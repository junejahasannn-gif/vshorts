import React from "react";

export default function ProgressPanel({
  progress = 0,
  status = "rendering",
  message = "Creating your video...",
}) {
  const safeProgress = Math.max(
    0,
    Math.min(100, Number(progress) || 0)
  );

  const statusText = {
    queued: "Preparing render...",
    rendering: "Rendering video...",
    uploading: "Uploading video...",
    completed: "Video ready!",
    failed: "Rendering failed",
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: 220,
        padding: 28,
        borderRadius: 24,
        background:
          "linear-gradient(145deg, #111 0%, #080808 100%)",
        border: "1px solid rgba(255,255,255,.10)",
        boxShadow:
          "0 20px 60px rgba(0,0,0,.35)",
        color: "#fff",
        fontFamily:
          "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
          }}
        >
          {statusText[status] || "Processing..."}
        </div>

        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#aaa",
          }}
        >
          {Math.round(safeProgress)}%
        </div>
      </div>

      <div
        style={{
          width: "100%",
          height: 10,
          borderRadius: 999,
          background:
            "rgba(255,255,255,.10)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${safeProgress}%`,
            height: "100%",
            borderRadius: 999,
            background:
              "linear-gradient(90deg, #fff, #aaa)",
            transition:
              "width .35s ease",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 18,
          color: "rgba(255,255,255,.62)",
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        {message}
      </div>

      {status !== "failed" &&
        status !== "completed" && (
          <div
            style={{
              marginTop: 22,
              display: "flex",
              gap: 8,
            }}
          >
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background:
                    "rgba(255,255,255,.65)",
                  animation:
                    "viraltap-pulse 1.2s infinite",
                  animationDelay:
                    `${item * 0.2}s`,
                }}
              />
            ))}
          </div>
        )}

      <style>
        {`
          @keyframes viraltap-pulse {
            0%, 100% {
              opacity: .25;
              transform: scale(.8);
            }

            50% {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}
      </style>
    </div>
  );
}
