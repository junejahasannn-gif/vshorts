// lib/ai-client.js
//
// FIXED VERSION.
//
// What changed vs the original:
// 1. isRetryableStatus() no longer includes 429. Quota/rate-limit errors
//    must fail fast with a structured error, never be retried with
//    exponential backoff inside a 60s Vercel function.
// 2. All thrown errors now carry a stable `code` (GEMINI_AUTH_ERROR,
//    GEMINI_QUOTA_EXCEEDED, GEMINI_RATE_LIMITED, GEMINI_BAD_REQUEST,
//    GEMINI_UPSTREAM_ERROR, GEMINI_TIMEOUT, GEMINI_NETWORK_ERROR) so
//    API routes can map them to the standardized response format
//    from item 20 without re-parsing message strings.
// 3. retryAfterSeconds is extracted from Gemini's response when present
//    (either a `retryInfo` field or a Retry-After header) and attached
//    to the thrown error.
// 4. Central model config now lives here + lib/video-config.js instead
//    of being duplicated across generate-script.js / generate-visuals.js
//    / generate-voice.js. Existing DEFAULT_MODEL export kept for
//    backwards compatibility.

export const GEMINI_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash";

export const GEMINI_TEXT_FALLBACK_MODEL =
  process.env.GEMINI_TEXT_FALLBACK_MODEL || "gemini-3.5-flash-lite";

export const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";

// Kept for backwards compatibility with any existing callers.
const DEFAULT_MODEL = GEMINI_TEXT_MODEL;

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error("GEMINI_API_KEY is not configured.");
    error.code = "GEMINI_AUTH_ERROR";
    error.status = 500;
    throw error;
  }

  return apiKey;
}

function buildUrl(model) {
  return `${GEMINI_API_BASE}/${model}:generateContent`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * IMPORTANT: 429 is intentionally NOT in this list.
 *
 * 429 means "quota/rate limit exceeded". Retrying it with backoff
 * inside a short-lived Vercel function is exactly what causes
 * "Task timed out after 60 seconds". A 429 must fail fast instead.
 *
 * Only genuinely transient infrastructure errors are retried here.
 */
function isRetryableStatus(status) {
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
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

/*
 * Try to find a retry-after hint from Gemini's response body
 * (google.rpc.RetryInfo in error.details) or from the Retry-After header.
 * Returns seconds, or null if not present.
 */
function extractRetryAfterSeconds(response, data) {
  const header = response?.headers?.get?.("retry-after");

  if (header && !Number.isNaN(Number(header))) {
    return Number(header);
  }

  const details = data?.error?.details;

  if (Array.isArray(details)) {
    for (const detail of details) {
      const retryDelay = detail?.retryDelay;

      if (typeof retryDelay === "string") {
        const match = retryDelay.match(/^([\d.]+)s$/);

        if (match) {
          return Math.ceil(Number(match[1]));
        }
      }
    }
  }

  return null;
}

async function readError(response) {
  try {
    const data = await response.json();

    return {
      message:
        data?.error?.message || JSON.stringify(data),
      data,
    };
  } catch {
    return {
      message: `Gemini request failed with HTTP ${response.status}.`,
      data: null,
    };
  }
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("");
}

function cleanJsonText(text) {
  let value = String(text || "").trim();

  if (!value) {
    return "";
  }

  if (value.startsWith("```")) {
    value = value
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  return value;
}

export async function generateContent({
  prompt,
  model = DEFAULT_MODEL,
  responseSchema = null,
  responseMimeType = null,
  maxOutputTokens = 8192,
  timeoutMs = 25000,
  // Retries now only apply to genuinely transient 5xx/network errors,
  // and only 1 retry by default to keep well inside a 60s function
  // budget alongside other work (e.g. multiple scenes).
  retries = 2,
} = {}) {
  if (!prompt) {
    const error = new Error("Gemini prompt is required.");
    error.code = "GEMINI_BAD_REQUEST";
    error.status = 400;
    throw error;
  }

  const apiKey = getApiKey();

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const generationConfig = { maxOutputTokens };

      if (responseMimeType) {
        generationConfig.responseMimeType = responseMimeType;
      }

      if (responseSchema) {
        generationConfig.responseSchema = responseSchema;
      }

      const response = await fetch(buildUrl(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: prompt }] },
          ],
          generationConfig,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const { message, data } = await readError(response);
        const status = response.status;
        const code = classifyStatus(status);

        const error = new Error(
          `Gemini API error (${status}): ${message}`
        );

        error.status = status;
        error.code = code;

        if (code === "GEMINI_QUOTA_EXCEEDED") {
          error.retryAfterSeconds = extractRetryAfterSeconds(
            response,
            data
          );

          // 429 = fail fast. No retry, no fallback attempt here.
          throw error;
        }

        // Non-retryable client errors (401/403/400/404) also fail fast.
        if (!isRetryableStatus(status)) {
          throw error;
        }

        lastError = error;

        if (attempt < retries) {
          const backoff = Math.min(4000, 800 * Math.pow(2, attempt - 1));
          await sleep(backoff);
          continue;
        }

        throw error;
      }

      const data = await response.json();
      const text = extractText(data);

      if (!text) {
        const error = new Error("Gemini returned an empty response.");
        error.code = "GEMINI_EMPTY_RESPONSE";
        error.status = 502;
        throw error;
      }

      return { text, data, model, attempt };
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(
          `Gemini request timed out after ${timeoutMs}ms.`
        );
        timeoutError.code = "GEMINI_TIMEOUT";
        timeoutError.status = 504;

        lastError = timeoutError;

        if (attempt < retries) {
          continue;
        }

        throw timeoutError;
      }

      // Already-classified errors (quota, auth, bad request) propagate
      // immediately without further retry.
      if (
        error?.code &&
        error.code !== "GEMINI_UPSTREAM_ERROR"
      ) {
        throw error;
      }

      lastError = error;

      if (attempt < retries) {
        const backoff = Math.min(4000, 800 * Math.pow(2, attempt - 1));
        await sleep(backoff);
        continue;
      }

      if (!error.code) {
        error.code = "GEMINI_NETWORK_ERROR";
        error.status = 0;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    Object.assign(new Error("Gemini request failed."), {
      code: "GEMINI_UNKNOWN_ERROR",
      status: 500,
    })
  );
}

