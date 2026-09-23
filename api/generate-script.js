export const maxDuration = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanJsonText(text) {
  if (!text) return "";

  let cleaned = String(text).trim();

  // Remove markdown fences
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Remove accidental BOM
  cleaned = cleaned.replace(/^\uFEFF/, "").trim();

  // If Gemini added text before/after the JSON,
  // extract the outermost JSON object.
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  return cleaned.trim();
}

function parseGeneratedJson(text) {
  const cleaned = cleanJsonText(text);

  if (!cleaned) {
    throw new Error("Gemini returned empty text.");
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    // Sometimes Gemini returns escaped JSON inside a string.
    try {
      const unescaped = cleaned
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");

      return JSON.parse(unescaped);
    } catch {
      throw new Error(
        `Invalid generated JSON: ${firstError.message}`
      );
    }
  }
}

function getDurationSeconds(duration) {
  const value = Number(duration);

  if (!Number.isFinite(value)) {
    return 30;
  }

  if (value <= 30) return 30;
  if (value <= 60) return 60;

  return 180;
}

function getSceneCount(durationSeconds, videoType) {
  if (videoType === "funny") {
    return 8;
  }

  if (durationSeconds <= 30) {
    return 5;
  }

  if (durationSeconds <= 60) {
    return 7;
  }

  return 10;
}

function distributeSceneDurations(totalSeconds, count) {
  if (count <= 0) return [];

  const durations = [];

  const base =
    Math.floor(
      (totalSeconds / count) * 10
    ) / 10;

  let used = 0;

  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      const remaining =
        Math.round(
          (totalSeconds - used) * 10
        ) / 10;

      durations.push(
        Math.max(1, remaining)
      );
    } else {
      const value = Math.max(1, base);

      durations.push(value);

      used += value;
    }
  }

  const total =
    durations.reduce(
      (sum, value) => sum + value,
      0
    );

  const difference =
    Math.round(
      (totalSeconds - total) * 10
    ) / 10;

  durations[durations.length - 1] =
    Math.max(
      1,
      Math.round(
        (
          durations[durations.length - 1] +
          difference
        ) * 10
      ) / 10
    );

  return durations;
}

