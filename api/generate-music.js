import {
  put,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

export const maxDuration = 60;

const MODEL = "lyria-3-clip-preview";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const MUSIC_STYLES = {
  cinematic: {
    label: "Cinematic",
    emoji: "🎬",
    description: "Epic cinematic background score",
    prompt:
      "Epic cinematic instrumental background music with orchestral strings, deep cinematic drums, subtle risers and atmospheric textures. Emotional and dramatic, but restrained enough for narration. Instrumental only, no vocals.",
    related: ["emotional", "energetic", "suspense"],
  },

  suspense: {
    label: "Dark Suspense",
    emoji: "👻",
    description: "Dark tension and mystery atmosphere",
    prompt:
      "Dark suspense instrumental background score with low drones, subtle pulses, tense strings, atmospheric textures and restrained percussion. Mysterious, uneasy and cinematic. Designed underneath spoken narration. Instrumental only, no vocals.",
    related: ["cinematic", "emotional", "action"],
  },

  action: {
    label: "Epic Action",
    emoji: "⚡",
    description: "Powerful energetic action score",
    prompt:
      "High-energy cinematic action instrumental with punchy drums, powerful percussion, tense strings, deep bass and modern trailer elements. Exciting and powerful without overpowering narration. Instrumental only, no vocals.",
    related: ["energetic", "cinematic", "suspense"],
  },

  funny: {
    label: "Funny & Playful",
    emoji: "😂",
    description: "Light comedy background music",
    prompt:
      "Light playful comedy instrumental background music with quirky percussion, cheerful rhythmic patterns, playful plucks and humorous timing. Fun and energetic while leaving clear space for spoken narration. Instrumental only, no vocals.",
    related: ["energetic", "cinematic", "calm"],
  },

  romantic: {
    label: "Soft Romantic",
    emoji: "❤️",
    description: "Warm emotional romantic music",
    prompt:
      "Soft romantic instrumental background music with warm piano, gentle acoustic guitar, delicate strings and emotional atmospheric pads. Intimate, heartfelt and subtle under narration. Instrumental only, no vocals.",
    related: ["emotional", "calm", "cinematic"],
  },

  emotional: {
    label: "Emotional",
    emoji: "💙",
    description: "Heartfelt emotional background",
    prompt:
      "Emotional cinematic instrumental with warm piano, soft strings, gentle atmospheric pads and subtle emotional swells. Heartfelt and moving while remaining quiet enough for spoken narration. Instrumental only, no vocals.",
    related: ["romantic", "cinematic", "calm"],
  },

  energetic: {
    label: "Energetic",
    emoji: "🔥",
    description: "Upbeat modern energy",
    prompt:
      "Upbeat energetic instrumental background music with modern drums, bright synth textures, rhythmic bass and motivating momentum. Positive, dynamic and suitable underneath short-form video narration. Instrumental only, no vocals.",
    related: ["action", "funny", "cinematic"],
  },

  calm: {
    label: "Calm & Ambient",
    emoji: "🌙",
    description: "Peaceful subtle atmosphere",
    prompt:
      "Calm ambient instrumental background music with soft pads, gentle piano, subtle textures and minimal percussion. Peaceful, warm and unobtrusive, designed to sit underneath spoken narration. Instrumental only, no vocals.",
    related: ["emotional", "romantic", "cinematic"],
  },
};

function clean(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeStyle(value) {
  const style = clean(value).toLowerCase();

  return MUSIC_STYLES[style]
    ? style
    : "";
}

function collectSceneText(scenes) {
  if (!Array.isArray(scenes)) {
    return "";
  }

  return scenes
    .map((scene) => {
      const parts = [
        scene?.caption,
        scene?.narration,
        scene?.dialogue,
        scene?.visualPrompt,
      ];

      if (Array.isArray(scene?.lines)) {
        for (const line of scene.lines) {
          if (typeof line === "string") {
            parts.push(line);
          } else if (line && typeof line === "object") {
            parts.push(line.text);
          }
        }
      }

      return parts
        .map(clean)
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function detectMusicStyle({
  scenes,
  videoType,
  requestedStyle,
}) {
  const explicit = normalizeStyle(requestedStyle);

  if (explicit) {
    return explicit;
  }

  const type = clean(videoType).toLowerCase();
  const text = collectSceneText(scenes).toLowerCase();

  const combined = `${type} ${text}`;

  const weightedRules = [
    {
      style: "suspense",
      score: 0,
      keywords: [
        "horror",
        "horror story",
        "ghost",
        "haunted",
        "haunting",
        "monster",
        "demon",
        "fear",
        "scary",
        "dark",
        "suspense",
        "mystery",
        "secret",
        "killer",
        "crime",
        "murder",
        "chase",
        "tension",
        "भूत",
        "डर",
        "डराव",
        "रहस्य",
        "हत्या",
      ],
    },

    {
      style: "action",
      score: 0,
      keywords: [
        "action",
        "fight",
        "battle",
        "war",
        "attack",
        "hero",
        "punch",
        "fight scene",
        "लड़ाई",
        "युद्ध",
        "हमला",
      ],
    },

    {
      style: "funny",
      score: 0,
      keywords: [
        "funny",
        "comedy",
        "joke",
        "jokes",
        "laugh",
        "meme",
        "prank",
        "humor",
        "humour",
        "हंसी",
        "मजाक",
        "कॉमेड",
      ],
    },

    {
      style: "romantic",
      score: 0,
      keywords: [
        "romantic",
        "romance",
        "love",
        "lover",
        "couple",
        "relationship",
        "kiss",
        "प्यार",
        "मोहब्बत",
        "इश्क",
        "प्रेम",
      ],
    },

    {
      style: "emotional",
      score: 0,
      keywords: [
        "sad",
        "sadness",
        "emotional",
        "cry",
        "crying",
        "heart",
        "loss",
        "pain",
        "family",
        "दुख",
        "भावुक",
        "आंसू",
      ],
    },

    {
      style: "energetic",
      score: 0,
      keywords: [
        "motivat",
        "motivation",
        "success",
        "inspir",
        "inspiration",
        "goal",
        "dream",
        "hustle",
        "success",
        "मेहनत",
        "सफलता",
        "प्रेर",
      ],
    },

    {
      style: "calm",
      score: 0,
      keywords: [
        "calm",
        "peace",
        "peaceful",
        "relax",
        "relaxing",
        "meditat",
        "nature",
        "peace",
        "शांत",
        "सुकून",
      ],
    },
  ];

  for (const rule of weightedRules) {
    for (const keyword of rule.keywords) {
      if (combined.includes(keyword)) {
        rule.score += keyword.length > 6 ? 3 : 1;
      }
    }
  }

  weightedRules.sort((a, b) => b.score - a.score);

  if (weightedRules[0]?.score > 0) {
    return weightedRules[0].style;
  }

  if (type.includes("funny") || type.includes("comedy")) {
    return "funny";
  }

  if (type.includes("horror")) {
    return "suspense";
  }

  if (type.includes("action")) {
    return "action";
  }

  if (type.includes("romantic")) {
    return "romantic";
  }

  if (type.includes("motiv")) {
    return "energetic";
  }

  if (type.includes("emotional")) {
    return "emotional";
  }

  return "cinematic";
}

function buildPrompt({
  style,
  scenes,
  videoType,
  duration,
}) {
  const music = MUSIC_STYLES[style] || MUSIC_STYLES.cinematic;

  const context = collectSceneText(scenes)
    .slice(0, 1800);

  const type = clean(videoType) || "short-form video";

  return [
    `Create a ${duration || 30}-second background music clip for a ${type}.`,
    music.prompt,
    "",
    "The music is for an AI short video and must work underneath spoken narration.",
    "Keep the arrangement clean and avoid vocals.",
    "Avoid lyrics and avoid a dominant lead melody.",
    "Keep the music cinematic and professionally produced.",
    "Instrumental only, no vocals.",
    "",
    `Video context: ${context || "short-form social video"}.`,
  ].join("\n");
}

async function readJson(response) {
  const raw = await response.text();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Music API returned invalid JSON. HTTP ${response.status}.`
    );
  }
}

function extractAudio(data) {
  if (
    data?.output_audio?.data
  ) {
    return {
      data: data.output_audio.data,
      mimeType:
        data.output_audio.mime_type ||
        "audio/mpeg",
    };
  }

  const steps = Array.isArray(data?.steps)
    ? data.steps
    : [];

  for (const step of steps) {
    if (
      step?.type &&
      step.type !== "model_output"
    ) {
      continue;
    }

    const content = Array.isArray(step?.content)
      ? step.content
      : [];

    for (const block of content) {
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

function getExtension(mimeType) {
  const mime = clean(mimeType).toLowerCase();

  if (
    mime === "audio/mpeg" ||
    mime === "audio/mp3"
  ) {
    return "mp3";
  }

  return "mp3";
}

function safePathPart(value) {
  return clean(value)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

async function createReadUrl(pathname) {
  const validUntil =
    Date.now() + 60 * 60 * 1000;

  const token =
    await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil,
    });

  const { presignedUrl } =
    await presignUrl(token, {
      pathname,
      operation: "get",
      access: "private",
      validUntil,
      useCache: false,
    });

  return presignedUrl;
}

function getRelatedStyles(style) {
  const selected =
    MUSIC_STYLES[style] ||
    MUSIC_STYLES.cinematic;

  return selected.related.map(
    (relatedStyle) => {
      const item =
        MUSIC_STYLES[relatedStyle];

      return {
        style: relatedStyle,
        label: item.label,
        emoji: item.emoji,
        description: item.description,
      };
    }
  );
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
      return res.status(500).json({
        success: false,
        error:
          "GEMINI_API_KEY is not configured.",
      });
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

    const scenes =
      Array.isArray(body.scenes)
        ? body.scenes
        : [];

    const duration =
      Number(body.duration) || 30;

    const style =
      detectMusicStyle({
        scenes,
        videoType:
          body.videoType,
        requestedStyle:
          body.musicStyle,
      });

    const music =
      MUSIC_STYLES[style];

    const prompt =
      buildPrompt({
        style,
        scenes,
        videoType:
          body.videoType,
        duration,
      });

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
            input: prompt,
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
          `Gemini music generation failed with HTTP ${response.status}.`
      );
    }

    const audio =
      extractAudio(data);

    if (!audio?.data) {
      console.error(
        "GEMINI MUSIC RESPONSE:",
        JSON.stringify(data).slice(
          0,
          8000
        )
      );

      throw new Error(
        "Gemini music generation did not return audio."
      );
    }

    const buffer =
      Buffer.from(
        audio.data,
        "base64"
      );

    if (!buffer.length) {
      throw new Error(
        "Generated music file was empty."
      );
    }

    const extension =
      getExtension(
        audio.mimeType
      );

    const pathname =
      `music/${safePathPart(jobId)}/${style}.${extension}`;

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

    const relatedStyles =
      getRelatedStyles(
        style
      );

    return res.status(200).json({
      success: true,

      jobId,

      model: MODEL,

      musicStyle: style,

      recommended: {
        style,
        label: music.label,
        emoji: music.emoji,
        description:
          music.description,
        url,
        musicUrl: url,
        pathname,
      },

      relatedStyles,

      asset: {
        type: "music",
        url,
        musicUrl: url,
        pathname,
        mimeType:
          "audio/mpeg",
        sizeBytes:
          buffer.length,
      },

      url,
      musicUrl: url,

      expiresInSeconds:
        60 * 60,
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
