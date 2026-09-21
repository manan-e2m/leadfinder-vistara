"use client";

import { useState } from "react";

/**
 * One-click copy of the audit share link for the person doing the sharing
 * (agency owner at the booth). Renders nothing server-side — pure client.
 */
export default function CopyAuditLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable; the URL is already visible on screen */
    }
  }
  return (
    <button
      onClick={copy}
      className="rounded-board border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink-60 hover:border-blue hover:text-blue"
    >
      {copied ? "Link copied ✓" : "Copy link"}
    </button>
  );
}
