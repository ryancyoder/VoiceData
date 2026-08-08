import type { Metadata } from "next";
import { PlantDatabaseClient } from "./PlantDatabaseClient";

export const metadata: Metadata = {
  title: "Plant Database · VoiceData",
  description: "Reusable plant and symbol library.",
};

export default function PlantsPage() {
  return <PlantDatabaseClient />;
}
