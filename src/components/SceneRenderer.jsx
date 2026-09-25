import React from "react";
import {
  AbsoluteFill,
  interpolate,
} from "remotion";
import LineCaption from "./LineCaption.jsx";

function getLineForFrame(lines = [], frame = 0) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  return (
    lines.find(
      (line) =>
        frame >= Number(line.startFrame || 0) &&
        frame < Number(line.endFrame || 0)
    ) || lines[lines.length - 1]
  );
}

export default function SceneRenderer({
  scene = {},
  sceneIndex = 0,
  totalScenes = 1,
  sceneFrames = 1,
  localFrame = 0,
}) {
  const frame = Math.max(
    0,
    Math.floor(Number(localFrame) || 0)
  );

  const safeSceneFrames = Math.max(
    1,
    Number(sceneFrames) || 1
  );

  const opacity = interpolate(
    frame,
    [0, 12, 24],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const imageScale = interpolate(
    frame,
    [0, safeSceneFrames],
    [1.06, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const activeLine = getLineForFrame(
    scene.lines,
    frame
  );

  const imageUrl =
    scene?.visualUrl ||
    scene?.visualAsset?.url ||
    "";

  return (
    <AbsoluteFill
      style={{
        background: "#050505",
        color: "#fff",
        fontFamily:
          "Arial, Helvetica, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* AI-generated scene image */}
      {imageUrl ? (
        <AbsoluteFill
          style={{
            overflow: "hidden",
            opacity,
          }}
        >
          <img
            src={imageUrl}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${imageScale})`,
              transformOrigin: "center center",
            }}
          />
        </AbsoluteFill>
      ) : (
        /* Safe fallback when no AI image exists */
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(135deg, #050505 0%, #171717 45%, #050505 100%)",
          }}
        />
      )}

      {/* Cinematic dark overlay */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.18), rgba(0,0,0,.82))",
        }}
      />

      {/* Extra center cinematic glow */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(255,255,255,.08), transparent 42%)",
          opacity,
        }}
      />

      {/* Top branding */}
      <div
        style={{
          position: "absolute",
          top: 50,
          left: 50,
          right: 50,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 30,
          opacity,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: 1,
            textShadow:
              "0 3px 12px rgba(0,0,0,.8)",
          }}
        >
          ViralTap
        </div>

        <div
          style={{
            fontSize: 18,
            color:
              "rgba(255,255,255,.72)",
            fontWeight: 700,
            textShadow:
              "0 3px 12px rgba(0,0,0,.8)",
          }}
        >
          {sceneIndex + 1}/{totalScenes}
        </div>
      </div>

      {/* Caption fallback */}
      {scene?.caption && !activeLine && (
        <div
          style={{
            position: "absolute",
            top: "42%",
            left: 60,
            right: 60,
            textAlign: "center",
            fontSize: 48,
            fontWeight: 800,
            opacity,
            zIndex: 25,
            textShadow:
              "0 4px 20px rgba(0,0,0,.9)",
          }}
        >
          {scene.caption}
        </div>
      )}

      {/* Current timed line */}
      {activeLine && (
        <LineCaption
          line={activeLine}
          frame={frame}
        />
      )}

      {/* Scene progress */}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 65,
          height: 5,
          borderRadius: 999,
          background:
            "rgba(255,255,255,.25)",
          overflow: "hidden",
          zIndex: 30,
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
              frame /
                Math.max(
                  1,
                  safeSceneFrames - 1
                )
            )})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
