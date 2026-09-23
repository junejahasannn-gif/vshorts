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

    // --------------------------------------------
    // 1. CREATE SANDBOX
    // --------------------------------------------

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000,
    });

    // --------------------------------------------
    // 2. REMOTION PROJECT
    // --------------------------------------------

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
    caption: "ViralTap Render Test"
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

    // --------------------------------------------
    // 3. INSTALL
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
    // 4. CHECK INSTALLED BINARY DIRECTLY
    // --------------------------------------------

    const binaryCheck = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls -la node_modules/.bin/remotion && node_modules/.bin/remotion --version",
      ],
    });

    const binaryOut = await binaryCheck.stdout();
    const binaryErr = await binaryCheck.stderr();

    if (binaryCheck.exitCode !== 0) {
      throw new Error(
        `Remotion binary check failed:\n${binaryErr}\n${binaryOut}`
      );
    }

    // --------------------------------------------
    // 5. BROWSER SETUP
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
    // 6. RENDER
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
    // 7. CHECK MP4
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
    // SUCCESS
    // --------------------------------------------

    return res.status(200).json({
      success: true,
      message: "REAL MP4 RENDER TEST SUCCESSFUL.",
      renderTest: {
        codec: "h264",
        frames: 90,
        durationSeconds: 3,
        remotionVersion: binaryOut.trim(),
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
