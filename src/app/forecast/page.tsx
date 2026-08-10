import { supabase } from "@/lib/supabaseClient";
import type { Stage } from "@/lib/salesBoard";
import { PLANNING_BLOCK_COLUMNS, rowToBlock, type PlanningBlock, type PlanningBlockRow } from "@/lib/planning/blocks";
import type { ForecastDeal, Placement } from "@/lib/planning/schedule";
import ForecastClient from "./ForecastClient";

export const dynamic = "force-dynamic";

type RawDeal = {
  id: number;
  deal_name: string;
  company: string | null;
  stage: Stage;
  estimated_hours: number | null;
  proposal_date: string | null;
  created_at: string | null;
};

export default async function ForecastPage() {
  const [blocksRes, dealsRes, defaultsRes, placementsRes] = await Promise.all([
    supabase.from("planning_blocks").select(PLANNING_BLOCK_COLUMNS).order("created_at", { ascending: true }),
    supabase
      .from("Sales Board")
      .select("id, deal_name, company, stage, estimated_hours, proposal_date, created_at, lost_at")
      .is("lost_at", null),
    supabase.from("stage_effort_defaults").select("stage, default_hours"),
    supabase.from("planning_placements").select("deal_id, block_id, date, position"),
  ]);

  if (blocksRes.error) throw new Error(`Failed to load forecast: ${blocksRes.error.message}`);
  if (dealsRes.error) throw new Error(`Failed to load forecast: ${dealsRes.error.message}`);
  if (defaultsRes.error) throw new Error(`Failed to load forecast: ${defaultsRes.error.message}`);
  if (placementsRes.error) throw new Error(`Failed to load forecast: ${placementsRes.error.message}`);

  const blocks: PlanningBlock[] = ((blocksRes.data ?? []) as unknown as PlanningBlockRow[]).map(rowToBlock);

  const deals: ForecastDeal[] = ((dealsRes.data ?? []) as unknown as RawDeal[]).map((d) => ({
    id: d.id,
    name: d.deal_name,
    company: d.company,
    stage: d.stage,
    estimatedHours: d.estimated_hours != null ? Number(d.estimated_hours) : null,
    orderDate: d.proposal_date ?? ((d.created_at ?? "").slice(0, 10) || "9999-12-31"),
  }));

  const defaults: Record<string, number> = {};
  for (const row of defaultsRes.data ?? []) defaults[row.stage as string] = Number(row.default_hours);

  const placements: Placement[] = (placementsRes.data ?? []).map((r) => ({
    dealId: r.deal_id as number,
    blockId: r.block_id as string | null,
    date: r.date as string,
    position: r.position as number,
  }));

  return <ForecastClient blocks={blocks} deals={deals} initialDefaults={defaults} initialPlacements={placements} />;
}
