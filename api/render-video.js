import { Sandbox } from "@vercel/sandbox";

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed.",
    });
  }

  let sandbox = null;

  try {
    const body = req.body || {};

    const scenes = Array.isArray(body.scenes)
      ? body.scenes
      : [];

    if (!scenes.length) {
      return res.status(400).json({
        success: false,
        error: "No scenes were provided.",
      });
    }

    const duration = Number(body.duration) || 30;
    const aspectRatio = body.aspectRatio || "9:16";

    let width = 1080;
    let height = 1920;

    if (aspectRatio === "16:9") {
      width = 1920;
      height = 1080;
    } else if (aspectRatio === "1:1") {
      width = 1080;
      height = 1080;
    }

    // --------------------------------------------
    // 1. CREATE SANDBOX
    // --------------------------------------------

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000,
    });

    // --------------------------------------------
    // 2. CREATE REMOTION PROJECT
    // --------------------------------------------

    const packageJson = `
{
  "name": "viraltap-render",
  "private": true,
  "type": "module",
  "dependencies": {
    "@remotion/cli": "4.0.527",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "remotion": "4.0.527"
  }
}
`;

    const rootJsx = `
import React from "react";
import {
  Composition,
  useCurrentFrame,
  useVideoConfig,
  interpolate
} from "remotion";

const Video = ({ scenes = [] }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const totalScenes = Math.max(scenes.length, 1);

  const sceneIndex = Math.min(
    totalScenes - 1,
    Math.floor(
      (frame / Math.max(durationInFrames, 1)) * totalScenes
    )
  );

  const scene = scenes[sceneIndex] || {
    caption: "ViralTap"
  };

  const opacity = interpolate(
    frame % fps,
    [0, Math.max(1, fps * 0.25), fps],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    }
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background:
          "linear-gradient(135deg, #090909 0%, #171717 100%)",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        opacity,
      }}
    >
      <div
        style={{
          width: "90%",
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1.25,
          textShadow: "0 4px 20px rgba(0,0,0,0.8)",
        }}
      >
        {scene.caption ||
          scene.narration ||
          scene.dialogue ||
          "ViralTap"}
      </div>
    </div>
  );
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="ViralTapVideo"
      component={Video}
      durationInFrames={90}
      fps={30}
      width=${width}
      height=${height}
      defaultProps={{
        scenes: [
          {
            caption: "ViralTap Render Test"
          }
        ]
      }}
    />
  );
};

export default RemotionRoot;
`;

    const indexJsx = `
import React from "react";
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root.jsx";

registerRoot(RemotionRoot);
`;

    await sandbox.writeFiles([
      {
        path: "package.json",
        content: Buffer.from(packageJson),
      },
      {
        path: "src/Root.jsx",
        content: Buffer.from(rootJsx),
      },
      {
        path: "src/index.jsx",
        content: Buffer.from(indexJsx),
      },
      {
        path: "scenes.json",
        content: Buffer.from(
          JSON.stringify(scenes)
        ),
      },
    ]);

    // --------------------------------------------
    // 3. INSTALL DEPENDENCIES
    // --------------------------------------------

    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install"],
    });

    const installOut = await install.stdout();
    const installErr = await install.stderr();

    if (install.exitCode !== 0) {
      throw new Error(
        `npm install failed:\n${installErr}\n${installOut}`
      );
    }

    // --------------------------------------------
    // 4. CHECK REMOTION
    // --------------------------------------------

    const binaryCheck = await sandbox.runCommand({
      cmd: "node_modules/.bin/remotion",
      args: ["versions"],
    });

    const binaryOut = await binaryCheck.stdout();
    const binaryErr = await binaryCheck.stderr();

    if (binaryCheck.exitCode !== 0) {
      throw new Error(
        `Remotion binary check failed:\n${binaryErr}\n${binaryOut}`
      );
    }

    // --------------------------------------------
    // 5. INSTALL / ENSURE CHROMIUM
    // --------------------------------------------

    const browser = await sandbox.runCommand({
      cmd: "node_modules/.bin/remotion",
      args: [
        "browser",
        "ensure",
      ],
    });

    const browserOut = await browser.stdout();
    const browserErr = await browser.stderr();

    if (browser.exitCode !== 0) {
      throw new Error(
        `Remotion browser setup failed:\n${browserErr}\n${browserOut}`
      );
    }

    // --------------------------------------------
    // 6. RENDER 3-SECOND MP4 TEST
    // --------------------------------------------

    const render = await sandbox.runCommand({
      cmd: "node_modules/.bin/remotion",
      args: [
        "render",
        "src/index.jsx",
        "ViralTapVideo",
        "viraltap-test.mp4",
        "--frames=0-89",
        "--codec=h264",
        "--concurrency=2",
      ],
    });

    const renderOut = await render.stdout();
    const renderErr = await render.stderr();

    if (render.exitCode !== 0) {
      throw new Error(
        `Remotion render failed:\n${renderErr}\n${renderOut}`
      );
    }

    // --------------------------------------------
    // 7. CHECK MP4 FILE
    // --------------------------------------------

    const fileCheck = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls -lh viraltap-test.mp4 && file viraltap-test.mp4",
      ],
    });

    const fileOut = await fileCheck.stdout();
    const fileErr = await fileCheck.stderr();

    if (fileCheck.exitCode !== 0) {
      throw new Error(
        `MP4 file check failed:\n${fileErr}\n${fileOut}`
      );
    }

    // --------------------------------------------
    // 8. SUCCESS
    // --------------------------------------------

    return res.status(200).json({
      success: true,
      message: "REAL MP4 RENDER TEST SUCCESSFUL.",

      renderTest: {
        codec: "h264",
        frames: 90,
        durationSeconds: 3,
        width,
        height,
        remotionVersion: binaryOut.trim(),
        browserSetup: browserOut.trim(),
        file: fileOut.trim(),
      },

      videoUrl: null,
      playbackReady: false,
    });

  } catch (error) {
    console.error(
      "VIRALTAP REAL RENDER TEST ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Real MP4 render test failed.",
      details:
        error?.message ||
        "Unknown rendering error.",
    });

  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (error) {
        console.error(
          "SANDBOX STOP ERROR:",
          error
        );
      }
    }
  }
}
