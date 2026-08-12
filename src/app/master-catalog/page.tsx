import type { Metadata } from "next";
import { MasterCatalogPageClient } from "./MasterCatalogPageClient";

export const metadata: Metadata = {
  title: "Master Catalog · VoiceData",
  description: "The normalized master catalog — materials, applications, equipment, and assemblies.",
};

export default function MasterCatalogPage() {
  return <MasterCatalogPageClient />;
}
