const DEFAULT_MODEL = "gemini-3.6-flash";

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  return apiKey;
}

function buildUrl(model) {
  return `${GEMINI_API_BASE}/${model}:generateContent`;
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function readError(response) {
  try {
    const data = await response.json();

    return (
      data?.error?.message ||
      JSON.stringify(data)
    );
  } catch {
    return `Gemini request failed with HTTP ${response.status}.`;
  }
}

function extractText(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts;

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
  timeoutMs = 30000,
  retries = 3,
} = {}) {
  if (!prompt) {
    throw new Error(
      "Gemini prompt is required."
    );
  }

  const apiKey = getApiKey();

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= retries;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      const generationConfig = {
        maxOutputTokens,
      };

      if (responseMimeType) {
        generationConfig.responseMimeType =
          responseMimeType;
      }

      if (responseSchema) {
        generationConfig.responseSchema =
          responseSchema;
      }

      const response = await fetch(
        buildUrl(model),
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
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

            generationConfig,
          }),

          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const message =
          await readError(response);

        const error = new Error(
          `Gemini API error (${response.status}): ${message}`
        );

        error.status = response.status;

        throw error;
      }

      const data =
        await response.json();

      const text = extractText(data);

      if (!text) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      return {
        text,
        data,
        model,
        attempt,
      };
    } catch (error) {
      lastError = error;

      if (
        error?.name ===
        "AbortError"
      ) {
        lastError = new Error(
          `Gemini request timed out after ${timeoutMs}ms.`
        );
      }

      const status =
        error?.status || 0;

      const shouldRetry =
        attempt < retries &&
        (isRetryableStatus(status) ||
          error?.name === "AbortError");

      if (!shouldRetry) {
        throw lastError;
      }

      const backoff =
        Math.min(
          8000,
          1000 *
            Math.pow(2, attempt - 1)
        );

      const jitter =
        Math.floor(
          Math.random() * 300
        );

      await sleep(
        backoff + jitter
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    new Error(
      "Gemini request failed."
    )
  );
}

export async function generateJson({
  prompt,
  model = DEFAULT_MODEL,
  responseSchema,
  maxOutputTokens = 8192,
  timeoutMs = 30000,
  retries = 3,
} = {}) {
  const result =
    await generateContent({
      prompt,
      model,
      responseSchema,
      responseMimeType:
        "application/json",
      maxOutputTokens,
      timeoutMs,
      retries,
    });

  const cleaned =
    cleanJsonText(result.text);

  if (!cleaned) {
    throw new Error(
      "Gemini returned empty JSON."
    );
  }

  try {
    return {
      ...result,
      json: JSON.parse(cleaned),
    };
  } catch (error) {
    throw new Error(
      `Gemini returned invalid JSON: ${error.message}`
    );
  }
}

export function getGeminiModel() {
  return DEFAULT_MODEL;
}
