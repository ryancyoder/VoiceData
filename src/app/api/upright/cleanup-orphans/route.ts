import { NextResponse } from "next/server";
import { cleanupOrphanUprightCopies } from "@/lib/uprightImport";

export const dynamic = "force-dynamic";

// Deletes the leftover copied files from the old copy-based Upright import
// (`property-<id>/upright-<uuid>.<ext>` in the deal-photos bucket) that no
// deal_photos row references any more. Idempotent — returns { deleted, orphans }.
export async function POST() {
  try {
    const result = await cleanupOrphanUprightCopies();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cleanup failed" },
      { status: 500 }
    );
  }
}
