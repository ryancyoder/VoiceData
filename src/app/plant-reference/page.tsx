import type { Metadata } from "next";
import { PlantReferenceClient } from "./PlantReferenceClient";

export const metadata: Metadata = {
  title: "Plant Reference · VoiceData",
  description: "Searchable landscape plant reference catalog.",
};

export default function PlantReferencePage() {
  return <PlantReferenceClient />;
}
