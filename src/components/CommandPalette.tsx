"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchDeal {
  id: number;
  label: string;
  subtitle: string | null;
  flagged: boolean;
}

interface SearchProperty {
  id: number;
  label: string;
  subtitle: string | null;
}

type ResultType = "deal" | "property" | "album";

interface ResultItem {
  key: string;
  type: ResultType;
  label: string;
  subtitle: string | null;
  href: string;
  dealId?: number;
  flagged?: boolean;
}

const MAX_PER_TYPE = 8;

const GROUP_LABELS: Record<ResultType, string> = {
  deal: "Deals",
  property: "Properties",
  album: "Photo albums",
};

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [deals, setDeals] = useState<SearchDeal[]>([]);
  const [properties, setProperties] = useState<SearchProperty[]>([]);
  const [albums, setAlbums] = useState<SearchProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Matches ⌘K and ⌘⇧K alike (Ctrl on Windows/Linux) — shiftKey is
      // deliberately not checked, since lowercasing e.key already collapses
      // the shifted "K" and unshifted "k" to the same match.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Resetting query/activeIndex when the palette opens is a plain state
  // adjustment (no real side effect), so it's done as a render-time
  // conditional rather than inside the fetch effect below.
  const [lastOpenProcessed, setLastOpenProcessed] = useState(false);
  if (open !== lastOpenProcessed) {
    setLastOpenProcessed(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setFlash(null);
    }
  }

  // Refetched on every open rather than cached — the index is cheap to
  // build server-side, and this keeps results from ever going stale after
  // a deal or property changes elsewhere in the app.
  useEffect(() => {
    if (!open) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/search");
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setDeals(data.deals ?? []);
        setProperties(data.properties ?? []);
        setAlbums(data.albums ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load search index");
      } finally {
        setLoading(false);
      }
    }
    load();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string, subtitle: string | null) =>
      !q || label.toLowerCase().includes(q) || (subtitle ?? "").toLowerCase().includes(q);

    const dealResults: ResultItem[] = deals
      .filter((d) => matches(d.label, d.subtitle))
      .slice(0, MAX_PER_TYPE)
      .map((d) => ({
        key: `deal-${d.id}`,
        type: "deal" as const,
        label: d.label,
        subtitle: d.subtitle,
        href: `/sales-board?deal=${d.id}`,
        dealId: d.id,
        flagged: d.flagged,
      }));

    const propertyResults: ResultItem[] = properties
      .filter((p) => matches(p.label, p.subtitle))
      .slice(0, MAX_PER_TYPE)
      .map((p) => ({
        key: `property-${p.id}`,
        type: "property",
        label: p.label,
        subtitle: p.subtitle,
        href: `/properties?property=${p.id}`,
      }));

    const albumResults: ResultItem[] = albums
      .filter((p) => matches(p.label, p.subtitle))
      .slice(0, MAX_PER_TYPE)
      .map((p) => ({
        key: `album-${p.id}`,
        type: "album",
        label: p.label,
        subtitle: p.subtitle,
        href: `/photos?property=${p.id}`,
      }));

    return [...dealResults, ...propertyResults, ...albumResults];
  }, [deals, properties, albums, query]);

  const [lastQueryProcessed, setLastQueryProcessed] = useState("");
  if (query !== lastQueryProcessed) {
    setLastQueryProcessed(query);
    setActiveIndex(0);
    setFlash(null);
  }

  function close() {
    setOpen(false);
  }

  function select(item: ResultItem) {
    close();
    router.push(item.href);
  }

  // Flag a deal as a loose end (⌘/Ctrl+Enter) without leaving the palette, so
  // you can flag several in a row. Only sets the flag on (never unflags here).
  async function flagDeal(item: ResultItem) {
    if (item.type !== "deal" || item.dealId == null) return;
    if (item.flagged) {
      setFlash(`"${item.label}" is already a loose end`);
      return;
    }
    const id = item.dealId;
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, flagged: true } : d)));
    setFlash(`🚩 Flagged "${item.label}" as a loose end`);
    try {
      const res = await fetch(`/api/sales-board/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged: true }),
      });
      if (!res.ok) throw new Error();
      // Tell any open Sales Board to update its list live (the palette is a
      // separate component, so it can't touch the board's state directly).
      window.dispatchEvent(new CustomEvent("voicedata:deal-flagged", { detail: { id, flagged: true } }));
    } catch {
      setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, flagged: false } : d)));
      setFlash(`Couldn't flag "${item.label}" — try again`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[activeIndex];
      if (!item) return;
      if ((e.metaKey || e.ctrlKey) && item.type === "deal") {
        flagDeal(item);
      } else {
        select(item);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (⌘K or ⌘⇧K)"
        aria-label="Search"
        className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-lg hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="shrink-0 text-zinc-400">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search deals, properties, and photo albums…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              <kbd className="hidden shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[0.65rem] text-zinc-400 sm:inline dark:border-zinc-700">
                Esc
              </kbd>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {loading && <div className="px-4 py-6 text-center text-sm text-zinc-400">Loading…</div>}
              {!loading && error && <div className="px-4 py-6 text-center text-sm text-red-500">{error}</div>}
              {!loading && !error && results.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-zinc-400">No matches</div>
              )}
              {!loading && !error && results.length > 0 && (
                <>
                  {results.map((item, i) => (
                    <div key={item.key}>
                      {(i === 0 || item.type !== results[i - 1].type) && (
                        <div className="px-4 pt-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-zinc-400">
                          {GROUP_LABELS[item.type]}
                        </div>
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => select(item)}
                        className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left ${
                          i === activeIndex ? "bg-zinc-100 dark:bg-zinc-800" : ""
                        }`}
                      >
                        <span className="text-sm text-zinc-900 dark:text-zinc-100">
                          {item.type === "deal" && item.flagged && (
                            <span title="Loose end" className="mr-1">
                              🚩
                            </span>
                          )}
                          {item.label}
                        </span>
                        {item.subtitle && <span className="text-xs text-zinc-500 dark:text-zinc-400">{item.subtitle}</span>}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-zinc-200 px-4 py-2 text-[0.7rem] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span className="truncate">
                {flash ??
                  (results[activeIndex]?.type === "deal"
                    ? "↵ open  ·  ⌘↵ flag as loose end"
                    : "↵ open")}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
