// lib/scene-utils.js

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function normalizeLine(line) {
  if (typeof line === "string") {
    return {
      text: cleanText(line),
      type: "dialogue",
    };
  }

  if (!line || typeof line !== "object") {
    return {
      text: "",
      type: "dialogue",
    };
  }

  return {
    text: cleanText(line.text),
    type: cleanText(line.type) || "dialogue",
  };
}

export function normalizeLines(scene = {}) {
  if (Array.isArray(scene.lines) && scene.lines.length > 0) {
    return scene.lines
      .map(normalizeLine)
      .filter((line) => line.text.length > 0);
  }

  const fallback = [
    scene.narration,
    scene.dialogue,
    scene.caption,
  ]
    .map(cleanText)
    .filter(Boolean);

  if (fallback.length > 0) {
    return fallback.map((text) => ({
      text,
      type: "dialogue",
    }));
  }

  return [
    {
      text: "ViralTap",
      type: "caption",
    },
  ];
}

export function normalizeScene(scene = {}) {
  const lines = normalizeLines(scene);

  return {
    visualPrompt: cleanText(scene.visualPrompt),
    narration: cleanText(scene.narration),
    dialogue: cleanText(scene.dialogue),
    caption: cleanText(scene.caption),
    lines,
    duration: Number(scene.duration) || 0,
  };
}

export function normalizeScenes(scenes = []) {
  if (!Array.isArray(scenes)) {
    return [];
  }

  return scenes
    .map(normalizeScene)
    .filter((scene) => scene.lines.length > 0);
}

export function getSceneText(scene = {}) {
  const lines = normalizeLines(scene);

  return lines
    .map((line) => line.text)
    .filter(Boolean)
    .join(" ");
}

export function getTextWeight(text = "") {
  const value = cleanText(text);

  if (!value) {
    return 1;
  }

  return Math.max(1, value.length);
}

export function calculateLineDurations(lines = [], totalFrames = 1) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const safeTotalFrames = Math.max(
    lines.length,
    Math.floor(Number(totalFrames) || 1)
  );

  const weights = lines.map((line) =>
    getTextWeight(line?.text)
  );

  const totalWeight = weights.reduce(
    (sum, weight) => sum + weight,
    0
  );

  let usedFrames = 0;

  return lines.map((line, index) => {
    const remainingLines = lines.length - index - 1;

    if (index === lines.length - 1) {
      const duration = Math.max(
        1,
        safeTotalFrames - usedFrames
      );

      usedFrames += duration;

      return {
        ...line,
        durationFrames: duration,
      };
    }

    const rawDuration =
      (weights[index] / totalWeight) * safeTotalFrames;

    const minimumFrames = 12;

    const maxAllowed =
      safeTotalFrames - usedFrames - remainingLines;

    const duration = Math.max(
      minimumFrames,
      Math.min(
        Math.round(rawDuration),
        Math.max(minimumFrames, maxAllowed)
      )
    );

    usedFrames += duration;

    return {
      ...line,
      durationFrames: duration,
    };
  });
}

export function buildTimedScene(scene, sceneFrames) {
  const normalizedScene = normalizeScene(scene);

  const timedLines = calculateLineDurations(
    normalizedScene.lines,
    sceneFrames
  );

  let startFrame = 0;

  const lines = timedLines.map((line) => {
    const endFrame =
      startFrame + line.durationFrames;

    const result = {
      ...line,
      startFrame,
      endFrame,
    };

    startFrame = endFrame;

    return result;
  });

  return {
    ...normalizedScene,
    lines,
    durationFrames: sceneFrames,
  };
}

export function buildTimedScenes(
  scenes = [],
  totalFrames = 1
) {
  const normalizedScenes = normalizeScenes(scenes);

  if (normalizedScenes.length === 0) {
    return [];
  }

  const safeTotalFrames = Math.max(
    normalizedScenes.length,
    Math.floor(Number(totalFrames) || 1)
  );

  const baseSceneFrames = Math.floor(
    safeTotalFrames / normalizedScenes.length
  );

  let usedFrames = 0;

  return normalizedScenes.map((scene, index) => {
    const remainingScenes =
      normalizedScenes.length - index - 1;

    let sceneFrames;

    if (index === normalizedScenes.length - 1) {
      sceneFrames =
        safeTotalFrames - usedFrames;
    } else {
      sceneFrames = Math.max(
        1,
        Math.min(
          baseSceneFrames,
          safeTotalFrames -
            usedFrames -
            remainingScenes
        )
      );
    }

    usedFrames += sceneFrames;

    return buildTimedScene(
      scene,
      sceneFrames
    );
  });
}

export function findActiveLine(
  lines = [],
  frame = 0
) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  const currentFrame = Math.max(
    0,
    Math.floor(Number(frame) || 0)
  );

  const active =
    lines.find(
      (line) =>
        currentFrame >= line.startFrame &&
        currentFrame < line.endFrame
    ) || lines[lines.length - 1];

  return active;
}
