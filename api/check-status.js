import {
  get,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

export const maxDuration = 30;

function validJobId(jobId) {
  return /^job_[A-Za-z0-9_-]+$/.test(jobId);
}

async function makeVideoReadUrl(pathname) {
  const validUntil =
    Date.now() + 60 * 60 * 1000;

  const token =
    await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil,
    });

  const { presignedUrl } =
    await presignUrl(token, {
      pathname,
      operation: "get",
      access: "private",
      validUntil,
      useCache: false,
    });

  return presignedUrl;
}

function isMissingBlobError(error) {
  const message =
    String(error?.message || "").toLowerCase();

  const code =
    String(
      error?.code ||
        error?.statusCode ||
        ""
    ).toLowerCase();

  return (
    code === "not_found" ||
    code === "404" ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("blob not found") ||
    message.includes("404")
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Only GET requests are allowed.",
    });
  }

  /*
   * Prevent browser/CDN/proxy caching.
   *
   * The frontend polls this endpoint repeatedly,
   * so every request must read the latest render status.
   */
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Expires",
    "0"
  );

  const jobId =
    String(req.query?.jobId || "").trim();

  if (!validJobId(jobId)) {
    return res.status(400).json({
      success: false,
      error: "Valid jobId is required.",
    });
  }

  const statusPath =
    `status/${jobId}.json`;

  try {
    /*
     * Read the exact private status Blob.
     *
     * Do not use list().
     *
     * The exact pathname is already known,
     * so directly reading it is more reliable
     * for this polling endpoint.
     */
    let stored;

    try {
      stored = await get(
        statusPath,
        {
          access: "private",
          useCache: false,
        }
      );
    } catch (error) {
      /*
       * The status file may not exist yet.
       *
       * This is NORMAL immediately after the
       * render job is created.
       *
       * Do not return HTTP 500 for this situation.
       */
      if (isMissingBlobError(error)) {
        return res.status(200).json({
          success: true,
          status: "queued",
          jobId,
          progress: 0,
          message:
            "Waiting for render worker...",
        });
      }

      throw error;
    }

    /*
     * No readable stream means there is no
     * usable status data yet.
     */
    if (!stored?.stream) {
      return res.status(200).json({
        success: true,
        status: "queued",
        jobId,
        progress: 0,
        message:
          "Waiting for render worker...",
      });
    }

    /*
     * Read the status JSON written by the
     * render worker.
     */
    const text =
      await new Response(
        stored.stream
      ).text();

    if (!text.trim()) {
      return res.status(200).json({
        success: true,
        status: "queued",
        jobId,
        progress: 0,
        message:
          "Render status is empty. Waiting for worker...",
      });
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error(
        "VIRALTAP STATUS JSON PARSE ERROR:",
        parseError
      );

      return res.status(500).json({
        success: false,
        jobId,
        error:
          "Render status file contains invalid JSON.",
      });
    }

    /*
     * Safety check:
     *
     * The status object must belong to the
     * same job requested by the frontend.
     */
    if (
      data?.jobId &&
      String(data.jobId) !== jobId
    ) {
      console.error(
        "VIRALTAP STATUS JOB ID MISMATCH:",
        {
          requestedJobId: jobId,
          storedJobId: data.jobId,
        }
      );

      return res.status(500).json({
        success: false,
        jobId,
        error:
          "Render status belongs to a different job.",
      });
    }

    /*
     * Normalize progress.
     *
     * The render worker sends real progress
     * values while Remotion is rendering.
     */
    let progress = Number(data?.progress);

    if (!Number.isFinite(progress)) {
      progress = 0;
    }

    progress = Math.max(
      0,
      Math.min(100, Math.round(progress))
    );

    /*
     * Completed render:
     *
     * The worker stores a PRIVATE Blob pathname:
     *
     * videos/job_xxx.mp4
     *
     * The browser cannot use that pathname
     * directly.
     *
     * Generate a temporary signed GET URL.
     */
    if (
      data.status === "completed" &&
      data.videoUrl
    ) {
      const pathname =
        String(data.videoUrl).trim();

      if (
        pathname.startsWith("videos/") &&
        pathname.endsWith(".mp4")
      ) {
        data.videoUrl =
          await makeVideoReadUrl(
            pathname
          );

        progress = 100;
      } else {
        console.error(
          "VIRALTAP INVALID VIDEO PATH:",
          pathname
        );

        return res.status(500).json({
          success: false,
          jobId,
          error:
            "Render completed but video path is invalid.",
        });
      }
    }

    /*
     * Failed render:
     *
     * Pass the worker's actual error to
     * the frontend.
     */
    if (data.status === "failed") {
      return res.status(200).json({
        ...data,
        jobId,
        progress,
      });
    }

    /*
     * Return the latest render state.
     *
     * Possible states:
     *
     * queued
     * rendering
     * uploading
     * completed
     * failed
     */
    return res.status(200).json({
      ...data,
      jobId,
      progress,
    });
  } catch (error) {
    console.error(
      "VIRALTAP STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      jobId,
      error:
        error?.message ||
        "Could not read render status.",
    });
  }
}
