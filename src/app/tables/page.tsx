import TableBrowserClient from "./TableBrowserClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tables · VoiceData",
};

export default function TablesPage() {
  // Just the host, so the header can show which project is being browsed
  // without putting the full URL (or any key) on the page.
  let projectHost = "";
  try {
    projectHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    projectHost = "";
  }

  return <TableBrowserClient projectHost={projectHost} />;
}
