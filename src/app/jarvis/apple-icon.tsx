import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg,#05070b 0%,#101a2d 58%,#19334f 100%)",
          color: "#e9f7ff",
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: -8,
          borderRadius: 38,
          border: "4px solid rgba(130,220,255,.34)",
        }}
      >
        G
      </div>
    ),
    size,
  );
}
