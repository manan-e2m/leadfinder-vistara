import type { AuditFamily } from "@/lib/types";
import type { AuditFn } from "./context";
import { auditWeb } from "./web";
import { auditSeo } from "./seo";
import { auditEcommerce } from "./ecommerce";
import { auditPpc } from "./ppc";
import { auditContent } from "./content";
import { auditAiIntake } from "./ai-intake";

export const AUDITS: Record<AuditFamily, AuditFn> = {
  web: auditWeb,
  seo: auditSeo,
  ecommerce: auditEcommerce,
  ppc: auditPpc,
  content: auditContent,
  ai: auditAiIntake,
};

export * from "./context";
