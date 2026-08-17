"use client";

import styles from "./sales-board.module.css";
import type { UiDeal } from "./DealCard";

// The "Wide screen" hover preview (Settings → Sales Board view): a full-height
// pane sitting after the last stage column, showing the key photo of whichever
// deal card the pointer last rested on.
//
// It holds the last hovered deal rather than clearing on pointer-leave, so it
// stays useful while you read it. `deal` null means nothing has been hovered
// yet this session; a hovered deal whose property has no key photo says so
// explicitly rather than silently keeping the previous photo up, which would
// misattribute one property's photo to another deal.
export default function PropertyPhotoPane({
  deal,
  coverUrls,
}: {
  deal: UiDeal | null;
  coverUrls: Record<number, string>;
}) {
  const url = deal?.property_id != null ? coverUrls[deal.property_id] ?? null : null;

  return (
    <aside className={styles["photo-pane"]} aria-label="Property photo preview">
      <div className={styles["photo-pane-head"]}>
        <span className={styles["photo-pane-title"]}>Property photo</span>
      </div>

      <div className={styles["photo-pane-body"]}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Key photo for ${deal?.property?.address ?? deal?.deal_name ?? "property"}`} />
        ) : (
          <p className={styles["photo-pane-empty"]}>
            {deal ? "No key photo set for this property." : "Hover a deal card to see its property photo."}
          </p>
        )}
      </div>

      {deal && (
        <div className={styles["photo-pane-foot"]}>
          <div className={styles["photo-pane-deal"]}>{deal.deal_name}</div>
          {deal.property?.address && <div className={styles["photo-pane-addr"]}>{deal.property.address}</div>}
        </div>
      )}
    </aside>
  );
}
