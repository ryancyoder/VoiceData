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

// Phase 2 persistence: Supabase, via /api/estimator/catalog. The catalog is
// edited locally and written back as a whole on Save (the app's existing
// edit-then-save UX). The bundled JSON is only a fallback if the load fails.
export function useCatalog() {
  const [items, setItems] = useState([]);
  const [deliveryRate, setDeliveryRate] = useState(CATALOG_DELIVERY_RATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/estimator/catalog')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then(data => {
        if (!active) return;
        if (Array.isArray(data.items)) setItems(data.items);
        if (typeof data.deliveryRate === 'number') setDeliveryRate(data.deliveryRate);
        setLoaded(true);
      })
      .catch(() => {
        // Fall back to the bundled defaults so the tool is still usable offline.
        if (!active) return;
        setItems(defaultCatalog.map(item => ({ ...item })));
        setLoaded(true);
      });
    return () => { active = false; };
  }, []);

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
      const res = await fetch('/api/estimator/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryRate: currentDeliveryRate, items: currentItems }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  return { catalogItems: items, deliveryRate, loaded, updateDeliveryRate, updateCatalogItem: updateItem, addCatalogItem: addItem, removeCatalogItem: removeItem, saveCatalog };
}
