export const maxDuration = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const idea = String(body.idea || "").trim();

    if (!idea) {
      return res.status(400).json({
        success: false,
        error: "Please enter a story idea."
      });
    }

    const episodeCount = 3;

    const prompt = `
Create a cinematic Indian web-series based on this idea:

"${idea}"

Create EXACTLY 3 connected episodes.

IMPORTANT:
- All 3 episodes must be part of the same story.
- Do not finish the entire story in Episode 1.
- Episode 1 introduces the characters and main conflict.
- Episode 2 develops the conflict and reveals an important secret.
- Episode 3 reaches a strong climax and resolves the main conflict.
- You may add a small Season 2 hook at the end.
- Use natural Hinglish.
- Make the narration suitable for AI voice.
- Create 3-5 recurring characters.
- Keep character details consistent.

Each episode needs:
- episode number
- title
- summary
- hook
- substantial script/narration
- dialogue
- cliffhanger

Do not make the episodes only 2-3 lines long.

Return ONLY valid JSON.

Use exactly this structure:

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

The episodes array MUST contain exactly 3 episodes.

Episode numbers MUST be 1, 2 and 3.

Return ONLY JSON.
No markdown.
No code fences.
No explanation outside JSON.
`;

    const models = [
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ];

    let geminiData = null;
    let lastError = null;
    let successfulModel = null;

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
                  maxOutputTokens: 20000,
                  responseMimeType: "application/json"
                }
              })
            }
          );

          const responseText = await response.text();

          if (response.ok) {
            try {
              geminiData = JSON.parse(responseText);
              successfulModel = model;
              break;
            } catch (error) {
              lastError = {
                status: response.status,
                model,
                details: responseText
              };
            }
          } else {
            lastError = {
              status: response.status,
              model,
              details: responseText
            };

            const retryable =
              response.status === 503 ||
              response.status === 429 ||
              response.status === 502 ||
              response.status === 504;

            if (retryable && attempt === 1) {
              await sleep(3000);
              continue;
            }

            break;
          }
        } catch (error) {
          lastError = {
            status: 500,
            model,
            details: error?.message || "Network error"
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
        error: "Gemini is temporarily unavailable.",
        details: lastError
          ? JSON.stringify(lastError)
          : "No Gemini model returned a response."
      });
    }

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
      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid JSON.",
        details: generatedText.slice(0, 5000)
      });
    }

    if (!Array.isArray(season.episodes)) {
      return res.status(500).json({
        success: false,
        error: "Gemini response has no episodes."
      });
    }

    if (season.episodes.length !== 3) {
      return res.status(500).json({
        success: false,
        error:
          `Gemini generated ${season.episodes.length} episodes instead of 3.`
      });
    }

    const episodes = season.episodes.map((ep, index) => ({
      episode: index + 1,
      title: ep?.title || `Episode ${index + 1}`,
      summary: ep?.summary || "",
      hook: ep?.hook || "",
      script: ep?.script || "",
      dialogue: ep?.dialogue || "",
      cliffhanger: ep?.cliffhanger || "",
      scenes: []
    }));

    return res.status(200).json({
      success: true,
      model: successfulModel,
      seasonTitle: season.seasonTitle || "Untitled Season",
      logline: season.logline || "",
      overallStory: season.overallStory || "",
      characters: Array.isArray(season.characters)
        ? season.characters
        : [],
      episodes,
      totalEpisodes: 3,
      seasonFinale: season.seasonFinale || "",
      season2Hook: season.season2Hook || ""
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Server error.",
      details: error?.message || "Unknown error."
    });
  }
}
