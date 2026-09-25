import React, { useEffect, useRef, useState } from "react";

export default function ResultVideo({
  videoUrl = "",
  title = "Your Video",
  duration = 30,
  aspectRatio = "9:16",
  sceneCount = 0,
}) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setIsPlaying(false);
    setError("");

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [videoUrl]);

  function togglePlayback() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          setError("Video playback could not be started.");
        });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function handleEnded() {
    setIsPlaying(false);
  }

  function handleError() {
    setIsPlaying(false);
    setError(
      "The video could not be loaded. Please try again."
    );
  }

  function downloadVideo() {
    if (!videoUrl) {
      return;
    }

    const link = document.createElement("a");

    link.href = videoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.download = "viraltap-video.mp4";

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyVideoLink() {
    if (!videoUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(videoUrl);
      setError("Video link copied.");
    } catch {
      setError(
        "Could not copy the video link."
      );
    }
  }

  return (
    <div
      style={{
        width: "100%",
        color: "#fff",
        fontFamily:
          "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          borderRadius: 26,
          overflow: "hidden",
          background: "#050505",
          border:
            "1px solid rgba(255,255,255,.12)",
          boxShadow:
            "0 25px 80px rgba(0,0,0,.45)",
        }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            onEnded={handleEnded}
            onError={handleError}
            style={{
              display: "block",
              width: "100%",
              maxHeight: "75vh",
              objectFit: "contain",
              background: "#000",
            }}
          />
        ) : (
          <div
            style={{
              minHeight: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,.55)",
            }}
          >
            Video URL is not available.
          </div>
        )}
      </div>

      <div
        style={{
          maxWidth: 760,
          margin: "18px auto 0",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 900,
          }}
        >
          {title}
        </h2>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 10,
            color: "rgba(255,255,255,.58)",
            fontSize: 14,
          }}
        >
          <span>
            {Number(duration) || 30}s
          </span>

          <span>•</span>

          <span>
            {aspectRatio || "9:16"}
          </span>

          {sceneCount > 0 && (
            <>
              <span>•</span>
              <span>
                {sceneCount} scenes
              </span>
            </>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 12,
              background:
                "rgba(255,255,255,.07)",
              color: "rgba(255,255,255,.72)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={togglePlayback}
            disabled={!videoUrl}
            style={{
              border: 0,
              borderRadius: 14,
              padding: "12px 18px",
              background: "#fff",
              color: "#000",
              fontWeight: 800,
              cursor: videoUrl
                ? "pointer"
                : "not-allowed",
              opacity: videoUrl ? 1 : 0.5,
            }}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

          <button
            type="button"
            onClick={downloadVideo}
            disabled={!videoUrl}
            style={{
              border:
                "1px solid rgba(255,255,255,.16)",
              borderRadius: 14,
              padding: "12px 18px",
              background:
                "rgba(255,255,255,.07)",
              color: "#fff",
              fontWeight: 800,
              cursor: videoUrl
                ? "pointer"
                : "not-allowed",
              opacity: videoUrl ? 1 : 0.5,
            }}
          >
            Download MP4
          </button>

          <button
            type="button"
            onClick={copyVideoLink}
            disabled={!videoUrl}
            style={{
              border:
                "1px solid rgba(255,255,255,.16)",
              borderRadius: 14,
              padding: "12px 18px",
              background:
                "rgba(255,255,255,.07)",
              color: "#fff",
              fontWeight: 800,
              cursor: videoUrl
                ? "pointer"
                : "not-allowed",
              opacity: videoUrl ? 1 : 0.5,
            }}
          >
            Copy Link
          </button>
        </div>
      </div>
    </div>
  );
}
