export const maxDuration = 60;

const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];

const ALLOWED_DURATIONS = new Set([
  30,
  60,
  180,
]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSceneCount(duration) {
  if (duration === 60) return 7;
  if (duration === 180) return 10;
  return 5;
}

/**
 * Gemini structured-output schema.
 *
 * IMPORTANT:
 * Do NOT use additionalProperties here.
 *
 * Every scene now contains:
 * visualPrompt
 * narration
 * dialogue
 * caption
 * lines[]
 * duration
 */
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

            lines: {
              type: "array",

              minItems: 2,
              maxItems: 5,

              items: {
                type: "object",

                properties: {
                  text: {
                    type: "string",
                  },

                  type: {
                    type: "string",
                  },
                },

                required: [
                  "text",
                  "type",
                ],
              },
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
            "lines",
            "duration",
          ],
        },
      },
    },

    required: [
      "title",
      "description",
      "scenes",
    ],
  };
}

function normalizeLines(
  scene,
  index
) {
  const rawLines =
    Array.isArray(scene?.lines)
      ? scene.lines
      : [];

  const lines = rawLines
    .map((line) => {
      if (
        typeof line === "string"
      ) {
        return {
          text: line.trim(),
          type: "narration",
        };
      }

      return {
        text: String(
          line?.text || ""
        ).trim(),

        type: String(
          line?.type ||
            "narration"
        ).trim(),
      };
    })
    .filter(
      (line) => line.text
    );

  /*
   * Safety fallback.
   *
   * Normally Gemini will always return
   * 2–5 lines because of the schema.
   *
   * This fallback prevents an old/partial
   * response from breaking the complete
   * render pipeline.
   */
  if (lines.length >= 2) {
    return lines.slice(0, 5);
  }

  const fallbackSource =
    String(
      scene?.narration ||
        scene?.dialogue ||
        scene?.caption ||
        ""
    ).trim();

  if (!fallbackSource) {
    throw new Error(
      `Scene ${index + 1} does not contain usable lines.`
    );
  }

  /*
   * Split longer narration into short
   * readable lines.
   */
  const words =
    fallbackSource.split(/\s+/);

  const fallbackLines = [];

  if (words.length <= 4) {
    fallbackLines.push({
      text: fallbackSource,
      type: "narration",
    });
  } else {
    const chunkSize = Math.ceil(
      words.length / 3
    );

    for (
      let i = 0;
      i < words.length &&
      fallbackLines.length < 5;
      i += chunkSize
    ) {
      const text =
        words
          .slice(
            i,
            i + chunkSize
          )
          .join(" ")
          .trim();

      if (text) {
        fallbackLines.push({
          text,
          type: "narration",
        });
      }
    }
  }

  while (
    fallbackLines.length < 2
  ) {
    fallbackLines.push({
      text: fallbackSource,
      type: "narration",
    });
  }

  return fallbackLines.slice(
    0,
    5
  );
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

      if (!visualPrompt) {
        throw new Error(
          `Scene ${index + 1} is missing visualPrompt.`
        );
      }

      if (!narration) {
        throw new Error(
          `Scene ${index + 1} is missing narration.`
        );
      }

      if (!caption) {
        throw new Error(
          `Scene ${index + 1} is missing caption.`
        );
      }

      const lines =
        normalizeLines(
          scene,
          index
        );

      return {
        visualPrompt,
        narration,
        dialogue,
        caption,
        lines,
        duration: 1,
      };
    }
  );

  /*
   * Server remains the final authority
   * for total scene duration.
   *
   * This guarantees:
   *
   * 30 sec -> exactly 30 sec
   * 60 sec -> exactly 60 sec
   * 180 sec -> exactly 180 sec
   */
  const baseDuration =
    Math.floor(
      totalDuration /
        requiredCount
    );

  const remainder =
    totalDuration %
    requiredCount;

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

  if (
    currentTotal !==
    totalDuration
  ) {
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

function isRetryableStatus(
  status
) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function callGeminiModel(
  model,
  requestBody,
  apiKey
) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const maxAttempts = 3;

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        30000
      );

    try {
      console.log(
        `Gemini ${model} attempt ${attempt}/${maxAttempts}`
      );

      const response =
        await fetch(
          endpoint,
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
          JSON.parse(
            responseText
          );
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
          model,
          attempts: attempt,
        };
      }

      const status =
        response.status;

      const message =
        getGeminiErrorMessage(
          data,
          "Gemini request failed."
        );

      console.error(
        `Gemini ${model} HTTP ${status}: ${message}`
      );

      lastError = {
        status,

        statusText:
          response.statusText,

        message,
      };

      if (
        isRetryableStatus(
          status
        ) &&
        attempt < maxAttempts
      ) {
        const baseDelay =
          Math.min(
            2000 *
              Math.pow(
                2,
                attempt - 1
              ),
            15000
          );

        const jitter =
          Math.floor(
            Math.random() * 1000
          );

        const waitTime =
          baseDelay + jitter;

        console.log(
          `Retrying ${model} in ${waitTime}ms`
        );

        await sleep(
          waitTime
        );

        continue;
      }

      return {
        ok: false,

        error: lastError,

        model,

        attempts: attempt,
      };
    } catch (error) {
      clearTimeout(timeout);

      const isTimeout =
        error?.name ===
        "AbortError";

      lastError = {
        status: 0,

        statusText:
          isTimeout
            ? "Timeout"
            : "Network error",

        message:
          isTimeout
            ? "Gemini request timed out."
            : error?.message ||
              "Unknown network error.",
      };

      console.error(
        `Gemini ${model} network error:`,
        error
      );

      if (
        attempt <
        maxAttempts
      ) {
        const baseDelay =
          Math.min(
            2000 *
              Math.pow(
                2,
                attempt - 1
              ),
            15000
          );

        const jitter =
          Math.floor(
            Math.random() * 1000
          );

        await sleep(
          baseDelay + jitter
        );

        continue;
      }
    }
  }

  return {
    ok: false,

    error: lastError,

    model,

    attempts:
      maxAttempts,
  };
}

