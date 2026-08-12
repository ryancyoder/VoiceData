import { useState, useEffect } from 'react';
import { CANONICAL_STAGES, stageLabel } from './stages';

// Loads the canonical production-phase sequence from the DB so the estimator's
// phase picker and by-phase breakdown share one source of truth with the master
// catalog. Falls back to the bundled sequence if the fetch fails. Returns
// stageOptions: [{ name, label }] in sequence order.
export function usePhases() {
  const [names, setNames] = useState(CANONICAL_STAGES);

  useEffect(() => {
    let active = true;
    fetch('/api/estimator/phases')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then((d) => {
        if (active && Array.isArray(d.phases) && d.phases.length) setNames(d.phases.map((p) => p.name));
      })
      .catch(() => { /* keep the bundled fallback */ });
    return () => { active = false; };
  }, []);

  const stageOptions = names.map((name) => ({ name, label: stageLabel(name) }));
  return { stageOptions };
}
