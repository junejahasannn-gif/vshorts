import { get, issueSignedToken, presignUrl, put } from "@vercel/blob";

export const maxDuration = 30;

// How long a job may sit in a given state before we consider the
// worker dead and mark it failed, instead of leaving the frontend
// polling forever (item 22/23). Render Actions workflow has
// timeout-minutes: 60, apply-music has timeout-minutes: 20 — these
// thresholds add a safety margin on top of that.
const STALE_QUEUED_MS = 6 * 60 * 1000; // dispatch/start problem
const STALE_ACTIVE_MS = 70 * 60 * 1000; // rendering/uploading/mixing

function validJobId(jobId) {
  return /^job_[A-Za-z0-9_-]+$/.test(jobId);
}

async function makeVideoReadUrl(pathname) {
  const validUntil = Date.now() + 60 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    pathname,
    operation: "get",
    access: "private",
    validUntil,
    useCache: false,
  });
  return presignedUrl;
}

function isMissingBlobError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || error?.statusCode || "").toLowerCase();

  return (
    code === "not_found" ||
    code === "404" ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("blob not found") ||
    message.includes("404")
  );
}

async function readCreatedAt(jobId) {
  try {
    const stored = await get(`created/${jobId}.json`, { access: "private", useCache: false });
    if (!stored?.stream) return null;

    const text = await new Response(stored.stream).text();
    if (!text.trim()) return null;

    const data = JSON.parse(text);
    const createdAt = Date.parse(data?.createdAt || "");

    return Number.isFinite(createdAt) ? createdAt : null;
  } catch {
    return null;
  }
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

function jsonError(res, httpStatus, code, message) {
  return res.status(httpStatus).json({ success: false, error: { code, message } });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonError(res, 405, "METHOD_NOT_ALLOWED", "Only GET requests are allowed.");
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const jobId = String(req.query?.jobId || "").trim();

  if (!validJobId(jobId)) {
    return jsonError(res, 400, "INVALID_INPUT", "Valid jobId is required.");
  }

  const statusPath = `status/${jobId}.json`;

  try {
    let stored;

    try {
      stored = await get(statusPath, { access: "private", useCache: false });
    } catch (error) {
      if (isMissingBlobError(error)) {
        return res.status(200).json({
          success: true,
          status: "queued",
          jobId,
          progress: 0,
          message: "Waiting for render worker...",
        });
      }
      throw error;
    }

    if (!stored?.stream) {
      return res.status(200).json({
        success: true,
        status: "queued",
        jobId,
        progress: 0,
        message: "Waiting for render worker...",
      });
    }

    const text = await new Response(stored.stream).text();

    if (!text.trim()) {
      return res.status(200).json({
        success: true,
        status: "queued",
        jobId,
        progress: 0,
        message: "Render status is empty. Waiting for worker...",
      });
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error("[CheckStatus] JSON parse error:", parseError);
      return jsonError(res, 500, "RENDER_FAILED", "Video rendering failed. Please try again.");
    }

    if (data?.jobId && String(data.jobId) !== jobId) {
      console.error("[CheckStatus] job id mismatch:", { requestedJobId: jobId, storedJobId: data.jobId });
      return jsonError(res, 500, "RENDER_FAILED", "Video rendering failed. Please try again.");
    }

    let progress = Number(data?.progress);
    if (!Number.isFinite(progress)) progress = 0;
    progress = Math.max(0, Math.min(100, Math.round(progress)));

    // ---- Stale job detection (item 22/23) ----------------------------
    const activeStates = ["queued", "processing", "rendering", "uploading", "mixing"];

    if (activeStates.includes(data.status)) {
      const createdAt = await readCreatedAt(jobId);

      if (createdAt) {
        const age = Date.now() - createdAt;
        const threshold = data.status === "queued" ? STALE_QUEUED_MS : STALE_ACTIVE_MS;

        if (age > threshold) {
          console.log(`[CheckStatus] job=${jobId} marked stale after ${Math.round(age / 1000)}s in status=${data.status}`);

          const failedPayload = {
            status: "failed",
            progress: 0,
            error: {
              code: "RENDER_TIMEOUT",
              message: "Video rendering took too long and was stopped. Please try again.",
            },
          };

          try {
            await writeStatus(jobId, failedPayload);
          } catch (writeError) {
            console.error("[CheckStatus] could not write stale-failed status:", writeError);
          }

          return res.status(200).json({ ...failedPayload, jobId, progress: 0 });
        }
      }
    }
    // --------------------------------------------------------------------

    if (data.status === "completed" && data.videoUrl) {
      const pathname = String(data.videoUrl).trim();

      if (pathname.startsWith("videos/") && pathname.endsWith(".mp4")) {
        data.videoUrl = await makeVideoReadUrl(pathname);
        progress = 100;
      } else {
        console.error("[CheckStatus] invalid video path:", pathname);
        return jsonError(res, 500, "RENDER_FAILED", "Video rendering failed. Please try again.");
      }
    }

    if (data.status === "failed") {
      // Normalize legacy string errors (from before this fix) into the
      // standard {code, message} shape so the frontend can rely on one
      // format either way.
      if (typeof data.error === "string") {
        data.error = { code: "RENDER_FAILED", message: data.error };
      }

      return res.status(200).json({ ...data, jobId, progress });
    }

    return res.status(200).json({ ...data, jobId, progress });
  } catch (error) {
    console.error("[CheckStatus] error:", error);
    return jsonError(res, 500, "UNKNOWN_ERROR", "Something went wrong. Please try again.");
  }
}
