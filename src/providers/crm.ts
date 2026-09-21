import { env, useLive } from "@/lib/env";
import type { CrmProvider, CrmContact } from "./types";
import { log } from "@/lib/logger";

/**
 * GoHighLevel first — E2M's own event forms run on LeadConnector and GHL
 * adoption among the agencies in this room is high. HubSpot second. CSV
 * always, and never dependent on either integration working. Plan §11.1
 *
 * Both adapters retry once, then the caller falls back to CSV with import
 * instructions rather than showing an error. App. C
 */

function mockOf(provider: string): CrmProvider {
  return {
    name: `crm/${provider}-mock`,
    live: false,
    async push(contacts) {
      log("info", "crm", `[mock ${provider}] would push ${contacts.length} contacts`);
      return { ok: true, count: contacts.length };
    },
  };
}

const ghlLive: CrmProvider = {
  name: "crm/ghl",
  live: true,
  async push(contacts) {
    let count = 0;
    for (const c of contacts) {
      const body = {
        locationId: env.keys.ghlLocation,
        name: c.name,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        website: c.website ?? undefined,
        city: c.city ?? undefined,
        tags: c.tags,
        customFields: Object.entries(c.customFields).map(([key, field_value]) => ({ key, field_value })),
      };
      const attempt = async () =>
        fetch("https://services.leadconnectorhq.com/contacts/", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.keys.ghl}`,
            "Content-Type": "application/json",
            Version: "2021-07-28",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      try {
        let res = await attempt();
        if (!res.ok) res = await attempt();          // retry once
        if (res.ok) count++;
        else return { ok: false, count, error: `GoHighLevel returned ${res.status}` };
      } catch (e) {
        return { ok: false, count, error: (e as Error).message };
      }
    }
    return { ok: true, count };
  },
};

const hubspotLive: CrmProvider = {
  name: "crm/hubspot",
  live: true,
  async push(contacts) {
    const inputs = contacts.map((c) => ({
      properties: {
        firstname: c.name,
        phone: c.phone ?? "",
        email: c.email ?? "",
        website: c.website ?? "",
        city: c.city ?? "",
        hs_lead_status: "NEW",
        ...c.customFields,
      },
    }));
    try {
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.keys.hubspot}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, count: 0, error: `HubSpot returned ${res.status}` };
      return { ok: true, count: inputs.length };
    } catch (e) {
      return { ok: false, count: 0, error: (e as Error).message };
    }
  },
};

export const ghl: CrmProvider = useLive(env.keys.ghl) ? ghlLive : mockOf("ghl");
export const hubspot: CrmProvider = useLive(env.keys.hubspot) ? hubspotLive : mockOf("hubspot");

export function crmFor(provider: string): CrmProvider | null {
  if (provider === "ghl") return ghl;
  if (provider === "hubspot") return hubspot;
  return null;
}
export type { CrmContact };
