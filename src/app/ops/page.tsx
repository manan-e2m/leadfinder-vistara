import Link from "next/link";
import OpsGate from '@/components/OpsGate';
import { Wordmark } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function OpsPage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-board items-center justify-between px-6 py-3.5">
          <Wordmark subtitle="Ops" />
          <Link href="/" className="text-xs font-medium text-ink-40 hover:text-ink">Back to scan</Link>
        </div>
      </header>
      <div className="mx-auto max-w-board px-6 py-8">
        <OpsGate />
      </div>
    </main>
  );
}
