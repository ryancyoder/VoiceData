import { appMonogram, type App } from "@/lib/agentOps";
import styles from "../agentOps.module.css";

// An app's home-screen icon, or its initials until one has been fetched. The
// icon is normally a data: URL held in the row, so there is no third-party
// request when a list of these renders — a plain <img> is the right element,
// as elsewhere in this codebase.
export default function AppIcon({
  app,
  size = 34,
}: {
  app: Pick<App, "name" | "icon_url">;
  size?: number;
}) {
  if (app.icon_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={app.icon_url}
        alt=""
        width={size}
        height={size}
        className={styles.appIcon}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className={styles.appIconFallback} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {appMonogram(app.name)}
    </span>
  );
}
