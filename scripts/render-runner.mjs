import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/* ==================================================
   ENVIRONMENT
================================================== */

const jobId = process.env.JOB_ID;
const duration = Number(process.env.VIDEO_DURATION);
const propsBase64 = process.env.PROPS_BASE64;

const workerUrl =
  process.env.VIRALTAP_WORKER_URL ||
  "https://vshorts-app.vercel.app/api/render-worker";

const visualsUrl =
  process.env.VIRALTAP_VISUALS_URL ||
  "https://vshorts-app.vercel.app/api/generate-visuals";

const voiceUrl =
  process.env.VIRALTAP_VOICE_URL ||
  "https://vshorts-app.vercel.app/api/generate-voice";

const musicUrl =
  process.env.VIRALTAP_MUSIC_URL ||
  "https://vshorts-app.vercel.app/api/generate-music";

// FIX: generate-visuals.js and generate-voice.js now check this header
// when INTERNAL_WORKER_SECRET is set in Vercel, so that a random visitor
// can't hit those Gemini-backed endpoints directly and burn your quota.
// Must match the INTERNAL_WORKER_SECRET GitHub Actions secret used below.
const internalWorkerSecret = process.env.INTERNAL_WORKER_SECRET || "";

function internalHeaders() {
  return {
    "Content-Type": "application/json",
    ...(internalWorkerSecret
      ? { "x-internal-secret": internalWorkerSecret }
      : {}),
  };
}

const githubOidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const githubOidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

const OIDC_AUDIENCE = "https://vshorts-app.vercel.app";

const FPS = 30;
const STATUS_URL_CACHE_MS = 8 * 60 * 1000;
const OIDC_TOKEN_SAFETY_MS = 60 * 1000;

/* ==================================================
   VALIDATION
================================================== */

if (!jobId) {
  throw new Error("JOB_ID is missing.");
}

if (![30, 60, 180].includes(duration)) {
  throw new Error("VIDEO_DURATION must be 30, 60, or 180.");
}

if (!propsBase64) {
  throw new Error("PROPS_BASE64 is missing.");
}

if (!githubOidcRequestUrl || !githubOidcRequestToken) {
  throw new Error(
    "GitHub Actions OIDC is unavailable. The workflow must grant id-token: write."
  );
}

/* ==================================================
   CACHED AUTH / URL STATE
================================================== */

let cachedOidcToken = null;
let cachedOidcTokenExpiresAt = 0;

let cachedStatusUploadUrl = null;
let cachedStatusUploadExpiresAt = 0;

/* ==================================================
   GITHUB OIDC TOKEN
================================================== */

async function getGitHubOidcToken() {
  const now = Date.now();

  if (cachedOidcToken && now < cachedOidcTokenExpiresAt - OIDC_TOKEN_SAFETY_MS) {
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
      "Could not obtain GitHub OIDC token: HTTP " + response.status + " " + detail.slice(0, 300)
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
    throw new Error("ViralTap worker API returned invalid JSON: " + text.slice(0, 300));
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "ViralTap worker API request failed.");
  }

  return data;
}

/* ==================================================
   STATUS UPLOAD URL
================================================== */

async function getStatusUploadUrl() {
  const now = Date.now();

  if (cachedStatusUploadUrl && now < cachedStatusUploadExpiresAt) {
    return cachedStatusUploadUrl;
  }

  const signed = await workerRequest({ action: "status-url" });

  if (!signed?.url) {
    throw new Error("Worker did not return a status upload URL.");
  }

  cachedStatusUploadUrl = signed.url;
  cachedStatusUploadExpiresAt = now + STATUS_URL_CACHE_MS;

  return cachedStatusUploadUrl;
}

/* ==================================================
   STATUS UPDATE
================================================== */

async function updateStatus(payload) {
  const signedUrl = await getStatusUploadUrl();

  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, updatedAt: new Date().toISOString(), ...payload }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "Status upload failed with HTTP " + response.status + ": " + detail.slice(0, 300)
    );
  }
}

/* ==================================================
   VIDEO UPLOAD
================================================== */

