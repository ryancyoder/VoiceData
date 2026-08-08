import { useState, useEffect } from 'react';
import defaultCatalog, { CATALOG_DELIVERY_RATE } from './catalog';

let idCounter = 0;

// Category-specific billing unit defaults for new items
const UNIT_OVERRIDES = {
  bulk_materials:     { unit: 'cu yd' },
  standard_materials: { unit: 'sq ft' },
  lawn:               { unit: 'sq ft' },
  edging:             { unit: 'ln ft' },
};

// Phase 1 persistence: browser localStorage. The bundled JSON is the seed
// the first time this runs (or if storage is empty/corrupt). Phase 2 moves
// this to Supabase (`catalog_items` / `estimator_settings`).
const CATALOG_KEY = 'landscape-catalog';

export function useCatalog() {
  const [items, setItems] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(CATALOG_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.items) && parsed.items.length) return parsed.items;
        }
      } catch { /* fall through to bundled defaults */ }
    }
    return defaultCatalog.map(item => ({ ...item }));
  });
  const [deliveryRate, setDeliveryRate] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(CATALOG_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.deliveryRate === 'number') return parsed.deliveryRate;
        }
      } catch { /* fall through */ }
    }
    return CATALOG_DELIVERY_RATE;
  });

  const updateItem = (id, field, value) => {
    setItems(prev =>
      prev.map(item => item.id === id ? { ...item, [field]: value } : item)
    );
  };

  const updateDeliveryRate = (rate) => setDeliveryRate(rate);

  const addItem = (category) => {
    const id = `custom-${category}-${Date.now()}-${++idCounter}`;

    setItems(prev => {
      const categoryItems = prev.filter(i => i.category === category);

      // Inherit feature flags from existing items in the category
      const extraFields = {};
      if (categoryItems.some(i => i.isAssembly)) {
        Object.assign(extraFields, { isAssembly: true, takeoffUnit: 'sq ft', coverageRate: 1 });
      }
      if (categoryItems.some(i => i.unitsPerLoad != null)) {
        extraFields.unitsPerLoad = 1;
        extraFields.deliveryFee = false;
      }

      return [...prev, {
        id,
        name: 'New Item',
        category,
        unit: 'ea',
        unitPrice: 0,
        ...extraFields,
        ...(UNIT_OVERRIDES[category] ?? {}),
      }];
    });
  };

  const removeItem = (id) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const saveCatalog = async (currentItems, currentDeliveryRate) => {
    try {
      localStorage.setItem(
        CATALOG_KEY,
        JSON.stringify({ deliveryRate: currentDeliveryRate, items: currentItems }),
      );
      return true;
    } catch {
      return false;
    }
  };

  return { catalogItems: items, deliveryRate, updateDeliveryRate, updateCatalogItem: updateItem, addCatalogItem: addItem, removeCatalogItem: removeItem, saveCatalog };
}
