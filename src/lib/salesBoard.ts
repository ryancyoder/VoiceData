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
  deal_id: number | null;
  storage_path: string;
  caption: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
  taken_at: string | null;
  event_id: number | null;
  media_type: "photo" | "video";
  poster_path: string | null;
}

export interface Property {
  id: number;
  address: string;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
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
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  property_id: number | null;
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

/**
 * URL for a grid/thumbnail preview of a photo or video. Videos can't be
 * rendered in an <img> tag, so this points at the captured poster frame
 * instead — null when no poster exists (capture failed at upload time),
 * in which case callers should render a placeholder rather than an <img>.
 */
export function dealThumbUrl(photo: Pick<DealPhoto, "media_type" | "storage_path" | "poster_path">): string | null {
  if (photo.media_type === "video") {
    return photo.poster_path ? dealPhotoUrl(photo.poster_path) : null;
  }
  return dealPhotoUrl(photo.storage_path);
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
