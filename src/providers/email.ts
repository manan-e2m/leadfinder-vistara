import { env, useLive } from "@/lib/env";
import type { EmailProvider } from "./types";
import { log } from "@/lib/logger";

/**
 * The dashboard link is emailed and persists. This is the only outbound mail
 * the platform ever sends, and it goes to the attendee about their own
 * results — never to a prospect on the agency's behalf. Plan §5.7, §7.4
 */

const mock: EmailProvider = {
  name: "email/mock",
  live: false,
  async send({ to, subject }) {
    log("info", "email", `[mock] would send "${subject}" to ${to}`);
    return { ok: true };
  },
};

const live: EmailProvider = {
  name: "email/resend",
  live: true,
  async send({ to, subject, html }) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.keys.resend}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "E2M LeadFinder <leadfinder@e2msolutions.com>",
          to: [to],
          subject,
          html,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, error: `Resend returned ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

export const email: EmailProvider = useLive(env.keys.resend) ? live : mock;
