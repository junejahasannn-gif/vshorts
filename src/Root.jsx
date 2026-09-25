import React from "react";
import {
  Composition,
  useCurrentFrame,
  interpolate,
} from "remotion";

const FPS = 30;

/* -------------------------------------------------------
   BASIC HELPERS
------------------------------------------------------- */

function getSceneText(scene) {
  return (
    scene?.caption ||
    scene?.narration ||
    scene?.dialogue ||
    scene?.scene ||
    "ViralTap"
  );
}

function normalizeLines(scene) {
  if (!scene) {
    return ["ViralTap"];
  }

  // Preferred format from Gemini
  if (Array.isArray(scene.lines) && scene.lines.length > 0) {
    const lines = scene.lines
      .map((line) => {
        if (typeof line === "string") {
          return line.trim();
        }

        if (line && typeof line === "object") {
          return String(line.text || "").trim();
        }

        return "";
      })
      .filter(Boolean);

    if (lines.length > 0) {
      return lines;
    }
  }

  // Fallback if Gemini didn't return lines[]
  const fallback = getSceneText(scene);

  if (!fallback) {
    return ["ViralTap"];
  }

  // Try splitting long text naturally
  const splitLines = String(fallback)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (splitLines.length > 0) {
    return splitLines;
  }

  return [String(fallback)];
}

/*
  Calculate how much visual time each line deserves.

  Longer text = more time.
  Punctuation = slightly more pause.
  Very short lines remain quick.
*/
function getLineWeight(text) {
  const value = String(text || "").trim();

  if (!value) {
    return 1;
  }

  const characters = value.length;

  // Natural reading weight.
  let weight = Math.max(
    1,
    Math.pow(characters, 0.82)
  );

  // Small extra pause for punctuation.
  if (/[.!?]$/.test(value)) {
    weight += 3;
  }

  if (/[…:]$/.test(value)) {
    weight += 4;
  }

  if (/[,—-]$/.test(value)) {
    weight += 1.5;
  }

  // Very short punch/dialogue lines should stay quick.
  if (characters <= 12) {
    weight *= 0.78;
  }

  return weight;
}

/*
  Creates frame ranges for all lines.

  Example:
  line 1 -> frames 0-70
  line 2 -> frames 70-145
  line 3 -> frames 145-240
*/
function buildLineTimings(lines, totalFrames) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [
      {
        text: "ViralTap",
        start: 0,
        end: totalFrames,
      },
    ];
  }

  if (lines.length === 1) {
    return [
      {
        text: lines[0],
        start: 0,
        end: totalFrames,
      },
    ];
  }

  const weights = lines.map(getLineWeight);

  const totalWeight = weights.reduce(
    (sum, weight) => sum + weight,
    0
  );

  const timings = [];

  let currentFrame = 0;

  lines.forEach((text, index) => {
    const isLast = index === lines.length - 1;

    let lineFrames;

    if (isLast) {
      // Always consume all remaining frames.
      lineFrames = totalFrames - currentFrame;
    } else {
      lineFrames = Math.max(
        8,
        Math.round(
          (weights[index] / totalWeight) *
            totalFrames
        )
      );
    }

    const start = currentFrame;
    const end = Math.min(
      totalFrames,
      start + lineFrames
    );

    timings.push({
      text,
      start,
      end,
    });

    currentFrame = end;
  });

  // Safety correction
  if (timings.length > 0) {
    timings[timings.length - 1].end =
      totalFrames;
  }

  return timings;
}

/*
  Finds which line should currently be visible.
*/
function getCurrentLineIndex(
  timings,
  frame
) {
  if (!timings.length) {
    return 0;
  }

  for (let i = 0; i < timings.length; i++) {
    const item = timings[i];

    if (
      frame >= item.start &&
      frame < item.end
    ) {
      return i;
    }
  }

  return timings.length - 1;
}

/* -------------------------------------------------------
   SCENE
------------------------------------------------------- */

