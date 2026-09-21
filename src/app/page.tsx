import Link from "next/link";
import ScanFlow from "@/components/ScanFlow";
import { Wordmark } from "@/components/ui";

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-board items-center justify-between px-6 py-3.5">
          <Wordmark subtitle="Vistara 2027" />
          <div className="flex items-center gap-4">
            <span className="hidden text-xs font-medium text-ink-40 sm:inline">
              White label services. Black label standard.
            </span>
            <Link href="/ops" className="text-xs font-semibold text-ink-60 hover:text-ink">
              Ops
            </Link>
          </div>
        </div>
      </header>

      <div className="e2m-hero-glow">
        <div className="mx-auto max-w-board px-6 pb-16 pt-14">
          <div className="mx-auto mb-9 max-w-2xl text-center">
            <span className="animate-pop inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-blue-deep shadow-sm">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-orange" />
              Instant ICP-to-prospect engine for agencies
            </span>
            <h1 className="mt-5 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              {["Your", "agency", "just", "got"].map((w, i) => (
                <span key={i} className="animate-word mr-[0.28em]" style={{ ["--i" as string]: i }}>
                  {w}
                </span>
              ))}
              <br className="hidden sm:block" />
              <span className="animate-word mr-[0.28em]" style={{ ["--i" as string]: 4 }}>a</span>
              <span className="animate-word text-blue" style={{ ["--i" as string]: 5 }}>
                20-lead shortlist
              </span>
              <span className="animate-word" style={{ ["--i" as string]: 6 }}>.</span>
            </h1>
            <p className="animate-rise mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-60" style={{ animationDelay: "0.5s" }}>
              Enter your website. We read your footprint across six sources, then return verified,
              scored, ready-to-contact prospects — each with a named gap and the number that proves it.
            </p>
          </div>

          <ScanFlow />

          <div className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-3">
            {[
              { n: "01", t: "Verified, not scraped", d: "Every phone, email and business status is checked before a lead reaches your screen. Twelve real beats fifty with six bad numbers." },
              { n: "02", t: "Scored on the arithmetic", d: "Fit × Pain × Ability to pay × Reachability — every component shown, never hidden behind one number." },
              { n: "03", t: "A gap, with proof", d: "Not a company record. A company plus a named gap plus the measurement — and the E2M service that fixes it." },
            ].map((c, i) => (
              <div
                key={c.n}
                className="lift animate-stagger rounded-board border border-line bg-surface p-5"
                style={{ ["--i" as string]: i + 2 }}
              >
                <span className="font-mono text-xs font-bold text-blue">{c.n}</span>
                <h3 className="mt-2 text-[15px] font-bold text-ink">{c.t}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-60">{c.d}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-xs text-ink-40">
            No signup to see results · We draft the outreach, you decide what to send
          </p>
        </div>
      </div>
    </main>
  );
}
