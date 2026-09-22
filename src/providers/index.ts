/**
 * Provider registry. Import providers from here, never from their own files,
 * so that swapping an implementation is a one-line change in one place.
 */
export { places } from "./places";
export { pagespeed } from "./pagespeed";
export { techdetect } from "./techdetect";
export { adlibrary } from "./adlibrary";
export { gbp } from "./gbp";
export { b2b } from "./b2b";
export { verify, isRoleAddress } from "./verify";
export { llm, resetLlmBudget, runLlmScope } from "./llm";
export { ghl, hubspot, crmFor } from "./crm";
export { email } from "./email";
export { benchmark } from "./benchmark";
export * from "./types";

import { places } from "./places";
import { pagespeed } from "./pagespeed";
import { techdetect } from "./techdetect";
import { adlibrary } from "./adlibrary";
import { gbp } from "./gbp";
import { b2b } from "./b2b";
import { verify } from "./verify";
import { llm } from "./llm";
import { ghl, hubspot } from "./crm";
import { email } from "./email";
import { benchmark } from "./benchmark";

/** What the ops dashboard shows: which half of each pair is actually running. */
export function providerStatus() {
  return [
    { slot: "Sourcing · local",     provider: places },
    { slot: "Sourcing · B2B",       provider: b2b },
    { slot: "Audit · performance",  provider: pagespeed },
    { slot: "Audit · tech profile", provider: techdetect },
    { slot: "Audit · ad activity",  provider: adlibrary },
    { slot: "Audit · GBP",          provider: gbp },
    { slot: "Verification",         provider: verify },
    { slot: "Personalization",      provider: llm },
    { slot: "CRM · GoHighLevel",    provider: ghl },
    { slot: "CRM · HubSpot",        provider: hubspot },
    { slot: "Email",                provider: email },
    { slot: "Benchmark",            provider: benchmark },
  ].map((r) => ({ slot: r.slot, name: r.provider.name, live: r.provider.live }));
}