function Scene({
  scene,
  sceneIndex,
  totalScenes,
  sceneDuration,
}) {
  const frame = useCurrentFrame();

  const lines = normalizeLines(scene);

  const lineTimings = buildLineTimings(
    lines,
    sceneDuration
  );

  const lineIndex = getCurrentLineIndex(
    lineTimings,
    frame
  );

  const currentLine =
    lineTimings[lineIndex] || {
      text: "ViralTap",
      start: 0,
      end: sceneDuration,
    };

  const localFrame =
    frame - currentLine.start;

  const lineDuration = Math.max(
    1,
    currentLine.end -
      currentLine.start
  );

  /* ---------------------------------------------------
     SCENE FADE
  --------------------------------------------------- */

  const sceneOpacity = interpolate(
    frame,
    [0, 12, 24],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  /* ---------------------------------------------------
     CINEMATIC BACKGROUND MOTION
  --------------------------------------------------- */

  const backgroundScale = interpolate(
    frame,
    [0, sceneDuration],
    [1.04, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  /* ---------------------------------------------------
     LINE ENTER / EXIT
  --------------------------------------------------- */

  const enterFrames = Math.min(
    12,
    Math.max(
      5,
      Math.floor(lineDuration * 0.18)
    )
  );

  const exitFrames = Math.min(
    10,
    Math.max(
      4,
      Math.floor(lineDuration * 0.14)
    )
  );

  const lineOpacity = interpolate(
    localFrame,
    [
      0,
      enterFrames,
      Math.max(
        enterFrames + 1,
        lineDuration - exitFrames
      ),
      lineDuration,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const lineTranslateY = interpolate(
    localFrame,
    [0, enterFrames],
    [35, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const lineScale = interpolate(
    localFrame,
    [0, enterFrames],
    [0.97, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  /* ---------------------------------------------------
     LINE PROGRESS
  --------------------------------------------------- */

  const lineProgress = interpolate(
    localFrame,
    [0, lineDuration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  /* ---------------------------------------------------
     TEXT SIZE

     Automatically keeps longer lines smaller.
  --------------------------------------------------- */

  const textLength =
    String(currentLine.text || "")
      .length;

  let fontSize = 52;

  if (textLength > 90) {
    fontSize = 38;
  } else if (textLength > 65) {
    fontSize = 42;
  } else if (textLength > 45) {
    fontSize = 46;
  } else if (textLength > 28) {
    fontSize = 50;
  }

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
      {/* ------------------------------------------------
          CINEMATIC BACKGROUND
      ------------------------------------------------ */}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 25%, rgba(255,255,255,.13), transparent 36%)",
          transform: `scale(${backgroundScale})`,
          opacity: sceneOpacity,
        }}
      />

      {/* Moving glow */}
      <div
        style={{
          position: "absolute",
          width: "55%",
          height: "55%",
          left: "22%",
          top: "8%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,.07), transparent 70%)",
          transform: `translateY(${Math.sin(
            frame / 45
          ) * 18}px)`,
          opacity: 0.8,
        }}
      />

      {/* ------------------------------------------------
          DARK CINEMATIC OVERLAY
      ------------------------------------------------ */}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.12), rgba(0,0,0,.88))",
        }}
      />

      {/* ------------------------------------------------
          TOP BRAND
      ------------------------------------------------ */}

      <div
        style={{
          position: "absolute",
          top: 50,
          left: 50,
          right: 50,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
          opacity: sceneOpacity,
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

      {/* ------------------------------------------------
          SCENE / LINE INDICATOR
      ------------------------------------------------ */}

      <div
        style={{
          position: "absolute",
          top: 105,
          left: 50,
          zIndex: 10,
          fontSize: 14,
          color: "rgba(255,255,255,.38)",
          fontWeight: 700,
          letterSpacing: 1,
          opacity: sceneOpacity,
        }}
      >
        LINE {lineIndex + 1}/{lines.length}
      </div>

      {/* ------------------------------------------------
          MAIN LINE
      ------------------------------------------------ */}

      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 125,
          zIndex: 10,
          opacity:
            sceneOpacity * lineOpacity,
          transform: `translateY(${lineTranslateY}px) scale(${lineScale})`,
          transformOrigin: "center bottom",
        }}
      >
        <div
          style={{
            fontSize,
            fontWeight: 800,
            lineHeight: 1.18,
            textAlign: "center",
            textShadow:
              "0 4px 20px rgba(0,0,0,.95)",
            wordBreak: "break-word",
          }}
        >
          {currentLine.text}
        </div>
      </div>

      {/* ------------------------------------------------
          BOTTOM PROGRESS
      ------------------------------------------------ */}

      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 65,
          height: 5,
          borderRadius: 999,
          background:
            "rgba(255,255,255,.22)",
          overflow: "hidden",
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#fff",
            transformOrigin: "left",
            transform: `scaleX(${lineProgress})`,
          }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   MAIN VIDEO
------------------------------------------------------- */

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

  /*
    Divide total video duration between scenes.

    The last scene receives any remaining frames
    so the video duration is always exact.
  */

  const baseSceneFrames = Math.max(
    1,
    Math.floor(
      totalFrames /
        safeScenes.length
    )
  );

  const frame =
    useCurrentFrame();

  let sceneIndex = 0;
  let accumulatedFrames = 0;

  for (
    let i = 0;
    i < safeScenes.length;
    i++
  ) {
    const isLast =
      i === safeScenes.length - 1;

    const sceneFrames = isLast
      ? totalFrames -
        accumulatedFrames
      : baseSceneFrames;

    if (
      frame >= accumulatedFrames &&
      frame <
        accumulatedFrames +
          sceneFrames
    ) {
      sceneIndex = i;
      break;
    }

    accumulatedFrames += sceneFrames;
  }

  /*
    Calculate exact scene start/end.
  */

  let sceneStart = 0;

  for (let i = 0; i < sceneIndex; i++) {
    const isLast =
      i === safeScenes.length - 1;

    const sceneFrames = isLast
      ? totalFrames -
        sceneStart
      : baseSceneFrames;

    sceneStart += sceneFrames;
  }

  const sceneEnd =
    sceneIndex ===
    safeScenes.length - 1
      ? totalFrames
      : sceneStart +
        baseSceneFrames;

  const sceneDuration =
    Math.max(
      1,
      sceneEnd - sceneStart
    );

  const scene =
    safeScenes[sceneIndex];

  /*
    Convert global Remotion frame into
    local scene frame.
  */

  const localSceneFrame =
    Math.max(
      0,
      frame - sceneStart
    );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      <Scene
        scene={scene}
        sceneIndex={sceneIndex}
        totalScenes={safeScenes.length}
        sceneDuration={sceneDuration}
        key={sceneIndex}
      />
    </div>
  );
};

/* -------------------------------------------------------
   REMOTION ROOT
------------------------------------------------------- */

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
            lines: [
              {
                text: "ViralTap",
                type: "caption",
              },
              {
                text: "Turn your idea into a video.",
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
