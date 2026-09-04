import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#071019", color: "#062b22", fontSize: 92, fontWeight: 800 }}>
      <div style={{ width: 142, height: 142, borderRadius: 42, display: "flex", alignItems: "center", justifyContent: "center", background: "#35d8b0" }}>会</div>
    </div>,
    size,
  );
}
