import { put } from "@vercel/blob";

export const maxDuration = 60;

const OWNER = "junejahasannn-gif";
const REPO = "vshorts";
const WORKFLOW = "apply-music.yml";
const BRANCH = "main";

const ALLOWED_DURATIONS = [30, 60, 180];

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function makeJobId() {
  return "job_music_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
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
    JSON.stringify({ jobId, updatedAt: new Date().toISOString(), ...payload }),
    {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    }
  );
}

// Basic SSRF guard: only allow video/music URLs that point at Vercel
// Blob storage (where every video/music asset in this app actually
// lives), rather than accepting an arbitrary attacker-supplied URL that
// the GitHub Actions runner will then download.
//
// Set BLOB_PUBLIC_HOST in Vercel if your Blob store's read hostname is
// not *.public.blob.vercel-storage.com (check your Blob store settings
// for the exact hostname). If unset, this check is skipped — set it to
// close this off.
function isAllowedAssetUrl(value) {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    const allowedHost = process.env.BLOB_PUBLIC_HOST;

    if (!allowedHost) {
      // Not configured yet — allow through, but this should be set.
      return true;
    }

    return url.hostname === allowedHost || url.hostname.endsWith(`.${allowedHost}`);
  } catch {
    return false;
  }
}

// See api/render-video.js for the same lightweight, best-effort guard.
const recentJobsByIp = new Map();
const MIN_INTERVAL_MS = 10000;

function isRateLimited(req) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const now = Date.now();
  const last = recentJobsByIp.get(ip) || 0;

  if (now - last < MIN_INTERVAL_MS) return true;

  recentJobsByIp.set(ip, now);

  if (recentJobsByIp.size > 500) {
    recentJobsByIp.delete(recentJobsByIp.keys().next().value);
  }

  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Only POST requests are allowed." },
    });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." },
    });
  }

  const body = req.body || {};
  const sourceJobId = clean(body.jobId);
  const videoUrl = clean(body.videoUrl);
  const musicUrl = clean(body.musicUrl);
  const duration = Number(body.duration);
  const musicStyle = clean(body.musicStyle) || "cinematic";

  if (!sourceJobId) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "Original render jobId is required." },
    });
  }

  if (!validJobId(sourceJobId)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "Invalid original render jobId." },
    });
  }

  if (!videoUrl || !isAllowedAssetUrl(videoUrl)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "A valid generated video URL is required." },
    });
  }

  if (!musicUrl || !isAllowedAssetUrl(musicUrl)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "A valid music URL is required." },
    });
  }

  if (!ALLOWED_DURATIONS.includes(duration)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "Duration must be 30, 60, or 180 seconds." },
    });
  }

  const githubToken = process.env.GH_PAT_TOKEN;

  if (!githubToken) {
    console.error("[ApplyMusic] GH_PAT_TOKEN missing");

    return res.status(500).json({
      success: false,
      error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
    });
  }

  const remixJobId = makeJobId();

  try {
    await writeStatus(remixJobId, {
      status: "queued",
      progress: 0,
      message: "Music remix job queued.",
      sourceJobId,
      duration,
      musicStyle,
    });

    await put(
      `created/${remixJobId}.json`,
      JSON.stringify({ jobId: remixJobId, createdAt: new Date().toISOString() }),
      {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
      }
    ).catch((error) => {
      console.error("[ApplyMusic] could not write created marker:", error);
    });
  } catch (error) {
    console.error("[ApplyMusic] initial status error:", error);

    return res.status(500).json({
      success: false,
      error: { code: "UNKNOWN_ERROR", message: "Something went wrong. Please try again." },
    });
  }

  const workflowUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

  try {
    const githubResponse = await fetch(workflowUrl, {
      method: "POST",
      headers: getGithubHeaders(githubToken),
      body: JSON.stringify({
        ref: BRANCH,
        inputs: {
          jobId: remixJobId,
          sourceJobId,
          sourceVideoUrl: videoUrl,
          musicUrl,
          musicStyle,
          duration: String(duration),
        },
      }),
    });

    if (!githubResponse.ok) {
      const detail = await githubResponse.text();

      console.error("[ApplyMusic] GitHub dispatch error:", {
        status: githubResponse.status,
        detail: detail.slice(0, 1500),
      });

      try {
        await writeStatus(remixJobId, {
          status: "failed",
          progress: 0,
          sourceJobId,
          error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
        });
      } catch (statusError) {
        console.error("[ApplyMusic] failed-status write error:", statusError);
      }

      return res.status(502).json({
        success: false,
        jobId: remixJobId,
        error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
      });
    }

    return res.status(200).json({
      success: true,
      jobId: remixJobId,
      sourceJobId,
      status: "queued",
      progress: 0,
      message: "Music remix job queued.",
      duration,
      musicStyle,
    });
  } catch (error) {
    console.error("[ApplyMusic] dispatch error:", error);

    try {
      await writeStatus(remixJobId, {
        status: "failed",
        progress: 0,
        sourceJobId,
        error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
      });
    } catch (statusError) {
      console.error("[ApplyMusic] error-status write failed:", statusError);
    }

    return res.status(500).json({
      success: false,
      jobId: remixJobId,
      error: { code: "UNKNOWN_ERROR", message: "Something went wrong. Please try again." },
    });
  }
}
