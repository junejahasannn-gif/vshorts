export const maxDuration = 60;

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

const ALLOWED_DURATIONS = new Set([30, 60, 180]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSceneCount(duration) {
  if (duration === 60) return 7;
  if (duration === 180) return 10;
  return 5;
}

function buildResponseSchema(sceneCount) {
  return {
    type: "object",
    properties: {
      title: {
        type: "string",
      },

      description: {
        type: "string",
      },

      scenes: {
        type: "array",
        minItems: sceneCount,
        maxItems: sceneCount,

        items: {
          type: "object",

          properties: {
            visualPrompt: {
              type: "string",
            },

            narration: {
              type: "string",
            },

            dialogue: {
              type: "string",
            },

            caption: {
              type: "string",
            },

            duration: {
              type: "integer",
              minimum: 1,
            },
          },

          required: [
            "visualPrompt",
            "narration",
            "dialogue",
            "caption",
            "duration",
          ],

          additionalProperties: false,
        },
      },
    },

    required: [
      "title",
      "description",
      "scenes",
    ],

    additionalProperties: false,
  };
}

function normalizeScenes(
  scenes,
  requiredCount,
  totalDuration
) {
  if (!Array.isArray(scenes)) {
    throw new Error(
      "Gemini response does not contain scenes."
    );
  }

  if (scenes.length !== requiredCount) {
    throw new Error(
      `Gemini returned ${scenes.length} scenes, but ${requiredCount} scenes were required.`
    );
  }

  const normalized = scenes.map(
    (scene, index) => {
      const visualPrompt = String(
        scene?.visualPrompt || ""
      ).trim();

      const narration = String(
        scene?.narration || ""
      ).trim();

      const dialogue = String(
        scene?.dialogue || ""
      ).trim();

      const caption = String(
        scene?.caption || ""
      ).trim();

      if (
        !visualPrompt ||
        !narration ||
        !caption
      ) {
        throw new Error(
          `Scene ${index + 1} is missing visualPrompt, narration, or caption.`
        );
      }

      return {
        visualPrompt,
        narration,
        dialogue,
        caption,
        duration: 1,
      };
    }
  );

  // Duration is controlled by the server.
  // This guarantees that the total is EXACTLY
  // the requested video duration.

  const baseDuration = Math.floor(
    totalDuration / requiredCount
  );

  const remainder =
    totalDuration % requiredCount;

  normalized.forEach(
    (scene, index) => {
      scene.duration =
        baseDuration +
        (index < remainder ? 1 : 0);
    }
  );

  const currentTotal =
    normalized.reduce(
      (sum, scene) =>
        sum + scene.duration,
      0
    );

  if (currentTotal !== totalDuration) {
    throw new Error(
      `Scene duration mismatch. Expected ${totalDuration}s but received ${currentTotal}s.`
    );
  }

  return normalized;
}

function getGeminiErrorMessage(
  data,
  fallback
) {
  return (
    data?.error?.message ||
    data?.error?.status ||
    fallback
  );
}

async function callGemini(
  requestBody,
  apiKey
) {
  const maxAttempts = 3;

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      15000
    );

    try {
      console.log(
        `Gemini request attempt ${attempt}/${maxAttempts}`
      );

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

          body: JSON.stringify(
            requestBody
          ),

          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      const responseText =
        await response.text();

      let data;

      try {
        data =
          JSON.parse(responseText);
      } catch {
        data = {
          error: {
            message:
              responseText ||
              "Non-JSON response from Gemini.",
          },
        };
      }

      if (response.ok) {
        return {
          ok: true,
          data,
          attempts: attempt,
        };
      }

      const status =
        response.status;

      console.error(
        `Gemini HTTP ${status} on attempt ${attempt}:`,
        data
      );

      lastError = {
        status,

        statusText:
          response.statusText,

        message:
          getGeminiErrorMessage(
            data,
            "Gemini request failed."
          ),
      };

      const retryable =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;

      if (
        retryable &&
        attempt < maxAttempts
      ) {
        const retryAfterHeader =
          response.headers.get(
            "retry-after"
          );

        const retryAfterSeconds =
          Number(
            retryAfterHeader
          );

        const waitTime =
          Number.isFinite(
            retryAfterSeconds
          ) &&
          retryAfterSeconds > 0
            ? Math.min(
                retryAfterSeconds * 1000,
                8000
              )
            : attempt * 2000;

        await sleep(waitTime);

        continue;
      }

      return {
        ok: false,
        error: lastError,
        attempts: attempt,
      };
    } catch (error) {
      clearTimeout(timeout);

      const isTimeout =
        error?.name ===
        "AbortError";

      console.error(
        `Gemini network error on attempt ${attempt}:`,
        error
      );

      lastError = {
        status: 0,

        statusText: isTimeout
          ? "Timeout"
          : "Network error",

        message: isTimeout
          ? "Gemini request timed out."
          : error?.message ||
            "Unknown network error.",
      };

      if (
        attempt < maxAttempts
      ) {
        await sleep(
          attempt * 2000
        );

        continue;
      }
    }
  }

  return {
    ok: false,

    error: lastError,

    attempts: maxAttempts,
  };
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,

      error:
        "Only POST requests are allowed.",
    });
  }

  try {
    const body =
      req.body || {};

    const story = String(
      body.story ||
        body.idea ||
        body.joke ||
        ""
    ).trim();

    if (!story) {
      return res.status(400).json({
        success: false,

        error:
          "Story or idea is required.",
      });
    }

    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,

        error:
          "GEMINI_API_KEY is missing in Vercel.",
      });
    }

    const duration =
      Number(body.duration) || 30;

    if (
      !ALLOWED_DURATIONS.has(
        duration
      )
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Duration must be 30, 60, or 180 seconds.",
      });
    }

    const sceneCount =
      getSceneCount(duration);

    const videoType = String(
      body.videoType ||
        "Custom"
    ).trim();

    const language = String(
      body.language ||
        "Hindi"
    ).trim();

    const aspectRatio =
      String(
        body.aspectRatio ||
          "9:16"
      ).trim();

    const voice = String(
      body.voice ||
        "Neutral"
    ).trim();

    const music = String(
      body.music ||
        "Background Music"
    ).trim();

    const branding = String(
      body.branding || ""
    ).trim();

    const systemInstruction = `
You are the lead AI director and professional short-form video scriptwriter for ViralTap Studio.

Your job is to transform the user's idea into a complete, engaging short-form video plan.

Return only the requested structured JSON object.

Rules:
- Follow the requested language.
- Make every scene visually specific and cinematic.
- Create a clear beginning, engaging middle, and satisfying ending.
- Keep narration natural for voice-over.
- Dialogue may be empty when the scene does not need spoken dialogue.
- Captions should be short and useful for on-screen text.
- visualPrompt must describe what should actually appear on screen.
- Do not include markdown fences.
- Do not include explanations outside the JSON structure.
`;

    const prompt = `
USER STORY / IDEA:
${story}

VIDEO SETTINGS:
Video Type: ${videoType}
Language: ${language}
Aspect Ratio: ${aspectRatio}
Total Duration: ${duration} seconds
Required Scenes: ${sceneCount}
Voice: ${voice}
Music: ${music}
Branding: ${branding || "None"}

Generate exactly ${sceneCount} scenes.

The total requested video duration is exactly ${duration} seconds.

The server will assign the final scene durations, so focus on producing the correct number and quality of scenes.
`;

    const requestBody = {
      systemInstruction: {
        parts: [
          {
            text:
              systemInstruction,
          },
        ],
      },

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

      // FIX:
      // Use responseMimeType + responseSchema
      // instead of responseFormat.text.mimeType.

      generationConfig: {
        responseMimeType:
          "application/json",

        responseSchema:
          buildResponseSchema(
            sceneCount
          ),

        temperature: 0.7,

        maxOutputTokens: 8192,
      },
    };

    const geminiResult =
      await callGemini(
        requestBody,
        apiKey
      );

    if (!geminiResult.ok) {
      const error =
        geminiResult.error;

      return res.status(502).json({
        success: false,

        error:
          "Gemini API request failed.",

        geminiHttpStatus:
          error?.status || null,

        geminiStatusText:
          error?.statusText || null,

        geminiError:
          error?.message || null,

        attempts:
          geminiResult.attempts || 3,
      });
    }

    const data =
      geminiResult.data;

    const candidate =
      data?.candidates?.[0];

    if (!candidate) {
      return res.status(502).json({
        success: false,

        error:
          "Gemini returned no candidate.",

        geminiError:
          "No candidates were returned by Gemini.",

        attempts:
          geminiResult.attempts,
      });
    }

    if (
      candidate.finishReason &&
      candidate.finishReason !==
        "STOP"
    ) {
      return res.status(502).json({
        success: false,

        error:
          "Gemini generation did not finish normally.",

        finishReason:
          candidate.finishReason,

        attempts:
          geminiResult.attempts,
      });
    }

    const generatedText =
      candidate?.content?.parts
        ?.map(
          (part) =>
            part?.text || ""
        )
        .join("")
        .trim();

    if (!generatedText) {
      return res.status(502).json({
        success: false,

        error:
          "Gemini returned no generated content.",

        finishReason:
          candidate.finishReason ||
          null,

        attempts:
          geminiResult.attempts,
      });
    }

    let parsed;

    try {
      parsed =
        JSON.parse(
          generatedText
        );
    } catch (error) {
      console.error(
        "Gemini JSON parse error:",
        error,
        generatedText
      );

      return res.status(502).json({
        success: false,

        error:
          "Gemini returned invalid JSON.",

        parseError:
          error?.message ||
          null,

        attempts:
          geminiResult.attempts,
      });
    }

    let scenes;

    try {
      scenes =
        normalizeScenes(
          parsed.scenes,
          sceneCount,
          duration
        );
    } catch (error) {
      console.error(
        "Gemini scene validation error:",
        error
      );

      return res.status(502).json({
        success: false,

        error:
          error?.message ||
          "Invalid scenes returned by Gemini.",

        attempts:
          geminiResult.attempts,
      });
    }

    return res.status(200).json({
      success: true,

      title:
        String(
          parsed.title ||
            "ViralTap Video"
        ).trim(),

      description:
        String(
          parsed.description ||
            ""
        ).trim(),

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

      error:
        "Generate script failed.",

      details:
        error?.message ||
        "Unknown error.",
    });
  }
}
