import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import JarvisPrimaryShell from "./JarvisPrimaryShell";
import "./jarvis.css";
import "./shell.css";
import "./themes.css";
import "./widget-layout.css";
import "./command-search.css";
import "./layout-modes.css";
import "./screen-layout-profiles.css";
import "./operation-mode.css";
import "./accessibility-status.css";

export const metadata: Metadata = {
  title: "GORIQ（ゴリック）",
  description: "やりたいことを一つの入口から任せられるGORIQ Daily Driver",
  manifest: "/jarvis/manifest.webmanifest",
  applicationName: "GORIQ",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GORIQ",
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
