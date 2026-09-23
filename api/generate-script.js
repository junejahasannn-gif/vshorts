export const maxDuration = 60;

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSceneCount(duration) {
  if (duration === 60) return 7;
  if (duration >= 180) return 10;
  return 5;
}

function buildResponseSchema(sceneCount) {
  return {
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
}

function cleanJsonText(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeScenes(scenes, requiredCount, totalDuration) {
  if (!Array.isArray(scenes)) {
    throw new Error("Gemini response does not contain scenes.");
  }

  if (scenes.length !== requiredCount) {
    throw new Error(
      `Gemini returned ${scenes.length} scenes, but ${requiredCount} scenes were required.`
    );
  }

  const normalized = scenes.map((scene) => ({
    visualPrompt: String(scene?.visualPrompt || ""),
    narration: String(scene?.narration || ""),
    dialogue: String(scene?.dialogue || ""),
    caption: String(scene?.caption || ""),
    duration: Math.max(1, Number(scene?.duration) || 1),
  }));

  let currentTotal = normalized.reduce(
    (sum, scene) => sum + scene.duration,
    0
  );

  // Adjust the last scene so the total duration exactly matches.
  const difference = totalDuration - currentTotal;

  normalized[normalized.length - 1].duration += difference;

  if (normalized[normalized.length - 1].duration < 1) {
    throw new Error("Invalid scene duration returned by Gemini.");
  }

  currentTotal = normalized.reduce(
    (sum, scene) => sum + scene.duration,
    0
  );

  if (currentTotal !== totalDuration) {
    throw new Error(
      `Scene duration mismatch. Expected ${totalDuration}s but received ${currentTotal}s.`
    );
  }

  return normalized;
}

async function callGemini(requestBody, apiKey) {
  const maxAttempts = 3;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `Gemini request attempt ${attempt}/${maxAttempts}`
      );

      const response = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();

      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        data = {
          rawResponse: responseText,
        };
      }

      if (response.ok) {
        return {
          ok: true,
          data,
          attempts: attempt,
        };
      }

      const status = response.status;

      console.error(
        `Gemini HTTP ${status} on attempt ${attempt}:`,
        data
      );

      lastError = {
        status,
        statusText: response.statusText,
        data,
      };

      // Retry only temporary/rate-limit errors.
      if (status === 503 || status === 429 || status === 500) {
        if (attempt < maxAttempts) {
          const waitTime = attempt * 2500;

          console.log(
            `Gemini temporarily unavailable. Retrying in ${waitTime}ms...`
          );

          await sleep(waitTime);
          continue;
        }
      }

      // Authentication, invalid request, model/config errors etc.
      // should not be retried.
      return {
        ok: false,
        error: lastError,
      };
    } catch (error) {
      console.error(
        `Gemini network error on attempt ${attempt}:`,
        error
      );

      lastError = {
        status: 0,
        statusText: "Network error",
        data: {
          message: error?.message || "Unknown network error",
        },
      };

      if (attempt < maxAttempts) {
        const waitTime = attempt * 2500;

        await sleep(waitTime);
        continue;
      }
    }
  }

  return {
    ok: false,
    error: lastError,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed.",
    });
  }

  try {
    const body = req.body || {};

    const story =
      body.story ||
      body.idea ||
      body.joke ||
      "";

    if (!String(story).trim()) {
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

    const sceneCount = getSceneCount(duration);

    const videoType =
      body.videoType || "Custom";

    const language =
      body.language || "Hindi";

    const aspectRatio =
      body.aspectRatio || "9:16";

    const voice =
      body.voice || "Neutral";

    const music =
      body.music || "Background Music";

    const branding =
      body.branding || "";

    const averageSceneDuration =
      Math.max(
        1,
        Math.round(duration / sceneCount)
      );

    const prompt = `
You are the lead AI director and professional short-form video scriptwriter for ViralTap Studio.

Create ONE complete short-form video.

USER STORY / IDEA:
${story}

VIDEO SETTINGS:
Video Type: ${videoType}
Language: ${language}
Aspect Ratio: ${aspectRatio}
Total Duration: ${duration} seconds
Voice: ${voice}
Music: ${music}
Branding: ${branding || "None"}

STRICT REQUIREMENTS:

1. Generate EXACTLY ${sceneCount} scenes.
2. Never generate fewer scenes.
3. Never generate more scenes.
4. Total duration of all scenes MUST equal exactly ${duration} seconds.
5. Each scene must contain:
   - visualPrompt
   - narration
   - dialogue
   - caption
   - duration
6. Average scene duration should be approximately ${averageSceneDuration} seconds.
7. Write narration/dialogue in ${language}.
8. Make visualPrompt detailed and cinematic.
9. The story should have a strong beginning, engaging middle and satisfying ending.
10. Make the video appropriate for ${aspectRatio}.
11. Do not return explanations outside the requested JSON structure.

Return ONLY the JSON object.
`;

    const requestBody = {
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
        responseSchema:
          buildResponseSchema(sceneCount),
      },
    };

    const geminiResult = await callGemini(
      requestBody,
      apiKey
    );

    if (!geminiResult.ok) {
      const error = geminiResult.error;

      return res.status(502).json({
        success: false,
        error: "Gemini API request failed.",
        geminiHttpStatus: error?.status || null,
        geminiStatusText:
          error?.statusText || null,
        geminiError:
          error?.data || null,
        attempts: 3,
        message:
          "Gemini was temporarily unavailable after automatic retries.",
      });
    }

    const data = geminiResult.data;

    const generatedText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      return res.status(502).json({
        success: false,
        error: "Gemini returned no generated content.",
        geminiResponse: data,
      });
    }

    const cleanedText =
      cleanJsonText(generatedText);

    let parsed;

    try {
      parsed = JSON.parse(cleanedText);
    } catch (error) {
      console.error(
        "Gemini JSON parse error:",
        error
      );

      return res.status(502).json({
        success: false,
        error: "Gemini returned invalid JSON.",
        rawText: generatedText,
      });
    }

    let scenes;

    try {
      scenes = normalizeScenes(
        parsed.scenes,
        sceneCount,
        duration
      );
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: error?.message || "Invalid scenes returned.",
        rawResult: parsed,
      });
    }

    return res.status(200).json({
      success: true,
      title:
        parsed.title ||
        "ViralTap Video",
      description:
        parsed.description ||
        "",
      scenes,
      attempts:
        geminiResult.attempts,
    });
  } catch (error) {
    console.error(
      "GENERATE SCRIPT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Generate script failed.",
      details:
        error?.message ||
        "Unknown error.",
    });
  }
}
