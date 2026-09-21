"use client";

import { useState } from "react";
import clsx from "clsx";
import type { RunView, LeadView } from "@/lib/results";
import { Chip, ScoreBreakdown, ScoreRing, SEVERITY, FAMILY_LABEL } from "./ui";

/**
 * Per-lead action state. Every mutating button (CRM push, scope email) keeps
 * its own idle/pushing/done/error state keyed by lead id, with a
 * double-click guard — a second click while a request is in flight is a
 * no-op, and failure renders a message the agency owner can act on.
 */
type LeadActionState = {
  state: "idle" | "pushing" | "done" | "error";
  msg?: string;
};

const CRM_LABEL: Record<string, string> = { ghl: "GoHighLevel", hubspot: "HubSpot" };

export default function LeadList({ view }: { view: RunView }) {
  const [expanded, setExpanded] = useState<string | null>(view.leads[0]?.id ?? null);
  const [crm, setCrm] = useState<LeadActionState>({ state: "idle" });
  /** per-lead push state, keyed `leadId:provider` */
  const [perLead, setPerLead] = useState<Record<string, LeadActionState>>({});
  const [shared, setShared] = useState<string | null>(null);

  function guard(state: LeadActionState): boolean {
    // double-click guard: ignore presses while a request is in flight
    return state.state !== "pushing";
  }

  async function pushAll(provider: string) {
    if (!guard(crm)) return;
    setCrm({ state: "pushing" });
    await runPush(provider, null, (s) => setCrm(s));
  }

  async function pushOne(leadId: string, provider: string) {
    const key = `${leadId}:${provider}`;
    const cur = perLead[key] ?? { state: "idle" as const };
    if (!guard(cur)) return;
    setPerLead((p) => ({ ...p, [key]: { state: "pushing" } }));
    await runPush(provider, leadId, (s) => setPerLead((p) => ({ ...p, [key]: s })));
  }

  async function runPush(
    provider: string,
    leadId: string | null,
    set: (s: LeadActionState) => void
  ) {
    try {
      const res = await fetch(`/api/run/${view.runId}/crm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leadId ? { provider, leadId } : { provider }),
      });
      const data = await res.json();
      if (data.ok) {
        set({
          state: "done",
          msg: `Pushed ${data.count} to ${CRM_LABEL[provider] ?? provider}${data.live ? "" : " (mock)"}.`,
        });
      } else if (data.error === "crm_not_connected") {
        set({
          state: "error",
          msg: `Connect your ${CRM_LABEL[provider] ?? provider} CRM in settings first. The CSV export works without it.`,
        });
      } else {
        set({
          state: "error",
          msg: `Push failed. Use the CSV export instead. (${data.error ?? "error"})`,
        });
      }
    } catch {
      set({ state: "error", msg: "Network error — push didn't happen. Use the CSV export instead." });
    }
  }

  async function shareLink() {
    const url = `${window.location.origin}/results/${view.runId}`;
    const copied = await copyText(url);
    setShared(copied ? "Link copied — paste it anywhere" : url);
    if (copied) setTimeout(() => setShared(null), 2000);
  }

  return (
    <div>
      <div className="animate-rise sticky top-0 z-10 -mx-6 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-page/90 px-6 py-3 backdrop-blur">
        <p className="text-sm text-ink-60">
          <span className="font-semibold text-ink">{view.leads.length} prospects</span> ready to contact
        </p>
        <div className="flex items-center gap-2">
          {crm.msg && (
            <span className={clsx("max-w-xs text-xs", crm.state === "error" ? "text-crit" : "text-ink-60")}>
              {crm.msg}
            </span>
          )}
          <a
            href={`/api/run/${view.runId}/export`}
            className="press rounded-board border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-80 hover:border-blue"
          >
            Export CSV
          </a>
          <button
            onClick={shareLink}
            className="press rounded-board border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-80 hover:border-blue"
          >
            {shared ?? "Share link"}
          </button>
          <button
            onClick={() => pushAll("ghl")}
            disabled={crm.state === "pushing"}
            className="press rounded-board bg-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-deep disabled:opacity-50"
          >
            {crm.state === "pushing" ? "Pushing…" : "Push all to GoHighLevel"}
          </button>
          <button
            onClick={() => pushAll("hubspot")}
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
            ghl={perLead[`${l.id}:ghl`] ?? { state: "idle" }}
            hubspot={perLead[`${l.id}:hubspot`] ?? { state: "idle" }}
            doToggle={() => setExpanded(expanded === l.id ? null : l.id)}
            onPush={pushOne}
          />
        ))}
      </ul>
    </div>
  );
}

const ACTION_MSG: Record<string, string> = {
  pushing: "Pushing…",
  done: "Pushed ✓",
};

function CrmOneButton({
  provider,
  state,
  onPush,
  leadId,
  solid,
}: {
  provider: string;
  state: LeadActionState;
  onPush: (leadId: string, provider: string) => void;
  leadId: string;
  solid?: boolean;
}) {
  const label = CRM_LABEL[provider] ?? provider;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPush(leadId, provider);
        }}
        disabled={state.state === "pushing"}
        className={clsx(
          "press rounded-board px-3 py-2 text-xs font-semibold disabled:opacity-50",
          solid
            ? "bg-agency text-white hover:opacity-90"
            : "border border-line-strong bg-surface text-ink-80 hover:border-blue"
        )}
      >
        {state.state === "pushing" ? "Pushing…" : state.state === "done" ? "In CRM ✓" : label}
      </button>
      {state.state === "error" && state.msg && <span className="text-[11px] text-crit">{state.msg}</span>}
    </div>
  );
}

function LeadCard({
  lead,
  index,
  open,
  doToggle,
  ghl,
  hubspot,
  onPush,
}: {
  lead: LeadView;
  index: number;
  open: boolean;
  doToggle: () => void;
  ghl: LeadActionState;
  hubspot: LeadActionState;
  onPush: (leadId: string, provider: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copyRow() {
    const line = [
      lead.business.name,
      lead.business.phone ?? "",
      lead.business.website ?? "",
      lead.headlineGap,
      lead.openers.phone?.body ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    const ok = await copyText(line);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <li
      className={clsx(
        "animate-stagger overflow-hidden rounded-board border bg-surface shadow-board transition",
        open ? "border-blue/40 shadow-lift" : "border-line lift"
      )}
      style={{ ["--i" as string]: Math.min(index, 12) }}
    >
      <div className="flex items-stretch">
        <button onClick={doToggle} className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5 text-left">
          <span className="w-6 shrink-0 text-center font-mono text-sm text-ink-40">{lead.rank}</span>
          <ScoreRing score={lead.score} index={Math.min(index, 12)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-bold text-ink">{lead.business.name}</span>
              <Chip tone="blue">{lead.tagLabel}</Chip>
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
      </div>

      {open && (
        <div className="animate-fade border-t border-line bg-page px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            {lead.business.phone && (
              <span className="rounded-board border border-line bg-surface px-3 py-1.5 font-mono text-sm text-ink">
                {lead.business.phone}
              </span>
            )}
            {lead.business.website && (
              <a
                href={`https://${lead.business.website}`}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-xs text-blue hover:text-blue-deep"
              >
                {lead.business.website} ↗
              </a>
            )}
            {/* Quick-steal copy lives here, next to the opener copy blocks, so
                the collapsible card face stays clean (score/name/tier only).
                It bundles name+phone+site+gap+phone opener for booth demos. */}
            <button
              onClick={copyRow}
              className="press rounded-board border border-line-strong bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink-60 hover:border-blue hover:text-blue"
              aria-label={`Copy ${lead.business.name}'s contact details`}
            >
              {copied ? "Copied ✓" : "Copy details"}
            </button>
            <div className="flex items-center gap-2">
              <CrmOneButton provider="ghl" leadId={lead.id} state={ghl} onPush={onPush} />
              <CrmOneButton provider="hubspot" leadId={lead.id} state={hubspot} onPush={onPush} />
            </div>
          </div>

          <div className="mt-3 rounded-board border border-line bg-surface p-3">
            <ScoreBreakdown breakdown={lead.breakdown} />
          </div>

          {lead.benchmark && (
            <p className="mt-3 rounded-board bg-blue-soft px-3 py-2 text-xs text-blue-deep">{lead.benchmark}</p>
          )}

          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-40">
            Findings ({lead.signals.length})
          </h4>
          <ul className="mt-2 space-y-1.5">
            {lead.signals.map((s, si) => {
              const sev = SEVERITY[s.severity] ?? SEVERITY.low;
              return (
                <li
                  key={s.key}
                  className="animate-slide-in flex items-start gap-2.5 rounded-board border border-line bg-surface px-3 py-2"
                  style={{ ["--i" as string]: si }}
                >
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
              <li className="text-xs text-ink-40">Audits are still catching up for this prospect; ranked on fit.</li>
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
    copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(which);
      setTimeout(() => setCopied(null), 1400);
    });
  }
  const templateNote = (origin: string) =>
    origin === "template" ? (
      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-warn">
        template opener — re-run personalize for custom
      </p>
    ) : null;
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
          {templateNote(lead.openers.email.origin)}
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
          {templateNote(lead.openers.phone.origin)}
        </div>
      )}
    </div>
  );
}

function ScopeButton({ leadId, auditToken }: { leadId: string; auditToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit() {
    if (!email.trim() || state === "sending") return; // double-click guard
    setState("sending");
    try {
      const res = await fetch("/api/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, contactEmail: email }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
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
      {state === "error" && (
        <span className="text-xs text-crit">
          Couldn&apos;t send. Check the address and try again.
        </span>
      )}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
