"use client";

import dynamic from "next/dynamic";

// The estimator is a client-only app: it reads/writes localStorage in its
// state initializers (Phase 1 persistence), so prerendering it on the server
// would risk a hydration mismatch for returning visitors. Disable SSR from
// the App component down. (Phase 2 moves persistence to Supabase.)
const EstimatorApp = dynamic(() => import("@/components/estimator/EstimatorApp"), {
  ssr: false,
});

export function EstimatorClient() {
  return <EstimatorApp />;
}
