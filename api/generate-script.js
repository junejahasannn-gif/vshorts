export const maxDuration = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(model, apiKey, prompt) {
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
          maxOutputTokens: 50000,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const text = await response.text();

  return {
    response,
    text
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
        error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
      });
    }

    const body = req.body || {};

    const idea = String(body.idea || "").trim();

    const requestedEpisodes = Number(body.episodeCount || 10);

    const episodeCount =
      requestedEpisodes === 20 ? 20 : 10;

    if (!idea) {
      return res.status(400).json({
        success: false,
        error: "Please enter a story idea."
      });
    }

    const prompt = `
You are a professional Indian web-series writer.

Create a connected cinematic story season based on this idea:

"${idea}"

Create EXACTLY ${episodeCount} episodes.

This must be ONE CONNECTED STORY.

Do NOT create separate unrelated stories.

The story should feel like a real Indian OTT/web-series.

LANGUAGE:
Natural Hinglish.
Use simple spoken Indian Hindi mixed naturally with English.

Create 3-6 important recurring characters.

Keep character names, personalities, relationships and appearances consistent throughout the season.

STORY STRUCTURE:

Episode 1:
Introduce the world, main characters and main conflict.

Early episodes:
Build relationships, mystery and conflict.

Middle episodes:
Reveal secrets, twists and important information.

Late episodes:
Increase tension and move toward the final confrontation.

Final episode:
Resolve the main season conflict properly.
A logical Season 2 hook is allowed.

IMPORTANT:

Do NOT finish the entire story in Episode 1.

Every episode must continue directly from the previous episode.

Every episode must contain substantial narration and dialogue.

Do NOT make tiny episodes.

For every episode create:

- episode number
- title
- summary
- hook
- substantial narration/script
- dialogue
- cliffhanger

The narration must be suitable for AI voice narration.

Return ONLY valid JSON.

Use EXACTLY this structure:

{
  "seasonTitle": "string",
  "logline": "string",
  "overallStory": "string",

  "characters": [
    {
      "name": "string",
      "age": 0,
      "role": "string",
      "personality": "string",
      "appearance": "string",
      "relationship": "string"
    }
  ],

  "episodes": [
    {
      "episode": 1,
      "title": "string",
      "summary": "string",
      "hook": "string",
      "script": "string",
      "dialogue": "string",
      "cliffhanger": "string"
    }
  ],

  "seasonFinale": "string",
  "season2Hook": "string"
}

The episodes array MUST contain exactly ${episodeCount} episodes.

Episode numbers MUST be sequential from 1 to ${episodeCount}.

Return ONLY JSON.
No markdown.
No code fences.
No explanation outside JSON.
`;

    /*
      Try multiple current Gemini models.
      This protects the app when one model is temporarily busy.
    */
    const models = [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ];

    let geminiData = null;
    let lastError = null;
    let successfulModel = null;

    for (const model of models) {
      console.log(`Trying Gemini model: ${model}`);

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await callGemini(
            model,
            apiKey,
            prompt
          );

          const { response, text } = result;

          if (response.ok) {
            try {
              geminiData = JSON.parse(text);
              successfulModel = model;
              break;
            } catch (error) {
              lastError = {
                status: response.status,
                model,
                details: text
              };
            }
          } else {
            lastError = {
              status: response.status,
              model,
              details: text
            };

            console.error(
              `Gemini ${model} attempt ${attempt} failed:`,
              response.status,
              text
            );

            /*
              Temporary errors:
              503 = service unavailable
              429 = rate limit
              502/504 = gateway problems

              Retry these.
            */
            const retryable =
              response.status === 503 ||
              response.status === 429 ||
              response.status === 502 ||
              response.status === 504;

            if (retryable && attempt === 1) {
              await sleep(2500);
              continue;
            }

            /*
              For permanent errors, move to the next model.
            */
            break;
          }
        } catch (error) {
          lastError = {
            status: 500,
            model,
            details: error?.message || "Network error"
          };

          if (attempt === 1) {
            await sleep(2500);
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
      return res.status(
        lastError?.status >= 400
          ? lastError.status
          : 503
      ).json({
        success: false,
        error: "All Gemini models are temporarily unavailable.",
        details: lastError
          ? JSON.stringify(lastError)
          : "No Gemini model returned a successful response."
      });
    }

    console.log(
      `Successful Gemini model: ${successfulModel}`
    );

    const generatedText =
      geminiData?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

    if (!generatedText) {
      return res.status(500).json({
        success: false,
        error: "Gemini returned an empty response.",
        details: JSON.stringify(geminiData).slice(0, 5000)
      });
    }

    let season;

    try {
      season = JSON.parse(generatedText);
    } catch (error) {
      console.error(
        "INVALID GENERATED JSON:",
        generatedText
      );

      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid JSON.",
        details: generatedText.slice(0, 5000)
      });
    }

    if (!season || typeof season !== "object") {
      return res.status(500).json({
        success: false,
        error: "Gemini returned an invalid season."
      });
    }

    if (!Array.isArray(season.episodes)) {
      return res.status(500).json({
        success: false,
        error: "Gemini response does not contain an episodes array.",
        details: JSON.stringify(season).slice(0, 5000)
      });
    }

    if (season.episodes.length !== episodeCount) {
      return res.status(500).json({
        success: false,
        error:
          `Gemini generated ${season.episodes.length} episodes instead of ${episodeCount}.`,
        details:
          `Requested ${episodeCount} episodes but received ${season.episodes.length}.`
      });
    }

    const episodes = season.episodes.map((ep, index) => ({
      episode: index + 1,
      title:
        ep?.title ||
        `Episode ${index + 1}`,

      summary:
        ep?.summary || "",

      hook:
        ep?.hook || "",

      script:
        ep?.script || "",

      dialogue:
        ep?.dialogue || "",

      cliffhanger:
        ep?.cliffhanger || "",

      scenes: []
    }));

    return res.status(200).json({
      success: true,

      model:
        successfulModel,

      seasonTitle:
        season.seasonTitle ||
        "Untitled Season",

      logline:
        season.logline || "",

      overallStory:
        season.overallStory || "",

      characters:
        Array.isArray(season.characters)
          ? season.characters
          : [],

      episodes,

      totalEpisodes:
        episodes.length,

      seasonFinale:
        season.seasonFinale || "",

      season2Hook:
        season.season2Hook || ""
    });

  } catch (error) {
    console.error(
      "SERVER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Server error.",
      details:
        error?.message ||
        "Unknown server error."
    });
  }
}
