import { NextRequest, NextResponse } from "next/server";
import { findOrCreateProperty } from "@/lib/properties";

// Creates (or finds, if the address already exists) a property row. Used
// when a user importing photos/videos picks "add a new property" because
// none of the nearby matches are right.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { address?: unknown };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const property = await findOrCreateProperty(address);
    if (!property) {
      return NextResponse.json({ error: "Failed to create property" }, { status: 500 });
    }
    return NextResponse.json({ property }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create property" },
      { status: 500 }
    );
  }
}
