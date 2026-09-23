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
    throw new Error(
      "Could not obtain GitHub OIDC token: HTTP " +
        response.status
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
    throw new Error(
      "Status upload failed with HTTP " +
        response.status
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

  // Private Blob me public videoUrl nahi milta.
  // Worker ab pathname return karta hai.
  return signed.pathname;
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

  const props =
    JSON.parse(
      Buffer.from(
        propsBase64,
        "base64"
      ).toString("utf8")
    );

  if (
    !Array.isArray(props.scenes) ||
    !props.scenes.length
  ) {
    throw new Error(
      "Render props contain no scenes."
    );
  }

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
    duration * 30;

  const outputPath =
    path.resolve(
      "render-output",
      `${jobId}.mp4`
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

  await updateStatus({
    status: "uploading",
    message:
      "Uploading your finished video...",
    sizeBytes: stat.size,
  });

  // IMPORTANT:
  // Private Blob ke case me uploadVideo()
  // pathname return karta hai, public URL nahi.
  const videoPath =
    await uploadVideo(
      outputPath,
      stat.size
    );

  await updateStatus({
    status: "completed",
    message:
      "Your video is ready.",

    // Private Blob pathname:
    // videos/job_xxxxx.mp4
    videoUrl: videoPath,

    sizeBytes: stat.size,
    duration,
    fps: 30,
    dimensions:
      `${props.width}x${props.height}`,
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
