import { useState, useCallback, useEffect, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { METACATEGORIES, CATEGORY_METACATEGORY } from './catalog';

const today = new Date().toISOString().split('T')[0];

const emptyPlan = { imageDataUrl: null, imageWidth: 0, imageHeight: 0, scale: null, shapes: [], plants: [], items: [] };

const initialEstimate = {
  projectName: '',
  clientName: '',
  date: today,
  taxRate: 0,
  notes: '',
  // rows: array of TakeOffGroup | EstimateItem
  // TakeOffGroup: { type:'group', id, label, sqFt, linearFt, height, collapsed, items:[] }
  // EstimateItem: { type:'item', id, groupId:null, ...fields }
  rows: [],
  plan: emptyPlan,
};

export const SHAPE_COLORS = ['#6366f1','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#65a30d','#9333ea'];

// ── Plan math helpers ────────────────────────────────────────────────────────

function polygonArea(vertices) {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

function polylineLength(vertices) {
  let length = 0;
  for (let i = 1; i < vertices.length; i++) {
    const dx = vertices[i].x - vertices[i - 1].x;
    const dy = vertices[i].y - vertices[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

function computeMeasurement(type, vertices, pixelsPerFoot) {
  if (!pixelsPerFoot) return 0;
  if (type === 'area') return polygonArea(vertices) / (pixelsPerFoot * pixelsPerFoot);
  return polylineLength(vertices) / pixelsPerFoot;
}

// ── Plant group sync ─────────────────────────────────────────────────────────

function syncPlantsGroup(plants, rows, catalogItems = []) {
  // Count placements by catalogId
  const counts = {};
  for (const p of plants) {
    if (p.catalogId) counts[p.catalogId] = (counts[p.catalogId] ?? 0) + 1;
  }

  const existingIdx = rows.findIndex(r => r.type === 'group' && r.isPlantsGroup);
  const existingGroup = existingIdx !== -1 ? rows[existingIdx] : null;

  if (!plants.length) {
    return existingIdx !== -1 ? rows.filter((_, i) => i !== existingIdx) : rows;
  }

  const buildItems = (groupId) => Object.entries(counts).map(([catalogId, qty]) => {
    const cat = catalogItems.find(c => c.id === catalogId);
    const prev = existingGroup?.items.find(i => i.catalogId === catalogId);
    return {
      type: 'item',
      id: prev?.id ?? genId('item'),
      groupId,
      catalogId,
      name: cat?.name ?? prev?.name ?? catalogId,
      category: 'plants',
      unit: cat?.unit ?? 'ea',
      unitPrice: cat?.unitPrice ?? prev?.unitPrice ?? 0,
      quantity: qty,
      notes: prev?.notes ?? '',
      isPlantItem: true,
    };
  });

  if (existingGroup) {
    const updated = { ...existingGroup, items: buildItems(existingGroup.id) };
    return rows.map((r, i) => i === existingIdx ? updated : r);
  }

  const id = genId('group');
  return [...rows, {
    type: 'group', id, label: 'Plants',
    sqFt: 0, linearFt: 0, height: 0,
    collapsed: false, notes: '',
    isPlantsGroup: true,
    items: buildItems(id),
  }];
}

// ── Item placement group sync ─────────────────────────────────────────────────

function syncItemsGroup(items, rows, catalogItems = []) {
  const counts = {};
  for (const p of items) {
    if (p.catalogId) counts[p.catalogId] = (counts[p.catalogId] ?? 0) + 1;
  }

  const existingIdx = rows.findIndex(r => r.type === 'group' && r.isItemsGroup);
  const existingGroup = existingIdx !== -1 ? rows[existingIdx] : null;

  if (!items.length) {
    return existingIdx !== -1 ? rows.filter((_, i) => i !== existingIdx) : rows;
  }

  const buildItems = (groupId) => Object.entries(counts).map(([catalogId, qty]) => {
    const cat = catalogItems.find(c => c.id === catalogId);
    const prev = existingGroup?.items.find(i => i.catalogId === catalogId);
    return {
      type: 'item',
      id: prev?.id ?? genId('item'),
      groupId,
      catalogId,
      name: cat?.name ?? prev?.name ?? catalogId,
      category: cat?.category ?? prev?.category ?? 'labor',
      unit: cat?.unit ?? 'ea',
      unitPrice: cat?.unitPrice ?? prev?.unitPrice ?? 0,
      quantity: qty,
      notes: prev?.notes ?? '',
      isItemPlacement: true,
    };
  });

  if (existingGroup) {
    const updated = { ...existingGroup, items: buildItems(existingGroup.id) };
    return rows.map((r, i) => i === existingIdx ? updated : r);
  }

  const id = genId('group');
  return [...rows, {
    type: 'group', id, label: 'Items',
    sqFt: 0, linearFt: 0, height: 0,
    collapsed: false, notes: '',
    isItemsGroup: true,
    items: buildItems(id),
  }];
}

function syncGroupsFromShapes(shapes, rows, affectedGroupIds) {
  if (!affectedGroupIds.length) return rows;
  return rows.map(row => {
    if (row.type !== 'group' || !affectedGroupIds.includes(row.id)) return row;
    const groupShapes = shapes.filter(s => s.groupId === row.id);
    const areaShape = groupShapes.find(s => s.type === 'area');
    const linearShape = groupShapes.find(s => s.type === 'linear');
    const newSqFt = areaShape?.measurement ?? 0;
    const newLinFt = linearShape?.measurement ?? 0;
    const updated = { ...row, sqFt: newSqFt, linearFt: newLinFt };
    return { ...updated, items: updated.items.map(i => applyGroupTakeoff(i, updated)) };
  });
}

let idCounter = 0;
export function genId(prefix = 'row') {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

// Determine which fields of an item are auto-derived from a group
function applyGroupTakeoff(item, group) {
  if (!group) return item;
  if (item.isWallAssembly) {
    return { ...item, linearFt: group.linearFt, height: group.height, faceFt: group.linearFt * group.height };
  }
  if (item.isAssembly) {
    const takeoffQty = item.takeoffUnit === 'ln ft' ? group.linearFt : group.sqFt;
    const rawQty = item.coverageRate ? takeoffQty / item.coverageRate : takeoffQty;
    const quantity = item.roundTo > 0 ? Math.round(rawQty / item.roundTo) * item.roundTo : rawQty;
    return { ...item, takeoffQty, quantity };
  }
  if (item.unit === 'sq ft')  return { ...item, quantity: group.sqFt };
  if (item.unit === 'ln ft') return { ...item, quantity: group.linearFt };
  return item; // ea / hr / day — user keeps editing qty
}

// Does this item type have its takeoff inherited from the group?
export function isGroupInherited(item) {
  return item.isWallAssembly || item.isAssembly ||
         item.unit === 'sq ft' || item.unit === 'ln ft';
}

function itemLineTotal(item) {
  if (item.isWallAssembly) {
    return (item.faceFt * item.pricePerFaceFt) + (item.linearFt * item.pricePerLinearFt);
  }
  return item.quantity * item.unitPrice;
}

function buildItem(catalogItem, groupId = null) {
  return {
    type: 'item',
    id: genId('item'),
    groupId,
    catalogId: catalogItem.id,
    name: catalogItem.name,
    category: catalogItem.category,
    unit: catalogItem.unit,
    unitPrice: catalogItem.unitPrice,
    quantity: (catalogItem.isAssembly || catalogItem.isWallAssembly) ? 0 : 1,
    notes: '',
    ...(catalogItem.isAssembly && {
      isAssembly: true,
      takeoffUnit: catalogItem.takeoffUnit,
      coverageRate: catalogItem.coverageRate,
      roundTo: catalogItem.roundTo ?? null,
      takeoffQty: 0,
      ...(catalogItem.unitsPerLoad && {
        unitsPerLoad: catalogItem.unitsPerLoad,
        deliveryFee: catalogItem.deliveryFee ?? false,
      }),
    }),
    ...(catalogItem.isWallAssembly && {
      isWallAssembly: true,
      pricePerFaceFt: catalogItem.pricePerFaceFt,
      pricePerLinearFt: catalogItem.pricePerLinearFt,
      linearFt: 0,
      height: 1,
      faceFt: 0,
    }),
  };
}

export function buildImportedEstimate(data, catalogItems) {
  const findCatalog = (name) =>
    catalogItems.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const rows = [];

  for (const g of (data.groups ?? [])) {
    const group = {
      type: 'group',
      id: genId('group'),
      label: g.label ?? 'New Take Off',
      sqFt: g.sqFt ?? 0,
      linearFt: g.linearFt ?? 0,
      height: g.height ?? 0,
      collapsed: false,
      notes: g.notes ?? '',
      items: [],
    };
    for (const spec of (g.items ?? [])) {
      const cat = findCatalog(spec.catalog ?? '');
      const base = cat
        ? buildItem(cat, group.id)
        : {
            type: 'item', id: genId('item'), groupId: group.id,
            catalogId: null, name: spec.catalog ?? 'Unknown Item',
            category: 'labor', unit: 'ea', unitPrice: 0, quantity: 1,
            notes: '[NOT FOUND IN CATALOG]',
          };
      const withNote = spec.notes
        ? { ...base, notes: spec.notes + (base.notes ? ' | ' + base.notes : '') }
        : base;
      group.items.push(applyGroupTakeoff(withNote, group));
    }
    rows.push(group);
  }

  for (const spec of (data.items ?? [])) {
    const cat = findCatalog(spec.catalog ?? '');
    const base = cat
      ? buildItem(cat, null)
      : {
          type: 'item', id: genId('item'), groupId: null,
          catalogId: null, name: spec.catalog ?? 'Unknown Item',
          category: 'labor', unit: 'ea', unitPrice: 0, quantity: 1,
          notes: '[NOT FOUND IN CATALOG]',
        };
    const withQty = (spec.quantity != null && !cat?.isAssembly && !cat?.isWallAssembly)
      ? { ...base, quantity: spec.quantity }
      : base;
    const withNote = spec.notes ? { ...withQty, notes: spec.notes } : withQty;
    rows.push(withNote);
  }

  return {
    projectName: data.projectName ?? '',
    clientName: data.clientName ?? '',
    date: data.date ?? new Date().toISOString().split('T')[0],
    taxRate: data.taxRate ?? 0,
    notes: data.notes ?? '',
    rows,
    plan: data.plan ?? emptyPlan,
  };
}

// Backfill plan sub-fields for estimates saved before those features existed.
function normalizePlan(plan) {
  const p = { ...emptyPlan, ...(plan ?? {}) };
  if (!Array.isArray(p.shapes)) p.shapes = [];
  if (!Array.isArray(p.plants)) p.plants = [];
  if (!Array.isArray(p.items)) p.items = [];
  return p;
}

// Phase 3 persistence: Supabase, one estimate per id. Loaded on mount and
// autosaved (debounced) as it changes. `estimateId` is required; the hook
// returns `loading` until the estimate has been fetched.
export function useEstimate(deliveryRate = 0, estimateId = null) {
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const skipSave = useRef(true); // don't autosave the value we just loaded
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!estimateId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    skipSave.current = true;
    fetch(`/api/estimator/estimates/${estimateId}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then(data => {
        if (!active) return;
        const e = data.estimate ?? initialEstimate;
        setEstimate({ ...initialEstimate, ...e, plan: normalizePlan(e.plan) });
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setEstimate({ ...initialEstimate, plan: normalizePlan() });
        setLoading(false);
      });
    return () => { active = false; };
  }, [estimateId]);

  const updateField = useCallback((field, value) => {
    setEstimate(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Groups ──────────────────────────────────────────────────────────────────

  const addGroup = useCallback((label = 'New Take Off') => {
    const id = genId('group');
    setEstimate(prev => ({
      ...prev,
      rows: [...prev.rows, {
        type: 'group',
        id,
        label,
        stage: null,
        sqFt: 0,
        linearFt: 0,
        height: 0,
        collapsed: false,
        notes: '',
        items: [],
      }],
    }));
    return id;
  }, []);

  const updateGroup = useCallback((groupId, field, value) => {
    setEstimate(prev => ({
      ...prev,
      rows: prev.rows.map(row => {
        if (row.id !== groupId || row.type !== 'group') return row;
        const updated = { ...row, [field]: value };
        return { ...updated, items: updated.items.map(i => applyGroupTakeoff(i, updated)) };
      }),
    }));
  }, []);

  const toggleGroupCollapse = useCallback((groupId) => {
    setEstimate(prev => ({
      ...prev,
      rows: prev.rows.map(row =>
        row.id === groupId && row.type === 'group'
          ? { ...row, collapsed: !row.collapsed }
          : row
      ),
    }));
  }, []);

  // ── Items ────────────────────────────────────────────────────────────────────

  const addItem = useCallback((catalogItem, groupId = null) => {
    const base = buildItem(catalogItem, groupId);
    setEstimate(prev => {
      if (!groupId) {
        return { ...prev, rows: [...prev.rows, base] };
      }
      return {
        ...prev,
        rows: prev.rows.map(row => {
          if (row.id !== groupId || row.type !== 'group') return row;
          return { ...row, items: [...row.items, applyGroupTakeoff(base, row)] };
        }),
      };
    });
  }, []);

  const removeRow = useCallback((rowId) => {
    setEstimate(prev => ({
      ...prev,
      rows: prev.rows
        .filter(row => row.id !== rowId)
        .map(row => row.type === 'group'
          ? { ...row, items: row.items.filter(i => i.id !== rowId) }
          : row
        ),
    }));
  }, []);

  const updateItem = useCallback((itemId, field, value) => {
    setEstimate(prev => ({
      ...prev,
      rows: prev.rows.map(row => {
        if (row.type === 'item' && row.id === itemId) return { ...row, [field]: value };
        if (row.type === 'group') {
          return { ...row, items: row.items.map(i => i.id === itemId ? { ...i, [field]: value } : i) };
        }
        return row;
      }),
    }));
  }, []);

  const updateTakeoff = useCallback((itemId, takeoffQty) => {
    setEstimate(prev => ({
      ...prev,
      rows: prev.rows.map(row => {
        if (row.type === 'item' && row.id === itemId) {
          return { ...row, takeoffQty, quantity: takeoffQty / row.coverageRate };
        }
        if (row.type === 'group') {
          return {
            ...row,
            items: row.items.map(i => i.id === itemId
              ? { ...i, takeoffQty, quantity: takeoffQty / i.coverageRate }
              : i
            ),
          };
        }
        return row;
      }),
    }));
  }, []);

  const updateWallDimensions = useCallback((itemId, linearFt, height) => {
    setEstimate(prev => ({
      ...prev,
      rows: prev.rows.map(row => {
        if (row.type === 'item' && row.id === itemId) {
          return { ...row, linearFt, height, faceFt: linearFt * height };
        }
        if (row.type === 'group') {
          return {
            ...row,
            items: row.items.map(i => i.id === itemId
              ? { ...i, linearFt, height, faceFt: linearFt * height }
              : i
            ),
          };
        }
        return row;
      }),
    }));
  }, []);

  const importEstimate = useCallback((estimateData) => {
    setEstimate(estimateData);
  }, []);

  const resetEstimate = useCallback(() => {
    setEstimate({ ...initialEstimate, date: new Date().toISOString().split('T')[0] });
  }, []);

  // ── Plan ─────────────────────────────────────────────────────────────────────

  // The plan image is uploaded to Supabase Storage (not stored as a base64
  // data URL in the estimate). We keep the returned public URL locally for
  // display; the storage path is tracked on the estimate row server-side.
  const setPlanImage = useCallback(async ({ file, imageWidth, imageHeight }) => {
    if (!estimateId || !file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/estimator/estimates/${estimateId}/plan-image`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('upload failed');
      const { url } = await res.json();
      setEstimate(prev => ({ ...prev, plan: { ...prev.plan, imageDataUrl: url, imageWidth, imageHeight } }));
    } catch (e) {
      console.error('Failed to upload plan image', e);
    }
  }, [estimateId]);

  const setPlanScale = useCallback((scaleData) => {
    setEstimate(prev => ({ ...prev, plan: { ...prev.plan, scale: scaleData } }));
  }, []);

  const addShape = useCallback((shape) => {
    setEstimate(prev => {
      const pixelsPerFoot = prev.plan.scale?.pixelsPerFoot ?? 0;
      const measurement = computeMeasurement(shape.type, shape.vertices, pixelsPerFoot);
      const newShape = { ...shape, measurement };
      const newShapes = [...prev.plan.shapes, newShape];
      const affectedGroupIds = [shape.groupId].filter(Boolean);
      return {
        ...prev,
        plan: { ...prev.plan, shapes: newShapes },
        rows: syncGroupsFromShapes(newShapes, prev.rows, affectedGroupIds),
      };
    });
  }, []);

  const updateShape = useCallback((shapeId, updates) => {
    setEstimate(prev => {
      const oldShape = prev.plan.shapes.find(s => s.id === shapeId);
      const pixelsPerFoot = prev.plan.scale?.pixelsPerFoot ?? 0;
      const newShapes = prev.plan.shapes.map(s => {
        if (s.id !== shapeId) return s;
        const updated = { ...s, ...updates };
        if (updates.vertices) updated.measurement = computeMeasurement(updated.type, updated.vertices, pixelsPerFoot);
        return updated;
      });
      const affectedGroupIds = [...new Set([oldShape?.groupId, updates.groupId])].filter(Boolean);
      return {
        ...prev,
        plan: { ...prev.plan, shapes: newShapes },
        rows: syncGroupsFromShapes(newShapes, prev.rows, affectedGroupIds),
      };
    });
  }, []);

  const addPlant = useCallback((plant, catalogItems = []) => {
    setEstimate(prev => {
      const newPlants = [...prev.plan.plants, plant];
      return { ...prev, plan: { ...prev.plan, plants: newPlants }, rows: syncPlantsGroup(newPlants, prev.rows, catalogItems) };
    });
  }, []);

  const removePlant = useCallback((plantId, catalogItems = []) => {
    setEstimate(prev => {
      const newPlants = prev.plan.plants.filter(p => p.id !== plantId);
      return { ...prev, plan: { ...prev.plan, plants: newPlants }, rows: syncPlantsGroup(newPlants, prev.rows, catalogItems) };
    });
  }, []);

  const addItemPlacement = useCallback((item, catalogItems = []) => {
    setEstimate(prev => {
      const newItems = [...(prev.plan.items ?? []), item];
      return { ...prev, plan: { ...prev.plan, items: newItems }, rows: syncItemsGroup(newItems, prev.rows, catalogItems) };
    });
  }, []);

  const removeItemPlacement = useCallback((itemId, catalogItems = []) => {
    setEstimate(prev => {
      const newItems = (prev.plan.items ?? []).filter(p => p.id !== itemId);
      return { ...prev, plan: { ...prev.plan, items: newItems }, rows: syncItemsGroup(newItems, prev.rows, catalogItems) };
    });
  }, []);

  const removeShape = useCallback((shapeId) => {
    setEstimate(prev => {
      const shape = prev.plan.shapes.find(s => s.id === shapeId);
      const newShapes = prev.plan.shapes.filter(s => s.id !== shapeId);
      const affectedGroupIds = [shape?.groupId].filter(Boolean);
      return {
        ...prev,
        plan: { ...prev.plan, shapes: newShapes },
        rows: syncGroupsFromShapes(newShapes, prev.rows, affectedGroupIds),
      };
    });
  }, []);

  const moveItemToGroup = useCallback((itemId, targetGroupId) => {
    setEstimate(prev => {
      // Find the item wherever it lives
      let foundItem = prev.rows.find(r => r.type === 'item' && r.id === itemId);
      if (!foundItem) {
        for (const row of prev.rows) {
          if (row.type === 'group') {
            const it = row.items.find(i => i.id === itemId);
            if (it) { foundItem = it; break; }
          }
        }
      }
      if (!foundItem) return prev;
      // Don't allow moving auto-synced plant/item-placement rows
      if (foundItem.isPlantItem || foundItem.isItemPlacement) return prev;

      // Remove from current location
      const rowsWithout = prev.rows
        .filter(r => !(r.type === 'item' && r.id === itemId))
        .map(row => row.type === 'group'
          ? { ...row, items: row.items.filter(i => i.id !== itemId) }
          : row
        );

      const movedItem = { ...foundItem, groupId: targetGroupId };

      if (!targetGroupId) {
        return { ...prev, rows: [...rowsWithout, movedItem] };
      }
      return {
        ...prev,
        rows: rowsWithout.map(row => {
          if (row.id !== targetGroupId || row.type !== 'group') return row;
          return { ...row, items: [...row.items, applyGroupTakeoff(movedItem, row)] };
        }),
      };
    });
  }, []);

  const addKitToGroup = useCallback((kit, groupId) => {
    const newGroupId = groupId ?? genId('group');
    setEstimate(prev => {
      const targetGroup = groupId
        ? prev.rows.find(r => r.type === 'group' && r.id === groupId)
        : null;

      const newItems = kit.items.map(kitItem => {
        const item = {
          type: 'item',
          id: genId('item'),
          groupId: newGroupId,
          catalogId: kitItem.catalogId,
          name: kitItem.name,
          category: kitItem.category,
          unit: kitItem.unit,
          unitPrice: kitItem.unitPrice,
          quantity: kitItem.isAssembly || kitItem.isWallAssembly ? 0 : 1,
          notes: kitItem.notes ?? '',
          ...(kitItem.isAssembly && {
            isAssembly: true,
            takeoffUnit: kitItem.takeoffUnit ?? 'sq ft',
            coverageRate: kitItem.coverageRate ?? 1,
            roundTo: kitItem.roundTo ?? null,
            takeoffQty: 0,
            ...(kitItem.unitsPerLoad != null && {
              unitsPerLoad: kitItem.unitsPerLoad,
              deliveryFee: kitItem.deliveryFee ?? true,
            }),
          }),
          ...(kitItem.isWallAssembly && {
            isWallAssembly: true,
            pricePerFaceFt: kitItem.pricePerFaceFt ?? 0,
            pricePerLinearFt: kitItem.pricePerLinearFt ?? 0,
            linearFt: 0,
            height: 1,
            faceFt: 0,
          }),
        };
        return targetGroup ? applyGroupTakeoff(item, targetGroup) : item;
      });

      if (groupId) {
        // Add items to existing group
        return {
          ...prev,
          rows: prev.rows.map(row => {
            if (row.type !== 'group' || row.id !== groupId) return row;
            return { ...row, items: [...row.items, ...newItems] };
          }),
        };
      }

      // Create a new group named after the kit and add items to it
      const newGroup = {
        type: 'group',
        id: newGroupId,
        label: kit.name,
        stage: kit.operationStage ?? null,
        sqFt: 0,
        linearFt: 0,
        height: 0,
        collapsed: false,
        notes: '',
        items: newItems,
      };
      return { ...prev, rows: [...prev.rows, newGroup] };
    });
    return newGroupId;
  }, []);

  const reorderRows = useCallback((activeId, overId) => {
    setEstimate(prev => {
      // Try reordering top-level rows
      const ai = prev.rows.findIndex(r => r.id === activeId);
      const oi = prev.rows.findIndex(r => r.id === overId);
      if (ai !== -1 && oi !== -1) {
        return { ...prev, rows: arrayMove(prev.rows, ai, oi) };
      }
      // Try reordering within a group
      const newRows = prev.rows.map(row => {
        if (row.type !== 'group') return row;
        const gai = row.items.findIndex(i => i.id === activeId);
        const goi = row.items.findIndex(i => i.id === overId);
        if (gai !== -1 && goi !== -1) {
          return { ...row, items: arrayMove(row.items, gai, goi) };
        }
        return row;
      });
      return { ...prev, rows: newRows };
    });
  }, []);

  // ── Computed ─────────────────────────────────────────────────────────────────
  // Guard every derived value against the pre-load null estimate.

  const allItems = estimate ? estimate.rows.flatMap(row =>
    row.type === 'group' ? row.items : row.type === 'item' ? [row] : []
  ) : [];

  const totalLoads = allItems.reduce((sum, item) => {
    if (!item.deliveryFee || !item.unitsPerLoad || !(item.quantity > 0)) return sum;
    return sum + Math.ceil(item.quantity / item.unitsPerLoad);
  }, 0);
  const totalDelivery = totalLoads * deliveryRate;
  // subtotal includes delivery (delivery is a logistics cost, not a separate line)
  const subtotal = allItems.reduce((sum, item) => sum + itemLineTotal(item), 0) + totalDelivery;
  const metacategoryTotals = METACATEGORIES.reduce((acc, meta) => {
    acc[meta] = allItems
      .filter(item => (CATEGORY_METACATEGORY[item.category] ?? 'MATERIAL') === meta)
      .reduce((sum, item) => sum + itemLineTotal(item), 0);
    return acc;
  }, {});
  // Delivery charges count as logistics
  metacategoryTotals['LOGISTICS'] = (metacategoryTotals['LOGISTICS'] ?? 0) + totalDelivery;

  // By operation stage: a group's stage tags every line in it. Groups without a
  // stage (and ungrouped top-level items) fall into 'unstaged'. Empty when no
  // group carries a stage, so the summary can hide the breakdown entirely.
  const stageTotals = estimate ? estimate.rows.reduce((acc, row) => {
    if (row.type === 'group') {
      const key = row.stage || 'unstaged';
      acc[key] = (acc[key] ?? 0) + row.items.reduce((s, i) => s + itemLineTotal(i), 0);
    } else if (row.type === 'item') {
      acc['unstaged'] = (acc['unstaged'] ?? 0) + itemLineTotal(row);
    }
    return acc;
  }, {}) : {};

  const taxAmount = subtotal * ((estimate?.taxRate ?? 0) / 100);
  const total = subtotal + taxAmount;

  // Debounced autosave. Runs only after the estimate has loaded; the first
  // post-load change is skipped so we don't immediately re-save what we read.
  useEffect(() => {
    if (loading || !estimate || !estimateId) return;
    if (skipSave.current) { skipSave.current = false; return; }
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/estimator/estimates/${estimateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...estimate, deliveryRate, subtotal, total }),
      })
        .then(res => setSaveState(res.ok ? 'saved' : 'error'))
        .catch(() => setSaveState('error'));
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [estimate, estimateId, loading, deliveryRate, subtotal, total]);

  return {
    estimate,
    loading,
    saveState,
    allItems,
    updateField,
    addGroup,
    updateGroup,
    toggleGroupCollapse,
    addItem,
    removeRow,
    updateItem,
    updateTakeoff,
    updateWallDimensions,
    reorderRows,
    moveItemToGroup,
    addKitToGroup,
    importEstimate,
    resetEstimate,
    setPlanImage,
    setPlanScale,
    addShape,
    updateShape,
    removeShape,
    addPlant,
    removePlant,
    addItemPlacement,
    removeItemPlacement,
    subtotal,
    metacategoryTotals,
    stageTotals,
    totalLoads,
    totalDelivery,
    taxAmount,
    total,
  };
}
