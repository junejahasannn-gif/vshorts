import { put, issueSignedToken, presignUrl } from "@vercel/blob";
import { toApiError, GEMINI_IMAGE_MODEL } from "../lib/ai-client.js";

export const maxDuration = 60;

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_IMAGE_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 25000;

// This endpoint is meant to be called only by the render pipeline
// (scripts/render-runner.mjs from GitHub Actions), never directly by a
// browser — each call costs real Gemini money. If INTERNAL_WORKER_SECRET
// is set, require it. If it's not set, the check is skipped (so this
// still works before you've configured the secret), but you should set
// it in Vercel + in the GitHub Actions workflow env to close this off.
function checkInternalAuth(req) {
  const expected = process.env.INTERNAL_WORKER_SECRET;

  if (!expected) return true;

  const provided = req.headers["x-internal-secret"];

  return provided === expected;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getAspectRatio(aspectRatio) {
  if (aspectRatio === "16:9" || aspectRatio === "1:1" || aspectRatio === "9:16") {
    return aspectRatio;
  }
  return "9:16";
}

function buildPrompt({ visualPrompt, scene, language }) {
  const prompt =
    clean(visualPrompt) ||
    clean(scene?.visualPrompt) ||
    clean(scene?.caption) ||
    clean(scene?.narration) ||
    "A cinematic scene";

  const languageText = clean(language) || "English";

  return `
Create a premium cinematic visual for an AI-generated short video.

Visual description:
${prompt}

Style requirements:
- professional cinematic composition
- realistic detailed lighting
- strong depth and atmosphere
- visually interesting foreground, middle ground and background
- natural shadows and highlights
- detailed environment
- consistent subject appearance
- no visible watermark
- no logos
- no UI elements
- no random text
- no subtitles
- no captions
- no distorted faces
- no extra limbs or malformed objects
- composition suitable for a social-media video
- high visual quality

Language context:
${languageText}

The image must communicate the scene visually without requiring text.
`;
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return "GEMINI_AUTH_ERROR";
  if (status === 429) return "GEMINI_QUOTA_EXCEEDED";
  if (status === 400) return "GEMINI_BAD_REQUEST";
  if (status === 404) return "GEMINI_NOT_FOUND";
  if (status >= 500) return "GEMINI_UPSTREAM_ERROR";
  return "GEMINI_UNKNOWN_ERROR";
}

function extractRetryAfterSeconds(response, data) {
  const header = response?.headers?.get?.("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header);

  const details = data?.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const match =
        typeof detail?.retryDelay === "string" &&
        detail.retryDelay.match(/^([\d.]+)s$/);
      if (match) return Math.ceil(Number(match[1]));
    }
  }
  return null;
}

function extractImage(data) {
  const candidates = data?.candidates || [];

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      const inlineData = part?.inlineData;
      if (inlineData?.data && inlineData?.mimeType) {
        return { data: inlineData.data, mimeType: inlineData.mimeType };
      }
    }
  }

  return null;
}

async function generateImage({ prompt, aspectRatio }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error("GEMINI_API_KEY is not configured.");
    error.code = "GEMINI_AUTH_ERROR";
    error.status = 500;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          responseFormat: { image: { aspectRatio, imageSize: "1K" } },
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Gemini image request timed out.");
      timeoutError.code = "GEMINI_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }

    const netError = new Error(error?.message || "Network error contacting Gemini.");
    netError.code = "GEMINI_NETWORK_ERROR";
    netError.status = 0;
    throw netError;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const status = response.status;
    const code = classifyStatus(status);
    const message = data?.error?.message || `Gemini image generation failed with HTTP ${status}.`;

    console.log(`[Gemini] visuals status=${status} code=${code}`);

    const error = new Error(message);
    error.code = code;
    error.status = status;

    if (code === "GEMINI_QUOTA_EXCEEDED") {
      error.retryAfterSeconds = extractRetryAfterSeconds(response, data);
    }

    throw error;
  }

  const image = extractImage(data);

  if (!image) {
    const error = new Error("Gemini did not return an image.");
    error.code = "GEMINI_EMPTY_RESPONSE";
    error.status = 502;
    throw error;
  }

  return image;
}

function base64ToBuffer(base64) {
  return Buffer.from(base64, "base64");
}

function extensionFromMime(mimeType) {
  const mime = clean(mimeType).toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function uploadImage({ image, jobId, sceneIndex }) {
  const extension = extensionFromMime(image.mimeType);
  const safeJobId = clean(jobId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeSceneIndex = Math.max(0, Number(sceneIndex) || 0);
  const pathname = `assets/${safeJobId}/scene-${safeSceneIndex + 1}.${extension}`;
  const buffer = base64ToBuffer(image.data);

  await put(pathname, buffer, {
    access: "private",
    contentType: image.mimeType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return { pathname, sizeBytes: buffer.length, mimeType: image.mimeType };
}

async function createReadUrl(pathname) {
  const validUntil = Date.now() + 60 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    pathname,
    operation: "get",
    access: "private",
    validUntil,
    useCache: false,
  });
  return presignedUrl;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
  }

  if (!checkInternalAuth(req)) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "This endpoint requires internal authorization." },
    });
  }

  try {
    const body = req.body || {};
    const scene = body.scene || {};
    const visualPrompt = clean(body.visualPrompt || scene.visualPrompt);
    const jobId = clean(body.jobId);
    const sceneIndex = Number(body.sceneIndex) || 0;
    const language = clean(body.language) || "English";
    const aspectRatio = getAspectRatio(body.aspectRatio);

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "jobId is required." },
      });
    }

    if (!visualPrompt) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "visualPrompt is required." },
      });
    }

    const prompt = buildPrompt({ visualPrompt, scene, language });
    const image = await generateImage({ prompt, aspectRatio });
    const uploaded = await uploadImage({ image, jobId, sceneIndex });
    const url = await createReadUrl(uploaded.pathname);

    return res.status(200).json({
      success: true,
      jobId,
      sceneIndex,
      asset: {
        type: "image",
        url,
        pathname: uploaded.pathname,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        aspectRatio,
      },
      model: GEMINI_IMAGE_MODEL,
    });
  } catch (error) {
    console.error("[GenerateVisuals] error:", error?.code || error?.message);

    const { httpStatus, body } = toApiError(error);
    return res.status(httpStatus).json(body);
  }
}
