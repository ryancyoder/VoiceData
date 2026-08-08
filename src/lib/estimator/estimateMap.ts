import { planImageUrl } from "./estimatePlan";

// Raw shape of a public.estimates row (snake_case columns).
export interface EstimateRow {
  id: string;
  deal_id: number | null;
  property_id: number | null;
  project_name: string | null;
  client_name: string | null;
  estimate_date: string | null;
  tax_rate: number | string | null;
  notes: string | null;
  rows: unknown[] | null;
  plan: Record<string, unknown> | null;
  plan_image_path: string | null;
  delivery_rate: number | string | null;
  subtotal: number | string | null;
  total: number | string | null;
  created_at: string;
  updated_at: string;
}

// The content-only shape the estimator frontend edits (matches useEstimate's
// initialEstimate). Metadata (id, deal_id, …) is kept out so autosave never
// round-trips it back as content.
export function mapEstimateContent(row: EstimateRow) {
  const plan = { ...(row.plan ?? {}) } as Record<string, unknown>;
  // imageDataUrl is always derived from the Storage path (authoritative),
  // never persisted as bytes in the jsonb.
  plan.imageDataUrl = row.plan_image_path ? planImageUrl(row.plan_image_path) : null;
  return {
    projectName: row.project_name ?? "",
    clientName: row.client_name ?? "",
    date: row.estimate_date ?? null,
    taxRate: Number(row.tax_rate ?? 0),
    notes: row.notes ?? "",
    rows: row.rows ?? [],
    plan,
  };
}

// Lightweight row for the estimate list.
export function mapEstimateSummary(row: EstimateRow) {
  return {
    id: row.id,
    dealId: row.deal_id,
    propertyId: row.property_id,
    projectName: row.project_name ?? "",
    clientName: row.client_name ?? "",
    date: row.estimate_date ?? null,
    total: row.total != null ? Number(row.total) : null,
    updatedAt: row.updated_at,
  };
}
