import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
