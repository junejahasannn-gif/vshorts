import { toApiError, GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK_MODEL } from "../lib/ai-client.js";

export const maxDuration = 60;

// Centralized model config (see lib/ai-client.js / lib/video-config.js)
// instead of hardcoding model names here.
const GEMINI_MODELS = [GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK_MODEL];

const ALLOWED_DURATIONS = new Set([30, 60, 180]);

// Per-model fetch timeout. Kept comfortably under maxDuration so that
// even (timeout + a couple of scenes of other work) never risks 60s.
const GEMINI_TIMEOUT_MS = 25000;

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
      title: { type: "string" },
      description: { type: "string" },
      scenes: {
        type: "array",
        minItems: sceneCount,
        maxItems: sceneCount,
        items: {
          type: "object",
          properties: {
            visualPrompt: { type: "string" },
            narration: { type: "string" },
            dialogue: { type: "string" },
            caption: { type: "string" },
            lines: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  type: { type: "string" },
                },
                required: ["text", "type"],
              },
            },
            duration: { type: "integer", minimum: 1 },
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
    required: ["title", "description", "scenes"],
  };
}

function normalizeLines(scene, index) {
  const rawLines = Array.isArray(scene?.lines) ? scene.lines : [];

  const lines = rawLines
    .map((line) => {
      if (typeof line === "string") {
        return { text: line.trim(), type: "narration" };
      }

      return {
        text: String(line?.text || "").trim(),
        type: String(line?.type || "narration").trim(),
      };
    })
    .filter((line) => line.text);

  if (lines.length >= 2) {
    return lines.slice(0, 5);
  }

  const fallbackSource = String(
    scene?.narration || scene?.dialogue || scene?.caption || ""
  ).trim();

  if (!fallbackSource) {
    const error = new Error(
      `Scene ${index + 1} does not contain usable lines.`
    );
    error.code = "GEMINI_INVALID_SCENES";
    error.status = 502;
    throw error;
  }

  const words = fallbackSource.split(/\s+/);
  const fallbackLines = [];

  if (words.length <= 4) {
    fallbackLines.push({ text: fallbackSource, type: "narration" });
  } else {
    const chunkSize = Math.ceil(words.length / 3);

    for (
      let i = 0;
      i < words.length && fallbackLines.length < 5;
      i += chunkSize
    ) {
      const text = words.slice(i, i + chunkSize).join(" ").trim();

      if (text) {
        fallbackLines.push({ text, type: "narration" });
      }
    }
  }

  while (fallbackLines.length < 2) {
    fallbackLines.push({ text: fallbackSource, type: "narration" });
  }

  return fallbackLines.slice(0, 5);
}

function normalizeScenes(scenes, requiredCount, totalDuration) {
  if (!Array.isArray(scenes)) {
    const error = new Error("Gemini response does not contain scenes.");
    error.code = "GEMINI_INVALID_SCENES";
    error.status = 502;
    throw error;
  }

  if (scenes.length !== requiredCount) {
    const error = new Error(
      `Gemini returned ${scenes.length} scenes, but ${requiredCount} scenes were required.`
    );
    error.code = "GEMINI_INVALID_SCENES";
    error.status = 502;
    throw error;
  }

  const normalized = scenes.map((scene, index) => {
    const visualPrompt = String(scene?.visualPrompt || "").trim();
    const narration = String(scene?.narration || "").trim();
    const dialogue = String(scene?.dialogue || "").trim();
    const caption = String(scene?.caption || "").trim();

    if (!visualPrompt || !narration || !caption) {
      const error = new Error(
        `Scene ${index + 1} is missing a required field.`
      );
      error.code = "GEMINI_INVALID_SCENES";
      error.status = 502;
      throw error;
    }

    const lines = normalizeLines(scene, index);

    return { visualPrompt, narration, dialogue, caption, lines, duration: 1 };
  });

  const baseDuration = Math.floor(totalDuration / requiredCount);
  const remainder = totalDuration % requiredCount;

  normalized.forEach((scene, index) => {
    scene.duration = baseDuration + (index < remainder ? 1 : 0);
  });

  return normalized;
}

