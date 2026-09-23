export const maxDuration = 60;

function getDurationSeconds(duration) {
  const value = Number(duration);

  if (!Number.isFinite(value)) return 60;
  if (value <= 30) return 30;
  if (value <= 60) return 60;

  return 180;
}

function getSceneCount(durationSeconds) {
  if (durationSeconds <= 30) return 5;
  if (durationSeconds <= 60) return 7;
  return 10;
}

function distributeSceneDurations(totalSeconds, count) {
  const result = [];
  const base = Math.floor((totalSeconds / count) * 10) / 10;

  let used = 0;

  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      result.push(
        Math.max(
          1,
          Math.round((totalSeconds - used) * 10) / 10
        )
      );
    } else {
      result.push(base);
      used += base;
    }
  }

  return result;
}

function extractGeminiText(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || ""
  );
}

function parseJsonSafely(text) {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let cleaned = text.trim();

  // Remove markdown fences if Gemini adds them.
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Find the JSON object if extra text somehow exists.
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

function normalizeScene(scene, index, duration) {
  return {
    scene: index + 1,
    duration,
    visualPrompt: String(
      scene?.visualPrompt ||
      scene?.imagePrompt ||
      ""
    ),
    narration: String(
      scene?.narration ||
      scene?.voiceover ||
      scene?.text ||
      ""
    ),
    dialogue: String(
      scene?.dialogue ||
      ""
    ),
    caption: String(
      scene?.caption ||
      scene?.text ||
      ""
    )
  };
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
      body.prompt ||
      ""
    ).trim();

    const videoType = String(
      body.videoType ||
      "normal"
    ).trim();

    const language = String(
      body.language ||
      "Hindi"
    ).trim();

    const aspectRatio = String(
      body.aspectRatio ||
      "9:16"
    ).trim();

    const durationSeconds = getDurationSeconds(
      body.duration
    );

    const voice = String(
      body.voice ||
      "Ankit"
    ).trim();

    const music = String(
      body.music ||
      "Background Music"
    ).trim();

    const branding = String(
      body.branding ||
      ""
    ).trim();

    if (!story) {
      return res.status(400).json({
        success: false,
        error: "Please enter a story or video idea."
      });
    }

    const sceneCount = getSceneCount(
      durationSeconds
    );

    const sceneDurations =
      distributeSceneDurations(
        durationSeconds,
        sceneCount
      );

    const sceneDurationText =
      sceneDurations
        .map((value, index) => `Scene ${index + 1}: ${value}s`)
        .join("\n");

    const prompt = `
You are the core AI video generation engine for ViralTap Studio.

Your job is to transform the user's idea into ONE complete short-form video.

IMPORTANT:
ViralTap Studio is NOT only a funny-video generator.

It must support ANY type of video, including:
- comedy
- funny
- story
- emotional
- romantic
- horror
- action
- motivational
- educational
- dramatic
- kids stories
- documentary style
- suspense
- inspirational
- custom user-created concepts

VIDEO TYPE:
${videoType}

USER IDEA:
${JSON.stringify(story)}

LANGUAGE:
${language}

ASPECT RATIO:
${aspectRatio}

TOTAL DURATION:
${durationSeconds} seconds

NUMBER OF SCENES:
${sceneCount}

VOICE:
${voice}

BACKGROUND MUSIC:
${music}

BRANDING:
${branding || "None"}

Create ONE continuous video.

Do NOT create:
- episodes
- seasons
- chapters
- multiple videos
- sequel ideas

The result must be a complete standalone video based on the user's idea.

LANGUAGE RULE:
Narration, dialogue and captions should primarily use the requested language.

VISUAL PROMPT RULE:
visualPrompt must be written in clear English because it will later be sent to an AI image/video generation system.

CHARACTER CONSISTENCY:
If characters appear, maintain their appearance, clothing, age and identity consistently across scenes.

VISUAL QUALITY:
Create detailed cinematic visual prompts suitable for AI image/video generation.

SCENE TIMING:
The scene durations must exactly follow these values:

${sceneDurationText}

Each scene must contain:

scene
duration
visualPrompt
narration
dialogue
caption

CONTENT RULES:
- Start with a strong hook.
- Keep the story understandable.
- Make every scene continue naturally from the previous scene.
- Match the tone of the requested video type.
- Use original characters.
- Do not use copyrighted movie characters.
- Do not mention these instructions in the output.
- Do not create unnecessary text.
- Make the ending satisfying.

Return ONLY valid JSON.

The response MUST be a single JSON object with this exact structure:

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
`;

    /*
     * ONE Gemini request.
     *
     * Native JSON mode is used so Gemini is instructed
     * to return structured JSON instead of Markdown.
     */
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
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
            temperature: 0.7,
            maxOutputTokens: 16000,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const responseText =
      await response.text();

    if (!response.ok) {
      console.error(
        "GEMINI API ERROR:",
        response.status,
        responseText
      );

      return res.status(502).json({
        success: false,
        error: "Gemini API request failed.",
        details: responseText.slice(0, 5000)
      });
    }

    let geminiData;

    try {
      geminiData =
        JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Gemini API returned an unreadable response.",
        details: responseText.slice(0, 5000)
      });
    }

    const generatedText =
      extractGeminiText(geminiData);

    if (!generatedText) {
      console.error(
        "EMPTY GEMINI RESPONSE:",
        JSON.stringify(geminiData)
      );

      return res.status(502).json({
        success: false,
        error: "Gemini returned an empty response.",
        details: JSON.stringify(
          geminiData
        ).slice(0, 5000)
      });
    }

    let videoData;

    try {
      videoData =
        parseJsonSafely(
          generatedText
        );
    } catch (error) {
      console.error(
        "INVALID GEMINI JSON:",
        generatedText
      );

      return res.status(502).json({
        success: false,
        error: "Gemini returned invalid JSON.",
        details: generatedText.slice(0, 5000)
      });
    }

    if (
      !videoData ||
      !Array.isArray(videoData.scenes)
    ) {
      return res.status(502).json({
        success: false,
        error: "Gemini response contains no valid scenes."
      });
    }

    if (
      videoData.scenes.length !==
      sceneCount
    ) {
      return res.status(502).json({
        success: false,
        error:
          `Gemini generated ${videoData.scenes.length} scenes instead of ${sceneCount}.`
      });
    }

    const scenes =
      videoData.scenes.map(
        (scene, index) =>
          normalizeScene(
            scene,
            index,
            sceneDurations[index]
          )
      );

    return res.status(200).json({
      success: true,

      model: "gemini-3.6-flash",

      title: String(
        videoData.title ||
        "ViralTap Video"
      ),

      hook: String(
        videoData.hook ||
        ""
      ),

      description: String(
        videoData.description ||
        ""
      ),

      language,

      videoType,

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
      "GENERATE SCRIPT SERVER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Server error while generating video script.",
      details:
        error?.message ||
        "Unknown error."
    });
  }
}
