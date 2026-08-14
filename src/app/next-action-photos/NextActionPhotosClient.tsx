"use client";

import Link from "next/link";
import { useState } from "react";

// One property's ⚡ next-action photo, pre-resolved server-side into plain
// serializable fields (url + the next-action task text) so this client
// component only handles presentation and the view toggles.
export type NextActionCard = {
  propertyId: number;
  label: string;
  url: string | null;
  caption: string | null;
  nextAction: string | null;
};

export function NextActionPhotosClient({ cards }: { cards: NextActionCard[] }) {
  const [bigTiles, setBigTiles] = useState(false);
  const [showActionText, setShowActionText] = useState(false);

  // "Larger" drops the column count one step per breakpoint, so tiles render
  // roughly 50% bigger — matching the Master Catalog / Plant Reference toggle.
  const grid = bigTiles
    ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Next Action Photos</h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {cards.length} {cards.length === 1 ? "property" : "properties"}
          </span>
        </div>
        {cards.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowActionText((v) => !v)}
              aria-pressed={showActionText}
              title="Overlay the next action on each photo"
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                showActionText
                  ? "border-transparent bg-[#4C82F7] text-white hover:bg-[#3f6fd6]"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {showActionText ? "⚡ Text on" : "⚡ Text off"}
            </button>
            <button
              onClick={() => setBigTiles((v) => !v)}
              aria-pressed={bigTiles}
              title={bigTiles ? "Smaller tiles" : "Larger tiles"}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {bigTiles ? "⊟ Smaller" : "⊞ Larger"}
            </button>
          </div>
        )}
      </div>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No next-action photos yet. In the{" "}
          <Link href="/photos" className="underline">
            Photos
          </Link>{" "}
          gallery, tap the ⚡ on a photo to mark it as a property&apos;s next-action photo.
        </p>
      ) : (
        <div className={grid}>
          {cards.map((card) => (
            <Link
              key={card.propertyId}
              href={`/photos?property=${card.propertyId}`}
              className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              title={`${card.label} — view in gallery`}
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                {card.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.url}
                    alt={card.caption ?? card.label}
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl">🖼</span>
                )}
                {showActionText && card.nextAction && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/45 to-transparent pb-8 pl-11 pr-3 pt-2">
                    <p className="line-clamp-3 text-sm font-medium leading-snug text-white drop-shadow-sm">
                      {card.nextAction}
                    </p>
                  </div>
                )}
                <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#4C82F7] text-xs text-white shadow">
                  ⚡
                </span>
              </div>
              <div className="truncate px-3 py-2 text-sm font-medium text-zinc-800 dark:text-zinc-200" title={card.label}>
                {card.label}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
