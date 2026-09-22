import Progress from "@/components/Progress";
import { Wordmark } from "@/components/ui";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-board items-center justify-between px-6 py-3.5">
          <Wordmark />
        </div>
      </header>
      <div className="mx-auto max-w-board px-6 py-14">
        <Progress runId={runId} />
      </div>
    </main>
  );
}
