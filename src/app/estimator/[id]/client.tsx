"use client";

import dynamic from "next/dynamic";

// The estimator editor is client-only (dnd, canvas, browser APIs). SSR is
// disabled from the App component down; data comes from the estimator API.
const EstimatorApp = dynamic(() => import("@/components/estimator/EstimatorApp"), {
  ssr: false,
});

export function EstimatorEditorClient({ id }: { id: string }) {
  return <EstimatorApp estimateId={id} />;
}
