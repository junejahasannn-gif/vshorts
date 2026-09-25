import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const JOB_ID = process.env.JOB_ID;
const SOURCE_JOB_ID = process.env.SOURCE_JOB_ID;
const SOURCE_VIDEO_URL = process.env.SOURCE_VIDEO_URL;
const MUSIC_URL = process.env.MUSIC_URL;
const MUSIC_STYLE =
  process.env.MUSIC_STYLE || "cinematic";
const VIDEO_DURATION =
  Number(process.env.VIDEO_DURATION) || 30;

const WORKER_URL =
  process.env.VIRALTAP_WORKER_URL ||
  "https://vshorts-app.vercel.app/api/render-worker";

const WORK_DIR =
  path.join(process.cwd(), ".viraltap-music");

const SOURCE_VIDEO =
  path.join(WORK_DIR, "source.mp4");

const MUSIC_FILE =
  path.join(WORK_DIR, "music.mp3");

const OUTPUT_VIDEO =
  path.join(WORK_DIR, "final.mp4");

function log(message) {
  console.log(`[VIRALTAP MUSIC] ${message}`);
}

function required(value, name) {
  if (!value || !String(value).trim()) {
    throw new Error(
      `${name} is missing.`
    );
  }

  return String(value).trim();
}

async function getOidcToken() {
  const requestUrl =
    required(
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      "ACTIONS_ID_TOKEN_REQUEST_URL"
    );

  const requestToken =
    required(
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN"
    );

  const separator =
    requestUrl.includes("?")
      ? "&"
      : "?";

  const response =
    await fetch(
      `${requestUrl}${separator}audience=viraltap-render-worker`,
      {
        headers: {
          Authorization:
            `bearer ${requestToken}`,
        },
      }
    );

  if (!response.ok) {
    throw new Error(
      `GitHub OIDC token request failed: HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (!data?.value) {
    throw new Error(
      "GitHub OIDC token was not returned."
    );
  }

  return data.value;
}

async function workerRequest(
  oidcToken,
  action,
  extra = {}
) {
  const response =
    await fetch(
      WORKER_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${oidcToken}`,
        },

        body: JSON.stringify({
          action,
          jobId: JOB_ID,
          ...extra,
        }),
      }
    );

  const raw =
    await response.text();

  let data = {};

  try {
    data =
      raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `Render worker returned invalid JSON: ${raw.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `Render worker request failed with HTTP ${response.status}.`
    );
  }

  return data;
}

async function getStatusUrl(oidcToken) {
  const data =
    await workerRequest(
      oidcToken,
      "status-url"
    );

  if (!data?.uploadUrl) {
    throw new Error(
      "Status upload URL was not returned."
    );
  }

  return data.uploadUrl;
}

async function getVideoUploadUrl(
  oidcToken,
  sizeBytes
) {
  const data =
    await workerRequest(
      oidcToken,
      "video-url",
      {
        sizeBytes,
      }
    );

  if (!data?.uploadUrl) {
    throw new Error(
      "Video upload URL was not returned."
    );
  }

  return data;
}

async function updateStatus(
  statusUrl,
  payload
) {
  const response =
    await fetch(
      statusUrl,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          jobId: JOB_ID,
          updatedAt:
            new Date().toISOString(),
          sourceJobId:
            SOURCE_JOB_ID,
          musicStyle:
            MUSIC_STYLE,
          ...payload,
        }),
      }
    );

  if (!response.ok) {
    const detail =
      await response.text();

    throw new Error(
      `Status update failed: HTTP ${response.status} ${detail.slice(0, 500)}`
    );
  }
}

async function downloadFile(
  url,
  destination,
  label
) {
  log(`Downloading ${label}...`);

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Could not download ${label}: HTTP ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  if (!buffer.length) {
    throw new Error(
      `${label} download was empty.`
    );
  }

  fs.writeFileSync(
    destination,
    buffer
  );

  log(
    `${label} downloaded: ${buffer.length} bytes`
  );
}

async function runCommand(
  command,
  args,
  label
) {
  log(label);

  try {
    const result =
      await execFileAsync(
        command,
        args,
        {
          maxBuffer:
            10 * 1024 * 1024,
        }
      );

    if (result.stdout) {
      console.log(
        result.stdout
      );
    }

    if (result.stderr) {
      console.log(
        result.stderr
      );
    }

    return result;
  } catch (error) {
    console.error(
      error?.stdout || ""
    );

    console.error(
      error?.stderr || ""
    );

    throw new Error(
      `${label} failed: ${
        error?.message ||
        "Unknown command error."
      }`
    );
  }
}

async function hasAudioTrack() {
  try {
    await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        SOURCE_VIDEO,
      ],
      {
        maxBuffer:
          1024 * 1024,
      }
    );

    return true;
  } catch {
    return false;
  }
}

async function mixMusic() {
  const sourceHasAudio =
    await hasAudioTrack();

  log(
    `Source audio detected: ${sourceHasAudio}`
  );

  const duration =
    String(VIDEO_DURATION);

  if (sourceHasAudio) {
    await runCommand(
      "ffmpeg",
      [
        "-y",

        "-i",
        SOURCE_VIDEO,

        "-stream_loop",
        "-1",

        "-i",
        MUSIC_FILE,

        "-filter_complex",

        "[0:a:0]volume=1[a0];" +
          "[1:a:0]volume=0.15[a1];" +
          "[a0][a1]amix=" +
          "inputs=2:" +
          "duration=first:" +
          "dropout_transition=2:" +
          "normalize=0[aout]",

        "-map",
        "0:v:0",

        "-map",
        "[aout]",

        "-c:v",
        "copy",

        "-c:a",
        "aac",

        "-b:a",
        "192k",

        "-t",
        duration,

        "-movflags",
        "+faststart",

        OUTPUT_VIDEO,
      ],
      "Mixing original audio with selected music..."
    );
  } else {
    await runCommand(
      "ffmpeg",
      [
        "-y",

        "-i",
        SOURCE_VIDEO,

        "-stream_loop",
        "-1",

        "-i",
        MUSIC_FILE,

        "-filter_complex",
        "[1:a:0]volume=0.15[aout]",

        "-map",
        "0:v:0",

        "-map",
        "[aout]",

        "-c:v",
        "copy",

        "-c:a",
        "aac",

        "-b:a",
        "192k",

        "-t",
        duration,

        "-movflags",
        "+faststart",

        OUTPUT_VIDEO,
      ],
      "Adding selected music to video..."
    );
  }

  if (!fs.existsSync(OUTPUT_VIDEO)) {
    throw new Error(
      "FFmpeg did not create the final MP4."
    );
  }

  const stats =
    fs.statSync(
      OUTPUT_VIDEO
    );

  if (!stats.size) {
    throw new Error(
      "Final MP4 is empty."
    );
  }

  log(
    `Final MP4 created: ${stats.size} bytes`
  );

  return stats.size;
}

async function uploadVideo(
  uploadUrl
) {
  log(
    "Uploading final MP4 to Vercel Blob..."
  );

  const fileBuffer =
    fs.readFileSync(
      OUTPUT_VIDEO
    );

  const response =
    await fetch(
      uploadUrl,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "video/mp4",

          "Content-Length":
            String(fileBuffer.length),
        },

        body: fileBuffer,
      }
    );

  if (!response.ok) {
    const detail =
      await response.text();

    throw new Error(
      `Final MP4 upload failed: HTTP ${response.status} ${detail.slice(0, 500)}`
    );
  }

  log(
    "Final MP4 uploaded successfully."
  );
}

async function cleanup() {
  try {
    fs.rmSync(
      WORK_DIR,
      {
        recursive: true,
        force: true,
      }
    );
  } catch {
    // Ignore cleanup errors.
  }
}

async function main() {
  required(
    JOB_ID,
    "JOB_ID"
  );

  required(
    SOURCE_VIDEO_URL,
    "SOURCE_VIDEO_URL"
  );

  required(
    MUSIC_URL,
    "MUSIC_URL"
  );

  if (
    ![30, 60, 180].includes(
      VIDEO_DURATION
    )
  ) {
    throw new Error(
      "VIDEO_DURATION must be 30, 60, or 180."
    );
  }

  fs.mkdirSync(
    WORK_DIR,
    {
      recursive: true,
    }
  );

  let statusUrl = "";

  try {
    log(
      `Starting music remix job ${JOB_ID}`
    );

    const oidcToken =
      await getOidcToken();

    statusUrl =
      await getStatusUrl(
        oidcToken
      );

    await updateStatus(
      statusUrl,
      {
        status: "processing",
        progress: 5,
        message:
          "Preparing music remix...",
      }
    );

    await downloadFile(
      SOURCE_VIDEO_URL,
      SOURCE_VIDEO,
      "source video"
    );

    await updateStatus(
      statusUrl,
      {
        status: "processing",
        progress: 20,
        message:
          "Source video downloaded.",
      }
    );

    await downloadFile(
      MUSIC_URL,
      MUSIC_FILE,
      "selected music"
    );

    await updateStatus(
      statusUrl,
      {
        status: "processing",
        progress: 35,
        message:
          "Selected music downloaded.",
      }
    );

    const outputSize =
      await mixMusic();

    await updateStatus(
      statusUrl,
      {
        status: "processing",
        progress: 75,
        message:
          "Music mixed with video.",
      }
    );

    const videoUpload =
      await getVideoUploadUrl(
        oidcToken,
        outputSize
      );

    await uploadVideo(
      videoUpload.uploadUrl
    );

    await updateStatus(
      statusUrl,
      {
        status: "processing",
        progress: 95,
        message:
          "Final video uploaded.",
      }
    );

    const finalPathname =
      videoUpload.pathname ||
      `videos/${JOB_ID}.mp4`;

    await updateStatus(
      statusUrl,
      {
        status: "completed",
        progress: 100,
        message:
          "Music applied successfully.",
        videoUrl:
          finalPathname,
        pathname:
          finalPathname,
        sourceJobId:
          SOURCE_JOB_ID,
        musicStyle:
          MUSIC_STYLE,
        duration:
          VIDEO_DURATION,
      }
    );

    log(
      "Music remix completed successfully."
    );
  } catch (error) {
    console.error(
      "VIRALTAP MUSIC REMIX ERROR:",
      error
    );

    if (statusUrl) {
      try {
        await updateStatus(
          statusUrl,
          {
            status: "failed",
            progress: 0,
            message:
              "Music remix failed.",
            error:
              error?.message ||
              "Unknown music remix error.",
          }
        );
      } catch (statusError) {
        console.error(
          "Could not update failed status:",
          statusError
        );
      }
    }

    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await main();
