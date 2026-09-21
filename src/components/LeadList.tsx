"use client";

import { useState } from "react";
import clsx from "clsx";
import type { RunView, LeadView } from "@/lib/results";
import { Chip, ScoreBreakdown, ScorePill, SEVERITY, FAMILY_LABEL } from "./ui";

export default function LeadList({ view }: { view: RunView }) {
  const [expanded, setExpanded] = useState<string | null>(view.leads[0]?.id ?? null);
  const [crm, setCrm] = useState<{ state: "idle" | "pushing" | "done"; msg?: string }>({ state: "idle" });

  async function pushCrm(provider: string) {
    setCrm({ state: "pushing" });
    try {
      const res = await fetch(`/api/run/${view.runId}/crm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (data.ok) {
        setCrm({
          state: "done",
          msg: `Pushed ${data.count} to ${provider === "ghl" ? "GoHighLevel" : "HubSpot"}${data.live ? "" : " (mock)"}.`,
        });
      } else {
        setCrm({ state: "done", msg: `Push failed — use the CSV instead. (${data.error ?? "error"})` });
      }
    } catch {
      setCrm({ state: "done", msg: "Push failed — use the CSV instead." });
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-6 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-page/90 px-6 py-3 backdrop-blur">
        <p className="text-sm text-ink-60">
          <span className="font-semibold text-ink">{view.leads.length} prospects</span> ready to contact
        </p>
        <div className="flex items-center gap-2">
          {crm.msg && <span className="text-xs text-ink-60">{crm.msg}</span>}
          <a
            href={`/api/run/${view.runId}/export`}
            className="press rounded-board border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-80 hover:border-blue"
          >
            Export CSV
          </a>
          <button
            onClick={() => pushCrm("ghl")}
            disabled={crm.state === "pushing"}
            className="press rounded-board bg-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-deep disabled:opacity-50"
          >
            {crm.state === "pushing" ? "Pushing…" : "Push to GoHighLevel"}
          </button>
          <button
            onClick={() => pushCrm("hubspot")}
            disabled={crm.state === "pushing"}
            className="press rounded-board border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-80 hover:border-blue disabled:opacity-50"
          >
            HubSpot
          </button>
        </div>
      </div>

      <ul className="space-y-3">
        {view.leads.map((l, i) => (
          <LeadCard
            key={l.id}
            lead={l}
            index={i}
            open={expanded === l.id}
            onToggle={() => setExpanded(expanded === l.id ? null : l.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function LeadCard({ lead, index, open, onToggle }: { lead: LeadView; index: number; open: boolean; onToggle: () => void }) {
  return (
    <li
      className={clsx(
        "animate-stagger overflow-hidden rounded-board border bg-surface shadow-board transition",
        open ? "border-blue/40 shadow-lift" : "border-line lift"
      )}
      style={{ ["--i" as string]: Math.min(index, 12) }}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-4 px-4 py-3.5 text-left">
        <span className="w-6 shrink-0 text-center font-mono text-sm text-ink-40">{lead.rank}</span>
        <ScorePill score={lead.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-bold text-ink">{lead.business.name}</span>
            <Chip tone="blue">{lead.tagLabel}</Chip>
            {lead.degraded && <Chip tone="warn">template opener</Chip>}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-60">
            {[lead.business.city, lead.business.region].filter(Boolean).join(", ")}
            {lead.business.reviewCount != null && ` · ${lead.business.reviewCount} reviews`}
            {lead.business.rating != null && ` · ${lead.business.rating}★`}
          </p>
          <p className="mt-1 truncate text-xs text-ink-80">{lead.headlineGap}</p>
        </div>
        <span className={clsx("shrink-0 text-ink-40 transition", open && "rotate-180")}>▾</span>
      </button>

      {open && (
        <div className="animate-fade border-t border-line bg-page px-4 py-4">
          <div className="rounded-board border border-line bg-surface p-3">
            <ScoreBreakdown breakdown={lead.breakdown} />
          </div>

          {lead.benchmark && (
            <p className="mt-3 rounded-board bg-blue-soft px-3 py-2 text-xs text-blue-deep">{lead.benchmark}</p>
          )}

          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-40">
            Findings ({lead.signals.length})
          </h4>
          <ul className="mt-2 space-y-1.5">
            {lead.signals.map((s) => {
              const sev = SEVERITY[s.severity] ?? SEVERITY.low;
              return (
                <li key={s.key} className="flex items-start gap-2.5 rounded-board border border-line bg-surface px-3 py-2">
                  <span className={clsx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", sev.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{s.label}</span>
                      <Chip className="shrink-0">{FAMILY_LABEL[s.family] ?? s.family}</Chip>
                      {s.confidence < 0.6 && <Chip tone="warn">lower confidence</Chip>}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-ink-80">{s.measurement}</p>
                    <p className="mt-0.5 text-[11px] text-ink-40">
                      {s.source} · fixes with {s.service}
                    </p>
                  </div>
                </li>
              );
            })}
            {lead.signals.length === 0 && (
              <li className="text-xs text-ink-40">Audits are still catching up for this prospect — ranked on fit.</li>
            )}
          </ul>

          <Openers lead={lead} />
          <ScopeButton leadId={lead.id} auditToken={lead.auditToken} />
        </div>
      )}
    </li>
  );
}

function Openers({ lead }: { lead: LeadView }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, which: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1400);
    });
  }
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {lead.openers.email && (
        <div className="rounded-board border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-40">Email opener</span>
            <button onClick={() => copy(`${lead.openers.email!.subject}\n\n${lead.openers.email!.body}`, "email")} className="text-[11px] font-medium text-blue hover:text-blue-deep">
              {copied === "email" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-xs font-semibold text-ink">{lead.openers.email.subject}</p>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-80">{lead.openers.email.body}</p>
        </div>
      )}
      {lead.openers.phone && (
        <div className="rounded-board border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-40">Phone opener</span>
            <button onClick={() => copy(lead.openers.phone!.body, "phone")} className="text-[11px] font-medium text-blue hover:text-blue-deep">
              {copied === "phone" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-ink-80">{lead.openers.phone.body}</p>
        </div>
      )}
    </div>
  );
}

function ScopeButton({ leadId, auditToken }: { leadId: string; auditToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  async function submit() {
    if (!email.trim()) return;
    setState("sending");
    await fetch("/api/scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, contactEmail: email }),
    }).catch(() => {});
    setState("done");
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {auditToken && (
        <a
          href={`/audit/${auditToken}`}
          target="_blank"
          className="rounded-board border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-80 hover:border-blue"
        >
          View branded audit ↗
        </a>
      )}
      {!open && state === "idle" && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-board bg-agency px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          Have E2M scope this
        </button>
      )}
      {open && state !== "done" && (
        <div className="flex items-center gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@agency.com"
            className="rounded-board border border-line-strong bg-surface px-3 py-2 text-xs outline-none focus:border-agency"
          />
          <button
            onClick={submit}
            disabled={state === "sending"}
            className="rounded-board bg-agency px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : "Send"}
          </button>
        </div>
      )}
      {state === "done" && <span className="text-xs text-ok">Sent to the E2M partner team ✓</span>}
    </div>
  );
}
