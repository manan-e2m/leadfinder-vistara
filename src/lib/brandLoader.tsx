import { db } from "@/lib/db";
import { readJson } from "@/lib/json";
import { DEFAULT_BRAND, type BrandTheme } from "@/lib/brandTheme";
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
  // Public chrome (home, settings, ops) is ALWAYS E2M — the extracted brand
  // is the product wearing the client's clothes on results/audit surfaces,
  // not a stranger's logo on the front door. Default: E2M brand unless a
  // workspace context is passed explicitly.
  if (!opts?.workspaceId && !opts?.runId) {
    return { brand: DEFAULT_BRAND, initial: "E" };
  }
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

  const initial = (brand.agencyName || domain || "E")
    .split(".")[0]
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .find(Boolean)?.[0]
    ?.toUpperCase() ?? "E";

  return { brand, initial };
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
