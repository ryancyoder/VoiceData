import { NextResponse } from "next/server";
import { getMasterKits } from "@/lib/estimator/masterCatalogAdapter";

// Read-only adapter: assembly kits served from the normalized `assemblies` +
// roles tables, in the { kits } shape the UI already consumes.
export async function GET() {
  try {
    const kits = await getMasterKits();
    return NextResponse.json({ kits });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load master kits" },
      { status: 500 }
    );
  }
}
