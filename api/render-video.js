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

    console.log("VIRALTAP RENDER START");
    console.log("Scenes:", scenes.length);
    console.log("Duration:", duration);
    console.log("Aspect ratio:", aspectRatio);

    // --------------------------------------------------
    // 1. CREATE SANDBOX
    // --------------------------------------------------

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000,
    });

    // --------------------------------------------------
    // 2. INSTALL CHROMIUM SYSTEM LIBRARIES
    // --------------------------------------------------

    console.log("Installing Chromium system dependencies...");

    const apt = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `
        set -e

        export DEBIAN_FRONTEND=noninteractive

        apt-get update -qq

        apt-get install -y -qq --no-install-recommends \\
          libnspr4 \\
          libnss3 \\
          libatk-bridge2.0-0 \\
          libatk1.0-0 \\
          libcups2 \\
          libdrm2 \\
          libxkbcommon0 \\
          libxcomposite1 \\
          libxdamage1 \\
          libxfixes3 \\
          libxrandr2 \\
          libgbm1 \\
          libpango-1.0-0 \\
          libcairo2 \\
          fonts-liberation \\
          ffmpeg

        apt-get install -y -qq libasound2 || true
        apt-get install -y -qq libasound2t64 || true

        ldconfig

        echo "SYSTEM_LIBRARIES_INSTALLED"
        `,
      ],
    });

    const aptOut = await apt.stdout();
    const aptErr = await apt.stderr();

    if (apt.exitCode !== 0) {
      throw new Error(
        `System dependency installation failed:\\n${aptErr}\\n${aptOut}`
      );
    }

    console.log(aptOut);

    // --------------------------------------------------
    // 3. CREATE REMOTION PROJECT
    // --------------------------------------------------

    const packageJson = `
{
  "name": "viraltap-render-worker",
  "version": "1.0.0",
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
  interpolate,
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
    caption: "ViralTap",
  };

  const fadeFrames = Math.max(1, Math.floor(fps * 0.25));

  const opacity = interpolate(
    frame % fps,
    [0, fadeFrames, fps],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
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
          scene.scene ||
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
      width={${width}}
      height={${height}}
      defaultProps={{
        scenes: [
          {
            caption: "ViralTap Render Test",
          },
        ],
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
          JSON.stringify({ scenes }, null, 2)
        ),
      },
    ]);

    // --------------------------------------------------
    // 4. NPM INSTALL
    // --------------------------------------------------

    console.log("Installing Remotion...");

    const install = await sandbox.runCommand({
      cmd: "npm",
      args: [
        "install",
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
      ],
    });

    const installOut = await install.stdout();
    const installErr = await install.stderr();

    if (install.exitCode !== 0) {
      throw new Error(
        `npm install failed:\\n${installErr}\\n${installOut}`
      );
    }

    // --------------------------------------------------
    // 5. REMOTION VERSION CHECK
    // --------------------------------------------------

    const versionCheck = await sandbox.runCommand({
      cmd: "node_modules/.bin/remotion",
      args: ["versions"],
    });

    const versionOut = await versionCheck.stdout();
    const versionErr = await versionCheck.stderr();

    if (versionCheck.exitCode !== 0) {
      throw new Error(
        `Remotion version check failed:\\n${versionErr}\\n${versionOut}`
      );
    }

    console.log("REMOTION:");
    console.log(versionOut);

    // --------------------------------------------------
    // 6. ENSURE CHROME
    // --------------------------------------------------

    console.log("Ensuring Remotion Chrome...");

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
        `Remotion browser setup failed:\\n${browserErr}\\n${browserOut}`
      );
    }

    console.log(browserOut);

    // --------------------------------------------------
    // 7. CHECK CHROME LIBRARY
    // --------------------------------------------------

    const chromeCheck = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `
        CHROME=$(find /vercel /root -type f -name "chrome-headless-shell" 2>/dev/null | head -1)

        if [ -z "$CHROME" ]; then
          echo "Chrome binary not found"
          exit 1
        fi

        echo "Chrome: $CHROME"

        ldd "$CHROME" 2>&1 | grep "not found" || true
        `,
      ],
    });

    const chromeOut = await chromeCheck.stdout();
    const chromeErr = await chromeCheck.stderr();

    console.log("CHROME CHECK:");
    console.log(chromeOut);

    if (chromeCheck.exitCode !== 0) {
      throw new Error(
        `Chrome library check failed:\\n${chromeErr}\\n${chromeOut}`
      );
    }

    // --------------------------------------------------
    // 8. REAL 3-SECOND MP4 RENDER TEST
    // --------------------------------------------------

    console.log("Starting REAL MP4 render...");

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
        "--props=scenes.json",
        "--chromium-options=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu",
      ],
    });

    const renderOut = await render.stdout();
    const renderErr = await render.stderr();

    console.log("RENDER STDOUT:");
    console.log(renderOut);

    console.log("RENDER STDERR:");
    console.log(renderErr);

    if (render.exitCode !== 0) {
      throw new Error(
        `Remotion render failed:\\n${renderErr}\\n${renderOut}`
      );
    }

    // --------------------------------------------------
    // 9. VERIFY MP4
    // --------------------------------------------------

    const fileCheck = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        "ls -lh viraltap-test.mp4 && file viraltap-test.mp4 && ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 viraltap-test.mp4",
      ],
    });

    const fileOut = await fileCheck.stdout();
    const fileErr = await fileCheck.stderr();

    if (fileCheck.exitCode !== 0) {
      throw new Error(
        `MP4 verification failed:\\n${fileErr}\\n${fileOut}`
      );
    }

    console.log("MP4 VERIFIED:");
    console.log(fileOut);

    // --------------------------------------------------
    // 10. SUCCESS
    // --------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "REAL MP4 RENDER TEST SUCCESSFUL.",

      renderTest: {
        codec: "h264",
        frames: 90,
        fps: 30,
        durationSeconds: 3,
        width,
        height,
        scenes: scenes.length,
        requestedDuration: duration,
        aspectRatio,
        remotionVersion: versionOut.trim(),
        browserSetup: browserOut.trim(),
        chromeCheck: chromeOut.trim(),
        file: fileOut.trim(),
      },

      videoUrl: null,
      playbackReady: false,
    });

  } catch (error) {
    console.error(
      "VIRALTAP REAL RENDER ERROR:",
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
