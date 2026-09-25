import { put } from "@vercel/blob";

export const maxDuration = 60;

const OWNER = "junejahasannn-gif";
const REPO = "vshorts";
const WORKFLOW = "apply-music.yml";
const BRANCH = "main";

const ALLOWED_DURATIONS = [30, 60, 180];

function clean(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function makeJobId() {
  return (
    "job_music_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

function validJobId(jobId) {
  return /^job_[A-Za-z0-9_-]+$/.test(jobId);
}

function getGithubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ViralTap-Studio",
  };
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

function isHttpUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed.",
    });
  }

  const body = req.body || {};

  const sourceJobId = clean(body.jobId);
  const videoUrl = clean(body.videoUrl);
  const musicUrl = clean(body.musicUrl);

  const duration = Number(body.duration);

  const musicStyle =
    clean(body.musicStyle) || "cinematic";

  if (!sourceJobId) {
    return res.status(400).json({
      success: false,
      error: "Original render jobId is required.",
    });
  }

  if (!validJobId(sourceJobId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid original render jobId.",
    });
  }

  if (!videoUrl || !isHttpUrl(videoUrl)) {
    return res.status(400).json({
      success: false,
      error: "A valid generated video URL is required.",
    });
  }

  if (!musicUrl || !isHttpUrl(musicUrl)) {
    return res.status(400).json({
      success: false,
      error: "A valid music URL is required.",
    });
  }

  if (!ALLOWED_DURATIONS.includes(duration)) {
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

  const remixJobId = makeJobId();

  try {
    await writeStatus(remixJobId, {
      status: "queued",
      progress: 0,
      message:
        "Music remix job queued.",
      sourceJobId,
      duration,
      musicStyle,
    });
  } catch (error) {
    console.error(
      "VIRALTAP MUSIC INITIAL STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Could not create music remix job status.",
    });
  }

  const workflowUrl =
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

  try {
    const githubResponse =
      await fetch(workflowUrl, {
        method: "POST",

        headers:
          getGithubHeaders(
            githubToken
          ),

        body: JSON.stringify({
          ref: BRANCH,

          inputs: {
            jobId: remixJobId,

            sourceJobId,

            sourceVideoUrl:
              videoUrl,

            musicUrl,

            musicStyle,

            duration:
              String(duration),
          },
        }),
      });

    if (!githubResponse.ok) {
      const detail =
        await githubResponse.text();

      console.error(
        "VIRALTAP MUSIC GITHUB DISPATCH ERROR:",
        {
          status:
            githubResponse.status,

          detail:
            detail.slice(0, 1500),
        }
      );

      try {
        await writeStatus(
          remixJobId,
          {
            status: "failed",
            progress: 0,
            sourceJobId,
            error:
              "GitHub music workflow dispatch failed.",
          }
        );
      } catch (statusError) {
        console.error(
          "VIRALTAP MUSIC FAILED STATUS ERROR:",
          statusError
        );
      }

      return res.status(502).json({
        success: false,

        jobId: remixJobId,

        error:
          "Could not start the music remix worker.",

        details:
          `GitHub returned HTTP ${githubResponse.status}.`,

        githubError:
          detail.slice(0, 1000),
      });
    }

    return res.status(200).json({
      success: true,

      jobId: remixJobId,

      sourceJobId,

      status: "queued",

      progress: 0,

      message:
        "Music remix job queued.",

      duration,

      musicStyle,
    });
  } catch (error) {
    console.error(
      "VIRALTAP MUSIC DISPATCH ERROR:",
      error
    );

    try {
      await writeStatus(
        remixJobId,
        {
          status: "failed",
          progress: 0,
          sourceJobId,
          error:
            error?.message ||
            "Failed to dispatch music remix.",
        }
      );
    } catch (statusError) {
      console.error(
        "VIRALTAP MUSIC ERROR STATUS FAILED:",
        statusError
      );
    }

    return res.status(500).json({
      success: false,

      jobId: remixJobId,

      error:
        error?.message ||
        "Failed to start music remix.",
    });
  }
}
