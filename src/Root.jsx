import React from "react";
import {
  Composition,
  useCurrentFrame,
  interpolate,
} from "remotion";

import SceneRenderer from "./components/SceneRenderer.jsx";

const FPS = 30;

function normalizeScenes(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return [
      {
        caption: "ViralTap",
        narration: "",
        dialogue: "",
        visualPrompt: "",
        lines: [
          {
            text: "ViralTap",
            type: "caption",
          },
        ],
      },
    ];
  }

  return scenes.map((scene) => {
    const lines =
      Array.isArray(scene?.lines) &&
      scene.lines.length > 0
        ? scene.lines
            .map((line) => {
              if (typeof line === "string") {
                return {
                  text: line.trim(),
                  type: "dialogue",
                };
              }

              return {
                text: String(line?.text || "").trim(),
                type: String(
                  line?.type || "dialogue"
                ),
              };
            })
            .filter((line) => line.text)
        : [
            {
              text:
                scene?.caption ||
                scene?.narration ||
                scene?.dialogue ||
                "ViralTap",
              type: "dialogue",
            },
          ];

    return {
      ...scene,
      lines,
    };
  });
}

function calculateLineTiming(
  lines,
  sceneFrames
) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const totalCharacters = lines.reduce(
    (sum, line) =>
      sum +
      Math.max(
        1,
        String(line.text || "").length
      ),
    0
  );

  let usedFrames = 0;

  return lines.map((line, index) => {
    const remainingLines =
      lines.length - index - 1;

    if (index === lines.length - 1) {
      const durationFrames = Math.max(
        1,
        sceneFrames - usedFrames
      );

      const result = {
        ...line,
        startFrame: usedFrames,
        endFrame:
          usedFrames + durationFrames,
        durationFrames,
      };

      usedFrames += durationFrames;

      return result;
    }

    const characterCount = Math.max(
      1,
      String(line.text || "").length
    );

    const proportionalFrames =
      Math.round(
        (characterCount / totalCharacters) *
          sceneFrames
      );

    /*
     * Minimum readable duration.
     *
     * Short line = faster
     * Long line = slower
     */
    const minimumFrames = 18;

    const maxPossible =
      sceneFrames -
      usedFrames -
      remainingLines;

    const durationFrames = Math.max(
      1,
      Math.min(
        Math.max(
          minimumFrames,
          proportionalFrames
        ),
        Math.max(1, maxPossible)
      )
    );

    const result = {
      ...line,
      startFrame: usedFrames,
      endFrame:
        usedFrames + durationFrames,
      durationFrames,
    };

    usedFrames += durationFrames;

    return result;
  });
}

function buildTimedScenes(
  scenes,
  totalFrames
) {
  const safeScenes = normalizeScenes(scenes);

  const sceneCount = safeScenes.length;

  if (sceneCount === 0) {
    return [];
  }

  const baseSceneFrames = Math.floor(
    totalFrames / sceneCount
  );

  let usedFrames = 0;

  return safeScenes.map((scene, index) => {
    const remainingScenes =
      sceneCount - index - 1;

    let sceneFrames;

    if (index === sceneCount - 1) {
      sceneFrames =
        totalFrames - usedFrames;
    } else {
      sceneFrames = Math.max(
        1,
        Math.min(
          baseSceneFrames,
          totalFrames -
            usedFrames -
            remainingScenes
        )
      );
    }

    const lines = calculateLineTiming(
      scene.lines,
      sceneFrames
    );

    const timedScene = {
      ...scene,
      lines,
      sceneFrames,
      startFrame: usedFrames,
      endFrame:
        usedFrames + sceneFrames,
    };

    usedFrames += sceneFrames;

    return timedScene;
  });
}

function VideoContent({
  scenes,
  duration,
}) {
  const frame = useCurrentFrame();

  const totalFrames = Math.max(
    FPS,
    Math.round(Number(duration) * FPS)
  );

  const timedScenes = buildTimedScenes(
    scenes,
    totalFrames
  );

  if (timedScenes.length === 0) {
    return null;
  }

  const currentScene =
    timedScenes.find(
      (scene) =>
        frame >= scene.startFrame &&
        frame < scene.endFrame
    ) ||
    timedScenes[timedScenes.length - 1];

  const sceneLocalFrame = Math.max(
    0,
    frame - currentScene.startFrame
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <SceneRenderer
          scene={currentScene}
          sceneIndex={timedScenes.indexOf(
            currentScene
          )}
          totalScenes={timedScenes.length}
          sceneFrames={
            currentScene.sceneFrames
          }
          localFrame={sceneLocalFrame}
        />
      </div>

      {/* Global progress */}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 25,
          height: 4,
          borderRadius: 999,
          background:
            "rgba(255,255,255,0.18)",
          overflow: "hidden",
          zIndex: 100,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#ffffff",
            transformOrigin: "left",
            transform: `scaleX(${Math.min(
              1,
              frame /
                Math.max(
                  1,
                  totalFrames - 1
                )
            )})`,
          }}
        />
      </div>
    </div>
  );
}

const ViralTapVideo = ({
  scenes = [],
  duration = 30,
}) => {
  return (
    <VideoContent
      scenes={scenes}
      duration={duration}
    />
  );
};

export const RemotionRoot = () => (
  <Composition
    id="ViralTapVideo"
    component={ViralTapVideo}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={FPS * 30}
    defaultProps={{
      scenes: [
        {
          caption: "ViralTap",
          narration: "",
          dialogue: "",
          visualPrompt: "",
          lines: [
            {
              text: "ViralTap",
              type: "caption",
            },
          ],
        },
      ],
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      duration: 30,
    }}
    calculateMetadata={({ props }) => {
      let width = 1080;
      let height = 1920;

      if (props?.aspectRatio === "16:9") {
        width = 1920;
        height = 1080;
      } else if (
        props?.aspectRatio === "1:1"
      ) {
        width = 1080;
        height = 1080;
      }

      const durationSeconds =
        Number(props?.duration) || 30;

      const durationInFrames = Math.max(
        FPS,
        Math.round(
          durationSeconds * FPS
        )
      );

      return {
        fps: FPS,
        width,
        height,
        durationInFrames,
      };
    }}
  />
);

export default RemotionRoot;
