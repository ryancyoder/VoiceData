import type { Metadata } from "next";
import { CatalogPageClient } from "./CatalogPageClient";

export const metadata: Metadata = {
  title: "Catalog · VoiceData",
  description: "Landscape estimator item catalog — editor and photo gallery.",
};

export default function CatalogPage() {
  return <CatalogPageClient />;
}
