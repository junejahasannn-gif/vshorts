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

    if (!scenes.length) {
      return res.status(400).json({
        success: false,
        error: "No scenes were provided."
      });
    }

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000
    });

    /*
     * Minimal Remotion project used only for
     * the first real MP4 rendering test.
     */

    const packageJson = `
{
  "name": "viraltap-render-test",
  "private": true,
  "type": "module",
  "dependencies": {
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

    const scenesJson = JSON.stringify(
      scenes.slice(0, 3)
    );

    await sandbox.writeFiles([
      {
        path: "package.json",
        content: Buffer.from(packageJson)
      },
      {
        path: "src/Root.jsx",
        content: Buffer.from(rootJsx)
      },
      {
        path: "src/index.jsx",
        content: Buffer.from(indexJsx)
      },
      {
        path: "scenes.json",
        content: Buffer.from(scenesJson)
      }
    ]);

    /*
     * Install the isolated Remotion test project.
     */
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install"]
    });

    if (install.exitCode !== 0) {
      throw new Error(
        `npm install failed: ${await install.stderr()}`
      );
    }

    /*
     * Make sure Remotion's browser is available.
     */
    const browser = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "remotion",
        "browser",
        "ensure"
      ]
    });

    if (browser.exitCode !== 0) {
      throw new Error(
        `Remotion browser setup failed: ${await browser.stderr()}`
      );
    }

    /*
     * Render a real 3-second MP4.
     */
    const render = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "remotion",
        "render",
        "src/index.jsx",
        "viraltap-test.mp4",
        "--frames=0-89",
        "--codec=h264"
      ]
    });

    const renderStdout = await render.stdout();
    const renderStderr = await render.stderr();

    if (render.exitCode !== 0) {
      throw new Error(
        `Remotion render failed.\n${renderStderr}\n${renderStdout}`
      );
    }

    /*
     * Verify that an actual MP4 was created.
     */
    const fileCheck = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls -lh viraltap-test.mp4 && file viraltap-test.mp4"
      ]
    });

    const fileOutput = await fileCheck.stdout();

    if (fileCheck.exitCode !== 0) {
      throw new Error(
        "MP4 file was not created."
      );
    }

    return res.status(200).json({
      success: true,
      message:
        "REAL MP4 RENDER TEST SUCCESSFUL.",
      renderTest: {
        durationSeconds: 3,
        frames: 90,
        codec: "h264",
        file: fileOutput.trim()
      },
      videoUrl: null,
      playbackReady: false
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
        "Unknown rendering error."
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
