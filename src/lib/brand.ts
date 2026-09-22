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

const UA = "LeadFinder/1.0";
const FETCH_TIMEOUT_MS = 6_000;

/** Result of one extraction pass over one site. */
export interface ExtractedBrand {
  logoUrl: string | null;
  primary: string | null;
  /** where the logo came from — surfaced for debugging / the hint chip */
  logoSource: "meta" | "icon" | "logo-img" | "svg" | null;
  colorSource: "css" | null;
  /** light-on-transparent mark that needs a dark tile */
  logoOnDark: boolean;
}

const EMPTY: ExtractedBrand = {
  logoUrl: null, primary: null, logoSource: null, colorSource: null, logoOnDark: false,
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
  if (url.startsWith("data:image/svg+xml")) return url.length > 80 && url.length < 80_000;
  // Empty data URIs (`data:,`) are parked-domain favicon stubs.
  if (/^data:/i.test(url)) return false;
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
  // Social-share cards (1200×628 OG images, Shopify pad_color banners) look
  // like a smear when forced into a 36px header mark.
  if (isOgCardUrl(url)) return false;
  return true;
}

/** Typical Open Graph / Twitter card URLs — marketing photos, not marks. */
function isOgCardUrl(url: string): boolean {
  return /(?:og[-_]?image|opengraph|twitter[-_]?card|social[-_]?share|pad_color=|[?&]height=628|[?&]width=1200)/i.test(url);
}

/** Filename hint for inverted / white-on-transparent marks. */
export function logoUrlLooksLight(url: string): boolean {
  return /white|inverted|on-?dark|logo-light/i.test(url);
}

