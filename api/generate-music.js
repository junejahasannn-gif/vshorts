import {
  put,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

export const maxDuration = 60;

const MODEL = "lyria-3-clip-preview";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const STYLES = {
  cinematic:
    "Epic cinematic instrumental background music, orchestral strings, deep cinematic drums, subtle risers, no vocals, designed to sit under narration.",

  action:
    "High-energy cinematic action instrumental, punchy drums, powerful percussion, tense strings and modern trailer elements, no vocals.",

  suspense:
    "Dark suspense instrumental background score, low drones, subtle pulses, tense strings and restrained percussion, no vocals.",

  emotional:
    "Emotional cinematic instrumental, warm piano, soft strings, gentle atmospheric pads, heartfelt and subtle, no vocals.",

  romantic:
    "Soft romantic instrumental, warm piano, acoustic guitar and delicate strings, intimate and emotional, no vocals.",

  funny:
    "Light playful comedy instrumental, quirky percussion, marimba-like plucks and cheerful rhythm, no vocals.",

  energetic:
    "Upbeat energetic instrumental, modern drums, bright synths and motivating rhythm, no vocals.",

  calm:
    "Calm ambient instrumental, soft pads, gentle piano and minimal texture, peaceful and unobtrusive, no vocals.",
};

function clean(value) {
  return value == null
    ? ""
    : String(value).trim();
}

function chooseStyle(scenes) {
  const text = clean(
    (Array.isArray(scenes)
      ? scenes
      : []
    )
      .map((scene) => [
        scene?.caption,
        scene?.narration,
        scene?.dialogue,
        scene?.visualPrompt,

        ...(Array.isArray(scene?.lines)
          ? scene.lines.map((line) =>
              typeof line === "string"
                ? line
                : line?.text
            )
          : []),
      ]
        .filter(Boolean)
        .join(" ")
      )
      .join(" ")
  ).toLowerCase();

  const rules = [
    [
      "horror|haunt|ghost|monster|demon|fear|scary|भूत|डराव",
      "suspense",
    ],

    [
      "suspense|mystery|secret|killer|crime|chase|tension|रहस्य|हत्या",
      "suspense",
    ],

    [
      "action|fight|battle|war|attack|hero|punch|लड़ाई|युद्ध|हमला",
      "action",
    ],

    [
      "funny|comedy|joke|laugh|meme|हंसी|मजाक|कॉमेड",
      "funny",
    ],

    [
      "romantic|romance|love|lover|couple|kiss|प्यार|मोहब्बत|इश्क",
      "romantic",
    ],

    [
      "sad|emotional|cry|heart|loss|दुख|भावुक|आंसू",
      "emotional",
    ],

    [
      "motivat|success|inspir|goal|dream|मेहनत|सफलता|प्रेर",
      "energetic",
    ],

    [
      "calm|peace|relax|meditat|शांत|सुकून",
      "calm",
    ],
  ];

  for (const [pattern, style] of rules) {
    if (
      new RegExp(pattern, "i").test(text)
    ) {
      return style;
    }
  }

  return "cinematic";
}

function buildPrompt(style, scenes) {
  const selected =
    STYLES[style] ||
    STYLES.cinematic;

  const context = clean(
    (Array.isArray(scenes)
      ? scenes
      : []
    )
      .slice(0, 5)
      .map(
        (scene) =>
          scene?.caption ||
          scene?.narration ||
          scene?.dialogue ||
          scene?.visualPrompt ||
          ""
      )
      .filter(Boolean)
      .join(" ")
  ).slice(0, 1200);

  return (
    "Create a 30-second seamless instrumental " +
    "background music clip for an AI short video.\n" +
    selected +
    "\nThe music must remain suitable underneath " +
    "spoken narration. Avoid vocals, avoid dominant " +
    "lead melodies, and leave space for speech.\n" +
    "Video context: " +
    (context || "short-form social video") +
    ".\nInstrumental only, no vocals."
  );
}

async function readJson(response) {
  const raw =
    await response.text();

  try {
    return raw
      ? JSON.parse(raw)
      : {};
  } catch {
    throw new Error(
      "Music API returned invalid JSON. HTTP " +
        response.status
    );
  }
}

function extractAudio(data) {
  if (
    data?.output_audio?.data
  ) {
    return {
      data:
        data.output_audio.data,

      mimeType:
        data.output_audio.mime_type ||
        "audio/mpeg",
    };
  }

  for (
    const step of Array.isArray(
      data?.steps
    )
      ? data.steps
      : []
  ) {
    for (
      const block of Array.isArray(
        step?.content
      )
        ? step.content
        : []
    ) {
      if (
        block?.type === "audio" &&
        block?.data
      ) {
        return {
          data: block.data,

          mimeType:
            block.mime_type ||
            "audio/mpeg",
        };
      }
    }
  }

  return null;
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
      error: "Method not allowed.",
    });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured."
      );
    }

    const body =
      req.body || {};

    const jobId =
      clean(body.jobId);

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error:
          "jobId is required.",
      });
    }

    const requestedStyle =
      clean(
        body.musicStyle
      ).toLowerCase();

    const style =
      STYLES[requestedStyle]
        ? requestedStyle
        : chooseStyle(
            body.scenes
          );

    const response =
      await fetch(
        ENDPOINT,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey,
          },

          body: JSON.stringify({
            model: MODEL,

            input:
              buildPrompt(
                style,
                body.scenes
              ),
          }),
        }
      );

    const data =
      await readJson(
        response
      );

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          "Gemini music generation failed with HTTP " +
            response.status +
            "."
      );
    }

    const audio =
      extractAudio(data);

    if (!audio?.data) {
      throw new Error(
        "Gemini music generation did not return audio."
      );
    }

    const buffer =
      Buffer.from(
        audio.data,
        "base64"
      );

    const pathname =
      "music/" +
      jobId +
      "/" +
      style +
      ".mp3";

    await put(
      pathname,
      buffer,
      {
        access: "private",

        contentType:
          "audio/mpeg",

        addRandomSuffix:
          false,

        allowOverwrite:
          true,
      }
    );

    const url =
      await createReadUrl(
        pathname
      );

    return res.status(200).json({
      success: true,

      jobId,

      musicStyle:
        style,

      model:
        MODEL,

      asset: {
        type: "music",

        url,

        pathname,

        mimeType:
          "audio/mpeg",

        sizeBytes:
          buffer.length,
      },

      url,

      musicUrl:
        url,
    });
  } catch (error) {
    console.error(
      "generate-music error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Music generation failed.",
    });
  }
}
