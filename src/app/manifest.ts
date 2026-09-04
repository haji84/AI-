import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI会社 仕事管理",
    short_name: "AI会社",
    description: "AI社員の稼働状況、タスク、進捗を確認する日本語ダッシュボード",
    start_url: "/",
    display: "standalone",
    background_color: "#071019",
    theme_color: "#071019",
    lang: "ja",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
