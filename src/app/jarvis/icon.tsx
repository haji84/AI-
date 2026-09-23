import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 250,
          fontWeight: 800,
          letterSpacing: -24,
          borderRadius: 112,
          border: "10px solid rgba(130,220,255,.34)",
          boxShadow: "inset 0 0 80px rgba(84,197,255,.24)",
        }}
      >
        G
      </div>
    ),
    size,
  );
}
