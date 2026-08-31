"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./sales-board.module.css";
import { flattenDealPhotos, STAGES, type Deal, type Stage } from "@/lib/salesBoard";

export type UiDeal = Deal & { _pending?: boolean; _error?: string };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// A stored plain date ("YYYY-MM-DD") as a minimalist "MM/DD". Built from the
// y/m/d parts directly (no Date parsing) so it never shifts a day in a
// negative-UTC timezone.
function formatProposalDate(isoDate: string) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

// The deal's all-day work window as a compact "03/03–03/07" range. A single
// day (or only a start set) collapses to just that one date.
function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${formatProposalDate(start)}–${formatProposalDate(end)}`;
  return formatProposalDate((start || end) as string);
}

const CHANNEL_ICON: Record<string, string> = { text: "💬", call: "📞", email: "✉️" };
const CHANNEL_ORDER = ["text", "call", "email"];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Most-recent logged touchpoint per channel (call/email/text) on a deal, with
// the two-digit day-of-month it was logged and whether that's over 30 days old.
function correspondenceChannelLogs(deal: UiDeal) {
  const latest = new Map<string, number>();
  for (const c of deal.correspondence ?? []) {
    if (!c.channel) continue;
    const t = new Date(c.created_at).getTime();
    const prev = latest.get(c.channel);
    if (prev == null || t > prev) latest.set(c.channel, t);
  }
  const now = Date.now();
  return CHANNEL_ORDER.filter((ch) => latest.has(ch)).map((ch) => {
    const t = latest.get(ch) as number;
    return {
      channel: ch,
      icon: CHANNEL_ICON[ch],
      day: String(new Date(t).getDate()).padStart(2, "0"),
      stale: now - t > THIRTY_DAYS_MS,
    };
  });
}

// Finger: hold this long (without moving) to grab a card — leaves quick swipes
// free to scroll the column. Pen/mouse: no wait — grab as soon as the pointer
// moves past DRAG_THRESHOLD, so an Apple Pencil just grabs and drags. A quick
// tap opens the deal; a double tap jumps to the deal's photo albums.
const DRAG_HOLD_MS = 450;
const MOVE_TOLERANCE = 10;
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 300;
// Pen/mouse: hold still this long (no drag) to arm opening the deal's Aspire
// opportunity link. The link opens on release — a real user gesture, so the
// browser won't block the new tab. Any drag past DRAG_THRESHOLD cancels it.
const LONG_PRESS_MS = 550;

// How the key-property-photo hover preview is presented (Settings → Sales
// Board view): not at all, a floating box beside the card, or handed to the
// board's wide-screen pane to draw.
export type HoverPhotoMode = "off" | "floating" | "pane";

// iPhone email-style swipe actions (phone view only). A horizontal drag on the
// card slides it to reveal action buttons: swipe left → trailing actions
// (Album / Flag / Lost), swipe right → the leading action (Advance a stage).
const SWIPE_DECIDE_PX = 8; // horizontal travel before a gesture becomes a swipe
const SWIPE_ACTION_W = 74; // px per trailing action button
const SWIPE_LEAD_W = 104; // px for the (wider) leading Advance button

// Key-property-photo hover preview (Settings → Sales Board view). Held back
// briefly so sweeping the pointer across a column doesn't strobe previews —
// in pane mode this also keeps the pane from thrashing on a passing cursor.
const HOVER_PHOTO_DELAY_MS = 250;
const HOVER_PHOTO_W = 260;
const HOVER_PHOTO_H = 190;
const HOVER_PHOTO_GAP = 10;
const HOVER_PHOTO_MARGIN = 8;

// Places the preview beside the card, flipping to its left when there's no room
// on the right and clamping to the viewport so it's never half off-screen.
// Fixed coordinates (not absolute) because the column body scrolls and would
// otherwise clip the preview.
function hoverPhotoPosition(rect: DOMRect) {
  let left = rect.right + HOVER_PHOTO_GAP;
  if (left + HOVER_PHOTO_W > window.innerWidth - HOVER_PHOTO_MARGIN) {
    left = rect.left - HOVER_PHOTO_W - HOVER_PHOTO_GAP;
  }
  return {
    left: Math.max(HOVER_PHOTO_MARGIN, Math.min(left, window.innerWidth - HOVER_PHOTO_W - HOVER_PHOTO_MARGIN)),
    top: Math.max(HOVER_PHOTO_MARGIN, Math.min(rect.top, window.innerHeight - HOVER_PHOTO_H - HOVER_PHOTO_MARGIN)),
  };
}

export default function DealCard({
  deal,
  color,
  showDescriptions,
  showNextAction,
  hoverPhotoMode,
  hoverPhotoUrl,
  onHoverPreview,
  onDragActivate,
  onOpen,
  onAlbums,
  isPhone = false,
  onToggleFlag,
  onToggleLost,
  onMoveStage,
}: {
  deal: UiDeal;
  color: string;
  showDescriptions: boolean;
  showNextAction: boolean;
  hoverPhotoMode: HoverPhotoMode;
  // The property's key photo, drawn by this card in "floating" mode. Null when
  // the property has no key photo set. Unused in "pane" mode — the board looks
  // the URL up itself for whichever deal it was handed.
  hoverPhotoUrl: string | null;
  // "pane" mode only: this card is now the one being hovered. Fires after the
  // same delay the floating box waits out, and fires even when the property has
  // no key photo, so the pane reflects the card under the pointer rather than
  // stranding whatever it showed last.
  onHoverPreview: (deal: UiDeal) => void;
  // Start dragging the given card element with the active pointer.
  onDragActivate: (card: HTMLElement, pointerId: number, clientX: number, clientY: number, deal: UiDeal) => void;
  onOpen: (deal: UiDeal) => void;
  onAlbums: (deal: UiDeal) => void;
  // Phone view: enables the email-style swipe actions below. The handlers are
  // only invoked in that mode, so they're optional for the desktop board.
  isPhone?: boolean;
  onToggleFlag?: (deal: UiDeal) => void;
  onToggleLost?: (deal: UiDeal) => void;
  onMoveStage?: (deal: UiDeal, stage: Stage) => void;
}) {
  const [pressing, setPressing] = useState(false);
  const [linkArmed, setLinkArmed] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressReadyRef = useRef(false);
  const pointerRef = useRef<{ id: number; x: number; y: number; el: HTMLElement; touch: boolean } | null>(null);
  const draggingRef = useRef(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Non-null once the hover preview is actually showing, holding its viewport
  // coordinates (measured when the delay elapses, not on enter).
  const [hoverPhotoPos, setHoverPhotoPos] = useState<{ top: number; left: number } | null>(null);
  const hoverPhotoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── iPhone swipe-to-reveal state ──────────────────────────────────
  // swipeX: current horizontal offset of the card (px). Negative = slid left
  // (trailing actions showing), positive = slid right (leading action showing).
  const [swipeX, setSwipeX] = useState(0);
  const [swipeAnimating, setSwipeAnimating] = useState(false);
  const swipeRef = useRef<{ x: number; y: number; base: number } | null>(null);
  const swipeModeRef = useRef<"idle" | "swiping" | "scroll">("idle");

  const stageIdx = STAGES.indexOf(deal.stage);
  const nextStage: Stage | null =
    stageIdx >= 0 && stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;
  // Trailing actions: Album, Flag, and (unless already lost) Lost.
  const trailWidth = SWIPE_ACTION_W * 3;
  const leadWidth = nextStage ? SWIPE_LEAD_W : 0;

  function closeSwipe() {
    setSwipeAnimating(true);
    setSwipeX(0);
  }

  function runSwipeAction(fn: () => void) {
    closeSwipe();
    fn();
  }

  function handleSwipeDown(e: React.PointerEvent<HTMLDivElement>) {
    if (deal._pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, base: swipeX };
    swipeModeRef.current = "idle";
    setSwipeAnimating(false);
  }

  function handleSwipeMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = swipeRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (swipeModeRef.current === "idle") {
      if (Math.abs(dx) > SWIPE_DECIDE_PX && Math.abs(dx) > Math.abs(dy)) {
        swipeModeRef.current = "swiping";
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
      } else if (Math.abs(dy) > SWIPE_DECIDE_PX && Math.abs(dy) > Math.abs(dx)) {
        // Vertical intent — let the column scroll, ignore this gesture.
        swipeModeRef.current = "scroll";
      }
    }
    if (swipeModeRef.current === "swiping") {
      e.preventDefault();
      const next = Math.max(-trailWidth, Math.min(leadWidth, s.base + dx));
      setSwipeX(next);
    }
  }

  function handleSwipeUp(e: React.PointerEvent<HTMLDivElement>) {
    const s = swipeRef.current;
    const mode = swipeModeRef.current;
    swipeRef.current = null;
    swipeModeRef.current = "idle";
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (mode === "swiping") {
      // Snap to whichever rest position the release is closest to.
      setSwipeAnimating(true);
      setSwipeX((x) => (x < -trailWidth / 2 ? -trailWidth : x > leadWidth / 2 ? leadWidth : 0));
      return;
    }
    if (mode === "scroll" || !s) return;
    // A tap: close an open card, otherwise open the deal.
    if (swipeX !== 0) {
      closeSwipe();
      return;
    }
    onOpen(deal);
  }

  function handleSwipeCancel(e: React.PointerEvent<HTMLDivElement>) {
    swipeRef.current = null;
    swipeModeRef.current = "idle";
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    closeSwipe();
  }

  function clearHoverPhoto() {
    if (hoverPhotoTimerRef.current) {
      clearTimeout(hoverPhotoTimerRef.current);
      hoverPhotoTimerRef.current = null;
    }
    setHoverPhotoPos(null);
  }

  function scheduleHoverPhoto(el: HTMLElement) {
    if (hoverPhotoMode === "off") return;
    // Nothing to float and nothing to hand over — skip the timer entirely.
    if (hoverPhotoMode === "floating" && !hoverPhotoUrl) return;
    clearHoverPhoto();
    hoverPhotoTimerRef.current = setTimeout(() => {
      hoverPhotoTimerRef.current = null;
      if (hoverPhotoMode === "pane") {
        onHoverPreview(deal);
      } else {
        setHoverPhotoPos(hoverPhotoPosition(el.getBoundingClientRect()));
      }
    }, HOVER_PHOTO_DELAY_MS);
  }

  // The preview is pinned to viewport coordinates measured once, so any scroll
  // (the column body, the board's horizontal strip, the page) or resize leaves
  // it stranded beside where the card used to be. Dismiss instead of tracking —
  // the pointer has effectively left the card anyway.
  useEffect(() => {
    if (!hoverPhotoPos) return;
    const dismiss = () => setHoverPhotoPos(null);
    window.addEventListener("scroll", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, { capture: true });
      window.removeEventListener("resize", dismiss);
    };
  }, [hoverPhotoPos]);

  // A card can unmount mid-delay (drag reorder, stage change, refresh) — drop
  // the pending timer with it.
  useEffect(() => {
    return () => {
      if (hoverPhotoTimerRef.current) clearTimeout(hoverPhotoTimerRef.current);
    };
  }, []);

  function clearHold() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setPressing(false);
  }

  function clearLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressReadyRef.current = false;
    setLinkArmed(false);
  }

  function openOpportunityLink() {
    if (deal.opportunity_link) window.open(deal.opportunity_link, "_blank", "noopener,noreferrer");
  }

  function startDrag(p: { id: number; x: number; y: number; el: HTMLElement }) {
    clearHold();
    clearLongPress();
    clearHoverPhoto();
    draggingRef.current = true;
    // Suppress native scrolling for the rest of a finger drag too (pen/mouse
    // were already suppressed on hover/down).
    p.el.style.touchAction = "none";
    onDragActivate(p.el, p.id, p.x, p.y, deal);
  }

  // Apple Pencil (and a mouse) hover over a card before pressing. Pre-arming
  // touch-action:none on hover means a grab gesture — even a vertical one —
  // starts without the column trying to scroll and stealing the drag. A finger
  // never hovers, so it keeps native scrolling.
  function handlePointerEnter(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    (e.currentTarget as HTMLElement).style.touchAction = "none";
    // Hover is a pointer-only concept — a finger "enters" a card on tap, which
    // would flash the preview over whatever the tap was about to do.
    scheduleHoverPhoto(e.currentTarget as HTMLElement);
  }
  function handlePointerLeave(e: React.PointerEvent<HTMLDivElement>) {
    clearHoverPhoto();
    if (!draggingRef.current && !pointerRef.current) (e.currentTarget as HTMLElement).style.touchAction = "";
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (deal._pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Pressing means opening, dragging, or arming the link — get the preview
    // out of the way for all three (and out from under .is-pressing's
    // transform, which would otherwise become its containing block).
    clearHoverPhoto();
    const el = e.currentTarget as HTMLElement;
    const touch = e.pointerType === "touch";
    // Pen/mouse never scrolls the column — kill native panning up front so a
    // vertical grab drags instead of scrolling.
    if (!touch) el.style.touchAction = "none";
    draggingRef.current = false;
    longPressReadyRef.current = false;
    setLinkArmed(false);
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, el, touch };
    setPressing(true);
    // Finger: arm the hold-to-grab timer. Pen/mouse: nothing here — the grab
    // fires on movement in handlePointerMove instead.
    if (touch) {
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        const p = pointerRef.current;
        if (p) startDrag(p);
      }, DRAG_HOLD_MS);
    } else if (deal.opportunity_link) {
      // Pen/mouse: holding still (no drag) arms opening the opportunity link on
      // release. Movement past the drag threshold cancels it in handlePointerMove.
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (!draggingRef.current) {
          longPressReadyRef.current = true;
          setLinkArmed(true);
        }
      }, LONG_PRESS_MS);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointerRef.current;
    if (!p || e.pointerId !== p.id || draggingRef.current) return;
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.touch) {
      // Finger moved before the hold completed — it's a scroll, not a grab.
      if (dist > MOVE_TOLERANCE) {
        clearHold();
        pointerRef.current = null;
      }
    } else if (dist > DRAG_THRESHOLD) {
      // Pen/mouse crossed the drag threshold — grab immediately.
      startDrag(p);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    clearHold();
    const armed = longPressReadyRef.current;
    clearLongPress();
    const p = pointerRef.current;
    // A finger interaction restores native scrolling on release (pen/mouse keep
    // it suppressed while hovering; pointerleave clears it when they leave).
    if (p?.touch) p.el.style.touchAction = "";
    if (draggingRef.current) {
      draggingRef.current = false;
      pointerRef.current = null;
      return;
    }
    // Long press completed without dragging — open the opportunity link and
    // suppress the tap-to-open that a release would otherwise trigger.
    if (armed) {
      pointerRef.current = null;
      lastTapRef.current = 0;
      openOpportunityLink();
      return;
    }
    pointerRef.current = null;
    if (!p || e.pointerId !== p.id) return;
    // A tap. Distinguish single (open deal) from double (albums).
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      onAlbums(deal);
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        lastTapRef.current = 0;
        onOpen(deal);
      }, DOUBLE_TAP_MS);
    }
  }

  function handlePointerCancel() {
    clearHold();
    clearLongPress();
    clearHoverPhoto();
    const p = pointerRef.current;
    if (p?.touch) p.el.style.touchAction = "";
    draggingRef.current = false;
    pointerRef.current = null;
  }

  const cardBody = (
    <>
      <div className={styles["card-top"]}>
        <div className={styles["card-name"]}>
          {deal.flagged && (
            <span className={styles["card-flag"]} title="Flagged — loose end to tie up">
              🚩
            </span>
          )}
          {deal.deal_name}
          {showDescriptions && deal.proposal_description && (
            <span className={styles["card-name-desc"]}> — {deal.proposal_description}</span>
          )}
        </div>
        {!!deal.value && <div className={styles["card-value"]}>{currency.format(deal.value)}</div>}
        {deal.stage === "Propose" && flattenDealPhotos(deal).length > 0 && (
          <div className={styles["card-photo-badge"]} aria-hidden="true">
            📷
          </div>
        )}
        {deal.stage === "Sent" && deal.proposal_pdf_path && (
          <div className={styles["card-doc-badge"]} aria-hidden="true">
            📄
          </div>
        )}
      </div>

      {deal.stage === "Propose" && deal.appointment_date && (
        <div className={styles["card-proposal-date"]}>Appt {formatProposalDate(deal.appointment_date)}</div>
      )}

      {deal.stage === "Sent" && deal.proposal_date && (
        <div className={styles["card-proposal-date"]}>Sent {formatProposalDate(deal.proposal_date)}</div>
      )}

      {deal.stage === "Sent" && correspondenceChannelLogs(deal).length > 0 && (
        <div className={styles["card-corr-icons"]}>
          {correspondenceChannelLogs(deal).map((log) => (
            <span key={log.channel} className={styles["card-corr-icon"]} title={`Last ${log.channel} logged`}>
              <span aria-hidden="true">{log.icon}</span>
              <span className={`${styles["card-corr-day"]} ${log.stale ? styles["is-stale"] : ""}`}>{log.day}</span>
            </span>
          ))}
        </div>
      )}

      {formatDateWindow(deal.start_date, deal.end_date) && (
        <div className={styles["card-schedule-date"]}>Prod {formatDateWindow(deal.start_date, deal.end_date)}</div>
      )}

      {showNextAction && deal.next_action && (
        <div className={`${styles["card-desc"]} ${styles["card-next-action"]}`}>{"> " + deal.next_action}</div>
      )}

      {deal._error && <div className={styles["card-error"]}>{deal._error}</div>}
    </>
  );

  // ── Phone: email-style swipe card ─────────────────────────────────
  // The action buttons sit behind the card; swiping the card aside reveals
  // them. Tapping the card opens the deal (or closes it if it's open).
  if (isPhone) {
    return (
      <div className={styles["swipe-card"]} data-swipe-open={swipeX !== 0 ? "1" : undefined}>
        {nextStage && (
          <div className={styles["swipe-lead"]} aria-hidden={swipeX <= 0}>
            <button
              type="button"
              className={`${styles["swipe-action"]} ${styles["swipe-advance"]}`}
              style={{ width: SWIPE_LEAD_W }}
              onClick={() => onMoveStage && runSwipeAction(() => onMoveStage(deal, nextStage))}
              title={`Move to ${nextStage}`}
            >
              <span className={styles["swipe-action-icon"]} aria-hidden="true">
                →
              </span>
              <span className={styles["swipe-action-label"]}>{nextStage}</span>
            </button>
          </div>
        )}
        <div className={styles["swipe-trail"]} aria-hidden={swipeX >= 0}>
          <button
            type="button"
            className={`${styles["swipe-action"]} ${styles["swipe-album"]}`}
            style={{ width: SWIPE_ACTION_W }}
            onClick={() => runSwipeAction(() => onAlbums(deal))}
            title="Open photo album"
          >
            <span className={styles["swipe-action-icon"]} aria-hidden="true">
              🖼️
            </span>
            <span className={styles["swipe-action-label"]}>Album</span>
          </button>
          <button
            type="button"
            className={`${styles["swipe-action"]} ${styles["swipe-flag"]} ${deal.flagged ? styles["is-on"] : ""}`}
            style={{ width: SWIPE_ACTION_W }}
            onClick={() => onToggleFlag && runSwipeAction(() => onToggleFlag(deal))}
            title={deal.flagged ? "Remove flag" : "Flag as loose end"}
          >
            <span className={styles["swipe-action-icon"]} aria-hidden="true">
              🚩
            </span>
            <span className={styles["swipe-action-label"]}>{deal.flagged ? "Unflag" : "Flag"}</span>
          </button>
          <button
            type="button"
            className={`${styles["swipe-action"]} ${styles["swipe-lost"]}`}
            style={{ width: SWIPE_ACTION_W }}
            onClick={() => onToggleLost && runSwipeAction(() => onToggleLost(deal))}
            title="Mark deal lost"
          >
            <span className={styles["swipe-action-icon"]} aria-hidden="true">
              ✕
            </span>
            <span className={styles["swipe-action-label"]}>Lost</span>
          </button>
        </div>
        <div
          className={[
            styles.card,
            deal._pending ? styles["is-pending"] : "",
            deal._error ? styles["is-error"] : "",
            swipeX !== 0 ? styles["is-swiped"] : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            ["--col-color" as string]: color,
            transform: `translateX(${swipeX}px)`,
            transition: swipeAnimating ? "transform 0.2s ease" : "none",
          }}
          data-card
          data-id={deal.id}
          tabIndex={0}
          role="button"
          aria-label={`${deal.deal_name} — tap to open, swipe for actions`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(deal);
            }
          }}
          onPointerDown={handleSwipeDown}
          onPointerMove={handleSwipeMove}
          onPointerUp={handleSwipeUp}
          onPointerCancel={handleSwipeCancel}
          onTransitionEnd={() => setSwipeAnimating(false)}
        >
          {cardBody}
        </div>
      </div>
    );
  }

  return (
    <>
    <div
      className={[
        styles.card,
        deal._pending ? styles["is-pending"] : "",
        deal._error ? styles["is-error"] : "",
        pressing ? styles["is-pressing"] : "",
        linkArmed ? styles["is-link-armed"] : "",
        deal.opportunity_link ? styles["is-linked"] : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--col-color" as string]: color }}
      data-card
      data-id={deal.id}
      tabIndex={0}
      role="button"
      aria-label={`${deal.deal_name} — tap to open, double-tap for photos, hold to move${
        deal.opportunity_link ? ", long-press to open opportunity link" : ""
      }`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(deal);
        }
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {cardBody}
    </div>

    {/* Rendered as the card's sibling, not its child, so .is-pressing's
        transform can never turn the card into this fixed box's containing
        block. Decorative — the card itself carries the accessible name. */}
    {hoverPhotoMode === "floating" && hoverPhotoUrl && hoverPhotoPos && (
      <div
        className={styles["card-hover-photo"]}
        style={{ top: hoverPhotoPos.top, left: hoverPhotoPos.left }}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hoverPhotoUrl} alt="" draggable={false} />
      </div>
    )}
    </>
  );
}
