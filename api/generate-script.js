export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed.",
    });
  }

  try {
    const body = req.body || {};

    const story = body.story || body.idea || body.joke || "";

    if (!story.trim()) {
      return res.status(400).json({
        success: false,
        error: "Story or idea is required.",
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is missing in Vercel.",
      });
    }

    const duration = Number(body.duration) || 30;

    let sceneCount = 5;

    if (duration === 60) {
      sceneCount = 7;
    } else if (duration >= 180) {
      sceneCount = 10;
    }

    const videoType = body.videoType || "Custom";
    const language = body.language || "Hindi";
    const aspectRatio = body.aspectRatio || "9:16";
    const voice = body.voice || "Neutral";
    const music = body.music || "Background Music";
    const branding = body.branding || "";

    const prompt = `
You are the AI director and scriptwriter for ViralTap Studio.

Create ONE complete short-form video based on the user's idea.

USER STORY / IDEA:
${story}

VIDEO SETTINGS:
- Video type: ${videoType}
- Language: ${language}
- Aspect ratio: ${aspectRatio}
- Total duration: ${duration} seconds
- Voice: ${voice}
- Music: ${music}
- Branding: ${branding || "None"}

VERY IMPORTANT:
- Generate EXACTLY ${sceneCount} scenes.
- Do not generate fewer scenes.
- Do not generate more scenes.
- The total scene duration must equal exactly ${duration} seconds.
- Every scene must have all five fields:
  visualPrompt
  narration
  dialogue
  caption
  duration

Make the story engaging and suitable for a short video.
The narration and dialogue must be in the requested language.
Visual prompts must be detailed enough for an AI image/video generator.
Captions should be short and engaging.

Return ONLY valid JSON.
`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
        },
        description: {
          type: "STRING",
        },
        scenes: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              visualPrompt: {
                type: "STRING",
              },
              narration: {
                type: "STRING",
              },
              dialogue: {
                type: "STRING",
              },
              caption: {
                type: "STRING",
              },
              duration: {
                type: "INTEGER",
              },
            },
            required: [
              "visualPrompt",
              "narration",
              "dialogue",
              "caption",
              "duration",
            ],
          },
        },
      },
      required: ["title", "description", "scenes"],
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
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
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema,
          },
        }),
      }
    );

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Gemini returned an invalid response.",
        geminiHttpStatus: response.status,
        geminiRawResponse: responseText,
      });
    }

    if (!response.ok) {
      console.error("GEMINI ERROR:", data);

      return res.status(502).json({
        success: false,
        error: "Gemini API request failed.",
        geminiHttpStatus: response.status,
        geminiStatusText: response.statusText,
        geminiError: data,
      });
    }

    const generatedText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      return res.status(502).json({
        success: false,
        error: "Gemini returned no generated content.",
        geminiResponse: data,
      });
    }

    let result;

    try {
      result = JSON.parse(generatedText);
    } catch {
      const cleaned = generatedText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      try {
        result = JSON.parse(cleaned);
      } catch {
        return res.status(502).json({
          success: false,
          error: "Gemini returned invalid JSON.",
          rawText: generatedText,
        });
      }
    }

    if (!Array.isArray(result.scenes)) {
      return res.status(502).json({
        success: false,
        error: "Gemini response does not contain a scenes array.",
        result,
      });
    }

    if (result.scenes.length !== sceneCount) {
      return res.status(502).json({
        success: false,
        error: `Gemini returned ${result.scenes.length} scenes, but ${sceneCount} scenes were required.`,
        scenes: result.scenes,
      });
    }

    const scenes = result.scenes.map((scene, index) => ({
      visualPrompt: String(scene.visualPrompt || ""),
      narration: String(scene.narration || ""),
      dialogue: String(scene.dialogue || ""),
      caption: String(scene.caption || ""),
      duration: Number(scene.duration) || 1,
    }));

    const totalSceneDuration = scenes.reduce(
      (total, scene) => total + scene.duration,
      0
    );

    if (totalSceneDuration !== duration) {
      const difference = duration - totalSceneDuration;

      scenes[scenes.length - 1].duration += difference;

      if (scenes[scenes.length - 1].duration < 1) {
        return res.status(502).json({
          success: false,
          error: "Gemini generated invalid scene durations.",
          scenes,
        });
      }
    }

    return res.status(200).json({
      success: true,
      title: result.title || "ViralTap Video",
      description: result.description || "",
      scenes,
    });
  } catch (error) {
    console.error("GENERATE SCRIPT ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Generate script failed.",
      details: error?.message || "Unknown error",
    });
  }
}
