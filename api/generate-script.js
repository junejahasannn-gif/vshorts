export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed"
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY missing in Vercel."
      });
    }

    const body = req.body || {};
    const idea = String(body.idea || "").trim();

    if (!idea) {
      return res.status(400).json({
        success: false,
        error: "Idea is required."
      });
    }

    const prompt = `
Create a connected Indian cinematic web-series season for this idea:

${idea}

Create EXACTLY 10 episodes.

Each episode must continue the same story.

Create 3-6 consistent characters.

Every episode needs:
- episode number
- title
- summary
- hook
- substantial spoken narration
- dialogue
- cliffhanger

Episode 1 introduces the world and main conflict.
Episodes 2-4 build the conflict.
Episodes 5-7 reveal important secrets.
Episodes 8-9 build toward the final confrontation.
Episode 10 resolves the main conflict and may contain a logical Season 2 hook.

Do NOT make the episodes tiny.
Do NOT finish the entire story in Episode 1.
Write natural Indian Hinglish.
Make it cinematic and suitable for AI voice narration.

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

The episodes array MUST contain exactly 10 episodes.
Episode numbers must be 1 through 10.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
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
            temperature: 0.8,
            maxOutputTokens: 20000,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const responseText = await response.text();

    // IMPORTANT: show the real Gemini error
    if (!response.ok) {
      console.error("GEMINI ERROR:", responseText);

      return res.status(500).json({
        success: false,
        error: `Gemini API failed (${response.status})`,
        details: responseText
      });
    }

    let geminiData;

    try {
      geminiData = JSON.parse(responseText);
    } catch {
      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid server response.",
        details: responseText.slice(0, 3000)
      });
    }

    const generatedText =
      geminiData?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!generatedText) {
      return res.status(500).json({
        success: false,
        error: "Gemini returned empty response.",
        details: JSON.stringify(geminiData).slice(0, 5000)
      });
    }

    let season;

    try {
      season = JSON.parse(generatedText);
    } catch {
      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid JSON.",
        details: generatedText.slice(0, 5000)
      });
    }

    if (!Array.isArray(season.episodes)) {
      return res.status(500).json({
        success: false,
        error: "Gemini response has no episodes.",
        details: JSON.stringify(season).slice(0, 5000)
      });
    }

    if (season.episodes.length !== 10) {
      return res.status(500).json({
        success: false,
        error: `Gemini generated ${season.episodes.length} episodes instead of 10.`
      });
    }

    const episodes = season.episodes.map((ep, index) => ({
      episode: index + 1,
      title: ep.title || `Episode ${index + 1}`,
      summary: ep.summary || "",
      hook: ep.hook || "",
      script: ep.script || "",
      dialogue: ep.dialogue || "",
      cliffhanger: ep.cliffhanger || "",
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
      details: error?.message || "Unknown error"
    });
  }
}
