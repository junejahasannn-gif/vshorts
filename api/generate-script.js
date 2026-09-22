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
Simple spoken Indian Hindi mixed naturally with English.

Create 3-6 important recurring characters.

Keep character names, personalities, relationships and appearances consistent.

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

Every episode must continue from the previous episode.

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

The episodes array MUST contain exactly ${episodeCount} episodes.

Episode numbers MUST be:

1 through ${episodeCount}

Return ONLY JSON.
No markdown.
No code fences.
No explanation outside JSON.
`;

    const maxRetries = 3;

    let response;
    let responseText = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      response = await fetch(
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
              maxOutputTokens: 50000,
              responseMimeType: "application/json"
            }
          })
        }
      );

      responseText = await response.text();

      if (response.ok) {
        break;
      }

      console.error(
        `Gemini attempt ${attempt} failed:`,
        response.status,
        responseText
      );

      const shouldRetry =
        response.status === 503 ||
        response.status === 429 ||
        response.status === 502 ||
        response.status === 504;

      if (!shouldRetry || attempt === maxRetries) {
        return res.status(response.status).json({
          success: false,
          error: `Gemini API failed (${response.status})`,
          details: responseText
        });
      }

      const waitTime =
        attempt === 1
          ? 2000
          : attempt === 2
          ? 5000
          : 10000;

      await sleep(waitTime);
    }

    let geminiData;

    try {
      geminiData = JSON.parse(responseText);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Gemini returned an invalid server response.",
        details: responseText.slice(0, 5000)
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
        details: "Please try generating the season again."
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
      seasonTitle: season.seasonTitle || "Untitled Season",
      logline: season.logline || "",
      overallStory: season.overallStory || "",
      characters: Array.isArray(season.characters)
        ? season.characters
        : [],
      episodes,
      totalEpisodes: episodes.length,
      seasonFinale: season.seasonFinale || "",
      season2Hook: season.season2Hook || ""
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Server error.",
      details: error?.message || "Unknown server error."
    });
  }
}
