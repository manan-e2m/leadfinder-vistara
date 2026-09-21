import type { Metadata } from "next";
import "./globals.css";
import { loadBrandTheme, WithBrand } from "@/lib/brandLoader";
import { brandCssVars } from "@/lib/brandTheme";

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
    <html lang="en">
      <body
        className="min-h-screen antialiased"
        style={cssVars}
        data-brand-logo={theme.brand?.logoUrl ? "1" : "0"}
      >
        <WithBrand theme={theme}>{children}</WithBrand>
      </body>
    </html>
  );
}
