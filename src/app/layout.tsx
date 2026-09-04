import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI会社",
  description: "AI社員の稼働状況、タスク、進捗を確認する日本語ダッシュボード",
  applicationName: "AI会社",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI会社",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#071019",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
