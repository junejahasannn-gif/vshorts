import {
  get,
  list,
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

  const jobId =
    String(req.query?.jobId || "").trim();

  if (!validJobId(jobId)) {
    return res.status(400).json({
      success: false,
      error: "Valid jobId is required.",
    });
  }

  try {
    const result = await list({
      prefix: `status/${jobId}.json`,
      limit: 1,
    });

    const blob = result?.blobs?.[0];

    if (!blob) {
      return res.status(200).json({
        status: "queued",
        jobId,
        message:
          "Waiting for render worker...",
      });
    }

    const stored = await get(
      `status/${jobId}.json`,
      {
        access: "private",
        useCache: false,
      }
    );

    if (!stored?.stream) {
      return res.status(200).json({
        status: "queued",
        jobId,
        message:
          "Waiting for render worker...",
      });
    }

    const text =
      await new Response(
        stored.stream
      ).text();

    const data = JSON.parse(text);

    /*
     * Worker stores only the private pathname:
     * videos/job_xxx.mp4
     *
     * We convert it into a temporary signed
     * GET URL for the frontend.
     */
    if (
      data.status === "completed" &&
      data.videoUrl
    ) {
      const pathname =
        String(data.videoUrl);

      if (
        pathname.startsWith("videos/")
      ) {
        data.videoUrl =
          await makeVideoReadUrl(
            pathname
          );
      }
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error(
      "VIRALTAP STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Could not read render status.",
    });
  }
}
