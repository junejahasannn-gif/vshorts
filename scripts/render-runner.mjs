import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const jobId = process.env.JOB_ID;
const duration = Number(process.env.VIDEO_DURATION);
const propsBase64 = process.env.PROPS_BASE64;
const workerUrl =
  process.env.VIRALTAP_WORKER_URL ||
  "https://vshorts-app.vercel.app/api/render-worker";
const githubOidcRequestUrl =
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const githubOidcRequestToken =
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
const OIDC_AUDIENCE =
  "https://vshorts-app.vercel.app";
const FPS = 30;
if (!jobId) {
  throw new Error("JOB_ID is missing.");
}
if (![30, 60, 180].includes(duration)) {
  throw new Error(
    "VIDEO_DURATION must be 30, 60, or 180."
  );
}
if (!propsBase64) {
  throw new Error("PROPS_BASE64 is missing.");
}
if (
  !githubOidcRequestUrl ||
  !githubOidcRequestToken
) {
  throw new Error(
    "GitHub Actions OIDC is unavailable. The workflow must grant id-token: write."
  );
}
async function getGitHubOidcToken() {
  const separator =
    githubOidcRequestUrl.includes("?")
      ? "&"
      : "?";
  const response = await fetch(
    githubOidcRequestUrl +
      separator +
      "audience=" +
      encodeURIComponent(OIDC_AUDIENCE),
    {
      headers: {
        Authorization:
          "bearer " +
          githubOidcRequestToken,
      },
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "Could not obtain GitHub OIDC token: HTTP " +
        response.status +
        " " +
        detail.slice(0, 300)
    );
  }
  const data = await response.json();
  if (!data?.value) {
    throw new Error(
      "GitHub OIDC response did not contain a token."
    );
  }
  return data.value;
}
async function workerRequest(body) {
  const oidcToken =
    await getGitHubOidcToken();
  const response = await fetch(
    workerUrl,
    {
      method: "POST",
      headers: {
        Authorization:
          "Bearer " + oidcToken,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        jobId,
        ...body,
      }),
    }
  );
  const text =
    await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "ViralTap worker API returned invalid JSON: " +
        text.slice(0, 300)
    );
  }
  if (
    !response.ok ||
    !data?.success
  ) {
    throw new Error(
      data?.error ||
        "ViralTap worker API request failed."
    );
  }
  return data;
}
async function updateStatus(payload) {
  const signed =
    await workerRequest({
      action: "status-url",
    });
  if (!signed?.url) {
    throw new Error(
      "Worker did not return a status upload URL."
    );
  }
  const response = await fetch(
    signed.url,
    {
      method: "PUT",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        jobId,
        updatedAt:
          new Date().toISOString(),
        ...payload,
      }),
    }
  );
  if (!response.ok) {
    const detail =
      await response.text();
    throw new Error(
      "Status upload failed with HTTP " +
        response.status +
        ": " +
        detail.slice(0, 300)
    );
  }
}
async function uploadVideo(
  outputPath,
  sizeBytes
) {
  const signed =
    await workerRequest({
      action: "video-url",
      sizeBytes,
    });
  if (!signed?.url) {
    throw new Error(
      "Worker did not return a video upload URL."
    );
  }
  const stream =
    fs.createReadStream(outputPath);
  try {
    const response = await fetch(
      signed.url,
      {
        method: "PUT",
        headers: {
          "Content-Type":
            "video/mp4",
          "Content-Length":
            String(sizeBytes),
        },
        body: stream,
        duplex: "half",
      }
    );
    if (!response.ok) {
      const detail =
        await response.text();
      throw new Error(
        "Video upload failed with HTTP " +
          response.status +
          ": " +
          detail.slice(0, 300)
      );
    }
  } finally {
    stream.destroy();
  }
  /*
   * Private Vercel Blob me public video URL nahi hota.
   *
   * New worker deployment pathname return karta hai:
   * videos/job_xxxxx.mp4
   *
   * Fallback is important because agar GitHub render
   * job kisi older Vercel worker deployment ke saath
   * temporarily run ho, to completed status me
   * undefined save nahi hona chahiye.
   */
  const pathname =
    signed.pathname ||
    `videos/${jobId}.mp4`;
  console.log(
    "VIDEO BLOB PATH:",
    pathname
  );
  return pathname;
}
function run(command, args) {
  console.log(
    "$",
    command,
    ...args
  );
  const result =
    spawnSync(
      command,
      args,
      {
        stdio: "inherit",
        shell: false,
      }
    );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status}`
    );
  }
}
async function main() {
  await updateStatus({
    status: "rendering",
    message:
      "Remotion is rendering your video...",
  });
  let props;
  try {
    props =
      JSON.parse(
        Buffer.from(
          propsBase64,
          "base64"
        ).toString("utf8")
      );
  } catch {
    throw new Error(
      "PROPS_BASE64 does not contain valid JSON."
    );
  }
  if (
    !props ||
    typeof props !== "object"
  ) {
    throw new Error(
      "Render props are invalid."
    );
  }
  if (
    !Array.isArray(props.scenes) ||
    !props.scenes.length
  ) {
    throw new Error(
      "Render props contain no scenes."
    );
  }
  console.log(
    "Render props:",
    JSON.stringify(
      {
        sceneCount:
          props.scenes.length,
        duration,
        aspectRatio:
          props.aspectRatio,
        width:
          props.width,
        height:
          props.height,
      },
      null,
      2
    )
  );
  fs.mkdirSync(
    "render-output",
    {
      recursive: true,
    }
  );
  fs.writeFileSync(
    "props.json",
    JSON.stringify(
      props,
      null,
      2
    ),
    "utf8"
  );
  const totalFrames =
    duration * FPS;
  const outputPath =
    path.resolve(
      "render-output",
      `${jobId}.mp4`
    );
  console.log(
    "Output MP4:",
    outputPath
  );
  console.log(
    "Total frames:",
    totalFrames
  );
  console.log(
    "Starting Remotion browser setup..."
  );
  run(
    "npx",
    [
      "remotion",
      "browser",
      "ensure",
    ]
  );
  console.log(
    "Starting Remotion render..."
  );
  run(
    "npx",
    [
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
    ]
  );
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      "Rendered MP4 was not created."
    );
  }
  const stat =
    fs.statSync(outputPath);
  if (!stat.size) {
    throw new Error(
      "Rendered MP4 is empty."
    );
  }
  console.log(
    "MP4 CREATED:",
    outputPath
  );
  console.log(
    "MP4 SIZE:",
    stat.size,
    "bytes"
  );
  await updateStatus({
    status: "uploading",
    message:
      "Uploading your finished video...",
    sizeBytes:
      stat.size,
  });
  const videoPath =
    await uploadVideo(
      outputPath,
      stat.size
    );
  if (!videoPath) {
    throw new Error(
      "Video upload completed but no Blob pathname was available."
    );
  }
  console.log(
    "Final video pathname:",
    videoPath
  );
  await updateStatus({
    status: "completed",
    message:
      "Your video is ready.",
    /*
     * IMPORTANT:
     * Private Blob pathname, NOT public URL.
     *
     * /api/check-status.js will convert this
     * pathname into a temporary signed GET URL.
     */
    videoUrl:
      videoPath,
    sizeBytes:
      stat.size,
    duration,
    fps:
      FPS,
    dimensions:
      `${props.width || 1080}x${props.height || 1920}`,
  });
  console.log(
    "VIRALTAP RENDER COMPLETE:",
    videoPath
  );
}
try {
  await main();
} catch (error) {
  console.error(
    "VIRALTAP RENDER WORKER FAILED:",
    error
  );
  try {
    await updateStatus({
      status: "failed",
      error:
        error?.message ||
        "Video rendering failed.",
    });
  } catch (statusError) {
    console.error(
      "Could not write failed status:",
      statusError
    );
  }
  process.exit(1);
}
