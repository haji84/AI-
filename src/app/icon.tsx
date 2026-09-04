import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#071019", color: "#062b22", fontSize: 260, fontWeight: 800 }}>
      <div style={{ width: 390, height: 390, borderRadius: 118, display: "flex", alignItems: "center", justifyContent: "center", background: "#35d8b0" }}>会</div>
    </div>,
    size,
  );
}
