import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/* ==================================================
   ENVIRONMENT
================================================== */

const jobId = process.env.JOB_ID;
const sourceVideoUrl = process.env.SOURCE_VIDEO_URL;
const musicUrl = process.env.MUSIC_URL;
const duration = Number(process.env.VIDEO_DURATION);
const musicStyle = process.env.MUSIC_STYLE || "cinematic";

const workerUrl =
  process.env.VIRALTAP_WORKER_URL ||
  "https://vshorts-app.vercel.app/api/render-worker";

const githubOidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const githubOidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

const OIDC_AUDIENCE = "https://vshorts-app.vercel.app";

const MAX_DOWNLOAD_SIZE = 5 * 1024 * 1024 * 1024;
const MUSIC_VOLUME = 0.16;

/* ==================================================
   VALIDATION
================================================== */

if (!jobId) {
  throw new Error("JOB_ID is missing.");
}

if (!sourceVideoUrl || !sourceVideoUrl.startsWith("https://")) {
  throw new Error("SOURCE_VIDEO_URL must be a valid HTTPS URL.");
}

if (!musicUrl || !musicUrl.startsWith("https://")) {
  throw new Error("MUSIC_URL must be a valid HTTPS URL.");
}

if (![30, 60, 180].includes(duration)) {
  throw new Error("VIDEO_DURATION must be 30, 60, or 180.");
}

if (!githubOidcRequestUrl || !githubOidcRequestToken) {
  throw new Error(
    "GitHub Actions OIDC is unavailable. The workflow must grant id-token: write."
  );
}

/* ==================================================
   TEMP DIRECTORY
================================================== */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "viraltap-music-"));
const sourcePath = path.join(tempDir, "source.mp4");
const musicPath = path.join(tempDir, "music.mp3");
const outputPath = path.join(tempDir, "final.mp4");

/* ==================================================
   CLEANUP
================================================== */

function cleanup() {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Cleanup failed:", error);
  }
}

process.on("exit", cleanup);

/* ==================================================
   GITHUB OIDC TOKEN
================================================== */

let cachedOidcToken = null;
let cachedOidcTokenExpiresAt = 0;

async function getGitHubOidcToken() {
  const now = Date.now();

  if (cachedOidcToken && now < cachedOidcTokenExpiresAt - 60_000) {
    return cachedOidcToken;
  }

  const separator = githubOidcRequestUrl.includes("?") ? "&" : "?";

  const response = await fetch(
    githubOidcRequestUrl + separator + "audience=" + encodeURIComponent(OIDC_AUDIENCE),
    { headers: { Authorization: "bearer " + githubOidcRequestToken } }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "Could not obtain GitHub OIDC token: HTTP " + response.status + " " + detail.slice(0, 500)
    );
  }

  const data = await response.json();

  if (!data?.value) {
    throw new Error("GitHub OIDC response did not contain a token.");
  }

  cachedOidcToken = data.value;
  cachedOidcTokenExpiresAt = now + 5 * 60 * 1000;

  return cachedOidcToken;
}

/* ==================================================
   WORKER REQUEST
================================================== */

async function workerRequest(body) {
  const oidcToken = await getGitHubOidcToken();

  const response = await fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + oidcToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId, ...body }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Worker API returned invalid JSON: " + text.slice(0, 500));
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Worker API request failed.");
  }

  return data;
}

/* ==================================================
   STATUS UPLOAD URL
================================================== */

let cachedStatusUrl = null;
let cachedStatusUrlExpiresAt = 0;

async function getStatusUploadUrl() {
  const now = Date.now();

  if (cachedStatusUrl && now < cachedStatusUrlExpiresAt) {
    return cachedStatusUrl;
  }

  const result = await workerRequest({ action: "status-url" });

  if (!result?.url) {
    throw new Error("Worker did not return a status upload URL.");
  }

  cachedStatusUrl = result.url;
  cachedStatusUrlExpiresAt = now + 8 * 60 * 1000;

  return cachedStatusUrl;
}

/* ==================================================
   STATUS UPDATE
================================================== */

async function updateStatus(payload) {
  const url = await getStatusUploadUrl();

  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, updatedAt: new Date().toISOString(), ...payload }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "Status upload failed with HTTP " + response.status + ": " + detail.slice(0, 500)
    );
  }
}

/* ==================================================
   DOWNLOAD FILE
================================================== */

async function downloadFile(url, destination, label) {
  console.log(`Downloading ${label}...`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label} download failed with HTTP ${response.status}.`);
  }

  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_SIZE) {
    throw new Error(`${label} is too large.`);
  }

  if (!response.body) {
    throw new Error(`${label} response has no body.`);
  }

  const file = fs.createWriteStream(destination);
  let totalBytes = 0;

  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > MAX_DOWNLOAD_SIZE) {
        throw new Error(`${label} exceeded the maximum download size.`);
      }

      file.write(buffer);
    }
  } finally {
    file.end();
    await new Promise((resolve) => file.once("close", resolve));
  }

  if (totalBytes <= 0) {
    throw new Error(`${label} downloaded file is empty.`);
  }

  console.log(`${label} downloaded:`, totalBytes, "bytes");

  return totalBytes;
}

/* ==================================================
   FFMPEG RUNNER
================================================== */

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`${label}:`, command, args.join(" "));

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;

      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }

      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code}.\n${stderr.slice(-5000)}`));
    });
  });
}