/** Fetch an SVG and see if its painted fills are white / near-white. */
async function svgIsLightMark(url: string): Promise<boolean> {
  if (url.startsWith("data:image/svg+xml")) {
    try {
      const raw = url.includes(";base64,")
        ? Buffer.from(url.split(";base64,")[1] ?? "", "base64").toString("utf8")
        : decodeURIComponent(url.replace(/^data:image\/svg\+xml[^,]*,/, ""));
      return svgFillsAreLight(raw);
    } catch {
      return false;
    }
  }
  if (!/^https?:\/\//i.test(url) || !/\.svg(\?|$)/i.test(url)) return false;
  try {
    const res = await fetchWithTimeout(url, 4_000);
    if (!res.ok) return false;
    const text = (await res.text()).slice(0, 80_000);
    return svgFillsAreLight(text);
  } catch {
    return false;
  }
}

function isLightFill(f: string): boolean {
  if (f === "white") return true;
  const hex = f.replace("#", "");
  if (/^[ef]{3}$|^[ef]{6}$/i.test(hex)) return true;
  return /^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/i.test(f);
}

function svgFillsAreLight(svg: string): boolean {
  const fills = [...svg.matchAll(/\bfill=["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  const painted = fills.filter((f) => f !== "none" && f !== "transparent");
  if (!painted.length) return false;
  const light = painted.filter(isLightFill);
  return light.length * 2 >= painted.length;
}

export function resolveLogoUrl(src: string, domain: string): string | null {
  try {
    const abs = src.startsWith("http") ? src : new URL(src, `https://${domain}/`).toString();
    return isUsableLogo(abs) ? abs : null;
  } catch {
    return null;
  }
}

function ogImageFromMeta(html: string, base: string): string | null {
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  ) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!og?.[1]) return null;
  return absolutize(og[1], base);
}

function appleTouchIcon(html: string, base: string): string | null {
  const apple = html.match(
    /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi
  );
  if (!apple) return null;
  let best: { href: string; size: number } | null = null;
  for (const tag of apple) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const size = Number(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? 180);
    if (!best || size > best.size) best = { href, size };
  }
  return best ? absolutize(best.href, base) : null;
}

/** (a) og:image · apple-touch-icon — kept for callers; extraction ranks these lower than real marks. */
export function logoFromMeta(html: string, base: string): string | null {
  const apple = appleTouchIcon(html, base);
  if (apple && isUsableLogo(apple)) return apple;
  const og = ogImageFromMeta(html, base);
  if (og && /logo|icon|mark|brand|favicon/i.test(og) && isUsableLogo(og)) return og;
  return null;
}

type LogoCandidate = { url: string; source: NonNullable<ExtractedBrand["logoSource"]> };

function scoreLogo({ url, source }: LogoCandidate): number {
  let score = 0;
  if (source === "logo-img") score += 50;
  if (source === "svg") score += 40;
  if (source === "meta") score += 15;
  if (source === "icon") score += 10;
  if (/\/icon\.svg|\/logo\.(?:svg|png)/i.test(url)) score += 35;
  if (/\.svg(\?|$)/i.test(url)) score += 25;
  if (/logo/i.test(url)) score += 20;
  if (/favicon/i.test(url)) score -= 15;
  if (isOgCardUrl(url)) score -= 80;
  return score;
}

function pickBestLogo(candidates: LogoCandidate[]): LogoCandidate | null {
  let best: { cand: LogoCandidate; score: number } | null = null;
  for (const cand of candidates) {
    if (!isUsableLogo(cand.url)) continue;
    const score = scoreLogo(cand);
    if (!best || score > best.score) best = { cand, score };
  }
  return best?.cand ?? null;
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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Product-card photos (Shopify "Custom Logo Tumbler") are not the brand mark. */
function isProductShot(src: string, alt: string, cls: string): boolean {
  if (/card__media|product-card|media--hover|product__media/i.test(cls)) return true;
  if (/\b(?:custom|personalized|engraved)\s+logo\b/i.test(alt)) return true;
  if (/\b(?:tumbler|keychain|mousepad|water bottle|corporate gifts?)\b/i.test(alt)) return true;
  if (/\/(?:IMG_|DSC[_-]?|GFT|LWB|FSK)\d/i.test(src)) return true;
  return false;
}

/** (d) logo candidates from header marks + <img> with logo/brand in src/alt/class. */
export function logoImgFromHtml(html: string, base: string): string | null {
  const headerHtml = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  let best: { src: string; score: number } | null = null;
  for (const tag of imgs) {
    const rawSrc = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!rawSrc) continue;
    const src = decodeEntities(rawSrc);
    const alt = decodeEntities(tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "");
    const cls = tag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
    const id = tag.match(/\bid=["']([^"']*)["']/i)?.[1] ?? "";
    const hay = `${src} ${alt} ${cls} ${id}`;
    const inHeader =
      headerHtml.includes(tag) ||
      /header__heading-logo|site-logo|navbar-brand|custom-logo|brand-logo/i.test(cls);
    if (isProductShot(src, alt, cls)) continue;
    if (!inHeader && !/logo|brandmark|brand-mark|wordmark/i.test(hay)) continue;
    let score = 0;
    if (inHeader) score += 20;
    if (/header__heading-logo|site-logo|navbar-brand|header__logo/i.test(cls)) score += 20;
    if (/logo/i.test(src)) score += 8;
    if (/logo/i.test(alt) && !/\b(?:custom|personalized)\s+logo\b/i.test(alt)) score += 6;
    if (/\.svg/i.test(src)) score += 5;
    const abs = absolutize(src, base);
    if (!abs || !isUsableLogo(abs)) continue;
    if (!best || score > best.score) best = { src: abs, score };
  }
  return best?.src ?? null;
}

/** Lucide/Heroicons/currentColor marks are UI chrome, not a brand logo. */
function isDecorativeSvg(svg: string): boolean {
  if (/lucide|heroicon|feather|tabler-icon|font-awesome|iconify/i.test(svg)) return true;
  const hasPaintedFill = /fill=["']#(?:[0-9a-f]{3}|[0-9a-f]{6})["']/i.test(svg);
  if (/\bcurrentColor\b/i.test(svg) && !hasPaintedFill) return true;
  if (/width=["']24["']/i.test(svg) && /height=["']24["']/i.test(svg) && svg.length < 2_500) return true;
  return false;
}

/** (d) inline SVG inside header/nav — skip icon-font decorations. */
export function logoSvgFromHeader(html: string): string | null {
  const headerNav =
    html.match(/<header\b[\s\S]*?<\/header>/i) ?? html.match(/<nav\b[\s\S]*?<\/nav>/i);
  if (!headerNav) return null;
  const svgs = headerNav[0].match(/<svg\b[\s\S]*?<\/svg>/gi) ?? [];
  for (const svg of svgs) {
    if (svg.length > 60_000 || isDecorativeSvg(svg)) continue;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
  return null;
}

/** Next.js /icon.svg and classic favicon.ico probes. */
export async function faviconIcoProbe(origin: string): Promise<string | null> {
  for (const path of ["/icon.svg", "/logo.svg", "/apple-touch-icon.png", "/favicon.ico"]) {
    const url = `${origin}${path}`;
    try {
      const res = await fetchWithTimeout(url, 4_000);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("text/html")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 80) return url;
    } catch {
      /* try the next well-known path */
    }
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

function clientRedirectUrl(html: string, base: string): string | null {
  const loc =
    html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'>;]+)/i);
  if (!loc?.[1]) return null;
  return absolutize(loc[1].trim(), base);
}

function isParkingShell(html: string): boolean {
  return /lander_type\s*=\s*["']?parkweb|LANDER_SYSTEM|parking-lander|wsimg\.com\/parking/i.test(html);
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
  let pageUrl = target;
  try {
    const res = await fetchWithTimeout(target);
    if (res.ok) html = (await res.text()).slice(0, 1_500_000);
  } catch {
    /* fall through — later stages may still probe favicon */
  }

  // JS/meta bounce (e.g. tracksync.com → /lander). Follow once.
  const bounce = html ? clientRedirectUrl(html, pageUrl) : null;
  if (bounce && bounce !== pageUrl) {
    try {
      const res = await fetchWithTimeout(bounce);
      if (res.ok) {
        html = (await res.text()).slice(0, 1_500_000);
        pageUrl = bounce;
      }
    } catch {
      /* keep the first body */
    }
  }

  // GoDaddy/parking shells have no brand — don't treat their empty favicon as a logo.
  if (isParkingShell(html)) {
    return EMPTY;
  }

  if (!html) {
    // site unreadable: favicon probe is the only thing left
    const favicon = await faviconIcoProbe(origin);
    if (favicon) return { ...EMPTY, logoUrl: favicon, logoSource: "icon" };
    return EMPTY;
  }

  const base = pageUrl;
  const result: ExtractedBrand = { ...EMPTY };
  const candidates: LogoCandidate[] = [];
  const add = (url: string | null, source: LogoCandidate["source"]) => {
    if (url) candidates.push({ url, source });
  };

  /* Real marks first — og:image/favicon used to win and paint a 1200×628
     social card (or a 32px favicon) into the 36px header. */
  add(logoImgFromHtml(html, base), "logo-img");
  add(logoSvgFromHeader(html), "svg");
  add(appleTouchIcon(html, base), "meta");
  add(faviconFromLinks(html, base), "icon");
  const og = ogImageFromMeta(html, base);
  if (og && /logo|icon|mark|brand|favicon/i.test(og)) add(og, "meta");

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

  let best = pickBestLogo(candidates);
  if (!best) {
    const favicon = await faviconIcoProbe(origin);
    if (favicon) best = { url: favicon, source: "icon" };
  }
  if (best) {
    result.logoUrl = best.url;
    result.logoSource = best.source;
    result.logoOnDark = logoUrlLooksLight(best.url) || (await svgIsLightMark(best.url));
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
