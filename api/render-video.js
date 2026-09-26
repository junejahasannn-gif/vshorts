import { put } from "@vercel/blob";

export const maxDuration = 60;

const OWNER = "junejahasannn-gif";
const REPO = "vshorts";
const WORKFLOW = "render.yml";
const BRANCH = "main";

function getDimensions(aspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "9:16":
    default:
      return { width: 1080, height: 1920 };
  }
}

function makeJobId() {
  return "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

function normalizeScenes(scenes) {
  if (!Array.isArray(scenes)) return [];

  return scenes
    .filter((scene) => scene && typeof scene === "object")
    .map((scene) => ({
      ...scene,
      caption: typeof scene.caption === "string" ? scene.caption.trim() : "",
      narration: typeof scene.narration === "string" ? scene.narration.trim() : "",
      dialogue: typeof scene.dialogue === "string" ? scene.dialogue.trim() : "",
      visualPrompt: typeof scene.visualPrompt === "string" ? scene.visualPrompt.trim() : "",
      lines: Array.isArray(scene.lines)
        ? scene.lines
            .map((line) => {
              if (typeof line === "string") {
                return { text: line.trim(), type: "dialogue" };
              }
              if (line && typeof line === "object") {
                return {
                  text: typeof line.text === "string" ? line.text.trim() : "",
                  type: typeof line.type === "string" ? line.type : "dialogue",
                };
              }
              return null;
            })
            .filter((line) => line && line.text)
        : [],
    }))
    .filter((scene) => scene.caption || scene.narration || scene.dialogue || scene.visualPrompt || scene.lines.length);
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

function getGithubHeaders(githubToken) {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ViralTap-Studio",
  };
}

// ---- Very lightweight abuse guard ----------------------------------
// NOTE: this uses in-memory state, which only works within a single
// warm serverless instance and resets on cold start / across
// instances. It reduces accidental rapid double-submits from the same
// warm instance but is NOT a substitute for real rate limiting
// (Vercel KV / Upstash Redis, etc). See the final report for details.
const recentJobsByIp = new Map();
const MIN_INTERVAL_MS = 15000;

function isRateLimited(req) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const now = Date.now();
  const last = recentJobsByIp.get(ip) || 0;

  if (now - last < MIN_INTERVAL_MS) {
    return true;
  }

  recentJobsByIp.set(ip, now);

  // Trim the map so it doesn't grow forever on a long-lived instance.
  if (recentJobsByIp.size > 500) {
    const oldestKey = recentJobsByIp.keys().next().value;
    recentJobsByIp.delete(oldestKey);
  }

  return false;
}
// ----------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Only POST requests are allowed." },
    });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many AI requests. Please wait a moment and try again.",
      },
    });
  }

  const body = req.body || {};
  const scenes = normalizeScenes(body.scenes);
  const duration = Number(body.duration);

  const allowedAspectRatios = ["9:16", "16:9", "1:1"];
  const aspectRatio = allowedAspectRatios.includes(body.aspectRatio) ? body.aspectRatio : "9:16";

  const allowedLanguages = ["Hindi", "Hinglish", "English", "Gujarati"];
  const language = allowedLanguages.includes(body.language) ? body.language : "Hindi";

  if (!scenes.length) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "No valid scenes were provided." },
    });
  }

  if (![30, 60, 180].includes(duration)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_INPUT", message: "Duration must be 30, 60, or 180 seconds." },
    });
  }

  const githubToken = process.env.GH_PAT_TOKEN;

  if (!githubToken) {
    console.error("[RenderVideo] GH_PAT_TOKEN missing");

    return res.status(500).json({
      success: false,
      error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
    });
  }

  const { width, height } = getDimensions(aspectRatio);
  const jobId = makeJobId();

  const props = {
    scenes,
    language,
    aspectRatio,
    width,
    height,
    duration,
    videoType: typeof body.videoType === "string" ? body.videoType : "normal",
    voice: typeof body.voice === "string" ? body.voice : "Natural Male",
    music: typeof body.music === "string" ? body.music : "None",
    branding: typeof body.branding === "string" ? body.branding : "ViralTap",
  };

  let propsBase64;

  try {
    propsBase64 = Buffer.from(JSON.stringify(props), "utf8").toString("base64");
  } catch (error) {
    console.error("[RenderVideo] props encode error:", error);

    return res.status(500).json({
      success: false,
      error: { code: "RENDER_FAILED", message: "Video rendering failed. Please try again." },
    });
  }

  if (propsBase64.length > 60000) {
    return res.status(413).json({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Your story or scene list is too long. Please shorten it and try again." },
    });
  }

  try {
    await writeStatus(jobId, {
      status: "queued",
      progress: 0,
      message: "Render job queued.",
      duration,
      language,
      aspectRatio,
      dimensions: `${width}x${height}`,
      sceneCount: scenes.length,
    });

    // Write-once creation marker used by check-status.js to detect
    // stale/stuck jobs (item 22/23). Deliberately not part of the
    // status/*.json object because that file is overwritten wholesale
    // on every update and would lose the original creation time.
    await put(
      `created/${jobId}.json`,
      JSON.stringify({ jobId, createdAt: new Date().toISOString() }),
      {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
      }
    ).catch((error) => {
      // Non-fatal: staleness detection just won't work for this job.
      console.error("[RenderVideo] could not write created marker:", error);
    });
  } catch (statusError) {
    console.error("[RenderVideo] initial status write error:", statusError);

    return res.status(500).json({
      success: false,
      error: { code: "RENDER_FAILED", message: "Video rendering failed. Please try again." },
    });
  }

  const workflowUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

  try {
    const githubResponse = await fetch(workflowUrl, {
      method: "POST",
      headers: getGithubHeaders(githubToken),
      body: JSON.stringify({
        ref: BRANCH,
        inputs: { jobId, duration: String(duration), propsBase64 },
      }),
    });

    if (!githubResponse.ok) {
      // Full detail goes to server logs only — never to the client.
      const detail = await githubResponse.text();

      console.error("[RenderVideo] GitHub dispatch error:", {
        status: githubResponse.status,
        detail: detail.slice(0, 1500),
      });

      try {
        await writeStatus(jobId, {
          status: "failed",
          progress: 0,
          error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
        });
      } catch (statusError) {
        console.error("[RenderVideo] failed-status write error:", statusError);
      }

      return res.status(502).json({
        success: false,
        jobId,
        error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
      });
    }

    return res.status(200).json({
      success: true,
      jobId,
      status: "queued",
      progress: 0,
      message: "Video render job queued.",
      dimensions: `${width}x${height}`,
      sceneCount: scenes.length,
      duration,
      language,
      aspectRatio,
    });
  } catch (error) {
    console.error("[RenderVideo] dispatch error:", error);

    try {
      await writeStatus(jobId, {
        status: "failed",
        progress: 0,
        error: { code: "GITHUB_WORKER_ERROR", message: "Video rendering worker could not be started." },
      });
    } catch (statusError) {
      console.error("[RenderVideo] error-status write failed:", statusError);
    }

    return res.status(500).json({
      success: false,
      jobId,
      error: { code: "UNKNOWN_ERROR", message: "Something went wrong. Please try again." },
    });
  }
}
