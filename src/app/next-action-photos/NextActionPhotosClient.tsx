"use client";

import Link from "next/link";
import { useState } from "react";

// One deal's next action, pre-resolved server-side into plain serializable
// fields (the ⚡ photo url, if any, plus the next-action task text) so this
// client component only handles presentation and the view toggles. A card
// with url === null is a next action that has no photo yet.
export type NextActionCard = {
  dealId: number;
  propertyId: number | null;
  propertyLabel: string;
  dealName: string;
  url: string | null;
  caption: string | null;
  nextAction: string | null;
};

export function NextActionPhotosClient({ cards }: { cards: NextActionCard[] }) {
  const [bigTiles, setBigTiles] = useState(false);
  const [showActionText, setShowActionText] = useState(false);
  // Whether to also show next actions that have no photo yet, over blank
  // placeholder tiles. Off by default so the album stays photo-forward.
  const [showPhotoless, setShowPhotoless] = useState(false);

  const hasPhotoless = cards.some((c) => c.url == null);
  const visibleCards = showPhotoless ? cards : cards.filter((c) => c.url != null);

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
            {visibleCards.length} {visibleCards.length === 1 ? "deal" : "deals"}
          </span>
        </div>
        {cards.length > 0 && (
          <div className="flex items-center gap-2">
            {hasPhotoless && (
              <button
                onClick={() => setShowPhotoless((v) => !v)}
                aria-pressed={showPhotoless}
                title="Show next actions that have no photo yet"
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  showPhotoless
                    ? "border-transparent bg-[#4C82F7] text-white hover:bg-[#3f6fd6]"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {showPhotoless ? "🗒️ Text-only on" : "🗒️ Text-only off"}
              </button>
            )}
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
          No next actions yet. In the{" "}
          <Link href="/photos" className="underline">
            Photos
          </Link>{" "}
          gallery, tap the ⚡ on a photo to mark it as a deal&apos;s next-action photo.
        </p>
      ) : visibleCards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No next actions have a photo. Turn on{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">🗒️ Text-only</span> to see the ones without.
        </p>
      ) : (
        <div className={grid}>
          {visibleCards.map((card) => (
            <Link
              key={card.dealId}
              href={`/photos?deal=${card.dealId}`}
              className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              title={`${card.propertyLabel} — view in gallery`}
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                {card.url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.url}
                      alt={card.caption ?? card.propertyLabel}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
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
                  </>
                ) : (
                  // No photo yet: a blank placeholder tile carrying the next action text.
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
                    <span className="text-lg opacity-40" aria-hidden>
                      ⚡
                    </span>
                    <p className="line-clamp-4 text-sm font-medium leading-snug text-zinc-600 dark:text-zinc-300">
                      {card.nextAction ?? card.dealName}
                    </p>
                  </div>
                )}
              </div>
              <div className="px-3 py-2" title={`${card.propertyLabel} · ${card.dealName}`}>
                <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{card.propertyLabel}</div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{card.dealName}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
