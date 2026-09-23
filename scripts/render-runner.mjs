import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { put } from "@vercel/blob";

const jobId = process.env.JOB_ID;
const duration = Number(
  process.env.VIDEO_DURATION
);
const propsBase64 =
  process.env.PROPS_BASE64;
const blobToken =
  process.env.BLOB_READ_WRITE_TOKEN;

if (!jobId) {
  throw new Error("JOB_ID is missing.");
}

if (![30, 60, 180].includes(duration)) {
  throw new Error(
    "VIDEO_DURATION must be 30, 60, or 180."
  );
}

if (!propsBase64) {
  throw new Error(
    "PROPS_BASE64 is missing."
  );
}

if (!blobToken) {
  throw new Error(
    "BLOB_READ_WRITE_TOKEN is missing."
  );
}

const statusName =
  `status/${jobId}.json`;

async function updateStatus(payload) {
  await put(
    statusName,
    JSON.stringify({
      jobId,
      updatedAt:
        new Date().toISOString(),
      ...payload,
    }),
    {
      access: "public",
      contentType:
        "application/json",
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    }
  );
}

function run(command, args) {
  console.log(
    "$",
    command,
    ...args
  );

  const result = spawnSync(
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

  const props = JSON.parse(
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

  run("npx", [
    "remotion",
    "browser",
    "ensure",
  ]);

  console.log(
    "Starting Remotion render..."
  );

  run("npx", [
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
  ]);

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

  const videoBuffer =
    fs.readFileSync(outputPath);

  const blob = await put(
    `videos/${jobId}.mp4`,
    videoBuffer,
    {
      access: "public",
      contentType:
        "video/mp4",
      addRandomSuffix: false,
    }
  );

  await updateStatus({
    status: "completed",
    message:
      "Your video is ready.",
    videoUrl: blob.url,
    sizeBytes: stat.size,
    duration,
    fps: 30,
    dimensions:
      `${props.width}x${props.height}`,
  });

  console.log(
    "VIRALTAP RENDER COMPLETE:",
    blob.url
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
