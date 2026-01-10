import type { Metadata } from "next";
import "./globals.css";

const siteTitle = "Swarmify - Run Multiple AI Coding Agents in VS Code";
const siteDescription = "VS Code extension for multi-agent coding. Run Claude Code, Codex, and Gemini in parallel tabs. Orchestrate AI agents, see diffs live, ship 3x faster.";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  keywords: [
    "VS Code AI extension",
    "multi-agent coding",
    "Claude Code VS Code",
    "Codex CLI",
    "Gemini CLI",
    "AI coding assistant",
    "parallel AI agents",
    "MCP server",
    "AI orchestration",
    "Cursor IDE",
    "Claude Code extension",
    "AI developer tools",
  ],
  authors: [{ name: "Swarmify" }],
  creator: "Swarmify",
  publisher: "Swarmify",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: "https://swarmify.co",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/logo.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon.ico",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "https://swarmify.co",
    siteName: "Swarmify",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "https://swarmify.co/og-image.png",
        width: 1200,
        height: 630,
        alt: "Swarmify - Run Claude, Codex, and Gemini agents in your IDE",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["https://swarmify.co/og-image.png"],
    creator: "@swarmify",
  },
  other: {
    "theme-color": "#0a0a0a",
    "msapplication-TileColor": "#0a0a0a",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
  metadataBase: new URL("https://swarmify.co"),
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Swarmify",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "VS Code, Cursor",
  description: siteDescription,
  url: "https://swarmify.co",
  downloadUrl: "https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext",
  softwareVersion: "1.0",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "5",
    ratingCount: "50",
  },
  featureList: [
    "Run Claude Code, Codex, and Gemini agents in parallel",
    "See diffs and markdown live in editor tabs",
    "Session persistence and recovery",
    "AI-powered git commits",
    "MCP server for agent orchestration",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
