import Link from "next/link";
import { env, useLive } from "@/lib/env";
import { providerStatus } from "@/providers";
import { Wordmark } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Read-only, harmless settings. Explains which providers are live vs mock so
 * an attendee understands why the demo shows fixture data, with zero cost
 * and zero mutatingsurface — GET only, no actions, no tokens.
 */
export default function SettingsPage() {
  const providers = providerStatus();
  const live = providers.filter((p) => p.live);
  const mock = providers.filter((p) => !p.live);

  const KEY_ROW: [string, () => boolean][] = [
    ["GoHighLevel", () => Boolean(env.keys.ghl && env.keys.ghlLocation)],
    ["HubSpot", () => Boolean(env.keys.hubspot)],
  ];

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-board items-center justify-between px-6 py-3.5">
          <Wordmark />
          <Link href="/" className="text-xs font-medium text-blue hover:text-blue-deep">
            Back to scan
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1.5 text-sm text-ink-60">
          Read-only status of this deployment. Nothing here needs configuring to run a demo.
        </p>

        <section className="mt-6 rounded-board border border-line bg-surface p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-40">Provider mode</h2>
          <p className="mt-2 text-[15px] font-bold text-ink capitalize">{env.providerMode}</p>
          {env.providerMode !== "live" && (
            <p className="mt-1.5 text-xs leading-relaxed text-ink-60">
              {env.providerMode === "mock"
                ? "All providers run on fixture data — every result on screen is a repeatable fixture, so the demo behaves identically every time. No API spend happens in this mode."
                : "Providers run live wherever an API key exists, and fall back to fixture data where it doesn't — that's why some results are labelled mock."}
            </p>
          )}
        </section>

        <section className="mt-4 rounded-board border border-line bg-surface p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-40">
            Live vs mock ({live.length} live / {mock.length} mock)
          </h2>
          <ul className="mt-3 space-y-1.5">
            {providers.map((p) => (
              <li key={p.slot} className="flex items-center justify-between text-sm">
                <span className="text-ink-80">{p.slot}</span>
                <span
                  className={
                    p.live
                      ? "rounded-chip bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok"
                      : "rounded-chip bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-40"
                  }
                >
                  {p.live ? "live" : "mock"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-board border border-line bg-surface p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-40">Integrations</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {KEY_ROW.map(([name, configured]) => (
              <li key={name} className="flex items-center justify-between">
                <span className="text-ink-80">{name} CRM</span>
                <span className={configured() ? "text-ok" : "text-warn"}>
                  {configured() ? "keys present" : "not connected — use CSV export"}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between">
              <span className="text-ink-80">LLM personalization</span>
              <span className={useLive(env.keys.anthropic) ? "text-ok" : "text-warn"}>
                {useLive(env.keys.anthropic) ? "live" : "template openers"}
              </span>
            </li>
          </ul>
        </section>

        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-board border border-line bg-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-40">Cost cap</h2>
            <p className="mt-2 font-mono text-[15px] font-bold text-ink">
              {env.costCapCents > 0 ? `${env.costCapCents}¢` : "off"}
            </p>
            <p className="mt-1 text-xs text-ink-60">
              {env.costCapCents > 0 ? "per run, hard ceiling. Audits skip when it hits." : "unlimited — spend is only tracked."}
            </p>
          </div>
          <div className="rounded-board border border-line bg-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-40">Rate limit</h2>
            <p className="mt-2 font-mono text-[15px] font-bold text-ink">
              {Number(process.env.SCAN_RATE_PER_MINUTE ?? 6)}/min
            </p>
            <p className="mt-1 text-xs text-ink-60">scans per IP, per minute.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
