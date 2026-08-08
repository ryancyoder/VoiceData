export const CATEGORIES = ['plants', 'lawn', 'bulk_materials', 'standard_materials', 'edging', 'labor', 'hardscape', 'heavy_equipment', 'small_equipment', 'drainage', 'lighting', 'logistics'];

export const METACATEGORIES = ['MATERIAL', 'LABOR', 'EQUIPMENT', 'LOGISTICS'];

export const CATEGORY_METACATEGORY = {
  plants:             'MATERIAL',
  lawn:               'MATERIAL',
  bulk_materials:     'MATERIAL',
  standard_materials: 'MATERIAL',
  edging:             'MATERIAL',
  hardscape:          'MATERIAL',
  drainage:           'MATERIAL',
  lighting:           'MATERIAL',
  labor:              'LABOR',
  heavy_equipment:    'EQUIPMENT',
  small_equipment:    'EQUIPMENT',
  logistics:          'LOGISTICS',
};

export const CATEGORY_LABELS = {
  plants:    'Plants',
  lawn:      'Lawn',
  bulk_materials:     'Bulk Materials',
  standard_materials: 'Standard Materials',
  edging:    'Edging',
  labor:     'Labor',
  hardscape: 'Hardscape',
  heavy_equipment: 'Heavy Equipment',
  small_equipment: 'Small Equipment',
  drainage:        'Drainage',
  lighting:  'Lighting',
  logistics: 'Logistics',
};

export const CATEGORY_COLORS = {
  plants:    { bg: 'bg-green-100',   text: 'text-green-800',   badge: 'bg-green-200',   border: 'border-green-300',   dot: 'bg-green-500' },
  lawn:      { bg: 'bg-emerald-100', text: 'text-emerald-800', badge: 'bg-emerald-200', border: 'border-emerald-300', dot: 'bg-emerald-500' },
  bulk_materials:     { bg: 'bg-amber-100', text: 'text-amber-800', badge: 'bg-amber-200', border: 'border-amber-300', dot: 'bg-amber-500' },
  standard_materials: { bg: 'bg-lime-100',   text: 'text-lime-800',   badge: 'bg-lime-200',   border: 'border-lime-300',   dot: 'bg-lime-500' },
  edging:             { bg: 'bg-violet-100', text: 'text-violet-800', badge: 'bg-violet-200', border: 'border-violet-300', dot: 'bg-violet-500' },
  labor:     { bg: 'bg-blue-100',   text: 'text-blue-800',   badge: 'bg-blue-200',   border: 'border-blue-300',   dot: 'bg-blue-500' },
  hardscape: { bg: 'bg-stone-100',  text: 'text-stone-800',  badge: 'bg-stone-200',  border: 'border-stone-300',  dot: 'bg-stone-500' },
  heavy_equipment: { bg: 'bg-orange-100', text: 'text-orange-800', badge: 'bg-orange-200', border: 'border-orange-300', dot: 'bg-orange-500' },
  small_equipment: { bg: 'bg-rose-100',   text: 'text-rose-800',   badge: 'bg-rose-200',   border: 'border-rose-300',   dot: 'bg-rose-500' },
  drainage:  { bg: 'bg-cyan-100',   text: 'text-cyan-800',   badge: 'bg-cyan-200',   border: 'border-cyan-300',   dot: 'bg-cyan-500' },
  lighting:  { bg: 'bg-yellow-100', text: 'text-yellow-800', badge: 'bg-yellow-200', border: 'border-yellow-300', dot: 'bg-yellow-500' },
  logistics: { bg: 'bg-slate-100',  text: 'text-slate-800',  badge: 'bg-slate-200',  border: 'border-slate-300',  dot: 'bg-slate-500'  },
};

import catalogData from './catalog-items.json';

export const CATALOG_DELIVERY_RATE = catalogData.deliveryRate ?? 80;
export default catalogData.items;
