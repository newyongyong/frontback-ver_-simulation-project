import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "생산계획 자동화",
  description: "SQLite 기반 생산계획 자동화 시스템",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
