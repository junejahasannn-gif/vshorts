import { list } from "@vercel/blob";

export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Only GET requests are allowed.",
    });
  }

  const jobId = String(
    req.query?.jobId || ""
  ).trim();

  if (!/^job_[A-Za-z0-9_-]+$/.test(jobId)) {
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

    if (!blob?.url) {
      return res.status(200).json({
        status: "queued",
        jobId,
        message:
          "Waiting for render worker...",
      });
    }

    const response = await fetch(
      `${blob.url}?t=${Date.now()}`,
      {
        cache: "no-store",
        headers: {
          "Cache-Control":
            "no-cache, no-store, max-age=0",
        },
      }
    );

    if (!response.ok) {
      return res.status(200).json({
        status: "queued",
        jobId,
        message:
          "Waiting for render worker...",
      });
    }

    const data = await response.json();

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