/*
 * 5xx / network / timeout only. 429 is deliberately excluded — quota
 * errors must fail fast, never be retried or used to trigger a
 * fallback-model attempt.
 */
function isRetryableStatus(status) {
  return (
    status === 500 || status === 502 || status === 503 || status === 504
  );
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return "GEMINI_AUTH_ERROR";
  if (status === 429) return "GEMINI_QUOTA_EXCEEDED";
  if (status === 400) return "GEMINI_BAD_REQUEST";
  if (status === 404) return "GEMINI_NOT_FOUND";
  if (status >= 500) return "GEMINI_UPSTREAM_ERROR";
  return "GEMINI_UNKNOWN_ERROR";
}

function extractRetryAfterSeconds(response, data) {
  const header = response?.headers?.get?.("retry-after");

  if (header && !Number.isNaN(Number(header))) {
    return Number(header);
  }

  const details = data?.error?.details;

  if (Array.isArray(details)) {
    for (const detail of details) {
      const match =
        typeof detail?.retryDelay === "string" &&
        detail.retryDelay.match(/^([\d.]+)s$/);

      if (match) {
        return Math.ceil(Number(match[1]));
      }
    }
  }

  return null;
}

/*
 * Single model attempt. Retries ONLY genuinely transient 5xx/network
 * errors, with a strict max of 2 attempts and short backoff — never
 * a 429.
 */
async function callGeminiModel(model, requestBody, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GEMINI_TIMEOUT_MS
    );

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseText = await response.text();
      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        data = { error: { message: responseText || "Non-JSON response." } };
      }

      if (response.ok) {
        return { ok: true, data, model, attempts: attempt };
      }

      const status = response.status;
      const code = classifyStatus(status);
      const message = data?.error?.message || "Gemini request failed.";

      console.log(`[Gemini] model=${model} status=${status} code=${code}`);

      if (code === "GEMINI_QUOTA_EXCEEDED") {
        // FAIL FAST. No retry on this model, no fallback model attempt.
        return {
          ok: false,
          model,
          attempts: attempt,
          error: {
            status,
            code,
            message,
            retryAfterSeconds: extractRetryAfterSeconds(response, data),
          },
        };
      }

      lastError = { status, code, message };

      if (isRetryableStatus(status) && attempt < maxAttempts) {
        const waitMs = 1000 * attempt;
        await sleep(waitMs);
        continue;
      }

      // Non-retryable (401/403/400/404) or out of attempts.
      return { ok: false, model, attempts: attempt, error: lastError };
    } catch (error) {
      clearTimeout(timeout);

      const isTimeout = error?.name === "AbortError";

      lastError = {
        status: isTimeout ? 504 : 0,
        code: isTimeout ? "GEMINI_TIMEOUT" : "GEMINI_NETWORK_ERROR",
        message: isTimeout
          ? "Gemini request timed out."
          : error?.message || "Unknown network error.",
      };

      console.log(
        `[Gemini] model=${model} network_error=${lastError.code}`
      );

      if (attempt < maxAttempts) {
        await sleep(1000 * attempt);
        continue;
      }
    }
  }

  return { ok: false, model, attempts: maxAttempts, error: lastError };
}

/*
 * Tries each configured model in order, but ONLY moves to the next
 * model for genuinely transient errors (5xx/timeout/network). A 429
 * (quota) or an auth/config error (401/403/400) stops immediately —
 * switching models does not fix a project-level quota problem and
 * wastes the remaining Vercel execution budget.
 */
async function callGemini(requestBody, apiKey) {
  let lastResult = null;

  for (const model of GEMINI_MODELS) {
    const result = await callGeminiModel(model, requestBody, apiKey);

    if (result.ok) {
      return result;
    }

    lastResult = result;

    const code = result.error?.code;

    if (code === "GEMINI_QUOTA_EXCEEDED" || code === "GEMINI_AUTH_ERROR" || code === "GEMINI_BAD_REQUEST") {
      return result;
    }

    console.log(`[Render] trying fallback model after ${model} failure (${code})`);
  }

  return (
    lastResult || {
      ok: false,
      error: {
        status: 503,
        code: "GEMINI_UPSTREAM_ERROR",
        message: "All Gemini models are temporarily unavailable.",
      },
      attempts: GEMINI_MODELS.length,
    }
  );
}