export async function generateJson({
  prompt,
  model = DEFAULT_MODEL,
  responseSchema,
  maxOutputTokens = 8192,
  timeoutMs = 25000,
  retries = 2,
} = {}) {
  const result = await generateContent({
    prompt,
    model,
    responseSchema,
    responseMimeType: "application/json",
    maxOutputTokens,
    timeoutMs,
    retries,
  });

  const cleaned = cleanJsonText(result.text);

  if (!cleaned) {
    const error = new Error("Gemini returned empty JSON.");
    error.code = "GEMINI_EMPTY_RESPONSE";
    error.status = 502;
    throw error;
  }

  try {
    return { ...result, json: JSON.parse(cleaned) };
  } catch (error) {
    const parseError = new Error(
      `Gemini returned invalid JSON: ${error.message}`
    );
    parseError.code = "GEMINI_INVALID_JSON";
    parseError.status = 502;
    throw parseError;
  }
}

export function getGeminiModel() {
  return DEFAULT_MODEL;
}

/*
 * Maps a structured Gemini error (as thrown above) to the safe,
 * standardized API response shape from item 20. Use this in every
 * api/*.js route's catch block instead of hand-rolling error JSON.
 */
export function toApiError(error) {
  const code = error?.code || "UNKNOWN_ERROR";

  const messages = {
    GEMINI_AUTH_ERROR:
      "AI service authentication problem. Please check server configuration.",
    GEMINI_QUOTA_EXCEEDED:
      "Gemini quota is temporarily exhausted. Please try again after the indicated time or use a project with available Gemini quota.",
    GEMINI_RATE_LIMITED:
      "Too many AI requests. Please wait a moment and try again.",
    GEMINI_TIMEOUT:
      "AI request timed out. Please try again.",
    GEMINI_NETWORK_ERROR:
      "Could not reach the AI service. Please try again.",
    GEMINI_BAD_REQUEST:
      "The request sent to the AI service was invalid.",
    GEMINI_UPSTREAM_ERROR:
      "The AI service is temporarily unavailable. Please try again shortly.",
    GEMINI_EMPTY_RESPONSE:
      "The AI service returned no content. Please try again.",
    GEMINI_INVALID_JSON:
      "The AI service returned an unexpected response. Please try again.",
    UNKNOWN_ERROR:
      "Something went wrong. Please try again.",
  };

  const httpStatus =
    error?.status && error.status >= 400 && error.status < 600
      ? error.status
      : 502;

  return {
    httpStatus,
    body: {
      success: false,
      error: {
        code,
        message: messages[code] || messages.UNKNOWN_ERROR,
        ...(error?.retryAfterSeconds
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    },
  };
}
