export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed"
    });
  }

  try {
    const { idea } = req.body || {};

    if (!idea || !idea.trim()) {
      return res.status(400).json({
        success: false,
        error: "Idea is required"
      });
    }

    // Temporary structured response.
    // Real AI generation will be connected next.
    const scenes = [
      {
        scene: 1,
        duration: 5,
        title: "Hook",
        narration: `Aaj ki kahani: ${idea}`,
        visualPrompt: `Cinematic opening scene based on: ${idea}`
      },
      {
        scene: 2,
        duration: 7,
        title: "Story",
        narration: `Is kahani mein ek unexpected twist aata hai.`,
        visualPrompt: `Dramatic cinematic scene related to: ${idea}`
      },
      {
        scene: 3,
        duration: 7,
        title: "Climax",
        narration: `Aur phir kahani apne sabse important moment par pahunchti hai.`,
        visualPrompt: `Epic cinematic climax related to: ${idea}`
      },
      {
        scene: 4,
        duration: 6,
        title: "Ending",
        narration: `Yahi tha is kahani ka sabse bada twist.`,
        visualPrompt: `Cinematic ending scene related to: ${idea}`
      }
    ];

    return res.status(200).json({
      success: true,
      title: idea,
      totalDuration: 25,
      scenes
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
}
