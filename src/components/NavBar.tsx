"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTileMode } from "@/lib/useTileMode";

const NAV_ITEMS = [
  { href: "/sales-board", label: "Sales Board" },
  { href: "/estimator", label: "Estimator" },
  { href: "/catalog", label: "Catalog" },
  { href: "/master-catalog", label: "Master Catalog" },
  { href: "/design", label: "Design" },
  { href: "/plants", label: "Plants" },
  { href: "/plant-reference", label: "Plant Reference" },
  { href: "/next-actions", label: "Next Actions" },
  { href: "/next-action-photos", label: "Action Photos" },
  { href: "/tasks", label: "Tasks" },
  { href: "/properties", label: "Properties" },
  { href: "/calendar", label: "Calendar" },
  { href: "/forecast", label: "Forecast" },
  { href: "/planner", label: "Planner" },
  { href: "/photos", label: "Photos" },
  { href: "/voicemap", label: "VoiceMap" },
  { href: "/settings", label: "Settings" },
];

export default function NavBar() {
  const pathname = usePathname();
  const { tileMode } = useTileMode();

  // Tile mode navigates entirely through the Launch Pad's tiles, so the top
  // nav is redundant — hide it. (The launcher's own back/breadcrumb and the
  // browser back button cover movement between screens.)
  if (tileMode) return null;

  return (
    <nav className="sticky top-0 z-30 flex items-center gap-3 overflow-x-auto border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:px-6 dark:border-zinc-800 dark:bg-zinc-950/95 dark:supports-[backdrop-filter]:bg-zinc-950/80">
      <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        VoiceData
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.href = "/login";
        }}
        className="ml-auto shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        Sign out
      </button>
    </nav>
  );
}
