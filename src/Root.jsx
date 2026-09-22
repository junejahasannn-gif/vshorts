import React from "react";
import {
  Composition,
  useCurrentFrame,
  interpolate,
} from "remotion";

const FPS = 30;

const Scene = ({ scene }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, 15, 30],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

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
        opacity,
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
        {scene?.caption ||
          scene?.narration ||
          scene?.dialogue ||
          "ViralTap"}
      </div>
    </div>
  );
};

const ViralTapVideo = ({
  scenes = [],
  duration = 30,
}) => {
  const totalFrames = Math.max(
    1,
    Math.round(duration * FPS)
  );

  const sceneDuration = Math.max(
    1,
    Math.floor(
      totalFrames / Math.max(scenes.length, 1)
    )
  );

  const frame = useCurrentFrame();

  const sceneIndex = Math.min(
    Math.max(scenes.length - 1, 0),
    Math.floor(frame / sceneDuration)
  );

  const scene = scenes[sceneIndex] || {
    caption: "ViralTap",
  };

  return <Scene scene={scene} />;
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="ViralTapVideo"
      component={ViralTapVideo}
      durationInFrames={30 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{
        scenes: [
          {
            caption: "ViralTap",
          },
        ],
        duration: 30,
      }}
    />
  );
};

export default RemotionRoot;