async function callGemini(
  requestBody,
  apiKey
) {
  let lastResult = null;

  for (
    const model of GEMINI_MODELS
  ) {
    const result =
      await callGeminiModel(
        model,
        requestBody,
        apiKey
      );

    if (result.ok) {
      return result;
    }

    lastResult = result;

    const status =
      result.error?.status;

    /*
     * Do not blindly switch models
     * for client/configuration errors.
     */
    if (
      status &&
      !isRetryableStatus(
        status
      )
    ) {
      return result;
    }

    /*
     * 503 / 429 / 5xx:
     * try the fallback model.
     */
    console.log(
      `Trying fallback Gemini model after ${model} failure.`
    );
  }

  return (
    lastResult || {
      ok: false,

      error: {
        status: 503,

        statusText:
          "Service Unavailable",

        message:
          "All Gemini models are temporarily unavailable.",
      },

      attempts: 3,
    }
  );
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

    const story =
      String(
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
      Number(
        body.duration
      ) || 30;

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
      getSceneCount(
        duration
      );

    const videoType =
      String(
        body.videoType ||
          "Custom"
      ).trim();

    const language =
      String(
        body.language ||
          "Hindi"
      ).trim();

    const aspectRatio =
      String(
        body.aspectRatio ||
          "9:16"
      ).trim();

    const voice =
      String(
        body.voice ||
          "Neutral"
      ).trim();

    const music =
      String(
        body.music ||
          "Background Music"
      ).trim();

    const branding =
      String(
        body.branding ||
          ""
      ).trim();

    const systemInstruction = `
You are the lead AI director and professional short-form video scriptwriter for ViralTap Studio.

Transform the user's idea into a complete, engaging short-form video plan.

Return ONLY the requested JSON object.

Rules:

- Follow the requested language.
- Make every scene visually specific and cinematic.
- Create a clear beginning, engaging middle, and satisfying ending.
- Keep narration natural for voice-over.
- Dialogue may be empty when the scene does not need spoken dialogue.
- Captions should be short and useful for on-screen text.
- visualPrompt must describe what should actually appear on screen.
- Do not use markdown.
- Do not use code fences.
- Do not add explanations outside the JSON.
- Generate exactly the requested number of scenes.
- Every scene must contain:
  visualPrompt
  narration
  dialogue
  caption
  lines
  duration

IMPORTANT LINE-BY-LINE RULE:

Every scene must contain 2 to 5 short lines.

The lines are the individual pieces of text that will appear on screen one after another.

Each line must be short enough to read comfortably.

Do NOT put the entire scene narration into one giant line.

Break the scene into natural beats.

Example:

Line 1:
"Raat ke 2 baje..."

Line 2:
"Usse ek ajeeb awaaz sunai di."

Line 3:
"Darwaza khud-ba-khud khul gaya."

Line 4:
"Ab andar kaun tha?"

Each line must contain:
text
type

The type should normally be:
narration
dialogue
caption

Use narration for spoken narration.
Use dialogue for character speech.
Use caption for important on-screen text.

Keep line order meaningful.

Short lines should feel fast.
Longer lines can naturally remain on screen longer.

Do not create empty lines.
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

For every scene:

1. Create a detailed visualPrompt.
2. Create natural narration.
3. Add dialogue only when useful.
4. Create a short caption.
5. Create 2–5 short lines.
6. Each line must have:
   - text
   - type
7. Keep lines short and readable.
8. Break long narration into multiple natural lines.
9. Preserve the story flow from one scene to the next.
10. Make the opening immediately engaging.
11. Build tension/emotion/action naturally.
12. Give the story a satisfying ending.

LINE TIMING INTENT:

The final video renderer will show these lines one after another.

Therefore:

- Very short lines should be suitable for quick display.
- Medium lines should have normal reading time.
- Longer lines should stay visible longer.
- Dramatic or suspense lines may be slightly slower.
- Do not make every line the same length.
- Do not combine several sentences into one unnecessarily long line.

The server will assign the final scene durations.

Return only valid JSON matching the requested schema.
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

      generationConfig: {
        responseMimeType:
          "application/json",

        responseSchema:
          buildResponseSchema(
            sceneCount
          ),

        maxOutputTokens:
          8192,
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

        geminiModel:
          geminiResult.model ||
          null,

        geminiHttpStatus:
          error?.status ||
          null,

        geminiStatusText:
          error?.statusText ||
          null,

        geminiError:
          error?.message ||
          null,

        attempts:
          geminiResult.attempts ||
          3,
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

        geminiModel:
          geminiResult.model,

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

        geminiModel:
          geminiResult.model,

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

        geminiModel:
          geminiResult.model,

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

        geminiModel:
          geminiResult.model,

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

        geminiModel:
          geminiResult.model,

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

      geminiModel:
        geminiResult.model,

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
