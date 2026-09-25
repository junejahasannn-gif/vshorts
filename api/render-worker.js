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

const EXPECTED_WORKFLOWS = [
  "ViralTap Video Renderer",
  "ViralTap Music Mixer",
];

const EXPECTED_BRANCH =
  "refs/heads/main";

const EXPECTED_EVENT =
  "workflow_dispatch";

const OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";

const OIDC_AUDIENCE =
  "https://vshorts-app.vercel.app";

const MAX_STATUS_SIZE =
  256 * 1024;

const MAX_VIDEO_SIZE =
  5 * 1024 * 1024 * 1024;

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

function getAuthorizationToken(req) {
  const auth =
    req.headers.authorization || "";

  if (
    typeof auth !== "string" ||
    !auth.startsWith("Bearer ")
  ) {
    throw new Error(
      "Missing GitHub OIDC authorization."
    );
  }

  const token =
    auth
      .slice("Bearer ".length)
      .trim();

  if (!token) {
    throw new Error(
      "GitHub OIDC token is empty."
    );
  }

  return token;
}

async function verifyGitHubOidc(req) {
  const token =
    getAuthorizationToken(req);

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
    !EXPECTED_WORKFLOWS.includes(
      payload.workflow
    )
  ) {
    throw new Error(
      "GitHub workflow is not authorized."
    );
  }

  if (
    payload.ref !==
    EXPECTED_BRANCH
  ) {
    throw new Error(
      "Only the main branch is authorized."
    );
  }

  if (
    payload.event_name !==
    EXPECTED_EVENT
  ) {
    throw new Error(
      "Only workflow_dispatch is authorized."
    );
  }

  return payload;
}

function getJobId(body) {
  return String(
    body?.jobId || ""
  ).trim();
}

function getAction(body) {
  return String(
    body?.action || ""
  ).trim();
}

async function createStatusUploadUrl(
  jobId
) {
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
        MAX_STATUS_SIZE,
    });

  const {
    presignedUrl,
  } =
    await presignUrl(
      token,
      {
        pathname,
        operation: "put",
        access: "private",
        validUntil,

        allowedContentTypes: [
          "application/json",
        ],

        maximumSizeInBytes:
          MAX_STATUS_SIZE,

        allowOverwrite: true,
      }
    );

  return {
    url: presignedUrl,
  };
}

async function createVideoUploadUrl(
  jobId,
  sizeBytes
) {
  if (
    !Number.isFinite(
      sizeBytes
    ) ||
    sizeBytes <= 0 ||
    sizeBytes >
      MAX_VIDEO_SIZE
  ) {
    throw new Error(
      "Invalid video size."
    );
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

  const {
    presignedUrl,
  } =
    await presignUrl(
      token,
      {
        pathname,
        operation: "put",
        access: "private",
        validUntil,

        allowedContentTypes: [
          "video/mp4",
        ],

        maximumSizeInBytes:
          sizeBytes,

        allowOverwrite: false,
      }
    );

  return {
    url: presignedUrl,
    pathname,
  };
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
  } catch (error) {
    console.error(
      "VIRALTAP WORKER OIDC VERIFICATION ERROR:",
      error
    );

    return res.status(401).json({
      success: false,
      error:
        error?.message ||
        "Worker authorization failed.",
    });
  }

  const body =
    req.body || {};

  const jobId =
    getJobId(body);

  const action =
    getAction(body);

  if (!validJobId(jobId)) {
    return res.status(400).json({
      success: false,
      error:
        "Invalid jobId.",
    });
  }

  if (
    action ===
    "status-url"
  ) {
    try {
      const result =
        await createStatusUploadUrl(
          jobId
        );

      return res.status(200).json({
        success: true,
        url:
          result.url,
      });
    } catch (error) {
      console.error(
        "VIRALTAP STATUS URL ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Could not create status upload URL.",
      });
    }
  }

  if (
    action ===
    "video-url"
  ) {
    const sizeBytes =
      Number(
        body.sizeBytes
      );

    if (
      !Number.isFinite(
        sizeBytes
      ) ||
      sizeBytes <= 0 ||
      sizeBytes >
        MAX_VIDEO_SIZE
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid video size.",
      });
    }

    try {
      const result =
        await createVideoUploadUrl(
          jobId,
          sizeBytes
        );

      return res.status(200).json({
        success: true,

        url:
          result.url,

        pathname:
          result.pathname,
      });
    } catch (error) {
      console.error(
        "VIRALTAP VIDEO URL ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Could not create video upload URL.",
      });
    }
  }

  return res.status(400).json({
    success: false,
    error:
      "Unknown worker action.",
  });
}
