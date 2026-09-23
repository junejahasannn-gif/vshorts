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

  const startTime = Date.now();

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

  try {
    // --------------------------------------------------
    // 1. CREATE SANDBOX
    // --------------------------------------------------

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000,
    });

    // --------------------------------------------------
    // 2. CREATE MINIMAL REMOTION PROJECT
    // --------------------------------------------------

    const packageJson = `
{
  "name": "viraltap-render-test",
  "private": true,
  "type": "module",
  "dependencies": {
    "@remotion/cli": "latest",
    "react": "latest",
    "react-dom": "latest",
    "remotion": "latest"
  }
}
`;

    const rootJsx = `
import React from "react";
import {
  Composition,
  useCurrentFrame,
  interpolate
} from "remotion";

const FPS = 30;

const Video = ({ scenes = [] }) => {
  const frame = useCurrentFrame();

  const sceneIndex = Math.min(
    Math.floor(frame / 30),
    Math.max(scenes.length - 1, 0)
  );

  const scene = scenes[sceneIndex] || {
    caption: "ViralTap"
  };

  const opacity = interpolate(
    frame % 30,
    [0, 8, 30],
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
        background: "#111",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        opacity
      }}
    >
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1.25
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
      fps={FPS}
      width={1080}
      height={1920}
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
          JSON.stringify(scenes.slice(0, 3))
        ),
      },
    ]);

    // --------------------------------------------------
    // 3. INSTALL PACKAGES
    // --------------------------------------------------

    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install"],
    });

    const installStdout = await install.stdout();
    const installStderr = await install.stderr();

    if (install.exitCode !== 0) {
      throw new Error(
        `npm install failed:\n${installStderr}\n${installStdout}`
      );
    }

    // --------------------------------------------------
    // 4. CHECK REMOTION CLI
    // --------------------------------------------------
    // IMPORTANT:
    // We installed @remotion/cli explicitly.
    // This avoids the previous:
    // "could not determine executable to run"
    // problem from `npx remotion`.

    const cliCheck = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "--yes",
        "@remotion/cli",
        "--version",
      ],
    });

    const cliStdout = await cliCheck.stdout();
    const cliStderr = await cliCheck.stderr();

    if (cliCheck.exitCode !== 0) {
      throw new Error(
        `Remotion CLI check failed:\n${cliStderr}\n${cliStdout}`
      );
    }

    // --------------------------------------------------
    // 5. BROWSER SETUP
    // --------------------------------------------------

    const browser = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "--yes",
        "@remotion/cli",
        "browser",
        "ensure",
      ],
    });

    const browserStdout = await browser.stdout();
    const browserStderr = await browser.stderr();

    if (browser.exitCode !== 0) {
      throw new Error(
        `Remotion browser setup failed:\n${browserStderr}\n${browserStdout}`
      );
    }

    // --------------------------------------------------
    // 6. RENDER 3-SECOND TEST MP4
    // --------------------------------------------------

    const render = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "--yes",
        "@remotion/cli",
        "render",
        "src/index.jsx",
        "ViralTapVideo",
        "viraltap-test.mp4",
        "--frames=0-89",
        "--codec=h264",
      ],
    });

    const renderStdout = await render.stdout();
    const renderStderr = await render.stderr();

    if (render.exitCode !== 0) {
      throw new Error(
        `Remotion render failed:\n${renderStderr}\n${renderStdout}`
      );
    }

    // --------------------------------------------------
    // 7. CHECK MP4
    // --------------------------------------------------

    const fileCheck = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls -lh viraltap-test.mp4 && file viraltap-test.mp4",
      ],
    });

    const fileOutput = await fileCheck.stdout();
    const fileError = await fileCheck.stderr();

    if (fileCheck.exitCode !== 0) {
      throw new Error(
        `MP4 file check failed:\n${fileError}\n${fileOutput}`
      );
    }

    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    return res.status(200).json({
      success: true,

      message:
        "REAL MP4 RENDER TEST SUCCESSFUL.",

      totalTime:
        `${((Date.now() - startTime) / 1000).toFixed(2)}s`,

      renderTest: {
        durationSeconds: 3,
        frames: 90,
        codec: "h264",
        cliVersion: cliStdout.trim(),
        file: fileOutput.trim(),
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

      error:
        "Real MP4 render test failed.",

      details:
        error?.message ||
        "Unknown rendering error.",

      totalTime:
        `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
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
