import type { Metadata } from "next";
import { EstimatorClient } from "./client";
import "./print.css";

export const metadata: Metadata = {
  title: "Estimator · VoiceData",
  description: "Landscape job estimating tool.",
};

export default function EstimatorPage() {
  return <EstimatorClient />;
}
