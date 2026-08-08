import type { Metadata } from "next";
import { DesignClient } from "./client";

export const metadata: Metadata = {
  title: "Design · VoiceData",
  description: "Perspective landscape design tool.",
};

export default function DesignPage() {
  return <DesignClient />;
}
