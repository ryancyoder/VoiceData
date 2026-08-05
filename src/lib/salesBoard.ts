export const STAGES = [
  "Lead",
  "Propose",
  "Sent",
  "Sold",
  "Scheduled",
  "Project Management",
  "Job Costing",
  "Invoiced",
  "Paid in Full",
] as const;

export type Stage = (typeof STAGES)[number];

export interface DealPhoto {
  id: number;
  deal_id: number;
  storage_path: string;
  caption: string | null;
  created_at: string;
}

export interface Deal {
  id: number;
  created_at: string;
  updated_at: string;
  deal_name: string;
  company: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  proposal_number: string | null;
  proposal_date: string | null;
  proposal_description: string | null;
  next_action: string | null;
  appointment_date: string | null;
  jobsite_address: string | null;
  value: number | null;
  stage: Stage;
  status: "Open" | "Closed";
  lost_at: string | null;
  photos: DealPhoto[];
}

export const DEAL_PHOTOS_BUCKET = "deal-photos";

export function dealPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${DEAL_PHOTOS_BUCKET}/${storagePath}`;
}

export interface DealInput {
  deal_name: string;
  company?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  proposal_number?: string | null;
  proposal_date?: string | null;
  proposal_description?: string | null;
  next_action?: string | null;
  appointment_date?: string | null;
  jobsite_address?: string | null;
  value?: number | null;
  stage?: Stage;
  lost_at?: string | null;
}
