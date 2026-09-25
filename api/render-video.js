import { put } from "@vercel/blob";

export const maxDuration = 60;

const OWNER = "junejahasannn-gif";
const REPO = "vshorts";
const WORKFLOW = "render.yml";
const BRANCH = "main";

function getDimensions(aspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return {
        width: 1920,
        height: 1080,
      };

    case "1:1":
      return {
        width: 1080,
        height: 1080,
      };

    case "9:16":
    default:
      return {
        width: 1080,
        height: 1920,
      };
  }
}

function makeJobId() {
  return (
    "job_" +
    Date.now() +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

function normalizeScenes(scenes) {
  if (!Array.isArray(scenes)) {
    return [];
  }

  return scenes
    .filter(
      (scene) =>
        scene &&
        typeof scene === "object"
    )
    .map((scene) => ({
      ...scene,

      caption:
        typeof scene.caption === "string"
          ? scene.caption.trim()
          : "",

      narration:
        typeof scene.narration === "string"
          ? scene.narration.trim()
          : "",

      dialogue:
        typeof scene.dialogue === "string"
          ? scene.dialogue.trim()
          : "",

      visualPrompt:
        typeof scene.visualPrompt === "string"
          ? scene.visualPrompt.trim()
          : "",

      lines: Array.isArray(scene.lines)
        ? scene.lines
            .map((line) => {
              if (
                typeof line === "string"
              ) {
                return {
                  text: line.trim(),
                  type: "dialogue",
                };
              }

              if (
                line &&
                typeof line === "object"
              ) {
                return {
                  text:
                    typeof line.text ===
                    "string"
                      ? line.text.trim()
                      : "",

                  type:
                    typeof line.type ===
                    "string"
                      ? line.type
                      : "dialogue",
                };
              }

              return null;
            })
            .filter(
              (line) =>
                line &&
                line.text
            )
        : [],
    }))
    .filter((scene) => {
      return (
        scene.caption ||
        scene.narration ||
        scene.dialogue ||
        scene.visualPrompt ||
        scene.lines.length
      );
    });
}

async function writeStatus(
  jobId,
  payload
) {
  return put(
    `status/${jobId}.json`,
    JSON.stringify({
      jobId,
      updatedAt:
        new Date().toISOString(),
      ...payload,
    }),
    {
      access: "private",
      contentType:
        "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    }
  );
}

function getGithubHeaders(
  githubToken
) {
  return {
    Authorization:
      `Bearer ${githubToken}`,

    Accept:
      "application/vnd.github+json",

    "Content-Type":
      "application/json",

    "X-GitHub-Api-Version":
      "2022-11-28",

    "User-Agent":
      "ViralTap-Studio",
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

  const body =
    req.body || {};

  const scenes =
    normalizeScenes(
      body.scenes
    );

  const duration =
    Number(body.duration);

  const allowedAspectRatios = [
    "9:16",
    "16:9",
    "1:1",
  ];

  const aspectRatio =
    allowedAspectRatios.includes(
      body.aspectRatio
    )
      ? body.aspectRatio
      : "9:16";

  /*
   * --------------------------------------------------
   * VALIDATION
   * --------------------------------------------------
   */

  if (!scenes.length) {
    return res.status(400).json({
      success: false,
      error:
        "No valid scenes were provided.",
    });
  }

  if (
    ![30, 60, 180].includes(
      duration
    )
  ) {
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

  /*
   * --------------------------------------------------
   * VIDEO DIMENSIONS
   * --------------------------------------------------
   */

  const {
    width,
    height,
  } = getDimensions(
    aspectRatio
  );

  /*
   * --------------------------------------------------
   * CREATE JOB
   * --------------------------------------------------
   */

  const jobId =
    makeJobId();

  /*
   * --------------------------------------------------
   * REMOTION PROPS
   * --------------------------------------------------
   */

  const props = {
    scenes,

    aspectRatio,

    width,

    height,

    duration,

    videoType:
      typeof body.videoType ===
      "string"
        ? body.videoType
        : "normal",

    voice:
      typeof body.voice ===
      "string"
        ? body.voice
        : "Natural Male",

    music:
      typeof body.music ===
      "string"
        ? body.music
        : "None",

    branding:
      typeof body.branding ===
      "string"
        ? body.branding
        : "ViralTap",
  };

  /*
   * --------------------------------------------------
   * ENCODE REMOTION PROPS
   * --------------------------------------------------
   */

  let propsBase64;

  try {
    propsBase64 =
      Buffer.from(
        JSON.stringify(props),
        "utf8"
      ).toString(
        "base64"
      );
  } catch (error) {
    console.error(
      "VIRALTAP PROPS ENCODE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Could not prepare render data.",
    });
  }

  /*
   * GitHub workflow_dispatch inputs have
   * a payload-size limit, so keep a safety margin.
   */

  if (
    propsBase64.length >
    60000
  ) {
    return res.status(413).json({
      success: false,
      error:
        "Render payload is too large.",
    });
  }

  /*
   * --------------------------------------------------
   * QUEUED STATUS
   * --------------------------------------------------
   */

  try {
    await writeStatus(
      jobId,
      {
        status: "queued",

        progress: 0,

        message:
          "Render job queued.",

        duration,

        aspectRatio,

        dimensions:
          `${width}x${height}`,

        sceneCount:
          scenes.length,
      }
    );
  } catch (statusError) {
    console.error(
      "VIRALTAP INITIAL STATUS WRITE ERROR:",
      statusError
    );

    return res.status(500).json({
      success: false,
      error:
        "Could not create render job status.",
    });
  }

  /*
   * --------------------------------------------------
   * START GITHUB ACTIONS
   * --------------------------------------------------
   */

  const workflowUrl =
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

  try {
    const githubResponse =
      await fetch(
        workflowUrl,
        {
          method: "POST",

          headers:
            getGithubHeaders(
              githubToken
            ),

          body: JSON.stringify({
            ref: BRANCH,

            inputs: {
              jobId,

              duration:
                String(duration),

              propsBase64,
            },
          }),
        }
      );

    /*
     * GitHub normally returns 204
     * for workflow dispatch.
     */

    if (
      !githubResponse.ok
    ) {
      const detail =
        await githubResponse.text();

      console.error(
        "VIRALTAP GITHUB DISPATCH ERROR:",
        {
          status:
            githubResponse.status,

          detail:
            detail.slice(
              0,
              1000
            ),
        }
      );

      try {
        await writeStatus(
          jobId,
          {
            status:
              "failed",

            progress: 0,

            error:
              "GitHub workflow dispatch failed: " +
              detail.slice(
                0,
                500
              ),
          }
        );
      } catch (
        statusError
      ) {
        console.error(
          "VIRALTAP FAILED STATUS WRITE ERROR:",
          statusError
        );
      }

      return res.status(502).json({
        success: false,

        jobId,

        error:
          "Could not start the GitHub render worker.",

        details:
          `GitHub returned HTTP ${githubResponse.status}.`,

        githubError:
          detail.slice(
            0,
            1000
          ),
      });
    }

    /*
     * ------------------------------------------------
     * SUCCESS
     * ------------------------------------------------
     */

    return res.status(200).json({
      success: true,

      jobId,

      status:
        "queued",

      progress: 0,

      message:
        "Video render job queued.",

      dimensions:
        `${width}x${height}`,

      sceneCount:
        scenes.length,

      duration,

      aspectRatio,
    });
  } catch (error) {
    console.error(
      "VIRALTAP DISPATCH ERROR:",
      error
    );

    try {
      await writeStatus(
        jobId,
        {
          status:
            "failed",

          progress: 0,

          error:
            error?.message ||
            "Failed to dispatch render.",
        }
      );
    } catch (
      statusError
    ) {
      console.error(
        "VIRALTAP ERROR STATUS WRITE FAILED:",
        statusError
      );
    }

    return res.status(500).json({
      success: false,

      jobId,

      error:
        error?.message ||
        "Failed to start video render.",
    });
  }
}
