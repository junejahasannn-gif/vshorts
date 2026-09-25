import React from "react";
import { interpolate } from "remotion";

export default function LineCaption({
  line,
  frame = 0,
}) {
  if (!line?.text) {
    return null;
  }

  const startFrame = Number(line.startFrame) || 0;
  const endFrame = Math.max(
    startFrame + 1,
    Number(line.endFrame) || startFrame + 1
  );

  const duration = endFrame - startFrame;
  const localFrame = frame - startFrame;

  const fadeFrames = Math.min(
    12,
    Math.max(4, Math.floor(duration * 0.12))
  );

  const opacity = interpolate(
    localFrame,
    [0, fadeFrames, Math.max(fadeFrames + 1, duration - fadeFrames), duration],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const translateY = interpolate(
    localFrame,
    [0, Math.min(10, duration), duration],
    [18, 0, -8],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const textLength = line.text.length;

  const fontSize =
    textLength > 110
      ? 38
      : textLength > 75
        ? 43
        : textLength > 45
          ? 48
          : 52;

  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: 120,
        zIndex: 20,
        opacity,
        transform: `translateY(${translateY}px)`,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: "92%",
          padding: "18px 26px",
          borderRadius: 22,
          background: "rgba(0, 0, 0, 0.48)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
          backdropFilter: "blur(8px)",
          color: "#fff",
          fontFamily:
            "Arial, Helvetica, sans-serif",
          fontSize,
          fontWeight: 800,
          lineHeight: 1.18,
          textAlign: "center",
          textShadow:
            "0 3px 14px rgba(0,0,0,0.9)",
          wordBreak: "break-word",
        }}
      >
        {line.text}
      </div>
    </div>
  );
}
