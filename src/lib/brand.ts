import type { BrandAssets } from "@/lib/types";

/**
 * Robust brand-asset extraction from the agency's own website.
 *
 * Chain, tried in order until one yields a usable value:
 *   (a) meta og:image / apple-touch-icon <link>
 *   (b) <link rel=icon> (any variant) → favicon.ico probe
 *   (c) hex/rgb colours harvested from homepage inline styles + <style>
 *       blocks + linked stylesheets → most saturated non-neutral wins
 *   (d) logo image candidates: <img> with "logo" in src/alt/class, or an
 *       inline/linked SVG inside header/nav
 *
 * When EVERYTHING fails we no longer silently mint a generic teal: the
 * caller renders a generated letter-avatar (first letter of the company
 * name derived from the domain) and the UI shows a "Using generated
 * brand" hint. That state is carried by `neutral: true` + `generated: true`.
 */

const UA = "E2M-LeadFinder/1.0 (+https://e2msolutions.com)";
const FETCH_TIMEOUT_MS = 6_000;

/** Result of one extraction pass over one site. */
export interface ExtractedBrand {
  logoUrl: string | null;
  primary: string | null;
  /** where the logo came from — surfaced for debugging / the hint chip */
  logoSource: "meta" | "icon" | "logo-img" | "svg" | null;
  colorSource: "css" | null;
}

const EMPTY: ExtractedBrand = {
  logoUrl: null, primary: null, logoSource: null, colorSource: null,
};

function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  return fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/* ────────────────────────── colour helpers ────────────────────────── */

export interface Rgb { r: number; g: number; b: number }

export function hexToRgb(hex: string): Rgb | null {
  const m = hex.replace("#", "");
  const full = m.length === 3 || m.length === 4
    ? m.split("").map((c) => c + c).join("").slice(0, 6)
    : m.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** HSL saturation (0..1) and lightness (0..1). */
export function saturation({ r, g, b }: Rgb): { s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { s: 0, l };
  const d = max - min;
  return { s: d / (1 - Math.abs(2 * l - 1)), l };
}

/**
 * Pick the best brand colour from a bag of candidates: the most saturated
 * non-neutral colour. Greys/browns (s < 0.25), near-black/near-white
 * (l outside 0.18–0.85) are skipped; ties break toward more frequent colours.
 */
export function pickBrandColor(candidates: string[]): string | null {
  const freq = new Map<string, number>();
  for (const raw of candidates) {
    const c = raw.trim().toLowerCase();
    if (!c) continue;
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let best: { hex: string; score: number } | null = null;
  for (const [c, count] of freq) {
    const rgb = c.startsWith("#") ? hexToRgb(c) : parseRgbLike(c);
    if (!rgb) continue;
    const { s, l } = saturation(rgb);
    // reject neutrals: greys, near-blacks, near-whites, muddy browns
    if (s < 0.25 || l < 0.18 || l > 0.85) continue;
    const score = s * 2 + Math.min(count, 5) * 0.1;
    if (!best || score > best.score) best = { hex: rgbToHex(rgb), score };
  }
  return best?.hex ?? null;
}

function parseRgbLike(value: string): Rgb | null {
  const m = value.match(
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i
  );
  if (!m) return null;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if ([r, g, b].some((n) => Number.isNaN(n) || n > 255)) return null;
  return { r, g, b };
}

const HEX_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB_RE = /\brgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)/gi;

/** Colours harvested from any CSS text (inline styles, <style>, sheets). */
export function colorsFromCss(css: string): string[] {
  return [...(css.match(HEX_RE) ?? []), ...(css.match(RGB_RE) ?? [])];
}

/* ────────────────────────── logo helpers ────────────────────────── */

function absolutize(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

function isUsableLogo(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // 1×1 tracking pixels and spacer gifs are not logos
  if (/\b(?:pixel|1x1|blank|spacer|transparent)\b/i.test(url)) return false;
  // Squarespace/website-builder TEMPLATE placeholder marks: every site on the
  // platform ships the same generic swirl/square logo. A "logo" fetched from
  // assets.squarespace.com (or similar CDN paths) says nothing about THIS
  // agency — rejecting it falls through to the next candidate (real favicon
  // or generated letter avatar).
  const GENERIC_HOSTS = [
    "assets.squarespace.com/universal/",
    "static1.squarespace.com/static/versioned-site-css/",
    "cdn.squarespace.com/",
    "website-files.com/", // webflow shared assets CDN
    "assets.website-files.com/shared/",
  ];
  if (GENERIC_HOSTS.some((p) => url.toLowerCase().includes(p))) return false;
  // Known builder placeholder file names regardless of host
  if (/\/(?:damask|logo-light|logo-dark)\.(?:svg|png)\b/i.test(url)) return false;

  // PHOTO REJECTION: content photography passing itself off as a logo is the
  // ugliest failure mode (a surgery photo in a 36px header mark, real case).
  // JPEG is a content-photo format; logos ship as svg/png/ico/webp. Combined
  // with camera/asset-path naming signals, confidence is high enough to reject
  // and fall through to the favicon or the generated letter avatar instead.
  const PHOTO_NAME = /(?:^|\/)(?:img_|dsc[_-]?|photo[_-]?|pexels|shutterstock|unsplash|_mobile\.|_desktop\.|-\d+x\d+\.)/i;
  const PHOTO_PATH = /\/(?:uploads|wp-content\/uploads|media|photos?|gallery|blog|portfolio|cases?|team)\/(?:20\d\d\/)?/i;
  if (/\.jpe?g(\?|$)/i.test(url) && (PHOTO_NAME.test(url) || PHOTO_PATH.test(url))) return false;
  if (/\.(?:jpe?g|heic|avif)(\?|$)/i.test(url) && PHOTO_NAME.test(url)) return false;
  return true;
}

/** (a) og:image · apple-touch-icon — big, usually high-quality marks. */
export function logoFromMeta(html: string, base: string): string | null {
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  ) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og?.[1]) {
    const abs = absolutize(og[1], base);
    if (abs && isUsableLogo(abs)) return abs;
  }
  const apple = html.match(
    /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi
  );
  if (apple) {
    // prefer the largest declared size
    let best: { href: string; size: number } | null = null;
    for (const tag of apple) {
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const size = Number(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? 180);
      if (!best || size > best.size) best = { href, size };
    }
    if (best) {
      const abs = absolutize(best.href, base);
      if (abs && isUsableLogo(abs)) return abs;
    }
  }
  return null;
}

