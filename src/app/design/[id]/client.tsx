"use client";

import dynamic from "next/dynamic";

// The design editor is client-only (Konva canvas, clipboard, and other browser
// APIs). SSR is disabled from the App component down; the project loads from the
// design API and autosaves back to Supabase.
const DesignApp = dynamic(() => import("@/components/design/DesignApp"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 min-h-0 items-center justify-center text-sm text-zinc-400">
      Loading design studio…
    </div>
  ),
});

export function DesignEditorClient({ id }: { id: string }) {
  return <DesignApp projectId={id} />;
}
