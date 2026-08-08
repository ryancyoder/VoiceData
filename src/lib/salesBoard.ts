import type { EventType } from "@/lib/events";

export const STAGES = ["Proposal Sent", "Sold", "Project Management", "Invoiced", "Paid in Full"] as const;

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
  is_outlier: boolean;
}

// A PO or receipt attached directly to a deal — unlike DealPhoto, never
// reached by way of an event, since these are business records rather
// than something photographed at a jobsite.
export interface DealAttachment {
  id: number;
  deal_id: number;
  storage_path: string;
  file_name: string;
  kind: "image" | "pdf";
  created_at: string;
}

// A screenshot of correspondence with the client (email/text threads) —
// attached directly to the deal like DealAttachment, but a distinct table
// so it renders as its own section rather than mixing with POs/receipts.
export interface DealCorrespondence {
  id: number;
  deal_id: number;
  storage_path: string;
  file_name: string;
  created_at: string;
}

export interface DealEvent {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType | null;
  photos: DealPhoto[];
}

export interface Contact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export interface Property {
  id: number;
  address: string;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  primary_contact_id: number | null;
  cover_photo_id: number | null;
  created_at: string;
  // Present when joined — a property's primary contact, the single point of
  // contact every deal at this property shares.
  contact: Contact | null;
}

// A lightweight property for picker dropdowns (Sales Board's jobsite
// address field, Calendar's event property field) — just enough to label
// and identify a property, not the full row.
export interface PropertyOption {
  id: number;
  address: string;
  contactLastName: string | null;
}

export interface Deal {
  id: number;
  created_at: string;
  updated_at: string;
  deal_name: string;
  company: string | null;
  // A deal's contact, address, and geocoding are all reached only by way
  // of its property — never stored directly on the deal. A property has
  // one primary contact (shared by every deal there), one address, and
  // one set of coordinates; duplicating any of that onto the deal is how
  // a deal's address used to silently drift from its property's.
  property: Property | null;
  proposal_number: string | null;
  proposal_date: string | null;
  proposal_description: string | null;
  // Not a deal column — this is the title of whichever task (in the
  // `tasks` table) is flagged as this deal's next action, joined in at
  // fetch time. Never set directly; flag a task instead.
  next_action: string | null;
  appointment_date: string | null;
  property_id: number | null;
  value: number | null;
  stage: Stage;
  status: "Open" | "Closed";
  lost_at: string | null;
  proposal_pdf_path: string | null;
  aspire_link: string | null;
  // A photo/video is attached to an event first — the event is the base
  // unit of truth — and a deal is made up of the events attached to it.
  // There is no direct deal->photo relationship; every photo is reached by
  // way of its event.
  events: DealEvent[];
  // POs, receipts, and other business documents — attached directly to
  // the deal, not by way of an event.
  attachments: DealAttachment[];
  // Screenshots of correspondence with the client — also attached
  // directly to the deal, kept separate from `attachments` above.
  correspondence: DealCorrespondence[];
}

/**
 * A bare address is hard to recognize at a glance — prepending the primary
 * contact's last name (e.g. "INGERSOL - 140 Shore drive") makes a property
 * picker actually recognizable to a human. Falls back to the address alone
 * when there's no contact yet (e.g. a freshly created property).
 */
export function formatPropertyLabel(property: { address: string; contactLastName?: string | null }): string {
  return property.contactLastName ? `${property.contactLastName.toUpperCase()} - ${property.address}` : property.address;
}

/** All of a deal's photos across every one of its events, flattened. */
export function flattenDealPhotos(deal: Pick<Deal, "events">): DealPhoto[] {
  return deal.events.flatMap((e) => e.photos);
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

export const DEAL_DOCUMENTS_BUCKET = "deal-documents";

export function dealDocumentUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${DEAL_DOCUMENTS_BUCKET}/${storagePath}`;
}

export const DEAL_ATTACHMENTS_BUCKET = "deal-attachments";

export function dealAttachmentUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${DEAL_ATTACHMENTS_BUCKET}/${storagePath}`;
}

export const DEAL_CORRESPONDENCE_BUCKET = "deal-correspondence";

export function dealCorrespondenceUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${DEAL_CORRESPONDENCE_BUCKET}/${storagePath}`;
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
  appointment_date?: string | null;
  property_id?: number | null;
  value?: number | null;
  stage?: Stage;
  lost_at?: string | null;
  aspire_link?: string | null;
}
