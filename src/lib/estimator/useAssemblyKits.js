import { useState, useEffect } from 'react';

let idCounter = 0;

// Assembly kits, read from the master catalog (assemblies) via
// /api/estimator/kits-v2. The estimator is a read-only consumer: kit/assembly
// authoring lives on the /master-catalog page. saveKit/removeKit/updateKit
// therefore only mutate the in-session list (e.g. "save this group as a kit"
// for reuse within the open estimate) — they do not persist.
export function useAssemblyKits() {
  const [kits, setKits] = useState([]);

  useEffect(() => {
    let active = true;
    fetch('/api/estimator/kits-v2')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then(data => { if (active && Array.isArray(data.kits)) setKits(data.kits); })
      .catch(() => { /* start empty if kits can't be loaded */ });
    return () => { active = false; };
  }, []);

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
    return kit.id;
  };

  const removeKit = (id) => {
    setKits(prev => prev.filter(k => k.id !== id));
  };

  const updateKit = (id, changes) => {
    setKits(prev => prev.map(k => k.id === id ? { ...k, ...changes } : k));
  };

  return { kits, saveKit, removeKit, updateKit };
}
