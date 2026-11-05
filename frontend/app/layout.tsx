import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://source-fix.vercel.app"),
  title: "SourceFix | Constraint-Relaxation Sourcing Agent",
  description: "Python enforces hard rules, the LLM proposes, a code gate decides.",
  icons: {
    icon: "/icon.jpg",
  },
  openGraph: {
    title: "SourceFix | Constraint-Relaxation Sourcing Agent",
    description: "Python enforces hard rules, the LLM proposes, a code gate decides.",
    url: "https://source-fix.vercel.app",
    siteName: "SourceFix",
    images: [
      {
        url: "https://source-fix.vercel.app/og-image.png",
        width: 1200,
        height: 630,
        alt: "SourceFix | Constraint-Relaxation Sourcing Agent",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SourceFix | Constraint-Relaxation Sourcing Agent",
    description: "Python enforces hard rules, the LLM proposes, a code gate decides.",
    images: ["https://source-fix.vercel.app/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}