import SiteVisitClient from "./SiteVisitClient";

export const dynamic = "force-dynamic";

// The Site Visit tile. Everything is loaded through /api/site-visit once a deal
// is chosen — the page itself only has to mount the client.
export default function SiteVisitPage() {
  return <SiteVisitClient />;
}
