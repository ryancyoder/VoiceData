// The camelCase catalog shapes the estimator frontend consumes. These used to
// live in the legacy column-mapper files (catalogItemColumns.ts /
// assemblyKitColumns.ts); with the legacy catalog removed, the master catalog
// adapter is the sole producer, so the shared types live here on their own.

// A catalog item as consumed by the frontend. Loosely typed on purpose: the
// object is passed around as a plain bag with a few optional feature flags, so
// we keep an index signature while naming the known fields.
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  isAssembly?: boolean;
  takeoffUnit?: string;
  coverageRate?: number;
  roundTo?: number;
  unitsPerLoad?: number;
  deliveryFee?: boolean;
  planSymbol?: string;
  itemSymbol?: string;
  description?: string;
  isWallAssembly?: boolean;
  pricePerFaceFt?: number;
  pricePerLinearFt?: number;
  [key: string]: unknown;
}

export interface KitItem {
  catalogId?: string;
  name: string;
  category?: string;
  unit?: string;
  unitPrice?: number;
  notes?: string;
  isAssembly?: boolean;
  takeoffUnit?: string;
  coverageRate?: number;
  roundTo?: number;
  unitsPerLoad?: number;
  deliveryFee?: boolean;
  isWallAssembly?: boolean;
  pricePerFaceFt?: number;
  pricePerLinearFt?: number;
  [key: string]: unknown;
}

export interface Kit {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  color?: string | null;
  takeoffUnit?: string | null;
  operationStage?: string | null;
  items: KitItem[];
  [key: string]: unknown;
}
