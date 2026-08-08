import type { Metadata } from "next";
import { DesignListClient } from "./DesignListClient";

export const metadata: Metadata = {
  title: "Designs · VoiceData",
  description: "Perspective landscape designs.",
};

export default function DesignListPage() {
  return <DesignListClient />;
}
