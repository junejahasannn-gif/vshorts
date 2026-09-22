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
    const body = req.body || {};

    const scenes = Array.isArray(body.scenes)
      ? body.scenes
      : [];

    const videoType =
      body.videoType === "funny"
        ? "funny"
        : "normal";

    const aspectRatio =
      String(body.aspectRatio || "9:16");

    const duration =
      Number(body.duration) || 30;

    if (!scenes.length) {
      return res.status(400).json({
        success: false,
        error: "No scenes were provided."
      });
    }

    /*
     * This endpoint is now ready for the real
     * image + voice + music + MP4 renderer.
     *
     * For now we validate and prepare the render job.
     * No fake MP4 URL is returned.
     */

    const renderJob = {
      id:
        `vt_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      status: "queued",

      videoType,

      aspectRatio,

      duration,

      totalScenes: scenes.length,

      createdAt:
        new Date().toISOString()
    };

    // Small async delay so the endpoint behaves like
    // a real render-job creation endpoint.
    await sleep(100);

    return res.status(200).json({
      success: true,

      message:
        "Video render job created successfully.",

      job: renderJob,

      /*
       * Important:
       * videoUrl is intentionally null until the
       * actual MP4 renderer is connected.
       */
      videoUrl: null,

      playbackReady: false
    });

  } catch (error) {
    console.error(
      "RENDER SERVER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Render server error.",
      details:
        error?.message ||
        "Unknown error."
    });
  }
}
