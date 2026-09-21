"use client";

import { createContext, useContext } from "react";
import clsx from "clsx";
import type { BrandAssets } from "@/lib/types";
import { DEFAULT_BRAND, type BrandTheme } from "@/lib/brandTheme";

/**
 * App-wide brand context. layout.tsx loads the extracted BrandAssets from
 * the workspace row once per request, injects the CSS variables on <body>,
 * and hands the theme down here — so header, sidebar, buttons and report
 * all read ONE source of truth.
 */

const BrandContext = createContext<BrandTheme>({
  brand: DEFAULT_BRAND,
  initial: "E",
});

export function BrandProvider({
  theme,
  children,
}: {
  theme: BrandTheme;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={theme}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandTheme {
  return useContext(BrandContext);
}

/**
 * The platform logo. When brand extraction succeeded, shows the extracted
 * logo image; when EVERYTHING failed, renders a generated brand: a colored
 * circle with the first letter of the company name (derived from the
 * domain) — with a small "Using generated brand" hint.
 */
export function BrandLogo({
  size = 36,
  showHint = false,
  className,
}: {
  size?: number;
  showHint?: boolean;
  className?: string;
}) {
  const { brand, initial } = useBrand();

  if (brand.logoUrl && !brand.generated) {
    return (
      <span className={clsx("group inline-flex items-center gap-2.5", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logoUrl}
          alt={`${brand.agencyName || "Brand"} logo`}
          width={size}
          height={size}
          className="rounded-[10px] object-contain shadow-lift"
          style={{ width: size, height: size }}
        />
        {showHint && null}
      </span>
    );
  }

  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <span
        className="flex items-center justify-center rounded-full font-extrabold leading-none text-white shadow-lift"
        style={{ width: size, height: size, background: brand.primary, fontSize: size * 0.42 }}
        aria-label={`${brand.agencyName || "Brand"} (generated mark)`}
      >
        {initial}
      </span>
      {showHint && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-40">
          Using generated brand
        </span>
      )}
    </span>
  );
}