/** (b) <link rel=icon> any variant → favicon.ico probe. */
export function faviconFromLinks(html: string, base: string): string | null {
  const links = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi) ?? [];
  let best: { href: string; size: number } | null = null;
  for (const tag of links) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const size = Number(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? 16);
    if (!best || size > best.size) best = { href, size };
  }
  if (best) {
    const abs = absolutize(best.href, base);
    if (abs && isUsableLogo(abs)) return abs;
  }
  // classic favicon.ico probe is checked by the caller via HEAD
  return null;
}

/** (d) logo candidates from <img src|alt|class containing "logo"> + header SVGs. */
export function logoImgFromHtml(html: string, base: string): string | null {
  const imgs =
    html.match(/<img\b[^>]*>/gi) ?? [];
  let best: { src: string; score: number } | null = null;
  for (const tag of imgs) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "";
    const cls = tag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
    const id = tag.match(/\bid=["']([^"']*)["']/i)?.[1] ?? "";
    const hay = `${src} ${alt} ${cls} ${id}`;
    if (!/logo|brandmark|brand-mark/i.test(hay)) continue;
    // score: logo in src/alt beats class-only; svg beats raster
    let score = /logo/i.test(alt) ? 3 : /logo/i.test(src) ? 2 : 1;
    if (/\.svg/i.test(src)) score += 1;
    const abs = absolutize(src, base);
    if (!abs || !isUsableLogo(abs)) continue;
    if (!best || score > best.score) best = { src: abs, score };
  }
  return best?.src ?? null;
}

/** (d) inline SVG inside header/nav — renderable vector mark. */
export function logoSvgFromHeader(html: string): string | null {
  const headerNav =
    html.match(/<header\b[\s\S]*?<\/header>/i) ?? html.match(/<nav\b[\s\S]*?<\/nav>/i);
  if (!headerNav) return null;
  const svg = headerNav[0].match(/<svg\b[\s\S]*?<\/svg>/i)?.[0];
  if (!svg || svg.length > 60_000) return null;
  // data-URI wrap so it can ride in BrandAssets.logoUrl like any other src
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** (b) last-ditch favicon.ico existence probe. */
export async function faviconIcoProbe(origin: string): Promise<string | null> {
  const url = `${origin}/favicon.ico`;
  try {
    const res = await fetchWithTimeout(url, 4_000);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      // real favicon, not an empty/stub response
      if (buf.length > 100) return url;
    }
  } catch {
    /* ignore — probe is best-effort */
  }
  return null;
}

