import type { EventType } from "@/lib/events";

export const STAGES = [
  "Lead",
  "Propose",
  "Sent",
  "Sold",
  "Project Management",
  "Invoiced",
  "Paid in Full",
] as const;

export type Stage = (typeof STAGES)[number];

// A special photo label. null = an ordinary jobsite photo. "Site_Plan_Image"
// is the estimator's site plan for a deal — stored as an event-less deal photo
// (deal_id set, event_id null) so it lives in the deal's gallery without being
// a calendar event.
export const SITE_PLAN_IMAGE_TYPE = "Site_Plan_Image";
// A general-reference photo of a property itself — not tied to any calendar
// event or deal (event_id null, deal_id null, property_id set). Lives in the
// property's album under a "General reference" section.
export const PROPERTY_REFERENCE_TYPE = "Property_Reference";
// A video recorded with the Video Snapshot walkthrough tool — a normal event
// video, but tagged so the gallery can badge it with a distinct walkthrough icon.
export const WALKTHROUGH_VIDEO_TYPE = "Video_Walkthrough";
// A deal's "next action" photo, uploaded from the Next Actions list — stored as
// an event-less deal photo (deal_id set, event_id null) so it lives in the
// deal's gallery under an "Action" section. One per deal: adding a new one
// replaces the old, and it becomes the deal's next_action_photo_id.
export const ACTION_PHOTO_TYPE = "Action_Photo";
export type PhotoType =
  | typeof SITE_PLAN_IMAGE_TYPE
  | typeof PROPERTY_REFERENCE_TYPE
  | typeof WALKTHROUGH_VIDEO_TYPE
  | typeof ACTION_PHOTO_TYPE
  | null;

export interface DealPhoto {
  id: number;
  deal_id: number | null;
  // The task an Action_Photo is attached to (the action it represents). Null on
  // ordinary jobsite/reference photos.
  task_id?: number | null;
  property_id?: number | null;
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
  photo_type: PhotoType;
  // When set, storage_path points at an annotated composite and this holds the
  // un-annotated original (so the annotation can be reverted). Null = never
  // annotated. Added by the photo-annotation feature; older rows are null.
  original_storage_path?: string | null;
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

// A client-correspondence record on a deal — either a screenshot (email/text
// threads, POs) with storage_path/file_name set, or a logged touchpoint
// (call/email/text) with `channel` set and no file. A distinct table so it
// renders as its own section rather than mixing with POs/receipts.
export type CorrespondenceChannel = "call" | "email" | "text";
export interface DealCorrespondence {
  id: number;
  deal_id: number;
  storage_path: string | null;
  file_name: string | null;
  channel: CorrespondenceChannel | null;
  created_at: string;
}

// An email brought into the CRM by forwarding it to the inbound address (see
// /api/emails/inbound). Matched to a contact by any address on the message,
// then to that contact's property. Rendered read-only in the deal modal's
// Emails list and as a 📧 tile/dot on the timeline strip.
export interface Email {
  id: number;
  message_id: string | null;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  snippet: string | null;
  body_text: string | null;
  sent_at: string | null;
  contact_id: number | null;
  property_id: number | null;
  deal_id: number | null;
  matched: boolean;
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
  // The one photo (of this property's photos) flagged as its "next action"
  // photo — surfaced on the Next Actions page. Mirrors cover_photo_id.
  next_action_photo_id: number | null;
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
  // RFP (Request for Proposal) date — the Lead stage's key date, when the
  // customer requested a proposal. All-day (date only, no time).
  rfp_date: string | null;
  // Won date — the Sold stage's key date, when the deal was won. All-day.
  won_date: string | null;
  // Invoiced / Paid-in-Full dates — the last two stages' key dates. All-day.
  invoiced_date: string | null;
  paid_date: string | null;
  // The deal's scheduled work window — all-day (date only, no time). start_date
  // is the first day on the job, end_date the last. Either may be null.
  start_date: string | null;
  end_date: string | null;
  // Not a deal column — this is the title of whichever task (in the
  // `tasks` table) is flagged as this deal's next action, joined in at
  // fetch time. Never set directly; flag a task instead.
  next_action: string | null;
  // The deal's ⚡ next-action photo (a deal_photos id) — chosen in the photo
  // gallery and surfaced on the Next Actions page / Next Action Photos album.
  next_action_photo_id: number | null;
  appointment_date: string | null;
  property_id: number | null;
  value: number | null;
  stage: Stage;
  status: "Open" | "Closed";
  lost_at: string | null;
  proposal_pdf_path: string | null;
  // Backs the "Proposal link" field. (Column keeps its historical name; the
  // Aspire opportunity URL — the one "Parse from Aspire" reads — lives in
  // opportunity_link.)
  aspire_link: string | null;
  opportunity_link: string | null;
  // A photo/video is attached to an event first — the event is the base
  // unit of truth — and a deal is made up of the events attached to it.
  // There is no direct deal->photo relationship; every photo is reached by
  // way of its event.
  events: DealEvent[];
  // The deal's site plan image(s) — event-less deal photos marked
  // "Site_Plan_Image", uploaded from the estimator's Plan view. Kept separate
  // from `events` photos since they aren't jobsite/calendar photos.
  site_plan_photos: DealPhoto[];
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
  rfp_date?: string | null;
  won_date?: string | null;
  invoiced_date?: string | null;
  paid_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  property_id?: number | null;
  value?: number | null;
  stage?: Stage;
  lost_at?: string | null;
  aspire_link?: string | null;
  opportunity_link?: string | null;
}
