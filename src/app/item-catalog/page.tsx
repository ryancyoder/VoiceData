import type { Metadata } from "next";
import { ItemCatalogClient } from "./ItemCatalogClient";

export const metadata: Metadata = {
  title: "Item Catalog · VoiceData",
  description: "Searchable catalog of estimator items with reference photos.",
};

export default function ItemCatalogPage() {
  return <ItemCatalogClient />;
}