function sendGeminiError(res, geminiResult) {
  const error = geminiResult.error || {};
  const { httpStatus, body } = toApiError({
    code: error.code || "GEMINI_UPSTREAM_ERROR",
    status: error.status || 502,
    retryAfterSeconds: error.retryAfterSeconds,
  });

  return res.status(httpStatus).json({
    ...body,
    geminiModel: geminiResult.model || null,
    attempts: geminiResult.attempts || null,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Only POST requests are allowed." },
    });
  }

  try {
    const body = req.body || {};
    const story = String(body.story || body.idea || body.joke || "").trim();

    if (!story) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "Story or idea is required." },
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.log("[Gemini] GEMINI_API_KEY missing");

      return res.status(500).json({
        success: false,
        error: {
          code: "GEMINI_AUTH_ERROR",
          message: "AI service authentication problem. Please check server configuration.",
        },
      });
    }

    const duration = Number(body.duration) || 30;

    if (!ALLOWED_DURATIONS.has(duration)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "Duration must be 30, 60, or 180 seconds." },
      });
    }

    const sceneCount = getSceneCount(duration);
    const videoType = String(body.videoType || "Custom").trim();
    const language = String(body.language || "Hindi").trim();
    const aspectRatio = String(body.aspectRatio || "9:16").trim();
    const voice = String(body.voice || "Neutral").trim();
    const music = String(body.music || "Background Music").trim();
    const branding = String(body.branding || "").trim();

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
- Do not use markdown, code fences, or explanations outside the JSON.
- Generate exactly the requested number of scenes.
- Every scene must contain 2 to 5 short lines with text and type (narration/dialogue/caption).
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

Generate exactly ${sceneCount} scenes covering exactly ${duration} seconds total.
Return only valid JSON matching the requested schema.
`;

    const requestBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: buildResponseSchema(sceneCount),
        maxOutputTokens: 8192,
      },
    };

    const geminiResult = await callGemini(requestBody, apiKey);

    if (!geminiResult.ok) {
      return sendGeminiError(res, geminiResult);
    }

    const data = geminiResult.data;
    const candidate = data?.candidates?.[0];

    if (!candidate) {
      return res.status(502).json({
        success: false,
        error: { code: "GEMINI_EMPTY_RESPONSE", message: "The AI service returned no content. Please try again." },
      });
    }

    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      return res.status(502).json({
        success: false,
        error: { code: "GEMINI_EMPTY_RESPONSE", message: "The AI service returned no content. Please try again." },
        finishReason: candidate.finishReason,
      });
    }

    const generatedText = candidate?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim();

    if (!generatedText) {
      return res.status(502).json({
        success: false,
        error: { code: "GEMINI_EMPTY_RESPONSE", message: "The AI service returned no content. Please try again." },
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(generatedText);
    } catch (error) {
      console.error("[Gemini] JSON parse error:", error);

      return res.status(502).json({
        success: false,
        error: { code: "GEMINI_INVALID_JSON", message: "The AI service returned an unexpected response. Please try again." },
      });
    }

    let scenes;

    try {
      scenes = normalizeScenes(parsed.scenes, sceneCount, duration);
    } catch (error) {
      console.error("[Gemini] scene validation error:", error?.message);

      return res.status(502).json({
        success: false,
        error: { code: "RENDER_FAILED", message: "The AI response could not be used. Please try again." },
      });
    }

    return res.status(200).json({
      success: true,
      title: String(parsed.title || "ViralTap Video").trim(),
      description: String(parsed.description || "").trim(),
      scenes,
      geminiModel: geminiResult.model,
      attempts: geminiResult.attempts,
    });
  } catch (error) {
    console.error("[GenerateScript] unexpected error:", error);

    return res.status(500).json({
      success: false,
      error: { code: "UNKNOWN_ERROR", message: "Something went wrong. Please try again." },
    });
  }
}
