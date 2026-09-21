"use client";

import { useState } from "react";
import OpsBoard from "./OpsBoard";

const KEY = "ops_token";

/**
 * Minimal client-side gate for the ops dashboard when OPS_TOKEN is set.
 * Token lives in sessionStorage and is sent as x-ops-token with every poll.
 * When OPS_TOKEN is unset the page renders OpsBoard directly (demo default).
 */
export default function OpsGate() {
  const [token, setToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem(KEY) : null
  );
  const [state, setState] = useState<"idle" | "checking" | "ok" | "bad">(
    token ? "checking" : "idle"
  );

  if (state === "ok") return <OpsBoard token={token ?? ""} />;

  if (state === "checking") {
    return (
      <Verify
        token={token ?? ""}
        onOk={() => setState("ok")}
        onBad={() => {
          sessionStorage.removeItem(KEY);
          setToken(null);
          setState("bad");
        }}
      />
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get("token")?.toString().trim() ?? "";
    if (!v) return;
    sessionStorage.setItem(KEY, v);
    setToken(v);
    setState("checking");
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-10 max-w-sm rounded-board border border-line bg-surface p-6"
    >
      <h1 className="text-lg font-bold text-ink">Ops access</h1>
      <p className="mt-1 text-sm text-ink-40">
        Enter the ops token to view the dashboard.
      </p>
      <input
        name="token"
        type="password"
        autoFocus
        className="mt-4 w-full rounded-board border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-blue"
        placeholder="ops token"
      />
      {state === "bad" && (
        <p className="mt-2 text-xs text-crit">Invalid token. Try again.</p>
      )}
      <button
        type="submit"
        className="mt-3 w-full rounded-board bg-blue px-3 py-2 text-sm font-semibold text-white hover:bg-blue-deep"
      >
        Unlock
      </button>
    </form>
  );
}

/** Verify a stored token once against the guarded feed; otherwise ungate. */
function Verify({ token, onOk, onBad }: { token: string; onOk: () => void; onBad: () => void }) {
  const [attempted, setAttempted] = useState(false);
  if (!attempted) {
    setAttempted(true);
    fetch("/api/providers", {
      headers: { "x-ops-token": token },
      cache: "no-store",
    }).then((r) => (r.ok ? onOk() : onBad()));
  }
  return <p className="text-sm text-ink-40">Checking token…</p>;
}
