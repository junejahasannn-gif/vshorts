import { Sandbox } from "@vercel/sandbox";

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed."
    });
  }

  let sandbox;

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
     * Create a real Vercel Sandbox.
     *
     * This is the first real step toward
     * server-side Remotion MP4 rendering.
     */
    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000
    });

    /*
     * Test that the Sandbox can execute Node.
     */
    const test = await sandbox.runCommand({
      cmd: "node",
      args: [
        "-e",
        'console.log("ViralTap Sandbox OK")'
      ]
    });

    const output = await test.stdout();

    if (test.exitCode !== 0) {
      throw new Error(
        "Vercel Sandbox Node test failed."
      );
    }

    const renderJob = {
      id:
        `vt_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      status: "sandbox-ready",

      videoType,

      aspectRatio,

      duration,

      totalScenes: scenes.length,

      sandbox: {
        ready: true,
        output: output.trim()
      },

      createdAt:
        new Date().toISOString()
    };

    return res.status(200).json({
      success: true,

      message:
        "ViralTap render sandbox is ready.",

      job: renderJob,

      /*
       * Still null intentionally.
       *
       * MP4 rendering comes in the next step after
       * the Remotion bundle is connected.
       */
      videoUrl: null,

      playbackReady: false
    });

  } catch (error) {
    console.error(
      "VIRALTAP RENDER SERVER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "ViralTap render sandbox failed.",

      details:
        error?.message ||
        "Unknown error."
    });

  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (stopError) {
        console.error(
          "SANDBOX STOP ERROR:",
          stopError
        );
      }
    }
  }
}
