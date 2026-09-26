import { put, issueSignedToken, presignUrl } from "@vercel/blob";
import { toApiError, GEMINI_TTS_MODEL } from "../lib/ai-client.js";

export const maxDuration = 60;

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 25000;

// See api/generate-visuals.js for why this check exists.
function checkInternalAuth(req) {
  const expected = process.env.INTERNAL_WORKER_SECRET;
  if (!expected) return true;
  return req.headers["x-internal-secret"] === expected;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getLanguage(language) {
  const allowed = ["Hindi", "Hinglish", "English", "Gujarati"];
  return allowed.includes(language) ? language : "Hindi";
}

function getVoiceName(voice) {
  const value = clean(voice).toLowerCase();
  if (value.includes("female")) return "Kore";
  return "Puck";
}

function getSpeechStyle(language) {
  switch (language) {
    case "Hindi":
      return "Natural, clear Hindi narration with an engaging storytelling tone.";
    case "Gujarati":
      return "Natural, clear Gujarati narration with an engaging storytelling tone.";
    case "Hinglish":
      return "Natural Indian Hinglish narration with a smooth conversational storytelling tone.";
    case "English":
      return "Natural, clear English narration with an engaging storytelling tone.";
    default:
      return "Natural, clear narration with an engaging storytelling tone.";
  }
}

function buildTranscript({ scene }) {
  const lines = Array.isArray(scene?.lines)
    ? scene.lines
        .map((line) => (typeof line === "string" ? clean(line) : clean(line?.text)))
        .filter(Boolean)
    : [];

  const narration = clean(scene?.narration);
  const dialogue = clean(scene?.dialogue);
  const caption = clean(scene?.caption);

  if (lines.length) return lines.join(" ");
  if (narration) return narration;
  if (dialogue) return dialogue;
  if (caption) return caption;
  return "";
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

function extractAudio(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    for (const part of parts) {
      const inlineData = part?.inlineData;
      if (
        inlineData?.data &&
        inlineData?.mimeType &&
        String(inlineData.mimeType).toLowerCase().startsWith("audio/")
      ) {
        return { data: inlineData.data, mimeType: inlineData.mimeType };
      }
    }
  }

  return null;
}

async function generateSpeech({ transcript, voiceName, language }) {
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
        contents: [
          {
            role: "user",
            parts: [
              {
                text: transcript,
                speechMetadata: { style: getSpeechStyle(language) },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { voice: voiceName } },
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Gemini TTS request timed out.");
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
    const message = data?.error?.message || `Gemini TTS generation failed with HTTP ${status}.`;

    console.log(`[Gemini] voice status=${status} code=${code}`);

    const error = new Error(message);
    error.code = code;
    error.status = status;

    if (code === "GEMINI_QUOTA_EXCEEDED") {
      error.retryAfterSeconds = extractRetryAfterSeconds(response, data);
    }

    throw error;
  }

  const audio = extractAudio(data);

  if (!audio) {
    console.error("[Gemini] TTS response missing audio:", JSON.stringify(data).slice(0, 2000));

    const error = new Error("Gemini TTS did not return audio data.");
    error.code = "GEMINI_EMPTY_RESPONSE";
    error.status = 502;
    throw error;
  }

  return audio;
}

function extensionFromMime(mimeType) {
  const mime = clean(mimeType).toLowerCase();
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/l16") return "pcm";
  return "wav";
}

function base64ToBuffer(base64) {
  return Buffer.from(base64, "base64");
}

function safePart(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function uploadAudio({ audio, jobId, sceneIndex }) {
  const extension = extensionFromMime(audio.mimeType);
  const sceneNumber = Math.max(0, Number(sceneIndex) || 0) + 1;
  const pathname = `audio/${safePart(jobId)}/voice-${sceneNumber}.${extension}`;
  const buffer = base64ToBuffer(audio.data);

  await put(pathname, buffer, {
    access: "private",
    contentType: audio.mimeType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return { pathname, sizeBytes: buffer.length, mimeType: audio.mimeType };
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
    const jobId = clean(body.jobId);
    const sceneIndex = Number(body.sceneIndex) || 0;
    const language = getLanguage(clean(body.language));
    const voiceName = getVoiceName(body.voice);

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "jobId is required." },
      });
    }

    const transcript = buildTranscript({ scene });

    if (!transcript) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "No narration text was provided for this scene." },
      });
    }

    const audio = await generateSpeech({ transcript, voiceName, language });
    const uploaded = await uploadAudio({ audio, jobId, sceneIndex });
    const url = await createReadUrl(uploaded.pathname);

    return res.status(200).json({
      success: true,
      jobId,
      sceneIndex,
      language,
      voice: voiceName,
      transcript,
      asset: {
        type: "audio",
        url,
        pathname: uploaded.pathname,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
      },
      url,
      voiceUrl: url,
      model: GEMINI_TTS_MODEL,
    });
  } catch (error) {
    console.error("[GenerateVoice] error:", error?.code || error?.message);

    const { httpStatus, body } = toApiError(error);
    return res.status(httpStatus).json(body);
  }
}
