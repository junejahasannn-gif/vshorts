import React from "react";
import { Composition } from "remotion";

const FPS = 30;

const Scene = ({ scene }) => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#111",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: 60,
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 42,
          fontWeight: 700,
          lineHeight: 1.2,
          textShadow: "0 2px 10px rgba(0,0,0,.8)",
        }}
      >
        {scene?.caption || scene?.narration || scene?.dialogue || ""}
      </div>
    </div>
  );
};

const ViralTapVideo = ({ scenes = [], duration = 30 }) => {
  const totalFrames = Math.max(1, Math.round(duration * FPS));

  const sceneDuration = Math.max(
    1,
    Math.floor(totalFrames / Math.max(scenes.length, 1))
  );

  const sceneIndex = Math.min(
    scenes.length - 1,
    Math.floor(useCurrentFrame() / sceneDuration)
  );

  const scene = scenes[sceneIndex] || {
    caption: "ViralTap",
  };

  return <Scene scene={scene} />;
};

function useCurrentFrame() {
  try {
    // Remotion hook is loaded dynamically below.
    return globalThis.__REMOTION_CURRENT_FRAME__ || 0;
  } catch {
    return 0;
  }
}

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="ViralTapVideo"
        component={ViralTapVideo}
        durationInFrames={30 * FPS}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          scenes: [],
          duration: 30,
        }}
      />
    </>
  );
};

export default RemotionRoot;
