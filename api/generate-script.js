export const maxDuration = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanJsonText(text) {
  if (!text) return "";

  let cleaned = text.trim();

  // Remove markdown code fences if Gemini accidentally adds them
  cleaned = cleaned.replace(/^```json\s*/i, "");
  cleaned = cleaned.replace(/^```\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");

  return cleaned.trim();
}

function getDurationSeconds(duration) {
  const value = Number(duration);

  if (!Number.isFinite(value)) return 60;

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
  const durations = [];

  if (count <= 0) return durations;

  const base = Math.floor((totalSeconds / count) * 10) / 10;
  let used = 0;

  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      const last = Math.round((totalSeconds - used) * 10) / 10;
      durations.push(Math.max(1, last));
    } else {
      const value = Math.max(1, base);
      durations.push(value);
      used += value;
    }
  }

  // Small correction so total is exactly the requested duration
  const total = durations.reduce((a, b) => a + b, 0);
  const difference = Math.round((totalSeconds - total) * 10) / 10;

  durations[durations.length - 1] =
    Math.max(
      1,
      Math.round((durations[durations.length - 1] + difference) * 10) / 10
    );

  return durations;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed."
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is missing in Vercel."
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
      String(body.language || "Hindi").trim();

    const aspectRatio =
      String(body.aspectRatio || "9:16").trim();

    const durationSeconds =
      getDurationSeconds(body.duration);

    const voice =
      String(body.voice || "Ankit").trim();

    const music =
      String(body.music || "Background Music").trim();

    const branding =
      String(body.branding || "").trim();

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
      getSceneCount(durationSeconds, videoType);

    const sceneDurations =
      distributeSceneDurations(
        durationSeconds,
        sceneCount
      );

    const typeInstructions =
      videoType === "funny"
        ? `
This is a FUNNY SHORT VIDEO.

Make the content genuinely humorous, simple and easy to understand.

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

Turn the user's story into ONE complete short-form video.

Do NOT create episodes.
Do NOT create seasons.
Do NOT split the response into multiple episodes.
Create one continuous video with a clear beginning, development and ending.
`;

    const prompt = `
You are the AI video script engine for ViralTap Studio.

Create ONE complete AI short video.

VIDEO TYPE:
${videoType}

USER STORY / JOKE:
"${story}"

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
Write the narration, dialogue and captions primarily in the requested language.
The visual prompts should be written in clear English because they will be used by an image generation system.

IMPORTANT SCENE RULES:
- Create EXACTLY ${sceneCount} scenes.
- Keep characters visually consistent between scenes.
- Every scene must continue naturally from the previous scene.
- Each scene needs a specific visual description.
- Do not use vague visual prompts.
- Avoid copyrighted characters and existing movie characters.
- Create original characters.
- Make the visual prompts suitable for a 3D cartoon / cinematic AI video.
- Match the requested ${aspectRatio} aspect ratio.
- Keep the total scene durations equal to ${durationSeconds} seconds.

SCENE DURATIONS:
${sceneDurations.join(", ")} seconds

For every scene provide:
- scene number
- duration
- visualPrompt
- narration
- dialogue
- caption

Also provide:
- title
- hook
- description

Return ONLY valid JSON.

Use exactly this structure:

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

The scenes array MUST contain exactly ${sceneCount} scenes.

Scene numbers MUST be:
${Array.from(
  { length: sceneCount },
  (_, i) => i + 1
).join(", ")}

Return ONLY JSON.
No markdown.
No code fences.
No explanation outside JSON.
`;

    /*
     * Keep model list small.
     * If one model is temporarily unavailable,
     * the next model can be tried.
     */
    const models = [
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ];

    let geminiData = null;
    let successfulModel = null;
    let lastError = null;

    for (const model of models) {

      for (let attempt = 1; attempt <= 2; attempt++) {

        try {

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",

              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },

              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: prompt
                      }
                    ]
                  }
                ],

                generationConfig: {
                  maxOutputTokens: 16000,
                  responseMimeType: "application/json"
                }
              })
            }
          );

          const responseText =
            await response.text();

          if (response.ok) {

            try {

              geminiData =
                JSON.parse(responseText);

              successfulModel = model;

              break;

            } catch (error) {

              lastError = {
                status: response.status,
                model,
                details:
                  "Gemini response was not valid JSON.",
                raw:
                  responseText.slice(0, 4000)
              };

            }

          } else {

            lastError = {
              status: response.status,
              model,
              details: responseText.slice(0, 4000)
            };

            const retryable =
              response.status === 503 ||
              response.status === 429 ||
              response.status === 502 ||
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

        } catch (error) {

          lastError = {
            status: 500,
            model,
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

      if (geminiData) {
        break;
      }
    }


    if (!geminiData) {

      return res.status(503).json({
        success: false,
        error:
          "Gemini is temporarily unavailable. Please try again.",
        details:
          lastError
            ? JSON.stringify(lastError)
            : "No Gemini model returned a response."
      });

    }


    const generatedText =
      geminiData
        ?.candidates?.[0]
        ?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();


    if (!generatedText) {

      return res.status(500).json({
        success: false,
        error:
          "Gemini returned an empty response.",
        details:
          JSON.stringify(geminiData).slice(0, 5000)
      });

    }


    let videoData;

    try {

      const cleaned =
        cleanJsonText(generatedText);

      videoData =
        JSON.parse(cleaned);

    } catch (error) {

      return res.status(500).json({
        success: false,
        error:
          "Gemini returned invalid JSON.",
        details:
          generatedText.slice(0, 5000)
      });

    }


    /*
     * Validate scenes.
     */

    if (!Array.isArray(videoData.scenes)) {

      return res.status(500).json({
        success: false,
        error:
          "Gemini response has no scenes."
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
        (scene, index) => {

          return {
            scene: index + 1,

            duration:
              Number(scene?.duration) ||
              sceneDurations[index] ||
              5,

            visualPrompt:
              String(
                scene?.visualPrompt || ""
              ),

            narration:
              String(
                scene?.narration || ""
              ),

            dialogue:
              String(
                scene?.dialogue || ""
              ),

            caption:
              String(
                scene?.caption || ""
              )
          };

        }
      );


    /*
     * Make sure duration metadata is controlled
     * by the server rather than trusting Gemini.
     */

    scenes.forEach((scene, index) => {

      scene.duration =
        sceneDurations[index];

    });


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
          videoData.description || ""
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
      "SERVER ERROR:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Server error.",

      details:
        error?.message ||
        "Unknown error."

    });

  }
}
