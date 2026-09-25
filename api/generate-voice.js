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

  if (lines.length) {
    return lines.join(" ");
  }

  if (narration) {
    return narration;
  }

  if (dialogue) {
    return dialogue;
  }

  if (caption) {
    return caption;
  }

  return "";
}

async function readGeminiError(response) {
  try {
    const data = await response.json();

    return (
      data?.error?.message ||
      JSON.stringify(data)
    );
  } catch {
    return (
      `Gemini TTS request failed with HTTP ${response.status}.`
    );
  }
}

function extractAudio(data) {
  const candidates =
    Array.isArray(data?.candidates)
      ? data.candidates
      : [];

  for (const candidate of candidates) {
    const parts =
      Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts
        : [];

    for (const part of parts) {
      const inlineData =
        part?.inlineData;

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
  language,
}) {
  const apiKey = getApiKey();

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
                  text: transcript,

                  speechMetadata: {
                    style:
                      getSpeechStyle(
                        language
                      ),
                  },
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
                voice:
                  voiceName,
              },
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
      `Gemini TTS generation failed (${response.status}): ${message}`
    );
  }

  const data =
    await response.json();

  const audio =
    extractAudio(data);

  if (!audio) {
    console.error(
      "GEMINI TTS RESPONSE:",
      JSON.stringify(data).slice(
        0,
        5000
      )
    );

    throw new Error(
      "Gemini TTS did not return audio data."
    );
  }

  return audio;
}

function extensionFromMime(
  mimeType
) {
  const mime =
    clean(mimeType).toLowerCase();

  if (
    mime === "audio/wav" ||
    mime === "audio/x-wav"
  ) {
    return "wav";
  }

  if (
    mime === "audio/mpeg" ||
    mime === "audio/mp3"
  ) {
    return "mp3";
  }

  if (mime === "audio/ogg") {
    return "ogg";
  }

  if (mime === "audio/l16") {
    return "pcm";
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

  const sceneNumber =
    Math.max(
      0,
      Number(sceneIndex) || 0
    ) + 1;

  const pathname =
    `audio/${safePart(
      jobId
    )}/voice-${sceneNumber}.${extension}`;

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

async function createReadUrl(
  pathname
) {
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
  } =
    await presignUrl(
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

        language,
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

      url,

      voiceUrl: url,

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
