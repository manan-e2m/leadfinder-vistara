import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "E2M LeadFinder",
  description:
    "Instant ICP-to-prospect engine for agency owners. Scan your agency, get a verified, scored, personalized shortlist in under a minute.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
