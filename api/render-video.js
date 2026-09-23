import { Sandbox } from "@vercel/sandbox";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed",
    });
  }

  const { scenes, aspectRatio = "9:16" } = req.body || {};

  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({
      success: false,
      error: "No scenes were provided",
    });
  }

  let width = 1080;
  let height = 1920;

  if (aspectRatio === "16:9") {
    width = 1920;
    height = 1080;
  }

  if (aspectRatio === "1:1") {
    width = 1080;
    height = 1080;
  }

  let sandbox = null;
  const startTime = Date.now();

  try {
    console.log("VIRALTAP RENDER START");
    console.log("Aspect ratio:", aspectRatio);
    console.log("Scenes:", scenes.length);

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000,
    });

    const run = async (cmd, args = [], sudo = false) => {
      const options = { cmd, args };

      if (sudo) {
        options.sudo = true;
      }

      const result = await sandbox.runCommand(options);

      const stdout =
        typeof result.stdout === "function"
          ? await result.stdout()
          : result.stdout || "";

      const stderr =
        typeof result.stderr === "function"
          ? await result.stderr()
          : result.stderr || "";

      return {
        exitCode:
          typeof result.exitCode === "number" ? result.exitCode : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      };
    };

    // Install Chrome/Linux dependencies
    console.log("Installing system dependencies...");

    const update = await run("apt-get", ["update", "-qq"], true);

    if (update.exitCode !== 0) {
      throw new Error(
        `apt-get update failed: ${update.stderr || update.stdout}`
      );
    }

    const install = await run(
      "apt-get",
      [
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "libnspr4",
        "libnss3",
        "libatk-bridge2.0-0",
        "libatk1.0-0",
        "libcups2",
        "libdrm2",
        "libxkbcommon0",
        "libxcomposite1",
        "libxdamage1",
        "libxfixes3",
        "libxrandr2",
        "libgbm1",
        "libpango-1.0-0",
        "libcairo2",
        "libasound2",
        "fonts-liberation",
        "ffmpeg",
      ],
      true
    );

    if (install.exitCode !== 0) {
      throw new Error(
        `apt-get install failed: ${install.stderr || install.stdout}`
      );
    }

    console.log("System dependencies installed.");

    const rootJsxPath = path.join(process.cwd(), "src", "Root.jsx");
    const indexJsxPath = path.join(process.cwd(), "src", "index.jsx");

    if (!fs.existsSync(rootJsxPath)) {
      throw new Error("src/Root.jsx not found.");
    }

    if (!fs.existsSync(indexJsxPath)) {
      throw new Error("src/index.jsx not found.");
    }

    const rootJsx = fs.readFileSync(rootJsxPath, "utf8");
    const indexJsx = fs.readFileSync(indexJsxPath, "utf8");

    const packageJson = {
      name: "viraltap-render-worker",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: {
        react: "18.3.1",
        "react-dom": "18.3.1",
        remotion: "4.0.527",
        "@remotion/cli": "4.0.527",
      },
    };

    const props = {
      scenes,
      duration: 30,
      aspectRatio,
      width,
      height,
    };

    const files = [
      {
        path: "package.json",
        content: Buffer.from(
          JSON.stringify(packageJson, null, 2)
        ),
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
        path: "props.json",
        content: Buffer.from(JSON.stringify(props, null, 2)),
      },
    ];

    await sandbox.writeFiles(files);

    console.log("Installing npm packages...");

    const npmInstall = await run("npm", [
      "install",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
    ]);

    if (npmInstall.exitCode !== 0) {
      throw new Error(
        `npm install failed: ${npmInstall.stderr || npmInstall.stdout}`
      );
    }

    console.log("Ensuring Remotion browser...");

    const browser = await run("npx", [
      "remotion",
      "browser",
      "ensure",
    ]);

    if (browser.exitCode !== 0) {
      throw new Error(
        `Remotion browser ensure failed: ${
          browser.stderr || browser.stdout
        }`
      );
    }

    console.log("Rendering MP4...");

    const render = await run("npx", [
      "remotion",
      "render",
      "src/index.jsx",
      "viraltap-test.mp4",
      "--frames=0-89",
      "--codec=h264",
      "--props=props.json",
      "--chromium-options=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu",
      "--gl=angle",
    ]);

    if (render.exitCode !== 0) {
      throw new Error(
        `Remotion render failed: ${render.stderr || render.stdout}`
      );
    }

    console.log("Checking MP4...");

    const check = await run("ls", ["-lh", "viraltap-test.mp4"]);

    if (check.exitCode !== 0) {
      throw new Error("MP4 file was not created.");
    }

    const base64 = await run("base64", [
      "-w",
      "0",
      "viraltap-test.mp4",
    ]);

    if (base64.exitCode !== 0 || !base64.stdout) {
      throw new Error("Failed to export MP4.");
    }

    const videoBuffer = Buffer.from(
      base64.stdout.trim(),
      "base64"
    );

    if (!videoBuffer.length) {
      throw new Error("Rendered MP4 is empty.");
    }

    let videoUrl;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const fileName = `viraltap-${Date.now()}.mp4`;

      const blob = await put(fileName, videoBuffer, {
        access: "public",
        contentType: "video/mp4",
      });

      videoUrl = blob.url;
    } else {
      videoUrl =
        `data:video/mp4;base64,${base64.stdout.trim()}`;
    }

    const renderTime = (
      (Date.now() - startTime) /
      1000
    ).toFixed(2);

    console.log("VIRALTAP RENDER SUCCESS");

    return res.status(200).json({
      success: true,
      videoUrl,
      sizeBytes: videoBuffer.length,
      durationFrames: 90,
      fps: 30,
      aspectRatio,
      dimensions: `${width}x${height}`,
      renderTime: `${renderTime}s`,
    });
  } catch (error) {
    console.error(
      "VIRALTAP REAL RENDER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Video rendering failed.",
    });
  } finally {
    if (sandbox) {
      try {
        if (typeof sandbox.stop === "function") {
          await sandbox.stop();
        } else if (typeof sandbox.destroy === "function") {
          await sandbox.destroy();
        } else if (typeof sandbox.close === "function") {
          await sandbox.close();
        }
      } catch (cleanupError) {
        console.error(
          "Sandbox cleanup error:",
          cleanupError
        );
      }
    }
  }
}
