// lib/video-config.js

export const FPS = 30;

export const VIDEO_PRESETS = {
  "9:16": {
    width: 1080,
    height: 1920,
  },

  "16:9": {
    width: 1920,
    height: 1080,
  },

  "1:1": {
    width: 1080,
    height: 1080,
  },
};

export const VIDEO_DURATIONS = [30, 60, 180];

export const SCENE_COUNTS = {
  30: 5,
  60: 7,
  180: 10,
};

export function getVideoDimensions(aspectRatio = "9:16") {
  return VIDEO_PRESETS[aspectRatio] || VIDEO_PRESETS["9:16"];
}

export function getSceneCount(duration = 30) {
  const seconds = Number(duration);

  return SCENE_COUNTS[seconds] || SCENE_COUNTS[30];
}

export function getTotalFrames(duration = 30) {
  const seconds = Number(duration) || 30;

  return Math.max(FPS, Math.round(seconds * FPS));
}

export function getVideoConfig({
  aspectRatio = "9:16",
  duration = 30,
} = {}) {
  const dimensions = getVideoDimensions(aspectRatio);
  const sceneCount = getSceneCount(duration);
  const totalFrames = getTotalFrames(duration);

  return {
    fps: FPS,
    aspectRatio,
    duration: Number(duration),
    width: dimensions.width,
    height: dimensions.height,
    sceneCount,
    totalFrames,
  };
}
