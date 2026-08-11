import { NextResponse } from "next/server";
import { getMasterCatalog } from "@/lib/estimator/masterCatalogAdapter";

// Read-only adapter: the estimator catalog served from the normalized master
// tables (materials / applications / equipment) instead of catalog_items,
// in the exact { items, deliveryRate, photos } shape the UI already consumes.
// Photos are keyed to catalog_items ids, which don't exist here yet, so this
// returns none for now (handled when the write path migrates).
export async function GET() {
  try {
    const { items, deliveryRate } = await getMasterCatalog();
    return NextResponse.json({ items, deliveryRate, photos: {} });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load master catalog" },
      { status: 500 }
    );
  }
}
