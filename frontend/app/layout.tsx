import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SourceFix | Supplier Shortlisting",
  description: "Turn product requirements into a defensible supplier shortlist.",
  icons: {
    icon: "/icon.jpg",
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