async function uploadVideo(outputPath, sizeBytes) {
  const signed = await workerRequest({ action: "video-url", sizeBytes });

  if (!signed?.url) {
    throw new Error("Worker did not return a video upload URL.");
  }

  console.log("Uploading MP4...");
  console.log("Upload size:", sizeBytes, "bytes");

  const stream = fs.createReadStream(outputPath);

  try {
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(sizeBytes),
      },
      body: stream,
      duplex: "half",
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        "Video upload failed with HTTP " + response.status + ": " + detail.slice(0, 300)
      );
    }
  } finally {
    stream.destroy();
  }

  const pathname = signed.pathname || `videos/${jobId}.mp4`;

  console.log("VIDEO BLOB PATH:", pathname);

  return pathname;
}

/* ==================================================
   ERROR NORMALIZATION
================================================== */

// generate-visuals.js / generate-voice.js / generate-music.js now return
// { success:false, error:{ code, message, retryAfterSeconds? } } instead
// of a flat string. This keeps the runner working against either shape
// and surfaces a useful message either way.
function errorMessageFrom(data, fallback) {
  if (data?.error && typeof data.error === "object") {
    const msg = data.error.message || fallback;
    return data.error.retryAfterSeconds
      ? `${msg} (retry after ~${data.error.retryAfterSeconds}s)`
      : msg;
  }

  return data?.error || fallback;
}

/* ==================================================
   AI VISUAL GENERATION
================================================== */

async function generateSceneVisual(scene, sceneIndex, totalScenes, props) {
  console.log(`Generating AI visual ${sceneIndex + 1}/${totalScenes}...`);

  const response = await fetch(visualsUrl, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      jobId,
      scene,
      sceneIndex,
      language: props.language || "English",
      aspectRatio: props.aspectRatio || "9:16",
      visualPrompt:
        scene?.visualPrompt || scene?.caption || scene?.narration || "",
    }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Visual generation API returned invalid JSON: " + text.slice(0, 500));
  }

  if (!response.ok || !data?.success || !data?.asset?.url) {
    throw new Error(
      errorMessageFrom(data, `AI visual generation failed for scene ${sceneIndex + 1}.`)
    );
  }

  console.log(`AI visual ${sceneIndex + 1}/${totalScenes} ready.`);

  return data.asset;
}

async function generateAllVisuals(props) {
  const scenes = Array.isArray(props.scenes) ? props.scenes : [];

  if (!scenes.length) {
    throw new Error("Cannot generate visuals without scenes.");
  }

  const totalScenes = scenes.length;
  const assets = [];

  await updateStatus({
    status: "rendering",
    progress: 2,
    message: `Generating AI visuals — 0/${totalScenes} scenes`,
  });

  for (let index = 0; index < totalScenes; index++) {
    const asset = await generateSceneVisual(scenes[index], index, totalScenes, props);
    assets.push(asset);

    const visualProgress = Math.min(20, Math.round(((index + 1) / totalScenes) * 20));

    await updateStatus({
      status: "rendering",
      progress: visualProgress,
      message: `Generating AI visuals — ${index + 1}/${totalScenes} scenes`,
    });
  }

  return assets;
}

/* ==================================================
   AI VOICE GENERATION
================================================== */

async function generateSceneVoice(scene, sceneIndex, totalScenes, props) {
  console.log(`Generating AI voice ${sceneIndex + 1}/${totalScenes}...`);

  const response = await fetch(voiceUrl, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      jobId,
      scene,
      sceneIndex,
      language: props.language || "Hindi",
      voice: props.voice || "Natural Male",
    }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Voice generation API returned invalid JSON: " + text.slice(0, 500));
  }

  if (!response.ok || !data?.success || !data?.asset?.url) {
    throw new Error(
      errorMessageFrom(data, `AI voice generation failed for scene ${sceneIndex + 1}.`)
    );
  }

  console.log(`AI voice ${sceneIndex + 1}/${totalScenes} ready.`);

  return data.asset;
}

async function generateAllVoices(props) {
  const scenes = Array.isArray(props.scenes) ? props.scenes : [];

  if (!scenes.length) {
    throw new Error("Cannot generate voice without scenes.");
  }

  const totalScenes = scenes.length;
  const assets = [];

  await updateStatus({
    status: "rendering",
    progress: 20,
    message: `Generating AI voice — 0/${totalScenes} scenes`,
  });

  for (let index = 0; index < totalScenes; index++) {
    const asset = await generateSceneVoice(scenes[index], index, totalScenes, props);
    assets.push(asset);

    const voiceProgress = 20 + Math.round(((index + 1) / totalScenes) * 15);

    await updateStatus({
      status: "rendering",
      progress: voiceProgress,
      message: `Generating AI voice — ${index + 1}/${totalScenes} scenes`,
    });
  }

  return assets;
}

