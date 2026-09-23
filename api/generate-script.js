export const maxDuration = 60;

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

    const story =
      body.story ||
      body.idea ||
      body.joke ||
      body.prompt ||
      "Create an engaging short video.";

    const videoType = body.videoType || "custom";
    const language = body.language || "Hindi";
    const aspectRatio = body.aspectRatio || "9:16";
    const duration = Number(body.duration) || 30;
    const voice = body.voice || "default";
    const music = body.music || "default";
    const branding = body.branding || "ViralTap";

    let sceneCount = 5;

    if (duration >= 180) {
      sceneCount = 10;
    } else if (duration >= 60) {
      sceneCount = 7;
    }

    const sceneDuration = duration / sceneCount;

    const prompt = `
You are the AI video script engine for ViralTap Studio.

Create ONE complete short-form video based on the user's idea.

IMPORTANT:
- This is NOT limited to comedy.
- Support any video type including:
  comedy, funny, story, horror, action, emotional, romantic,
  motivational, educational, dramatic, kids story, documentary,
  suspense, inspirational, custom ideas.
- Write everything in ${language}.
- Video type: ${videoType}
- Aspect ratio: ${aspectRatio}
- Total duration: ${duration} seconds
- Voiceover: ${voice}
- Background music: ${music}
- Branding: ${branding}

USER IDEA:
${story}

Create exactly ${sceneCount} scenes.

Each scene must contain:
- visualPrompt: detailed visual description for AI image/video generation
- narration: voiceover narration
- dialogue: dialogue if appropriate, otherwise ""
- caption: short on-screen caption
- duration: duration of that scene in seconds

The scene durations should add up to approximately ${duration} seconds.

Return ONLY valid JSON.
Do not use markdown.
Do not use code fences.
Do not add explanations.

Required JSON format:

{
  "title": "Short catchy video title",
  "description": "Short description of the video",
  "scenes": [
    {
      "visualPrompt": "Detailed visual description",
      "narration": "Voiceover text",
      "dialogue": "",
      "caption": "Short caption",
      "duration": ${sceneDuration}
    }
  ]
}
`;

    const response = await fetch(
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
            temperature: 0.7,
            maxOutputTokens: 16000,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const responseText = await response.text();

    let geminiData;

    try {
      geminiData = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Gemini returned an invalid API response.",
        details: responseText.slice(0, 2000)
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: "Gemini API request failed.",
        geminiHttpStatus: response.status,
        geminiResponse: geminiData
      });
    }

    const generatedText =
      geminiData?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

    if (!generatedText) {
      return res.status(502).json({
        success: false,
        error: "Gemini returned no generated content.",
        geminiResponse: geminiData
      });
    }

    let videoData;

    try {
      videoData = JSON.parse(generatedText);
    } catch {
      let cleaned = generatedText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      try {
        videoData = JSON.parse(cleaned);
      } catch {
        return res.status(502).json({
          success: false,
          error: "Gemini returned invalid video JSON.",
          rawResponse: generatedText.slice(0, 5000)
        });
      }
    }

    if (!Array.isArray(videoData.scenes) || !videoData.scenes.length) {
      return res.status(502).json({
        success: false,
        error: "Gemini did not return any scenes.",
        generatedData: videoData
      });
    }

    const scenes = videoData.scenes.map((scene, index) => ({
      visualPrompt:
        scene?.visualPrompt ||
        scene?.visual ||
        `Create a cinematic scene for scene ${index + 1}.`,

      narration:
        scene?.narration ||
        scene?.voiceover ||
        "",

      dialogue:
        scene?.dialogue ||
        "",

      caption:
        scene?.caption ||
        scene?.text ||
        scene?.narration ||
        "",

      duration:
        Number(scene?.duration) > 0
          ? Number(scene.duration)
          : Number(scene?.durationInSeconds) > 0
            ? Number(scene.durationInSeconds)
            : sceneDuration
    }));

    return res.status(200).json({
      success: true,
      title:
        videoData.title ||
        `${videoType} Video`,

      description:
        videoData.description ||
        `AI-generated ${videoType} video created with ViralTap.`,

      scenes,

      settings: {
        videoType,
        language,
        aspectRatio,
        duration,
        voice,
        music,
        branding
      }
    });

  } catch (error) {
    console.error("VIRALTAP GENERATE SCRIPT ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Video script generation failed.",
      details: error?.message || "Unknown error."
    });
  }
}
