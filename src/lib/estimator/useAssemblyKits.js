import { useState, useEffect } from 'react';

let idCounter = 0;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Phase 2 persistence: Supabase, via /api/estimator/kits. Local state is
// updated optimistically for a snappy UI; the matching request persists in
// the background (kits are low-stakes reference data, so a failed write logs
// rather than blocking the interaction).
// `source` mirrors useCatalog: 'legacy' reads /api/estimator/kits, 'master'
// reads /api/estimator/kits-v2 (assemblies from the normalized tables).
// Master is read-only — writes are local-only until the write path migrates.
export function useAssemblyKits(source = 'legacy') {
  const [kits, setKits] = useState([]);
  const readOnly = source === 'master';

  useEffect(() => {
    let active = true;
    const url = source === 'master' ? '/api/estimator/kits-v2' : '/api/estimator/kits';
    fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then(data => { if (active && Array.isArray(data.kits)) setKits(data.kits); })
      .catch(() => { /* start empty if kits can't be loaded */ });
    return () => { active = false; };
  }, [source]);

  const saveKit = (name, description, groupItems, { color, takeoffUnit } = {}) => {
    const kitItems = groupItems.map(item => {
      const base = {
        catalogId: item.catalogId,
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitPrice: item.unitPrice,
        notes: item.notes ?? '',
      };
      if (item.isAssembly) {
        base.isAssembly = true;
        base.takeoffUnit = item.takeoffUnit;
        base.coverageRate = item.coverageRate;
        if (item.roundTo != null) base.roundTo = item.roundTo;
        if (item.unitsPerLoad != null) {
          base.unitsPerLoad = item.unitsPerLoad;
          base.deliveryFee = item.deliveryFee ?? true;
        }
      }
      if (item.isWallAssembly) {
        base.isWallAssembly = true;
        base.pricePerFaceFt = item.pricePerFaceFt;
        base.pricePerLinearFt = item.pricePerLinearFt;
      }
      return base;
    });

    const kit = {
      id: `kit-${Date.now()}-${++idCounter}`,
      name,
      description: description ?? '',
      createdAt: new Date().toISOString(),
      color: color ?? null,
      takeoffUnit: takeoffUnit ?? null, // 'area' | 'linear' | null (either)
      items: kitItems,
    };
    setKits(prev => [...prev, kit]);
    if (!readOnly) {
      fetch('/api/estimator/kits', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(kit) })
        .catch(err => console.error('Failed to save kit', err));
    }
    return kit.id;
  };

  const removeKit = (id) => {
    setKits(prev => prev.filter(k => k.id !== id));
    if (!readOnly) {
      fetch(`/api/estimator/kits/${id}`, { method: 'DELETE' })
        .catch(err => console.error('Failed to delete kit', err));
    }
  };

  const updateKit = (id, changes) => {
    setKits(prev => prev.map(k => k.id === id ? { ...k, ...changes } : k));
    if (!readOnly) {
      fetch(`/api/estimator/kits/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(changes) })
        .catch(err => console.error('Failed to update kit', err));
    }
  };

  return { kits, saveKit, removeKit, updateKit };
}
