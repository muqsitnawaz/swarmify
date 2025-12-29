import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swarmify - AI Agents in Your Editor",
  description: "Run Claude, Codex, Gemini, and Cursor agents as editor tabs. Stop context-switching. Ship faster.",
  openGraph: {
    title: "Swarmify - AI Agents in Your Editor",
    description: "Run Claude, Codex, Gemini, and Cursor agents as editor tabs. Stop context-switching. Ship faster.",
    url: "https://swarmify.co",
    siteName: "Swarmify",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Swarmify - AI Agents in Your Editor",
    description: "Run Claude, Codex, Gemini, and Cursor agents as editor tabs. Stop context-switching. Ship faster.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
