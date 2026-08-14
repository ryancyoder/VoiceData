import Link from "next/link";
import AskClient from "./AskClient";

// Hybrid RAG chat over VoiceMap notes. The heavy lifting is in
// /api/voicemap/ask; this is just the shell.
export const dynamic = "force-dynamic";

export default function VoiceMapAskPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Ask your brain</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Answers grounded in your captured notes, with sources.
          </p>
        </div>
        <Link href="/voicemap/wiki" className="shrink-0 text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Wiki
        </Link>
      </header>
      <AskClient />
    </main>
  );
}
