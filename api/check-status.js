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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Only GET requests are allowed.",
    });
  }

  /*
   * Never allow the browser or an intermediate
   * cache to reuse an old render status.
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
     * IMPORTANT:
     *
     * Do NOT use list() here.
     *
     * list() can return an older/stale object
     * from the Blob listing layer.
     *
     * We already know the exact pathname,
     * so read that exact private blob directly.
     */
    const stored = await get(
      statusPath,
      {
        access: "private",
        useCache: false,
      }
    );

    /*
     * Status file does not exist yet.
     *
     * This is normal while the render job is
     * waiting to be processed.
     */
    if (!stored?.stream) {
      return res.status(200).json({
        success: true,
        status: "queued",
        jobId,
        message:
          "Waiting for render worker...",
      });
    }

    /*
     * Read the JSON status written by the
     * GitHub render worker.
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
        error:
          "Render status file contains invalid JSON.",
      });
    }

    /*
     * Safety:
     * Make sure the status belongs to the
     * job requested by the frontend.
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
        error:
          "Render status belongs to a different job.",
      });
    }

    /*
     * Completed render:
     *
     * Worker stores the private Blob pathname,
     * for example:
     *
     * videos/job_xxx.mp4
     *
     * The browser cannot directly access a
     * private Blob pathname, so create a temporary
     * signed GET URL for the frontend.
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
      } else {
        console.error(
          "VIRALTAP INVALID VIDEO PATH:",
          pathname
        );

        return res.status(500).json({
          success: false,
          error:
            "Render completed but video path is invalid.",
        });
      }
    }

    /*
     * If the worker reports failure,
     * pass the failure information to the frontend.
     */
    if (data.status === "failed") {
      return res.status(200).json({
        ...data,
        jobId,
      });
    }

    /*
     * Return the current render status.
     *
     * Possible statuses:
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
    });
  } catch (error) {
    console.error(
      "VIRALTAP STATUS ERROR:",
      error
    );

    /*
     * If the exact status object is temporarily
     * unavailable, do not manufacture a completed
     * or failed result.
     */
    return res.status(500).json({
      success: false,
      jobId,
      error:
        error?.message ||
        "Could not read render status.",
    });
  }
}