/* ────────────────────────── stylesheet fetching ────────────────────────── */

function stylesheetHrefs(html: string, base: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) ?? []) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      const abs = absolutize(href, base);
      if (abs && abs.startsWith("http")) out.push(abs);
    }
  }
  return out.slice(0, 4); // budget: four sheets is plenty
}

/* ────────────────────────── main entry ────────────────────────── */

/**
 * Full extraction chain over one already-fetched homepage. Never throws —
 * every step degrades to the next.
 */
export async function extractBrandFromSite(url: string): Promise<ExtractedBrand> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  let origin: string;
  try {
    origin = new URL(target).origin;
  } catch {
    return EMPTY;
  }

  let html = "";
  try {
    const res = await fetchWithTimeout(target);
    if (res.ok) html = (await res.text()).slice(0, 1_500_000);
  } catch {
    /* fall through — later stages may still probe favicon */
  }

  if (!html) {
    // site unreadable: favicon probe is the only thing left
    const favicon = await faviconIcoProbe(origin);
    if (favicon) return { ...EMPTY, logoUrl: favicon, logoSource: "icon" };
    return EMPTY;
  }

  const base = target;
  const result: ExtractedBrand = { ...EMPTY };

  /* (a) og:image / apple-touch-icon */
  result.logoUrl = logoFromMeta(html, base);
  if (result.logoUrl) result.logoSource = "meta";

  /* (b) <link rel=icon> → favicon.ico */
  if (!result.logoUrl) {
    result.logoUrl = faviconFromLinks(html, base);
    if (result.logoUrl) result.logoSource = "icon";
  }

  /* (c) colours: inline styles + <style> blocks + linked sheets */
  const styleBlocks = [...(html.match(/<style\b[\s\S]*?<\/style>/gi) ?? []).map((s) =>
    s.replace(/<\/?style[^>]*>/gi, "")
  )];
  const inlineStyles = [...(html.match(/style=["']([^"']+)["']/gi) ?? []).map((m) =>
    m.replace(/^style=["']|["']$/g, "")
  )];
  const colorBag: string[] = [];
  for (const css of [...styleBlocks, ...inlineStyles]) colorBag.push(...colorsFromCss(css));

  const sheets = await Promise.all(
    stylesheetHrefs(html, base).map(async (href) => {
      try {
        const res = await fetchWithTimeout(href, 5_000);
        return res.ok ? await res.text() : "";
      } catch {
        return "";
      }
    })
  );
  for (const css of sheets) colorBag.push(...colorsFromCss(css));

  result.primary = pickBrandColor(colorBag);
  if (result.primary) result.colorSource = "css";

  /* (d) logo candidates from <img>/<svg> — used when meta/icon yielded nothing */
  if (!result.logoUrl) {
    result.logoUrl = logoImgFromHtml(html, base);
    if (result.logoUrl) result.logoSource = "logo-img";
  }
  if (!result.logoUrl) {
    result.logoUrl = logoSvgFromHeader(html);
    if (result.logoUrl) result.logoSource = "svg";
  }

  /* still nothing? favicon.ico probe as the final logo attempt */
  if (!result.logoUrl) {
    const favicon = await faviconIcoProbe(origin);
    if (favicon) {
      result.logoUrl = favicon;
      result.logoSource = "icon";
    }
  }

  return result;
}

/* ────────────────────────── generated-avatar helpers ────────────────────────── */

/**
 * When detection yields nothing we render a generated brand: a coloured
 * circle with the first letter of the company name (derived from the
 * domain) — never a silent generic teal.
 */
export function generatedAvatarColor(name: string): string {
  const PALETTE = ["#B3541E", "#1F3A93", "#2E7D32", "#5B2C6F", "#8A2846", "#0B7285", "#7A5C00", "#354A5F"];
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** First letter of the company name from a domain or name string. */
export function avatarInitial(nameOrDomain: string): string {
  const base = nameOrDomain.split(".")[0].replace(/[-_]+/g, " ").trim();
  const word = base.split(/\s+/).find(Boolean) ?? nameOrDomain;
  return (word[0] ?? "?").toUpperCase();
}