/* ==================================================
   DETECT SOURCE AUDIO
================================================== */

async function sourceHasAudio() {
  try {
    await runCommand(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=index",
        "-of", "csv=p=0",
        sourcePath,
      ],
      "Checking source audio"
    );

    return true;
  } catch {
    return false;
  }
}

/* ==================================================
   MIX MUSIC
================================================== */

async function mixMusic({ hasOriginalAudio }) {
  console.log("Mixing selected music...");

  if (hasOriginalAudio) {
    const filterComplex = [
      `[0:a]aresample=48000,volume=1.0[voice]`,
      `[1:a]aresample=48000,volume=${MUSIC_VOLUME}[music]`,
      `[voice][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
    ].join(";");

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i", sourcePath,
        "-stream_loop", "-1",
        "-i", musicPath,
        "-filter_complex", filterComplex,
        "-map", "0:v:0",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-t", String(duration),
        "-movflags", "+faststart",
        outputPath,
      ],
      "FFmpeg voice + music mix"
    );

    return;
  }

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i", sourcePath,
      "-stream_loop", "-1",
      "-i", musicPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-t", String(duration),
      "-movflags", "+faststart",
      outputPath,
    ],
    "FFmpeg music-only mix"
  );
}

/* ==================================================
   MAIN
================================================== */

async function main() {
  try {
    await updateStatus({
      status: "mixing",
      progress: 5,
      message: "Preparing selected music...",
      musicStyle,
    });

    await downloadFile(sourceVideoUrl, sourcePath, "Original video");

    await updateStatus({
      status: "mixing",
      progress: 20,
      message: "Original video downloaded.",
      musicStyle,
    });

    await downloadFile(musicUrl, musicPath, "Selected music");

    await updateStatus({
      status: "mixing",
      progress: 40,
      message: "Music downloaded. Preparing audio mix.",
      musicStyle,
    });

    const hasOriginalAudio = await sourceHasAudio();

    console.log("Original audio:", hasOriginalAudio ? "YES" : "NO");

    await updateStatus({
      status: "mixing",
      progress: 50,
      message: hasOriginalAudio
        ? "Mixing background music with voiceover."
        : "Adding background music to video.",
      musicStyle,
    });

    await mixMusic({ hasOriginalAudio });

    if (!fs.existsSync(outputPath)) {
      throw new Error("FFmpeg did not create the final MP4.");
    }

    const outputStats = fs.statSync(outputPath);

    if (outputStats.size <= 0) {
      throw new Error("Final MP4 is empty.");
    }

    await updateStatus({
      status: "mixing",
      progress: 75,
      message: "Music mix completed. Uploading final video.",
      musicStyle,
    });

    const videoUpload = await workerRequest({
      action: "video-url",
      sizeBytes: outputStats.size,
    });

    if (!videoUpload?.url) {
      throw new Error("Worker did not return final video upload URL.");
    }

    console.log("Uploading final mixed MP4...");

    const stream = fs.createReadStream(outputPath);

    try {
      const response = await fetch(videoUpload.url, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(outputStats.size),
        },
        body: stream,
        duplex: "half",
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          "Final video upload failed with HTTP " + response.status + ": " + detail.slice(0, 500)
        );
      }
    } finally {
      stream.destroy();
    }

    const pathname = videoUpload.pathname || `videos/${jobId}.mp4`;

    await updateStatus({
      status: "completed",
      progress: 100,
      message: "Music applied successfully.",
      musicStyle,
      videoUrl: pathname,
      videoPath: pathname,
      sourceVideoUrl,
      sizeBytes: outputStats.size,
    });

    console.log("========================================");
    console.log("VIRALTAP MUSIC MIX COMPLETE");
    console.log("JOB:", jobId);
    console.log("MUSIC:", musicStyle);
    console.log("VIDEO:", pathname);
    console.log("SIZE:", outputStats.size, "bytes");
    console.log("========================================");
  } catch (error) {
    console.error("VIRALTAP MUSIC MIX ERROR:", error);

    try {
      // FIX: structured error, matching check-status.js / other runners,
      // instead of a bare string.
      await updateStatus({
        status: "failed",
        progress: 0,
        message: "Music application failed.",
        error: {
          code: "RENDER_FAILED",
          message: error?.message || "Music mix failed.",
        },
        musicStyle,
      });
    } catch (statusError) {
      console.error("Could not write failed status:", statusError);
    }

    throw error;
  } finally {
    cleanup();
  }
}

await main();
