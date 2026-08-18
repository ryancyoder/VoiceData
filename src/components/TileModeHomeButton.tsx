"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTileMode } from "@/lib/useTileMode";

// In Tile mode the top nav is hidden, so a sub-page (opened by tapping a
// non–Sales Board Launch Pad tile) would otherwise trap the user with only the
// browser back button. This floating button is the always-available way back to
// the Launch Pad. Hidden on the Launch Pad itself (home) and whenever Tile mode
// is off.
export default function TileModeHomeButton() {
  const pathname = usePathname();
  const { tileMode } = useTileMode();

  if (!tileMode || pathname === "/") return null;

  return (
    <Link
      href="/"
      title="Launch Pad"
      aria-label="Back to Launch Pad"
      className="fixed bottom-5 left-5 z-40 flex h-11 items-center gap-2 rounded-full border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-lg hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50"
    >
      <span aria-hidden="true" className="text-base leading-none">⊞</span>
      Launch Pad
    </Link>
  );
}
