import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const jobId = process.env.JOB_ID;

const duration = Number(
  process.env.VIDEO_DURATION
);

const propsBase64 =
  process.env.PROPS_BASE64;

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
  throw new Error(
    "JOB_ID is missing."
  );
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

if (
  !githubOidcRequestUrl ||
  !githubOidcRequestToken
) {
  throw new Error(
    "GitHub Actions OIDC is unavailable. The workflow must grant id-token: write."
  );
}


/* --------------------------------
   GITHUB OIDC
-------------------------------- */

async function getGitHubOidcToken() {
  const separator =
    githubOidcRequestUrl.includes("?")
      ? "&"
      : "?";

  const response =
    await fetch(
      githubOidcRequestUrl +
        separator +
        "audience=" +
        encodeURIComponent(
          OIDC_AUDIENCE
        ),
      {
        headers: {
          Authorization:
            "bearer " +
            githubOidcRequestToken,
        },
      }
    );

  if (!response.ok) {
    const detail =
      await response.text();

    throw new Error(
      "Could not obtain GitHub OIDC token: HTTP " +
        response.status +
        " " +
        detail.slice(0, 300)
    );
  }

  const data =
    await response.json();

  if (!data?.value) {
    throw new Error(
      "GitHub OIDC response did not contain a token."
    );
  }

  return data.value;
}


/* --------------------------------
   WORKER REQUEST
-------------------------------- */

async function workerRequest(
  body
) {
  const oidcToken =
    await getGitHubOidcToken();

  const response =
    await fetch(
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
    data =
      JSON.parse(text);
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


/* --------------------------------
   STATUS
-------------------------------- */

async function updateStatus(
  payload
) {
  const signed =
    await workerRequest({
      action: "status-url",
    });

  if (!signed?.url) {
    throw new Error(
      "Worker did not return a status upload URL."
    );
  }

  const response =
    await fetch(
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


/* --------------------------------
   VIDEO UPLOAD
-------------------------------- */

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
    fs.createReadStream(
      outputPath
    );

  try {
    const response =
      await fetch(
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

  const pathname =
    signed.pathname ||
    `videos/${jobId}.mp4`;

  console.log(
    "VIDEO BLOB PATH:",
    pathname
  );

  return pathname;
}


/* --------------------------------
   COMMAND RUNNER
-------------------------------- */

function runCommand(
  command,
  args
) {
  return new Promise(
    (resolve, reject) => {
      console.log(
        "$",
        command,
        ...args
      );

      const child =
        spawn(
          command,
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],

            shell: false,
          }
        );

      let stdoutBuffer = "";
      let stderrBuffer = "";

      child.stdout.on(
        "data",
        (chunk) => {
          const text =
            chunk.toString();

          stdoutBuffer += text;

          process.stdout.write(
            text
          );
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          const text =
            chunk.toString();

          stderrBuffer += text;

          process.stderr.write(
            text
          );
        }
      );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `${command} failed with exit code ${code}\n${stderrBuffer.slice(-2000)}`
              )
            );

            return;
          }

          resolve({
            stdout:
              stdoutBuffer,

            stderr:
              stderrBuffer,
          });
        }
      );
    }
  );
}


/* --------------------------------
   REMOTION RENDER
-------------------------------- */

async function renderVideo(
  outputPath,
  totalFrames
) {
  let lastProgress = -1;

  let lastStatusUpdate =
    Promise.resolve();

  let pendingProgress = null;

  let updateInProgress =
    false;


  async function sendProgress(
    percent,
    message
  ) {
    if (
      percent <= lastProgress
    ) {
      return;
    }

    lastProgress =
      percent;

    pendingProgress = {
      percent,
      message,
    };

    if (updateInProgress) {
      return;
    }

    updateInProgress =
      true;

    try {
      while (
        pendingProgress
      ) {
        const current =
          pendingProgress;

        pendingProgress =
          null;

        await lastStatusUpdate;

        lastStatusUpdate =
          updateStatus({
            status:
              "rendering",

            progress:
              current.percent,

            message:
              current.message,
          });

        await lastStatusUpdate;
      }
    } finally {
      updateInProgress =
        false;
    }
  }


  console.log(
    "Starting Remotion render..."
  );

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


  await new Promise(
    (resolve, reject) => {
      const child =
        spawn(
          "npx",
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],

            shell: false,
          }
        );

      let buffer = "";

      let errorBuffer =
        "";


      function processOutput(
        chunk
      ) {
        const text =
          chunk.toString();

        process.stdout.write(
          text
        );

        buffer += text;

        const lines =
          buffer.split(/\r?\n/);

        buffer =
          lines.pop() || "";

        for (
          const line of lines
        ) {
          const match =
            line.match(
              /Rendered\s+(\d+)\/(\d+)/
            );

          if (!match) {
            continue;
          }

          const rendered =
            Number(match[1]);

          const total =
            Number(match[2]) ||
            totalFrames;

          const percent =
            Math.min(
              99,
              Math.max(
                0,
                Math.round(
                  (rendered /
                    total) *
                    100
                )
              )
            );

          void sendProgress(
            percent,
            `Rendering MP4 — ${rendered}/${total} frames`
          );
        }
      }


      child.stdout.on(
        "data",
        processOutput
      );


      child.stderr.on(
        "data",
        (chunk) => {
          const text =
            chunk.toString();

          errorBuffer += text;

          process.stderr.write(
            text
          );
        }
      );


      child.on(
        "error",
        reject
      );


      child.on(
        "close",
        async (code) => {
          try {
            if (code !== 0) {
              reject(
                new Error(
                  "Remotion render failed with exit code " +
                    code +
                    "\n" +
                    errorBuffer.slice(
                      -3000
                    )
                )
              );

              return;
            }

            await sendProgress(
              99,
              "MP4 render complete. Uploading..."
            );

            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );
    }
  );
}


/* --------------------------------
   MAIN
-------------------------------- */

async function main() {

  await updateStatus({
    status:
      "rendering",

    progress:
      1,

    message:
      "Preparing Remotion render...",
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
    typeof props !==
      "object"
  ) {
    throw new Error(
      "Render props are invalid."
    );
  }


  if (
    !Array.isArray(
      props.scenes
    ) ||
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


  /*
   * Browser is cached by GitHub Actions.
   * If it already exists, this is almost instant.
   */

  console.log(
    "Checking Remotion browser..."
  );


  await runCommand(
    "npx",
    [
      "remotion",
      "browser",
      "ensure",
    ]
  );


  /*
   * Actual frame-by-frame rendering.
   */

  await renderVideo(
    outputPath,
    totalFrames
  );


  if (
    !fs.existsSync(
      outputPath
    )
  ) {
    throw new Error(
      "Rendered MP4 was not created."
    );
  }


  const stat =
    fs.statSync(
      outputPath
    );


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
    status:
      "uploading",

    progress:
      99,

    message:
      "Uploading your finished MP4...",

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


  await updateStatus({
    status:
      "completed",

    progress:
      100,

    message:
      "Your video is ready.",

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
      status:
        "failed",

      progress:
        0,

      error:
        error?.message ||
        "Video rendering failed.",
    });
  } catch (
    statusError
  ) {
    console.error(
      "Could not write failed status:",
      statusError
    );
  }

  process.exit(1);
}
