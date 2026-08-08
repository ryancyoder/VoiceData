"use client";

import dynamic from "next/dynamic";

// The design editor is client-only (Konva canvas, IndexedDB, clipboard, and
// other browser APIs). SSR is disabled from the App component down. Phase 1
// still persists to IndexedDB — the Supabase-backed store lands in later phases.
const DesignApp = dynamic(() => import("@/components/design/DesignApp"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 min-h-0 items-center justify-center text-sm text-zinc-400">
      Loading design studio…
    </div>
  ),
});

export function DesignClient() {
  return <DesignApp />;
}
