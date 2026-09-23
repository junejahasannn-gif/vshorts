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

  const body = req.body || {};
  const scenes = Array.isArray(body.scenes) ? body.scenes : [];
  const aspectRatio = body.aspectRatio || "9:16";

  if (!scenes.length) {
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
  } else if (aspectRatio === "1:1") {
    width = 1080;
    height = 1080;
  }

  let sandbox = null;

  try {
    console.log("VIRALTAP RENDER START");
    console.log("Scenes:", scenes.length);
    console.log("Aspect:", aspectRatio);

    sandbox = await Sandbox.create({
      persistent: false,
      timeout: 10 * 60 * 1000,
    });

    async function run(cmd, args = [], sudo = false) {
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
          typeof result.exitCode === "number"
            ? result.exitCode
            : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      };
    }

    // -----------------------------
    // SYSTEM DEPENDENCIES
    // -----------------------------

    const update = await run(
      "apt-get",
      ["update", "-qq"],
      true
    );

    if (update.exitCode !== 0) {
      throw new Error(
        `apt-get update failed: ${
          update.stderr || update.stdout
        }`
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
        "libasound2t64",
        "fonts-liberation",
        "ffmpeg",
      ],
      true
    );

    if (install.exitCode !== 0) {
      throw new Error(
        `apt-get install failed: ${
          install.stderr || install.stdout
        }`
      );
    }

    // -----------------------------
    // READ REMOTION FILES
    // -----------------------------

    const rootPath = path.join(
      process.cwd(),
      "src",
      "Root.jsx"
    );

    const indexPath = path.join(
      process.cwd(),
      "src",
      "index.jsx"
    );

    if (!fs.existsSync(rootPath)) {
      throw new Error("src/Root.jsx not found");
    }

    if (!fs.existsSync(indexPath)) {
      throw new Error("src/index.jsx not found");
    }

    const rootContent = fs.readFileSync(
      rootPath,
      "utf8"
    );

    const indexContent = fs.readFileSync(
      indexPath,
      "utf8"
    );

    // -----------------------------
    // RENDER PACKAGE
    // -----------------------------

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
      duration: 3,
      aspectRatio,
      width,
      height,
    };

    await sandbox.writeFiles([
      {
        path: "package.json",
        content: Buffer.from(
          JSON.stringify(packageJson, null, 2)
        ),
      },
      {
        path: "src/Root.jsx",
        content: Buffer.from(rootContent),
      },
      {
        path: "src/index.jsx",
        content: Buffer.from(indexContent),
      },
      {
        path: "props.json",
        content: Buffer.from(
          JSON.stringify(props, null, 2)
        ),
      },
    ]);

    // -----------------------------
    // NPM INSTALL
    // -----------------------------

    const npm = await run("npm", [
      "install",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
    ]);

    if (npm.exitCode !== 0) {
      throw new Error(
        `npm install failed: ${
          npm.stderr || npm.stdout
        }`
      );
    }

    // -----------------------------
    // REMOTION BROWSER
    // -----------------------------

    const browser = await run("npx", [
      "remotion",
      "browser",
      "ensure",
    ]);

    if (browser.exitCode !== 0) {
      throw new Error(
        `Browser setup failed: ${
          browser.stderr || browser.stdout
        }`
      );
    }

    // -----------------------------
    // RENDER
    // -----------------------------

    console.log("Starting Remotion render...");

    const render = await run("npx", [
      "remotion",
      "render",
      "src/index.jsx",
      "viraltap-test.mp4",
      "--frames=0-89",
      "--codec=h264",
      "--props=props.json",
      "--concurrency=1",
      "--chromium-options=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu",
      "--gl=angle",
      "--disable-web-security",
    ]);

    if (render.exitCode !== 0) {
      throw new Error(
        `Remotion render failed: ${
          render.stderr || render.stdout
        }`
      );
    }

    // -----------------------------
    // CHECK VIDEO
    // -----------------------------

    const check = await run("ls", [
      "-lh",
      "viraltap-test.mp4",
    ]);

    if (check.exitCode !== 0) {
      throw new Error(
        "Rendered MP4 was not created"
      );
    }

    console.log(check.stdout);

    // -----------------------------
    // EXPORT MP4
    // -----------------------------

    const encoded = await run("base64", [
      "-w",
      "0",
      "viraltap-test.mp4",
    ]);

    if (
      encoded.exitCode !== 0 ||
      !encoded.stdout
    ) {
      throw new Error(
        "Failed to read rendered MP4"
      );
    }

    const videoBuffer = Buffer.from(
      encoded.stdout.trim(),
      "base64"
    );

    if (!videoBuffer.length) {
      throw new Error(
        "Rendered video is empty"
      );
    }

    // -----------------------------
    // VERCEL BLOB
    // -----------------------------

    let videoUrl;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const fileName =
        `viraltap-${Date.now()}.mp4`;

      const blob = await put(
        fileName,
        videoBuffer,
        {
          access: "public",
          contentType: "video/mp4",
        }
      );

      videoUrl = blob.url;
    } else {
      videoUrl =
        `data:video/mp4;base64,${encoded.stdout.trim()}`;
    }

    console.log(
      "VIRALTAP RENDER SUCCESS"
    );

    return res.status(200).json({
      success: true,
      videoUrl,
      sizeBytes: videoBuffer.length,
      durationFrames: 90,
      fps: 30,
      dimensions: `${width}x${height}`,
      aspectRatio,
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
        "Video rendering failed",
    });

  } finally {
    if (sandbox) {
      try {
        if (typeof sandbox.stop === "function") {
          await sandbox.stop();
        }
      } catch (cleanupError) {
        console.log(
          "Sandbox cleanup:",
          cleanupError?.message
        );
      }
    }
  }
}
