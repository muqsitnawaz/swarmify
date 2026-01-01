import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swarmify - Multi-agent Coding",
  description: "Run multiple AI agents in parallel. Let your main agent spawn subagents to distribute tasks. Ship features 3x faster.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Swarmify - Multi-agent Coding",
    description: "Run multiple AI agents in parallel. Let your main agent spawn subagents to distribute tasks. Ship features 3x faster.",
    url: "https://swarmify.dev",
    siteName: "Swarmify",
    type: "website",
    images: [
      {
        url: "https://swarmify.dev/og-image.png",
        width: 1200,
        height: 630,
        alt: "Swarmify - Multi-agent coding in your IDE",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Swarmify - Multi-agent Coding",
    description: "Run multiple AI agents in parallel. Let your main agent spawn subagents to distribute tasks. Ship features 3x faster.",
    images: ["https://swarmify.dev/og-image.png"],
  },
  metadataBase: new URL("https://swarmify.dev"),
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
