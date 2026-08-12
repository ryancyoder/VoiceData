// Deterministic synthetic event id for a property's reference-photo group,
// offset far from real event ids and the site-plan groups (which use -dealId).
//
// Lives in its own plain module (NOT the "use client" gallery component) so the
// server component can call it directly — a client module's function exports
// can only be rendered or passed as props, never invoked from the server.
export function refEventId(propertyId: number): number {
  return -2_000_000 - propertyId;
}
