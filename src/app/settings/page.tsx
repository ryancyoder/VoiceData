import { supabase } from "@/lib/supabaseClient";
import StageDefaultsEditor from "./StageDefaultsEditor";
import KeyboardShortcuts from "./KeyboardShortcuts";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { data, error } = await supabase.from("stage_effort_defaults").select("stage, default_hours");
  if (error) throw new Error(`Failed to load settings: ${error.message}`);

  const defaults: Record<string, number> = {};
  for (const row of data ?? []) defaults[row.stage as string] = Number(row.default_hours);

  return (
    <div className={styles.settings}>
      <div className={styles.header}>
        <h1>Settings</h1>
        <p>Planning &amp; forecast configuration.</p>
      </div>
      <StageDefaultsEditor initialDefaults={defaults} />
      <KeyboardShortcuts />
    </div>
  );
}
