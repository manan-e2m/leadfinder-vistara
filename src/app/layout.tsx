import type { Metadata } from "next";
import "./globals.css";
import { loadBrandTheme, WithBrand } from "@/lib/brandLoader";
import { brandCssVars } from "@/lib/brandTheme";

export const metadata: Metadata = {
  title: "E2M LeadFinder",
  description:
    "Instant ICP-to-prospect engine for agency owners. Scan your agency, get a verified, scored, personalized shortlist in under a minute.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await loadBrandTheme();
  const cssVars = brandCssVars(theme.brand);

  return (
    <html lang="en">
      <body className="min-h-screen antialiased" style={cssVars}>
        <WithBrand theme={theme}>{children}</WithBrand>
      </body>
    </html>
  );
}
