import {
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

export const maxDuration = 30;

const EXPECTED_REPOSITORY =
  "junejahasannn-gif/vshorts";

const EXPECTED_WORKFLOW =
  "ViralTap Video Renderer";

const OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";

const OIDC_AUDIENCE =
  "https://vshorts-app.vercel.app";

const githubJwks =
  createRemoteJWKSet(
    new URL(
      "https://token.actions.githubusercontent.com/.well-known/jwks"
    )
  );

function validJobId(jobId) {
  return /^job_[A-Za-z0-9_-]+$/.test(
    jobId
  );
}

async function verifyGitHubOidc(req) {
  const auth =
    req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    throw new Error(
      "Missing GitHub OIDC authorization."
    );
  }

  const token =
    auth.slice("Bearer ".length).trim();

  const { payload } =
    await jwtVerify(
      token,
      githubJwks,
      {
        issuer: OIDC_ISSUER,
        audience: OIDC_AUDIENCE,
      }
    );

  if (
    payload.repository !==
    EXPECTED_REPOSITORY
  ) {
    throw new Error(
      "GitHub repository is not authorized."
    );
  }

  if (
    payload.workflow !==
    EXPECTED_WORKFLOW
  ) {
    throw new Error(
      "GitHub workflow is not authorized."
    );
  }

  if (
    payload.ref !==
    "refs/heads/main"
  ) {
    throw new Error(
      "Only the main branch is authorized."
    );
  }

  if (
    payload.event_name !==
    "workflow_dispatch"
  ) {
    throw new Error(
      "Only workflow_dispatch is authorized."
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error:
        "Only POST requests are allowed.",
    });
  }

  try {
    await verifyGitHubOidc(req);

    const body = req.body || {};

    const jobId =
      String(
        body.jobId || ""
      ).trim();

    const action =
      String(
        body.action || ""
      ).trim();

    if (!validJobId(jobId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid jobId.",
      });
    }

    if (action === "status-url") {
      const pathname =
        `status/${jobId}.json`;

      const validUntil =
        Date.now() +
        10 * 60 * 1000;

      const token =
        await issueSignedToken({
          pathname,
          operations: ["put"],
          validUntil,
          allowedContentTypes: [
            "application/json",
          ],
          maximumSizeInBytes:
            256 * 1024,
        });

      const { presignedUrl } =
        await presignUrl(
          token,
          {
            pathname,
            operation: "put",
            access: "public",
            validUntil,
            allowedContentTypes: [
              "application/json",
            ],
            maximumSizeInBytes:
              256 * 1024,
            allowOverwrite: true,
          }
        );

      return res.status(200).json({
        success: true,
        url: presignedUrl,
      });
    }

    if (action === "video-url") {
      const sizeBytes =
        Number(body.sizeBytes);

      if (
        !Number.isFinite(
          sizeBytes
        ) ||
        sizeBytes <= 0 ||
        sizeBytes >
          5 *
            1024 *
            1024 *
            1024
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid video size.",
        });
      }

      const pathname =
        `videos/${jobId}.mp4`;

      const validUntil =
        Date.now() +
        45 * 60 * 1000;

      const token =
        await issueSignedToken({
          pathname,
          operations: ["put"],
          validUntil,
          allowedContentTypes: [
            "video/mp4",
          ],
          maximumSizeInBytes:
            sizeBytes,
        });

      const { presignedUrl } =
        await presignUrl(
          token,
          {
            pathname,
            operation: "put",
            access: "public",
            validUntil,
            allowedContentTypes: [
              "video/mp4",
            ],
            maximumSizeInBytes:
              sizeBytes,
            allowOverwrite: false,
          }
        );

      const videoUrl =
        `https://${process.env.BLOB_STORE_ID}.public.blob.vercel-storage.com/${pathname}`;

      return res.status(200).json({
        success: true,
        url: presignedUrl,
        videoUrl,
      });
    }

    return res.status(400).json({
      success: false,
      error:
        "Unknown worker action.",
    });
  } catch (error) {
    console.error(
      "VIRALTAP WORKER AUTH ERROR:",
      error
    );

    return res.status(401).json({
      success: false,
      error:
        error?.message ||
        "Worker authorization failed.",
    });
  }
}
