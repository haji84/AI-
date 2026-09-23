import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GORIQ Commander",
    short_name: "GORIQ",
    description: "登録済みGORIQ端末をiPhoneから管理・操作する司令塔",
    start_url: "/jarvis/mobile",
    scope: "/jarvis/",
    display: "standalone",
    background_color: "#05070b",
    theme_color: "#05070b",
    orientation: "portrait-primary",
    categories: ["utilities", "productivity"],
    icons: [
      { src: "/jarvis/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