function extractGeminiText(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => {
      if (
        typeof part?.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .join("")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed."
    });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "GEMINI_API_KEY is missing in Vercel."
      });
    }

    const body = req.body || {};

    const story = String(
      body.story ||
      body.idea ||
      body.joke ||
      ""
    ).trim();

    const videoType =
      body.videoType === "funny"
        ? "funny"
        : "normal";

    const language =
      String(
        body.language || "Hindi"
      ).trim();

    const aspectRatio =
      String(
        body.aspectRatio || "9:16"
      ).trim();

    const durationSeconds =
      getDurationSeconds(
        body.duration
      );

    const voice =
      String(
        body.voice || "Ankit"
      ).trim();

    const music =
      String(
        body.music ||
        "Background Music"
      ).trim();

    const branding =
      String(
        body.branding || ""
      ).trim();

    if (!story) {
      return res.status(400).json({
        success: false,
        error:
          videoType === "funny"
            ? "Please select or enter a joke."
            : "Please enter a story."
      });
    }

    const sceneCount =
      getSceneCount(
        durationSeconds,
        videoType
      );

    const sceneDurations =
      distributeSceneDurations(
        durationSeconds,
        sceneCount
      );

    const typeInstructions =
      videoType === "funny"
        ? `
This is a FUNNY SHORT VIDEO.

Make the content genuinely humorous,
simple and easy to understand.

Use:
- comedy timing
- funny reactions
- expressive characters
- visual comedy
- quick scene changes
- a strong opening hook
- a satisfying punchline

Do NOT make it a long story.
Do NOT create episodes.
Do NOT create seasons.
This is ONE complete funny video.
`
        : `
This is a NORMAL STORY VIDEO.

Turn the user's story into ONE complete
short-form video.

Do NOT create episodes.
Do NOT create seasons.
Do NOT split the response into multiple episodes.

Create one continuous video with:
- clear beginning
- development
- ending
`;

    const prompt = `
You are the AI video script engine for ViralTap Studio.

Create ONE complete AI short video.

VIDEO TYPE:
${videoType}

USER STORY / JOKE:
${JSON.stringify(story)}

LANGUAGE:
${language}

ASPECT RATIO:
${aspectRatio}

TOTAL VIDEO DURATION:
${durationSeconds} seconds

NUMBER OF SCENES:
EXACTLY ${sceneCount}

VOICE:
${voice}

BACKGROUND MUSIC:
${music}

BRANDING:
${branding || "No branding"}

${typeInstructions}

IMPORTANT LANGUAGE RULE:

Write narration, dialogue and captions
primarily in the requested language.

Write visualPrompt in clear English.

IMPORTANT SCENE RULES:

- Create EXACTLY ${sceneCount} scenes.
- Keep characters visually consistent.
- Every scene must continue naturally.
- Every scene needs a specific visual description.
- Do not use vague visual prompts.
- Avoid copyrighted characters.
- Create original characters.
- Make visual prompts suitable for a
  3D cartoon / cinematic AI video.
- Match ${aspectRatio}.
- Total scene duration must equal
  ${durationSeconds} seconds.

SCENE DURATIONS:

${sceneDurations.join(", ")} seconds

Every scene MUST contain:

- scene
- duration
- visualPrompt
- narration
- dialogue
- caption

Also provide:

- title
- hook
- description

CRITICAL JSON RULES:

Return ONLY one valid JSON object.

Do NOT use markdown.
Do NOT use code fences.
Do NOT write anything before the JSON.
Do NOT write anything after the JSON.

Use double quotes for all JSON keys
and string values.

Do not put unescaped double quotes
inside string values.

The scenes array MUST contain exactly
${sceneCount} objects.

Scene numbers MUST be:

${Array.from(
  { length: sceneCount },
  (_, i) => i + 1
).join(", ")}

Use this exact structure:

{
  "title": "string",
  "hook": "string",
  "description": "string",
  "language": "${language}",
  "videoType": "${videoType}",
  "aspectRatio": "${aspectRatio}",
  "duration": ${durationSeconds},
  "scenes": [
    {
      "scene": 1,
      "duration": ${sceneDurations[0] || 5},
      "visualPrompt": "string",
      "narration": "string",
      "dialogue": "string",
      "caption": "string"
    }
  ]
}
`;

    /*
     * Keep fallback models.
     */
    const models = [
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ];

    let videoData = null;
    let successfulModel = null;
    let lastError = null;

    /*
     * Try each model.
     */
    for (const model of models) {
      for (
        let attempt = 1;
        attempt <= 2;
        attempt++
      ) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
                "x-goog-api-key":
                  apiKey
              },

              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        text: prompt
                      }
                    ]
                  }
                ],

                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 16000,
                  responseMimeType:
                    "application/json"
                }
              })
            }
          );

          const responseText =
            await response.text();

          if (!response.ok) {
            lastError = {
              model,
              status: response.status,
              details:
                responseText.slice(
                  0,
                  4000
                )
            };

            const retryable =
              response.status === 429 ||
              response.status === 500 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504;

            if (
              retryable &&
              attempt === 1
            ) {
              await sleep(3000);
              continue;
            }

            break;
          }

          let geminiResponse;

          try {
            geminiResponse =
              JSON.parse(
                responseText
              );
          } catch {
            lastError = {
              model,
              status: response.status,
              details:
                "Gemini API itself returned non-JSON.",
              raw:
                responseText.slice(
                  0,
                  4000
                )
            };

            break;
          }

          const generatedText =
            extractGeminiText(
              geminiResponse
            );

          if (!generatedText) {
            lastError = {
              model,
              status: response.status,
              details:
                "Gemini returned no generated text.",
              raw:
                JSON.stringify(
                  geminiResponse
                ).slice(0, 4000)
            };

            break;
          }

          /*
           * Parse the actual generated JSON.
           */
          try {
            videoData =
              parseGeneratedJson(
                generatedText
              );

            successfulModel =
              model;

            break;

          } catch (parseError) {
            lastError = {
              model,
              status: response.status,
              details:
                parseError.message,
              raw:
                generatedText.slice(
                  0,
                  5000
                )
            };

            /*
             * Retry once because a model can
             * occasionally return malformed JSON.
             */
            if (attempt === 1) {
              await sleep(1500);
              continue;
            }

            break;
          }

        } catch (error) {
          lastError = {
            model,
            status: 500,
            details:
              error?.message ||
              "Network error"
          };

          if (attempt === 1) {
            await sleep(3000);
            continue;
          }

          break;
        }
      }

      if (videoData) {
        break;
      }
    }

    if (!videoData) {
      return res.status(503).json({
        success: false,

        error:
          "Gemini could not generate a valid video script.",

        details:
          lastError || null
      });
    }

    /*
     * Validate scenes.
     */

    if (
      !Array.isArray(
        videoData.scenes
      )
    ) {
      return res.status(500).json({
        success: false,
        error:
          "Gemini response has no scenes.",
        details:
          JSON.stringify(
            videoData
          ).slice(0, 5000)
      });
    }

    if (
      videoData.scenes.length !==
      sceneCount
    ) {
      return res.status(500).json({
        success: false,

        error:
          `Gemini generated ${videoData.scenes.length} scenes instead of ${sceneCount}.`
      });
    }

    /*
     * Normalize scenes.
     */

    const scenes =
      videoData.scenes.map(
        (scene, index) => ({
          scene:
            index + 1,

          duration:
            sceneDurations[index],

          visualPrompt:
            String(
              scene?.visualPrompt ||
              ""
            ),

          narration:
            String(
              scene?.narration ||
              ""
            ),

          dialogue:
            String(
              scene?.dialogue ||
              ""
            ),

          caption:
            String(
              scene?.caption ||
              ""
            )
        })
      );

    /*
     * Final response.
     */

    return res.status(200).json({
      success: true,

      model:
        successfulModel,

      videoType,

      title:
        String(
          videoData.title ||
          (
            videoType === "funny"
              ? "Funny Reel"
              : "AI Video"
          )
        ),

      hook:
        String(
          videoData.hook || ""
        ),

      description:
        String(
          videoData.description ||
          ""
        ),

      language,

      aspectRatio,

      duration:
        durationSeconds,

      voice,

      music,

      branding,

      totalScenes:
        sceneCount,

      scenes
    });

  } catch (error) {
    console.error(
      "VIRALTAP GENERATE SCRIPT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        "Server error while generating video script.",

      details:
        error?.message ||
        "Unknown error."
    });
  }
}
