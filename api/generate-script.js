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
        error: "GEMINI_API_KEY is not configured in Vercel Environment Variables."
      });
    }

    const body = req.body || {};

    const idea = String(body.idea || "").trim();

    const requestedEpisodes = Number(body.episodeCount || 10);

    const episodeCount =
      requestedEpisodes === 20 ? 20 : 10;

    const language =
      String(body.language || "Hinglish").trim();

    const genre =
      String(body.genre || "Cinematic Story").trim();

    if (!idea) {
      return res.status(400).json({
        success: false,
        error: "Idea is required."
      });
    }

    const prompt = `
You are a professional Indian web-series writer and showrunner.

Create a COMPLETE connected fictional season for the ViralTap Studio AI video maker.

USER IDEA:
${idea}

GENRE:
${genre}

LANGUAGE:
${language}

NUMBER OF EPISODES:
EXACTLY ${episodeCount}

IMPORTANT:

This is NOT a tiny reel script.

Create a complete ${episodeCount}-episode season.

The story must continue from Episode 1 all the way to Episode ${episodeCount}.

Every episode must move the story forward.

Do not finish the entire story in Episode 1.

Do not write:
"Aaj ki kahani..."
"Ek din..."
"And then a twist..."
unless it naturally belongs to the story.

Make the writing feel like a professional Indian cinematic web-series.

CHARACTER CONTINUITY:

Create 3-6 important characters.

Keep their names, personalities, relationships and backgrounds consistent throughout the season.

STORY STRUCTURE:

Episode 1:
Introduce the main character, world and central problem.
End with a strong reason to watch Episode 2.

Episodes 2-4:
Build the mystery/conflict.

Episodes 5-7:
Major revelations, danger and emotional development.

Episodes 8-${Math.max(8, episodeCount - 2)}:
Escalate toward the main confrontation.

Episode ${Math.max(9, episodeCount - 1)}:
Major confrontation begins.

Episode ${episodeCount}:
Season finale.
Resolve the main season conflict.
Leave a logical optional hook for Season 2.

EVERY EPISODE MUST HAVE:

- Episode number
- Strong title
- Short summary
- Opening hook
- Complete spoken narration/script
- Important dialogue
- Ending cliffhanger

SCRIPT LENGTH:

Do NOT make each episode 2-3 sentences.

Each episode should contain enough natural spoken material for a proper short-form episode.

The narration must be ready for AI voice generation.

Use natural Indian ${language}.

Make dialogue emotional and cinematic.

Use suspense, mystery, action, emotion or comedy according to the story.

Do not repeat the same lines between episodes.

Each episode must end with a meaningful cliffhanger.

RETURN ONLY VALID JSON.

Do NOT use markdown.
Do NOT use code fences.
Do NOT write anything outside the JSON.

Return exactly this structure:

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

IMPORTANT:
The episodes array MUST contain EXACTLY ${episodeCount} episodes.
Episode numbers must be 1 through ${episodeCount}.
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
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 30000,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Gemini API ERROR:", responseText);

      return res.status(response.status).json({
        success: false,
        error: "Gemini API request failed.",
        geminiStatus: response.status,
        details: responseText
      });
    }

    let geminiData;

    try {
      geminiData = JSON.parse(responseText);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Invalid response received from Gemini.",
        details: responseText
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
        error: "Gemini returned an empty response.",
        details: JSON.stringify(geminiData)
      });
    }

    let season;

    try {
      season = JSON.parse(generatedText);
    } catch (error) {
      console.error("Season JSON parse error:", error);

      return res.status(500).json({
        success: false,
        error: "Gemini returned invalid season JSON.",
        details: generatedText.slice(0, 3000)
      });
    }

    if (!season || !Array.isArray(season.episodes)) {
      return res.status(500).json({
        success: false,
        error: "Gemini response does not contain episodes."
      });
    }

    if (season.episodes.length !== episodeCount) {
      return res.status(500).json({
        success: false,
        error:
          `Gemini generated ${season.episodes.length} episodes instead of ${episodeCount}.`
      });
    }

    season.episodes = season.episodes.map((episode, index) => ({
      episode: index + 1,
      title: episode.title || `Episode ${index + 1}`,
      summary: episode.summary || "",
      hook: episode.hook || "",
      script: episode.script || "",
      dialogue: episode.dialogue || "",
      cliffhanger: episode.cliffhanger || "",
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

      episodes: season.episodes,

      totalEpisodes: season.episodes.length,

      seasonFinale: season.seasonFinale || "",

      season2Hook: season.season2Hook || "",

      // Compatibility with old frontend
      title: season.seasonTitle || "Untitled Season",

      scenes: [],

      totalDuration: 0
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Server error.",
      details: error?.message || "Unknown server error"
    });
  }
}
