import type { Metadata } from "next";
import { EstimatorEditorClient } from "./client";
import "../print.css";

export const metadata: Metadata = {
  title: "Estimate · VoiceData",
  description: "Landscape job estimating tool.",
};

export default async function EstimatorEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EstimatorEditorClient id={id} />;
}
