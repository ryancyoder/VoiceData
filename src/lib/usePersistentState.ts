import { useEffect, useRef, useState } from "react";

// A useState that remembers its value in localStorage under `key`, so a chosen
// view/filter persists across reloads until the user changes it. SSR-safe: the
// first render uses `initial` (matching the server), then the stored value is
// loaded on mount. Defaults are never written back — storage only changes once
// the value actually changes — so a stored choice is never clobbered on load.
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);

  // Load the persisted value once, after mount (client only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      // Loading persisted state after mount is the SSR-safe pattern (the first
      // render must match the server); the setState here is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore malformed/unavailable storage */
    }
  }, [key]);

  // Persist on change, skipping the initial mount write.
  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
