export const STAGES = [
  "Lead",
  "Propose",
  "Sent",
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
  contact_name: string | null;
  value: number | null;
  stage: Stage;
  status: "Open" | "Closed";
}

export interface DealInput {
  deal_name: string;
  company?: string | null;
  contact_name?: string | null;
  value?: number | null;
  stage?: Stage;
}
