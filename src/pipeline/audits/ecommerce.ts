import type { AuditFn } from "./context";
import type { DetectedSignal } from "@/lib/types";
import { SERVICE_BY_FAMILY } from "@/lib/types";

const SERVICE = SERVICE_BY_FAMILY.ecommerce;

/** Storefront audit: leaking revenue at checkout. Plan §5.4, App. B */
export const auditEcommerce: AuditFn = async (ctx) => {
  const out: DetectedSignal[] = [];
  const { tech } = ctx;
  if (!tech?.reachable || !tech.storefront) return out;

  const platform = tech.storefront[0].toUpperCase() + tech.storefront.slice(1);

  if (tech.checkoutLcpSeconds !== null && tech.checkoutLcpSeconds > 4) {
    out.push({
      key: "ecom.slow_checkout",
      label: "Checkout is slow on mobile",
      measurement: `Checkout step LCP ${tech.checkoutLcpSeconds} s on ${platform}`,
      source: "Checkout page load audit",
      severity: tech.checkoutLcpSeconds > 6 ? "high" : "med",
      confidence: 0.85,
      family: "ecommerce",
      service: SERVICE,
      pitch: "Store optimization",
    });
  }

  if (!tech.schema.product) {
    out.push({
      key: "ecom.no_product_schema",
      label: "No product structured data",
      measurement: tech.productCount
        ? `0 of ${tech.productCount} products carry Product or Offer schema · none eligible for rich results`
        : "No Product or Offer schema on any product template",
      source: "Structured data parse on product templates",
      severity: "high",
      confidence: 0.9,
      family: "ecommerce",
      service: SERVICE,
      pitch: "Store optimization",
    });
  }

  if (tech.reviewsApp === false) {
    out.push({
      key: "ecom.no_reviews_app",
      label: "No reviews app installed",
      measurement: "No review collection or display on any product page",
      source: "App and widget detection",
      severity: "med",
      confidence: 0.85,
      family: "ecommerce",
      service: SERVICE,
      pitch: "Store optimization",
    });
  }

  return out;
};
