import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { loadBrandTheme, WithBrand } from "@/lib/brandLoader";
import { brandCssVars } from "@/lib/brandTheme";

// Cookie-driven session whitelabeling: the brand depends on the lf_ws cookie,
// so the root layout must render per-request, never as static shell.
export const dynamic = "force-dynamic";

/**
 * Type system — Instrument Sans for the interface, JetBrains Mono for every
 * number, domain and measurement. Exposed as CSS variables so globals.css and
 * the tailwind tokens read a single source (see --font-sans / --font-mono).
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "E2M LeadFinder",
  description:
    "Scan your agency, get a verified, scored shortlist of prospects in under a minute. Built for agency owners who need leads, not dashboards.",
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body
        className="min-h-screen antialiased"
        style={cssVars}
        data-brand-logo={theme.brand?.logoUrl ? "1" : "0"}
      >
        {/* Ambient platform backdrop — drifting brand orbs over a masked grid.
            Fixed and pointer-events-none so it sits behind every route. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="app-bg-orb app-bg-orb--blue" />
          <div className="app-bg-orb app-bg-orb--orange" />
          <div className="app-bg-grid" />
        </div>
        <div className="relative z-[1]">
          <WithBrand theme={theme}>{children}</WithBrand>
        </div>
      </body>
    </html>
  );
}
