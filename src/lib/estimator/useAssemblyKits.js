import { useState, useEffect } from 'react';

const KITS_KEY = 'landscape-assembly-kits';

let idCounter = 0;

export function useAssemblyKits() {
  const [kits, setKits] = useState(() => {
    try {
      const saved = localStorage.getItem(KITS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(KITS_KEY, JSON.stringify(kits)); } catch {}
  }, [kits]);

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
