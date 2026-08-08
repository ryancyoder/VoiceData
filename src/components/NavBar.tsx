"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/sales-board", label: "Sales Board" },
  { href: "/estimator", label: "Estimator" },
  { href: "/catalog", label: "Catalog" },
  { href: "/design", label: "Design" },
  { href: "/next-actions", label: "Next Actions" },
  { href: "/tasks", label: "Tasks" },
  { href: "/properties", label: "Properties" },
  { href: "/calendar", label: "Calendar" },
  { href: "/photos", label: "Photos" },
];

export default function NavBar() {
  const pathname = usePathname();

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
    </nav>
  );
}
