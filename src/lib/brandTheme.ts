/**
 * Centralized, app-wide brand theme — the ONE place the extracted brand
 * (logo URL + colors) lives so every surface of the platform reads it,
 * not just the single white-labeled audit page.
 *
 * Server side: `brandCssVars(brand)` returns the inline CSS custom
 * properties to spread on <body> (see src/app/layout.tsx, which loads the
 * workspace's BrandAssets from the DB once per request and injects them).
 * Client side: any component can read the active brand via
 * <BrandProvider> + useBrand().
 *
 * Defaults reproduce the E2M palette from globals.css, so with no stored
 * brand the platform looks exactly as before.
 */
import type { BrandAssets } from "@/lib/types";

export const DEFAULT_BRAND: BrandAssets = {
  logoUrl: null,
  primary: "#1638fb",
  secondary: "#08090C",
  tone: "direct, plain-spoken, no jargon",
  agencyName: "",
  neutral: true,
  generated: false,
};

/** Compute a soft tint (10% alpha over white) from any hex colour. */
export function softTint(hex: string): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "rgba(22, 56, 251, 0.08)";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.08)`;
}

/**
 * CSS custom properties consumed by tailwind theme tokens (tailwind.config
 * maps `blue`, `agency` etc. onto these), so theme colors + logo apply
 * across app chrome — header, sidebar, buttons — everywhere at once.
 */
export function brandCssVars(brand: BrandAssets): Record<string, string> {
  return {
    "--brand-primary": brand.primary,
    "--brand-secondary": brand.secondary,
    "--brand-soft": softTint(brand.primary),
    "--agency": brand.primary,
    "--agency-soft": softTint(brand.primary),
    "--logo-url": brand.logoUrl ? `url("${brand.logoUrl}")` : "none",
  };
}

/** Context value handed to client components. */
export interface BrandTheme {
  brand: BrandAssets;
  /** letter to render in the generated avatar when detection failed */
  initial: string;
}
