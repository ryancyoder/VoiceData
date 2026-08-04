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
  jobsite_address: string | null;
  value: number | null;
  stage: Stage;
  status: "Open" | "Closed";
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
  jobsite_address?: string | null;
  value?: number | null;
  stage?: Stage;
}