/* ==================================================
   AI BACKGROUND MUSIC
================================================== */

async function generateMusic(props) {
  console.log("Generating AI background music...");

  await updateStatus({
    status: "rendering",
    progress: 36,
    message: "Creating AI background music...",
  });

  const response = await fetch(musicUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId,
      scenes: props.scenes,
      language: props.language || "Hindi",
    }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Music generation API returned invalid JSON: " + text.slice(0, 500));
  }

  if (!response.ok || !data?.success || !data?.asset?.url) {
    throw new Error(errorMessageFrom(data, "AI background music generation failed."));
  }

  console.log("AI background music ready.");
  console.log("Music style:", data.musicStyle || "cinematic");

  return data;
}

/* ==================================================
   COMMAND RUNNER
================================================== */

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log("$", command, ...args);

    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      process.stderr.write(text);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} failed with exit code ${code}\n${stderrBuffer.slice(-2000)}`));
        return;
      }

      resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
    });
  });
}

/* ==================================================
   REMOTION RENDER
================================================== */

async function renderVideo(outputPath, totalFrames) {
  let lastProgress = -1;
  let lastStatusUpdate = Promise.resolve();
  let pendingProgress = null;
  let updateInProgress = false;

  async function sendProgress(percent, message) {
    if (percent <= lastProgress) return;

    lastProgress = percent;
    pendingProgress = { percent, message };

    if (updateInProgress) return;

    updateInProgress = true;

    try {
      while (pendingProgress) {
        const current = pendingProgress;
        pendingProgress = null;

        await lastStatusUpdate;

        lastStatusUpdate = updateStatus({
          status: "rendering",
          progress: current.percent,
          message: current.message,
        });

        await lastStatusUpdate;
      }
    } finally {
      updateInProgress = false;
    }
  }

  console.log("Starting Remotion render...");
  console.log("Total frames:", totalFrames);

  const args = [
    "remotion",
    "render",
    "src/index.jsx",
    "ViralTapVideo",
    outputPath,
    `--frames=0-${totalFrames - 1}`,
    "--codec=h264",
    "--props=props.json",
    "--concurrency=2",
    "--chromium-options=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu",
  ];

  await new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let buffer = "";
    let errorBuffer = "";

    function processOutput(chunk) {
      const text = chunk.toString();
      process.stdout.write(text);

      buffer += text;

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const match = line.match(/Rendered\s+(\d+)\/(\d+)/);

        if (!match) continue;

        const rendered = Number(match[1]);
        const total = Number(match[2]) || totalFrames;

        const percent = Math.min(
          99,
          Math.max(35, 35 + Math.round((rendered / total) * 64))
        );

        void sendProgress(percent, `Rendering MP4 — ${rendered}/${total} frames`);
      }
    }

    child.stdout.on("data", processOutput);

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      errorBuffer += text;
      process.stderr.write(text);
    });

    child.on("error", reject);

    child.on("close", async (code) => {
      try {
        if (code !== 0) {
          reject(
            new Error(
              "Remotion render failed with exit code " + code + "\n" + errorBuffer.slice(-3000)
            )
          );
          return;
        }

        await sendProgress(99, "MP4 render complete. Uploading...");
        await lastStatusUpdate;

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

/* ==================================================
   MAIN
================================================== */

async function main() {
  console.log("========================================");
  console.log("VIRALTAP RENDER RUNNER");
  console.log("Job:", jobId);
  console.log("Duration:", duration, "seconds");
  console.log("========================================");

  await updateStatus({
    status: "rendering",
    progress: 1,
    message: "Preparing AI video assets...",
  });

  let props;

  try {
    props = JSON.parse(Buffer.from(propsBase64, "base64").toString("utf8"));
  } catch {
    throw new Error("PROPS_BASE64 does not contain valid JSON.");
  }

  if (!props || typeof props !== "object") {
    throw new Error("Render props are invalid.");
  }

  if (!Array.isArray(props.scenes) || !props.scenes.length) {
    throw new Error("Render props contain no scenes.");
  }

  console.log("Render props:");
  console.log(
    JSON.stringify(
      {
        sceneCount: props.scenes.length,
        duration,
        aspectRatio: props.aspectRatio,
        width: props.width,
        height: props.height,
        videoType: props.videoType,
        language: props.language,
        voice: props.voice,
        music: props.music,
        branding: props.branding,
      },
      null,
      2
    )
  );

  const totalLines = props.scenes.reduce(
    (count, scene) => count + (Array.isArray(scene?.lines) ? scene.lines.length : 0),
    0
  );

  console.log("Total caption lines:", totalLines);

  console.log("Starting AI visual generation...");
  const visualAssets = await generateAllVisuals(props);

  if (visualAssets.length !== props.scenes.length) {
    throw new Error("AI visual generation returned an incomplete asset list.");
  }

  props.scenes = props.scenes.map((scene, index) => ({
    ...scene,
    visualAsset: visualAssets[index],
    visualUrl: visualAssets[index]?.url || "",
  }));

  console.log("Starting AI voice generation...");
  const voiceAssets = await generateAllVoices(props);

  if (voiceAssets.length !== props.scenes.length) {
    throw new Error("AI voice generation returned an incomplete asset list.");
  }

  props.scenes = props.scenes.map((scene, index) => ({
    ...scene,
    voiceAsset: voiceAssets[index],
    voiceUrl: voiceAssets[index]?.url || "",
  }));

  console.log("Starting AI background music generation...");
  const musicData = await generateMusic(props);

  if (!musicData?.success || !musicData?.asset?.url) {
    throw new Error("AI background music generation returned an incomplete asset.");
  }

  props.musicAsset = musicData.asset;
  props.musicUrl = musicData.asset.url;
  props.musicStyle = musicData.musicStyle || "cinematic";

  fs.mkdirSync("render-output", { recursive: true });

  fs.writeFileSync("props.json", JSON.stringify(props, null, 2), "utf8");

  const totalFrames = duration * FPS;
  const outputPath = path.resolve("render-output", `${jobId}.mp4`);

  console.log("Output MP4:", outputPath);
  console.log("Total frames:", totalFrames);
  console.log("Music style:", props.musicStyle);

  console.log("Checking Remotion browser...");
  await runCommand("npx", ["remotion", "browser", "ensure"]);

  await renderVideo(outputPath, totalFrames);

  if (!fs.existsSync(outputPath)) {
    throw new Error("Rendered MP4 was not created.");
  }

  const stat = fs.statSync(outputPath);

  if (!stat.size) {
    throw new Error("Rendered MP4 is empty.");
  }

  console.log("MP4 CREATED:", outputPath);
  console.log("MP4 SIZE:", stat.size, "bytes");

  await updateStatus({
    status: "uploading",
    progress: 99,
    message: "Uploading your finished MP4...",
    sizeBytes: stat.size,
    musicStyle: props.musicStyle,
    musicUrl: props.musicUrl,
  });

  const videoPath = await uploadVideo(outputPath, stat.size);

  if (!videoPath) {
    throw new Error("Video upload completed but no Blob pathname was available.");
  }

  await updateStatus({
    status: "completed",
    progress: 100,
    message: "Your video is ready.",
    videoUrl: videoPath,
    musicStyle: props.musicStyle,
    musicUrl: props.musicUrl,
    sizeBytes: stat.size,
    duration,
    fps: FPS,
    dimensions: `${props.width || 1080}x${props.height || 1920}`,
  });

  console.log("========================================");
  console.log("VIRALTAP RENDER COMPLETE");
  console.log("Video:", videoPath);
  console.log("Music:", props.musicStyle);
  console.log("========================================");
}

/* ==================================================
   ERROR HANDLING
================================================== */

try {
  await main();
} catch (error) {
  console.error("VIRALTAP RENDER WORKER FAILED:", error);

  try {
    await updateStatus({
      status: "failed",
      progress: 0,
      error: {
        code: "RENDER_FAILED",
        message: error?.message || "Video rendering failed.",
      },
    });
  } catch (statusError) {
    console.error("Could not write failed status:", statusError);
  }

  process.exit(1);
}
