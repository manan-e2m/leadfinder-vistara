import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { readJson } from "@/lib/json";
import { DEFAULT_BRAND, themeFromBrand, type BrandTheme } from "@/lib/brandTheme";
import { generatedAvatarColor } from "@/lib/brand";
import type { BrandAssets } from "@/lib/types";
import { BrandProvider } from "@/components/BrandProvider";

/**
 * Server helper: load the extracted brand for a workspace (or the most
 * recent one) and wrap the page in the app-wide brand context. Every
 * page/layout that should carry the platform theme calls this once — the
 * CSS variables ride on <body> so header, buttons and chrome all follow.
 */
export async function loadBrandTheme(opts?: {
  workspaceId?: string | null;
  runId?: string | null;
}): Promise<BrandTheme> {
  // Session-scoped white-labeling (App. C, revised per product direction):
  // when the visitor has scanned their site this session, the `lf_ws` cookie
  // carries the workspace id and the ENTIRE app — home, confirm card, run,
  // results, audit — adopts the extracted brand. With no cookie, public
  // chrome stays on the default theme. Explicit runId (deep link to a shared result) always
  // wears that run's brand regardless of cookie.
  if (!opts?.workspaceId && !opts?.runId) {
    try {
      const jar = await cookies();
      const wsId = jar.get("lf_ws")?.value;
      if (wsId) return loadForWorkspace(wsId);
    } catch {
      // cookies() unavailable (e.g. prerender) — fall through to default theme
    }
    return { brand: DEFAULT_BRAND, initial: "L" };
  }
  return loadScoped(opts);
}

async function loadForWorkspace(workspaceId: string): Promise<BrandTheme> {
  return loadScoped({ workspaceId });
}

async function loadScoped(opts: {
  workspaceId?: string | null;
  runId?: string | null;
}): Promise<BrandTheme> {
  let brandJson: string | null = null;
  let domain = "";

  try {
    if (opts?.workspaceId) {
      const ws = await db.workspace.findUnique({
        where: { id: opts.workspaceId },
        select: { brandJson: true, domain: true },
      });
      brandJson = ws?.brandJson ?? null;
      domain = ws?.domain ?? "";
    } else if (opts?.runId) {
      const run = await db.run.findUnique({
        where: { id: opts.runId },
        select: { workspace: { select: { brandJson: true, domain: true } } },
      });
      brandJson = run?.workspace.brandJson ?? null;
      domain = run?.workspace.domain ?? "";
    } else {
      const latest = await db.workspace.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { brandJson: true, domain: true },
      });
      brandJson = latest?.brandJson ?? null;
      domain = latest?.domain ?? "";
    }
  } catch {
    // no DB yet / table empty — render with defaults, never crash chrome
  }

  const stored = readJson<Partial<BrandAssets>>(brandJson, {});
  const brand: BrandAssets = {
    ...DEFAULT_BRAND,
    ...stored,
  };
  // A generated brand must have a usable letter avatar colour even when a
  // stale row carried one without the new flag.
  if (brand.generated && !stored.primary) {
    brand.primary = generatedAvatarColor(brand.agencyName || domain);
  }

  return themeFromBrand(brand, domain);
}

/** Wrap children in the brand context (client provider) — server-safe. */
export function WithBrand({
  theme,
  children,
}: {
  theme: BrandTheme;
  children: React.ReactNode;
}) {
  return <BrandProvider theme={theme}>{children}</BrandProvider>;
}
