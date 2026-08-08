import type { Metadata } from "next";
import { DesignEditorClient } from "./client";

export const metadata: Metadata = {
  title: "Design · VoiceData",
  description: "Perspective landscape design editor.",
};

export default async function DesignEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DesignEditorClient id={id} />;
}
