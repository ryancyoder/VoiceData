"use client";

import { useEffect, useState } from "react";

// localStorage mirror of the server-side Tile mode flag, so the launcher and
// nav can react instantly on load without waiting for a round trip. The server
// setting (app_settings) stays the source of truth across devices; this is just
// a fast local cache, refreshed from the server on every mount.
export const TILE_MODE_LS_KEY = "app.tileMode";
// Fired (with detail {on}) whenever Tile mode is toggled, so already-mounted
// components update live instead of only on their next load.
export const TILE_MODE_EVENT = "voicedata:tile-mode";

function readLocal(): boolean {
  try {
    return window.localStorage.getItem(TILE_MODE_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocal(on: boolean) {
  try {
    if (on) window.localStorage.setItem(TILE_MODE_LS_KEY, "1");
    else window.localStorage.removeItem(TILE_MODE_LS_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

// Persist Tile mode to the server, update the local mirror, and announce it so
// open components react live. Returns the server's confirmed value (or throws).
export async function saveTileMode(on: boolean): Promise<boolean> {
  const res = await fetch("/api/settings/tile-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tileMode: on }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't save");
  const confirmed = !!data.tileMode;
  writeLocal(confirmed);
  window.dispatchEvent(new CustomEvent(TILE_MODE_EVENT, { detail: { on: confirmed } }));
  return confirmed;
}

// Reads Tile mode: the local mirror first (instant, SSR-safe — starts false to
// match the server render), then reconciles with the server on mount. `loaded`
// flips true once the server value is known, so callers can avoid flashing the
// wrong surface before the real value arrives.
export function useTileMode(): { tileMode: boolean; loaded: boolean } {
  const [tileMode, setTileMode] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Local mirror is instant; adopt it before the network answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTileMode(readLocal());

    let active = true;
    fetch("/api/settings/tile-mode")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const on = !!d.tileMode;
        writeLocal(on);
        setTileMode(on);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });

    function onEvent(e: Event) {
      const detail = (e as CustomEvent<{ on: boolean }>).detail;
      if (detail) setTileMode(detail.on);
    }
    window.addEventListener(TILE_MODE_EVENT, onEvent);
    return () => {
      active = false;
      window.removeEventListener(TILE_MODE_EVENT, onEvent);
    };
  }, []);

  return { tileMode, loaded };
}
