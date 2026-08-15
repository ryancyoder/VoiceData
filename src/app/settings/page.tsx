import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import StageDefaultsEditor from "./StageDefaultsEditor";
import KeyboardShortcuts from "./KeyboardShortcuts";
import OutlookCalendarSetting from "./OutlookCalendarSetting";
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
      <OutlookCalendarSetting />
      <KeyboardShortcuts />

      <div className={`${styles.card} ${styles.shortcutsCard}`}>
        <div className={styles.cardHead}>
          <div>
            <h2>Maintenance</h2>
            <p>
              Recompress already-stored deal &amp; plant photos to reclaim Supabase Storage space — with dry
              run, archive originals, download, and purge.
            </p>
          </div>
          <Link href="/admin/image-backfill" className={styles.toolLink}>
            Image backfill →
          </Link>
        </div>
      </div>
    </div>
  );
}
