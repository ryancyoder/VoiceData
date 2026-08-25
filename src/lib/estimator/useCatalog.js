import { useState, useEffect } from 'react';

const DEFAULT_DELIVERY_RATE = 80;

// The estimator catalog, read from the master catalog (normalized materials/
// applications/assemblies) via /api/estimator/catalog-v2. Read-only inside the
// estimator: catalog authoring lives on the /master-catalog page.
export function useCatalog() {
  const [items, setItems] = useState([]);
  const [deliveryRate, setDeliveryRate] = useState(DEFAULT_DELIVERY_RATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/estimator/catalog-v2')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then(data => {
        if (!active) return;
        if (Array.isArray(data.items)) setItems(data.items);
        if (typeof data.deliveryRate === 'number') setDeliveryRate(data.deliveryRate);
        setLoaded(true);
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  return { catalogItems: items, deliveryRate, loaded };
}
