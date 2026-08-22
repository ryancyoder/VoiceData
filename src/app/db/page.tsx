import type { Metadata } from "next";
import DbBrowserClient from "./DbBrowserClient";

export const metadata: Metadata = {
  title: "Database · VoiceData",
  description: "Browse the Supabase tables behind the app.",
};

export const dynamic = "force-dynamic";

export default function DatabasePage() {
  return <DbBrowserClient />;
}
