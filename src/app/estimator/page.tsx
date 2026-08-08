import type { Metadata } from "next";
import { EstimateListClient } from "./EstimateListClient";

export const metadata: Metadata = {
  title: "Estimator · VoiceData",
  description: "Landscape job estimates.",
};

export default function EstimatorPage() {
  return <EstimateListClient />;
}
