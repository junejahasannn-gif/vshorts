import { put } from "@vercel/blob";

export const maxDuration = 60;

const OWNER = "junejahasannn-gif";
const REPO = "vshorts";
const WORKFLOW = "render.yml";

function getDimensions(aspectRatio) {
  if (aspectRatio === "16:9") {
    return {
      width: 1920,
      height: 1080,
    };
  }

  if (aspectRatio === "1:1") {
    return {
      width: 1080,
      height: 1080,
    };
  }

  return {
    width: 1080,
    height: 1920,
  };
}

function makeJobId() {
  return (
    "job_" +
    Date.now() +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

async function writeStatus(jobId, payload) {
  return put(
    `status/${jobId}.json`,
    JSON.stringify({
      jobId,
      updatedAt: new Date().toISOString(),
      ...payload,
    }),
    {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    }
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed.",
    });
  }

  const body = req.body || {};

  const scenes = Array.isArray(body.scenes)
    ? body.scenes
    : [];

  const duration = Number(body.duration);

  const aspectRatio = [
    "9:16",
    "16:9",
    "1:1",
  ].includes(body.aspectRatio)
    ? body.aspectRatio
    : "9:16";

  if (!scenes.length) {
    return res.status(400).json({
      success: false,
      error: "No scenes were provided.",
    });
  }

  if (![30, 60, 180].includes(duration)) {
    return res.status(400).json({
      success: false,
      error:
        "Duration must be 30, 60, or 180 seconds.",
    });
  }

  const githubToken =
    process.env.GH_PAT_TOKEN;

  if (!githubToken) {
    return res.status(500).json({
      success: false,
      error:
        "GH_PAT_TOKEN is missing in Vercel environment variables.",
    });
  }

  const { width, height } =
    getDimensions(aspectRatio);

  const jobId = makeJobId();

  const props = {
    scenes,
    aspectRatio,
    width,
    height,
    duration,

    videoType:
      body.videoType || "normal",

    voice:
      body.voice || "Natural Male",

    music:
      body.music || "None",

    branding:
      body.branding || "ViralTap",
  };

  const propsBase64 =
    Buffer.from(
      JSON.stringify(props),
      "utf8"
    ).toString("base64");

  if (propsBase64.length > 60000) {
    return res.status(413).json({
      success: false,
      error:
        "Render payload is too large.",
    });
  }

  try {
    await writeStatus(jobId, {
      status: "queued",
      message: "Render job queued.",
    });

    const githubResponse =
      await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${githubToken}`,

            Accept:
              "application/vnd.github+json",

            "Content-Type":
              "application/json",

            "X-GitHub-Api-Version":
              "2022-11-28",

            "User-Agent":
              "ViralTap-Studio",
          },

          body: JSON.stringify({
            ref: "main",

            inputs: {
              jobId,
              duration: String(duration),
              propsBase64,
            },
          }),
        }
      );

    if (!githubResponse.ok) {
      const detail =
        await githubResponse.text();

      try {
        await writeStatus(jobId, {
          status: "failed",

          error:
            "GitHub workflow dispatch failed: " +
            detail.slice(0, 500),
        });
      } catch (statusError) {
        console.error(
          "VIRALTAP FAILED STATUS WRITE ERROR:",
          statusError
        );
      }

      return res.status(502).json({
        success: false,

        error:
          "Could not start the GitHub render worker.",

        details:
          `GitHub returned HTTP ${githubResponse.status}.`,

        githubError:
          detail.slice(0, 1000),
      });
    }

    return res.status(200).json({
      success: true,

      jobId,

      status: "queued",

      message:
        "Video render job queued.",

      dimensions:
        `${width}x${height}`,
    });
  } catch (error) {
    console.error(
      "VIRALTAP DISPATCH ERROR:",
      error
    );

    try {
      await writeStatus(jobId, {
        status: "failed",

        error:
          error?.message ||
          "Failed to dispatch render.",
      });
    } catch (statusError) {
      console.error(
        "VIRALTAP ERROR STATUS WRITE FAILED:",
        statusError
      );
    }

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Failed to start video render.",
    });
  }
}
