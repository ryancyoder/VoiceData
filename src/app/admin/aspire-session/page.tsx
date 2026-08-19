import { aspireSessionStatus } from "@/lib/aspireSession";
import AspireSessionClient from "./AspireSessionClient";

export const dynamic = "force-dynamic";

export default async function AspireSessionPage() {
  // Read the readiness state on the server so the page arrives already
  // populated — the client only re-fetches after it changes something.
  return <AspireSessionClient initialStatus={await aspireSessionStatus()} />;
}
