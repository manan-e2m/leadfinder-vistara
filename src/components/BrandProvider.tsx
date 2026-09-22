"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { BrandAssets } from "@/lib/types";
import {
  DEFAULT_BRAND,
  brandCssVars,
  themeFromBrand,
  type BrandTheme,
} from "@/lib/brandTheme";

/**
 * App-wide brand context. layout.tsx loads the extracted BrandAssets from
 * the workspace row once per request, injects the CSS variables on <body>,
 * and hands the theme down here — so header, sidebar, buttons and report
 * all read ONE source of truth.
 *
 * After a scan the cookie is set but this page does not remount, so
 * `setBrand` paints the extracted theme immediately (CSS vars + context).
 */

type BrandContextValue = BrandTheme & {
  setBrand: (brand: BrandAssets) => void;
};

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  initial: "E",
  setBrand: () => {},
});

function paintBrand(brand: BrandAssets) {
  if (typeof document === "undefined") return;
  const vars = brandCssVars(brand);
  for (const [k, v] of Object.entries(vars)) {
    document.body.style.setProperty(k, v);
  }
  document.body.dataset.brandLogo = brand.logoUrl && !brand.generated ? "1" : "0";
  document.body.dataset.logoOnDark = brand.logoOnDark ? "1" : "0";
}

export function BrandProvider({
  theme,
  children,
}: {
  theme: BrandTheme;
  children: React.ReactNode;
}) {
  const [current, setCurrent] = useState<BrandTheme>(theme);
  const pinned = useRef(false);

  useEffect(() => {
    // A scan paints the brand in-session via setBrand. Don't let the
    // server theme (still the previous cookie) clobber it on re-render.
    if (pinned.current) return;
    setCurrent(theme);
  }, [theme.brand.logoUrl, theme.brand.primary, theme.brand.agencyName, theme.brand.generated, theme.initial]);

  useEffect(() => {
    paintBrand(current.brand);
  }, [current]);

  const setBrand = useCallback((brand: BrandAssets) => {
    pinned.current = true;
    setCurrent(themeFromBrand(brand));
  }, []);

  const value = useMemo(
    () => ({ ...current, setBrand }),
    [current, setBrand]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

export function AppMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="brand-mark relative flex items-center justify-center overflow-hidden rounded-[10px] font-extrabold leading-none tracking-tight text-white shadow-lift"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-label="LeadFinder"
    >
      <span className="mark-letter relative z-10">LF</span>
      <span className="mark-sheen" />
    </span>
  );
}

/**
 * Extracted agency mark. If the image is missing or fails to paint,
 * fall back to the LeadFinder tile — never a blank square or letter avatar.
 */
export function BrandLogo({
  size = 36,
  showHint = false,
  className,
  assets,
}: {
  size?: number;
  showHint?: boolean;
  className?: string;
  /** Override context — used on the confirm card so a new scan can't keep the previous site's mark. */
  assets?: BrandAssets;
}) {
  const ctx = useBrand();
  const brand = assets ?? ctx.brand;
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [brand.logoUrl]);

  const { setBrand } = ctx;
  const usableLogo = Boolean(brand.logoUrl && !brand.generated && !broken);

  function failLogo() {
    setBroken(true);
    setBrand(DEFAULT_BRAND);
  }

  if (usableLogo && brand.logoUrl) {
    const pad = Math.max(4, Math.round(size * 0.12));
    const isSvg = /\.svg(\?|$)|data:image\/svg/i.test(brand.logoUrl);
    // White header SVGs (many agencies) vanish on a white tile.
    // Default SVGs to a dark ground unless extraction proved they're dark marks.
    const onDark =
      brand.logoOnDark === true ||
      /white|inverted|on-?dark/i.test(brand.logoUrl) ||
      (isSvg && brand.logoOnDark !== false);
    return (
      <span className={clsx("group inline-flex items-center gap-2.5", className)}>
        <span
          className={clsx(
            "inline-flex items-center justify-center overflow-hidden rounded-[10px] shadow-lift ring-1",
            onDark ? "ring-black/15" : "bg-white ring-line"
          )}
          style={{
            width: size,
            height: size,
            padding: pad,
            background: onDark ? brand.secondary || "#0a0a0a" : "#fff",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logoUrl}
            alt={`${brand.agencyName || "Brand"} logo`}
            width={size}
            height={size}
            className="h-full w-full object-contain"
            onError={failLogo}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth < 2 || img.naturalHeight < 2) failLogo();
            }}
          />
        </span>
        {showHint && null}
      </span>
    );
  }

  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <AppMark size={size} />
    </span>
  );
}

/** Header wordmark — extracted logo when a scan found a real mark, LeadFinder otherwise. */
export function Wordmark({ subtitle }: { subtitle?: string }) {
  const { brand } = useBrand();
  const branded = Boolean(brand.logoUrl && !brand.generated);

  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Go to homepage">
      {branded ? <BrandLogo size={36} /> : <AppMark size={36} />}
      <span className="flex flex-col leading-none">
        <span className="text-[16px] font-extrabold tracking-tight text-ink">
          Lead<span className="text-blue">Finder</span>
        </span>
        {subtitle && (
          <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-ink-40">
            {subtitle}
          </span>
        )}
      </span>
    </Link>
  );
}
