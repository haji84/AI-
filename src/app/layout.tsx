import type { Metadata } from "next";
import ControlCenterViewSwitcher from "./ControlCenterViewSwitcher.tsx";
import "./globals.css";
import "./view-switcher.css";
import "./attachments.css";

export const metadata: Metadata = {
  title: "Unified AI Creator Studio",
  description: "Phase 1 application foundation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <ControlCenterViewSwitcher>{children}</ControlCenterViewSwitcher>
      </body>
    </html>
  );
}
