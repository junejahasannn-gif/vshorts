import React from "react";
import {
  Composition,
  useCurrentFrame,
  interpolate,
} from "remotion";

const FPS = 30;

function getSceneText(scene) {
  return (
    scene?.caption ||
    scene?.narration ||
    scene?.dialogue ||
    scene?.scene ||
    "ViralTap"
  );
}

function Scene({ scene, sceneIndex, totalScenes }) {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, 12, 24],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const scale = interpolate(
    frame,
    [0, 30],
    [1.04, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const text = getSceneText(scene);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #050505 0%, #171717 45%, #050505 100%)",
        color: "#fff",
        fontFamily:
          "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Cinematic background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 25%, rgba(255,255,255,.12), transparent 35%)",
          transform: `scale(${scale})`,
          opacity,
        }}
      />

      {/* Dark cinematic overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.15), rgba(0,0,0,.85))",
        }}
      />

      {/* Brand */}
      <div
        style={{
          position: "absolute",
          top: 50,
          left: 50,
          right: 50,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 5,
          opacity,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: 1,
          }}
        >
          ViralTap
        </div>

        <div
          style={{
            fontSize: 18,
            color: "rgba(255,255,255,.55)",
            fontWeight: 700,
          }}
        >
          {sceneIndex + 1}/{totalScenes}
        </div>
      </div>

      {/* Main scene text */}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 120,
          zIndex: 5,
          opacity,
          transform: `translateY(${interpolate(
            frame,
            [0, 20],
            [30, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }
          )}px)`,
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.18,
            textShadow:
              "0 4px 20px rgba(0,0,0,.9)",
          }}
        >
          {text}
        </div>
      </div>

      {/* Bottom accent */}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 65,
          height: 5,
          borderRadius: 999,
          background: "rgba(255,255,255,.25)",
          overflow: "hidden",
          zIndex: 5,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#fff",
            transformOrigin: "left",
            transform: `scaleX(${Math.min(
              1,
              frame / 30
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
  const totalFrames = Math.max(
    FPS,
    Math.round(
      Number(duration) * FPS
    )
  );

  const safeScenes =
    Array.isArray(scenes) &&
    scenes.length
      ? scenes
      : [
          {
            caption: "ViralTap",
          },
        ];

  const sceneDuration = Math.max(
    1,
    Math.floor(
      totalFrames /
        safeScenes.length
    )
  );

  const frame =
    useCurrentFrame();

  const sceneIndex = Math.min(
    safeScenes.length - 1,
    Math.floor(
      frame / sceneDuration
    )
  );

  const scene =
    safeScenes[sceneIndex];

  return (
    <Scene
      scene={scene}
      sceneIndex={sceneIndex}
      totalScenes={safeScenes.length}
    />
  );
};

export const RemotionRoot = () => {
  return (
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

        if (
          props?.aspectRatio ===
          "16:9"
        ) {
          width = 1920;
          height = 1080;
        } else if (
          props?.aspectRatio ===
          "1:1"
        ) {
          width = 1080;
          height = 1080;
        }

        const durationSeconds =
          Number(props?.duration) ||
          30;

        const durationInFrames =
          Math.max(
            FPS,
            Math.round(
              durationSeconds *
                FPS
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
};

export default RemotionRoot;
