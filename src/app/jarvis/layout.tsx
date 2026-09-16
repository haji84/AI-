import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import JarvisPrimaryShell from "./JarvisPrimaryShell";
import "./jarvis.css";
import "./shell.css";
import "./themes.css";

export const metadata: Metadata = {
  title: "JARVIS Commander",
  description: "登録済みJARVIS端末を管理・操作する司令塔",
  manifest: "/jarvis/manifest.webmanifest",
  applicationName: "JARVIS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "JARVIS",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05070b",
};

export default function JarvisLayout({ children }: { children: ReactNode }) {
  return <JarvisPrimaryShell>{children}</JarvisPrimaryShell>;
}
