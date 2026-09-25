import {
  put,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

export const maxDuration = 60;

const GEMINI_MODEL =
  "gemini-3.1-flash-image";

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function getApiKey() {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  return apiKey;
}

function getAspectRatio(
  aspectRatio
) {
  if (
    aspectRatio === "16:9" ||
    aspectRatio === "1:1" ||
    aspectRatio === "9:16"
  ) {
    return aspectRatio;
  }

  return "9:16";
}

function buildPrompt({
  visualPrompt,
  scene,
  language,
}) {
  const prompt =
    clean(visualPrompt) ||
    clean(scene?.visualPrompt) ||
    clean(scene?.caption) ||
    clean(scene?.narration) ||
    "A cinematic scene";

  const languageText =
    clean(language) || "English";

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

async function readGeminiError(
  response
) {
  try {
    const data =
      await response.json();

    return (
      data?.error?.message ||
      JSON.stringify(data)
    );
  } catch {
    return `Gemini request failed with HTTP ${response.status}.`;
  }
}

function extractImage(data) {
  const candidates =
    data?.candidates || [];

  for (const candidate of candidates) {
    const parts =
      candidate?.content?.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      const inlineData =
        part?.inlineData;

      if (
        inlineData?.data &&
        inlineData?.mimeType
      ) {
        return {
          data: inlineData.data,
          mimeType:
            inlineData.mimeType,
        };
      }
    }
  }

  return null;
}

async function generateImage({
  prompt,
  aspectRatio,
}) {
  const apiKey =
    getApiKey();

  const response =
    await fetch(
      GEMINI_ENDPOINT,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
          "x-goog-api-key":
            apiKey,
        },

        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],

          generationConfig: {
            responseModalities: [
              "IMAGE",
            ],

            imageConfig: {
              aspectRatio,
              imageSize: "1K",
            },
          },
        }),
      }
    );

  if (!response.ok) {
    const message =
      await readGeminiError(
        response
      );

    throw new Error(
      `Gemini image generation failed (${response.status}): ${message}`
    );
  }

  const data =
    await response.json();

  const image =
    extractImage(data);

  if (!image) {
    throw new Error(
      "Gemini did not return an image."
    );
  }

  return image;
}

function base64ToBuffer(
  base64
) {
  return Buffer.from(
    base64,
    "base64"
  );
}

function extensionFromMime(
  mimeType
) {
  const mime =
    clean(mimeType)
      .toLowerCase();

  if (mime === "image/jpeg") {
    return "jpg";
  }

  if (mime === "image/webp") {
    return "webp";
  }

  return "png";
}

async function uploadImage({
  image,
  jobId,
  sceneIndex,
}) {
  const extension =
    extensionFromMime(
      image.mimeType
    );

  const safeJobId =
    clean(jobId)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      );

  const safeSceneIndex =
    Math.max(
      0,
      Number(sceneIndex) || 0
    );

  const pathname =
    `assets/${safeJobId}/scene-${safeSceneIndex + 1}.${extension}`;

  const buffer =
    base64ToBuffer(
      image.data
    );

  await put(
    pathname,
    buffer,
    {
      access: "private",

      contentType:
        image.mimeType,

      addRandomSuffix: false,

      allowOverwrite: true,
    }
  );

  return {
    pathname,
    sizeBytes:
      buffer.length,
    mimeType:
      image.mimeType,
  };
}

async function createReadUrl(
  pathname
) {
  const validUntil =
    Date.now() +
    60 * 60 * 1000;

  const token =
    await issueSignedToken({
      pathname,

      operations: ["get"],

      validUntil,
    });

  const {
    presignedUrl,
  } = await presignUrl(
    token,
    {
      pathname,

      operation: "get",

      access: "private",

      validUntil,

      useCache: false,
    }
  );

  return presignedUrl;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res.status(405).json({
      error:
        "Method not allowed.",
    });
  }

  try {
    const body =
      req.body || {};

    const scene =
      body.scene || {};

    const visualPrompt =
      clean(
        body.visualPrompt ||
          scene.visualPrompt
      );

    const jobId =
      clean(body.jobId);

    const sceneIndex =
      Number(body.sceneIndex) || 0;

    const language =
      clean(
        body.language
      ) || "English";

    const aspectRatio =
      getAspectRatio(
        body.aspectRatio
      );

    if (!jobId) {
      return res.status(400).json({
        error:
          "jobId is required.",
      });
    }

    if (!visualPrompt) {
      return res.status(400).json({
        error:
          "visualPrompt is required.",
      });
    }

    const prompt =
      buildPrompt({
        visualPrompt,
        scene,
        language,
      });

    const image =
      await generateImage({
        prompt,
        aspectRatio,
      });

    const uploaded =
      await uploadImage({
        image,
        jobId,
        sceneIndex,
      });

    const url =
      await createReadUrl(
        uploaded.pathname
      );

    return res.status(200).json({
      success: true,

      jobId,

      sceneIndex,

      asset: {
        type: "image",

        url,

        pathname:
          uploaded.pathname,

        mimeType:
          uploaded.mimeType,

        sizeBytes:
          uploaded.sizeBytes,

        aspectRatio,
      },

      model:
        GEMINI_MODEL,
    });
  } catch (error) {
    console.error(
      "generate-visuals error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Visual generation failed.",
    });
  }
}
