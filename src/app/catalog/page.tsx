import type { Metadata } from "next";
import { CatalogClient } from "./CatalogClient";

export const metadata: Metadata = {
  title: "Catalog · VoiceData",
  description: "Landscape estimator item catalog.",
};

export default function CatalogPage() {
  return <CatalogClient />;
}
