import {
  put,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

export const maxDuration = 60;

const GEMINI_MODEL = "gemini-3.8-flash-tts";

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function clean(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  return apiKey;
}

function getLanguage(language) {
  const allowed = [
    "Hindi",
    "Hinglish",
    "English",
    "Gujarati",
  ];

  return allowed.includes(language)
    ? language
    : "Hindi";
}

function getVoiceName(voice) {
  const value = clean(voice).toLowerCase();

  if (value.includes("female")) {
    return "Kore";
  }

  return "Puck";
}

function buildTranscript({ scene, language }) {
  const lines = Array.isArray(scene?.lines)
    ? scene.lines
        .map((line) => {
          if (typeof line === "string") {
            return clean(line);
          }

          return clean(line?.text);
        })
        .filter(Boolean)
    : [];

  const narration = clean(scene?.narration);
  const dialogue = clean(scene?.dialogue);
  const caption = clean(scene?.caption);

  const transcript = lines.length
    ? lines.join(" ")
    : narration || dialogue || caption;

  if (!transcript) {
    return "";
  }

  const languageInstruction =
    language === "Hindi"
      ? "Speak naturally in Hindi."
      : language === "Gujarati"
        ? "Speak naturally in Gujarati."
        : language === "Hinglish"
          ? "Speak naturally in Hinglish, using a natural Indian conversational delivery."
          : "Speak naturally in English.";

  return [
    languageInstruction,
    "Read the following text exactly as written.",
    "Do not add extra words.",
    "Do not summarize.",
    "Do not explain anything.",
    "",
    transcript,
  ].join("\n");
}

async function readGeminiError(response) {
  try {
    const data = await response.json();

    return (
      data?.error?.message ||
      JSON.stringify(data)
    );
  } catch {
    return `Gemini TTS request failed with HTTP ${response.status}.`;
  }
}

function extractAudio(data) {
  const candidates = data?.candidates || [];

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      const inlineData = part?.inlineData;

      if (
        inlineData?.data &&
        inlineData?.mimeType &&
        String(
          inlineData.mimeType
        )
          .toLowerCase()
          .startsWith("audio/")
      ) {
        return {
          data: inlineData.data,
          mimeType: inlineData.mimeType,
        };
      }
    }
  }

  return null;
}

async function generateSpeech({
  transcript,
  voiceName,
}) {
  const apiKey = getApiKey();

  const response = await fetch(
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
                text: transcript,
              },
            ],
          },
        ],

        generationConfig: {
          responseModalities: [
            "AUDIO",
          ],

          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName,
              },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const message =
      await readGeminiError(response);

    throw new Error(
      `Gemini TTS generation failed (${response.status}): ${message}`
    );
  }

  const data =
    await response.json();

  const audio =
    extractAudio(data);

  if (!audio) {
    throw new Error(
      "Gemini TTS did not return audio."
    );
  }

  return audio;
}

function extensionFromMime(mimeType) {
  const mime =
    clean(mimeType).toLowerCase();

  if (
    mime === "audio/mpeg" ||
    mime === "audio/mp3"
  ) {
    return "mp3";
  }

  if (mime === "audio/ogg") {
    return "ogg";
  }

  return "wav";
}

function base64ToBuffer(base64) {
  return Buffer.from(
    base64,
    "base64"
  );
}

function safePart(value) {
  return clean(value).replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );
}

async function uploadAudio({
  audio,
  jobId,
  sceneIndex,
}) {
  const extension =
    extensionFromMime(
      audio.mimeType
    );

  const pathname =
    `audio/${safePart(
      jobId
    )}/voice-${
      Math.max(
        0,
        Number(sceneIndex) || 0
      ) + 1
    }.${extension}`;

  const buffer =
    base64ToBuffer(
      audio.data
    );

  await put(
    pathname,
    buffer,
    {
      access: "private",

      contentType:
        audio.mimeType,

      addRandomSuffix: false,

      allowOverwrite: true,
    }
  );

  return {
    pathname,

    sizeBytes:
      buffer.length,

    mimeType:
      audio.mimeType,
  };
}

async function createReadUrl(pathname) {
  const validUntil =
    Date.now() +
    60 * 60 * 1000;

  const token =
    await issueSignedToken({
      pathname,

      operations: [
        "get",
      ],

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
      success: false,

      error:
        "Method not allowed.",
    });
  }

  try {
    const body =
      req.body || {};

    const scene =
      body.scene || {};

    const jobId =
      clean(body.jobId);

    const sceneIndex =
      Number(
        body.sceneIndex
      ) || 0;

    const language =
      getLanguage(
        clean(
          body.language
        )
      );

    const voiceName =
      getVoiceName(
        body.voice
      );

    if (!jobId) {
      return res.status(400).json({
        success: false,

        error:
          "jobId is required.",
      });
    }

    const transcript =
      buildTranscript({
        scene,

        language,
      });

    if (!transcript) {
      return res.status(400).json({
        success: false,

        error:
          "No narration text was provided for this scene.",
      });
    }

    const audio =
      await generateSpeech({
        transcript,

        voiceName,
      });

    const uploaded =
      await uploadAudio({
        audio,

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

      language,

      voice:
        voiceName,

      transcript,

      asset: {
        type: "audio",

        url,

        pathname:
          uploaded.pathname,

        mimeType:
          uploaded.mimeType,

        sizeBytes:
          uploaded.sizeBytes,
      },

      model:
        GEMINI_MODEL,
    });
  } catch (error) {
    console.error(
      "generate-voice error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Voice generation failed.",
    });
  }
}
