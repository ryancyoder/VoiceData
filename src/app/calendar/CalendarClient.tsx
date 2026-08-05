"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./calendar.module.css";
import { dealPhotoUrl } from "@/lib/salesBoard";
import type { PhotoEvent } from "@/lib/photoEvents";

export interface CalendarEvent extends PhotoEvent {
  deals: { id: number; name: string; company: string | null; jobsiteAddress: string | null }[];
}

const HOUR_HEIGHT = 48;
const MIN_EVENT_MS = 20 * 60 * 1000;

function startOfWeek(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}
function addDays(d: Date, n: number) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatHour(h: number) {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

interface LaidOutEvent {
  event: CalendarEvent;
  lane: number;
  totalLanes: number;
  top: number;
  height: number;
}

function layoutDay(day: Date, events: CalendarEvent[]): LaidOutEvent[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);

  const clipped = events
    .filter((e) => new Date(e.start) < dayEnd && new Date(e.end) >= dayStart)
    .map((e) => {
      const rawStart = new Date(e.start);
      const rawEnd = new Date(e.end);
      const start = rawStart < dayStart ? dayStart : rawStart;
      let end = rawEnd > dayEnd ? dayEnd : rawEnd;
      const minEnd = new Date(start.getTime() + MIN_EVENT_MS);
      if (end < minEnd) end = minEnd > dayEnd ? dayEnd : minEnd;
      return { event: e, start, end };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const laneEndTimes: number[] = [];
  const placed = clipped.map((item) => {
    const startMs = item.start.getTime();
    let lane = laneEndTimes.findIndex((endTime) => endTime <= startMs);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(item.end.getTime());
    } else {
      laneEndTimes[lane] = item.end.getTime();
    }
    return { ...item, lane };
  });
  const totalLanes = laneEndTimes.length || 1;

  return placed.map(({ event, lane, start, end }) => {
    const top = ((start.getTime() - dayStart.getTime()) / 60000 / 60) * HOUR_HEIGHT;
    const bottom = ((end.getTime() - dayStart.getTime()) / 60000 / 60) * HOUR_HEIGHT;
    return { event, lane, totalLanes, top, height: Math.max(4, bottom - top) };
  });
}

function eventLabel(event: CalendarEvent) {
  if (event.deals.length === 0) return "Unknown deal";
  if (event.deals.length === 1) return event.deals[0].name;
  return `${event.deals[0].name} +${event.deals.length - 1}`;
}

function timeRangeLabel(event: CalendarEvent) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (start.getTime() === end.getTime()) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function CalendarClient({
  events,
  ungeotaggedCount,
}: {
  events: CalendarEvent[];
  ungeotaggedCount: number;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 6 * HOUR_HEIGHT;
  }, []);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const eventsInWeek = useMemo(
    () => events.filter((e) => new Date(e.start) < weekEnd && new Date(e.end) >= weekStart),
    [events, weekStart, weekEnd]
  );

  const today = new Date();
  const rangeLabel = `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const activePhoto = selectedEvent && lightboxIndex != null ? selectedEvent.photos[lightboxIndex] ?? null : null;

  useEffect(() => {
    if (lightboxIndex == null || !selectedEvent) return;
    const photoCount = selectedEvent.photos.length;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowLeft") setLightboxIndex((i) => (i != null ? Math.max(0, i - 1) : i));
      else if (e.key === "ArrowRight") setLightboxIndex((i) => (i != null ? Math.min(photoCount - 1, i + 1) : i));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, selectedEvent]);

  useEffect(() => {
    if (lightboxIndex != null || !selectedEvent) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedEvent(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, selectedEvent]);

  return (
    <div className={styles.calendar}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Calendar</h1>
          <p>
            Job site events built from photo timestamps &amp; location ·{" "}
            <Link href="/photos" className={styles["brand-back"]}>
              Photos
            </Link>{" "}
            ·{" "}
            <Link href="/sales-board" className={styles["brand-back"]}>
              ← Sales Board
            </Link>
          </p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart((d) => addDays(d, -7))}>
          ‹ Prev
        </button>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart(startOfWeek(new Date()))}>
          Today
        </button>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart((d) => addDays(d, 7))}>
          Next ›
        </button>
        <span className={styles["range-label"]}>{rangeLabel}</span>
        {ungeotaggedCount > 0 && (
          <span className={styles["ungeotagged-note"]}>
            {ungeotaggedCount} photo{ungeotaggedCount === 1 ? "" : "s"} without location data can&apos;t be placed here.
          </span>
        )}
      </div>

      <div className={styles["week-wrap"]}>
        <div className={styles["week-header"]}>
          <div />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`${styles["day-header"]} ${isSameDay(day, today) ? styles["is-today"] : ""}`}
            >
              <div className={styles["day-name"]}>{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
              <div className={styles["day-num"]}>{day.getDate()}</div>
            </div>
          ))}
        </div>

        {eventsInWeek.length === 0 && <div className={styles["empty-week"]}>No located photo events this week.</div>}

        <div className={styles["week-body"]} ref={bodyRef}>
          <div className={styles["time-gutter"]} style={{ height: HOUR_HEIGHT * 24 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className={styles["hour-label"]} style={{ top: h * HOUR_HEIGHT }}>
                {formatHour(h)}
              </div>
            ))}
          </div>
          {weekDays.map((day) => {
            const laidOut = layoutDay(day, eventsInWeek);
            return (
              <div
                key={day.toISOString()}
                className={styles["day-column"]}
                style={{ height: HOUR_HEIGHT * 24, ["--hour-height" as string]: `${HOUR_HEIGHT}px` }}
              >
                {laidOut.map(({ event, lane, totalLanes, top, height }) => (
                  <button
                    key={event.id}
                    type="button"
                    className={styles["event-block"]}
                    style={{
                      top,
                      height,
                      left: `${(lane / totalLanes) * 100}%`,
                      width: `${100 / totalLanes}%`,
                    }}
                    onClick={() => {
                      setSelectedEvent(event);
                      setLightboxIndex(null);
                    }}
                  >
                    <div className={styles["event-title"]}>{eventLabel(event)}</div>
                    <div className={styles["event-meta"]}>
                      {timeRangeLabel(event)} · {event.photos.length} photo{event.photos.length === 1 ? "" : "s"}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {selectedEvent && !activePhoto && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEvent(null);
          }}
        >
          <div className={styles["modal-panel"]}>
            <div className={styles["modal-head"]}>
              <div>
                <h2 className={styles["modal-title"]}>{eventLabel(selectedEvent)}</h2>
                <div className={styles["modal-subtitle"]}>
                  {new Date(selectedEvent.start).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}{" "}
                  · {timeRangeLabel(selectedEvent)}
                </div>
              </div>
              <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={() => setSelectedEvent(null)}>
                ×
              </button>
            </div>

            <div className={styles["deal-list"]}>
              {selectedEvent.deals.map((deal) => (
                <div key={deal.id} className={styles["deal-chip"]}>
                  <div className={styles["deal-chip-name"]}>
                    {deal.name}
                    {deal.company ? ` · ${deal.company}` : ""}
                  </div>
                  {deal.jobsiteAddress && <div className={styles["deal-chip-meta"]}>{deal.jobsiteAddress}</div>}
                  <Link href={`/photos?deal=${deal.id}`} className={styles["deal-chip-link"]}>
                    View full album →
                  </Link>
                </div>
              ))}
            </div>

            <div className={styles["photo-grid"]}>
              {selectedEvent.photos.map((photo, i) => (
                <button
                  key={photo.id}
                  type="button"
                  className={styles["photo-thumb"]}
                  onClick={() => setLightboxIndex(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={dealPhotoUrl(photo.storage_path)} alt={photo.caption ?? eventLabel(selectedEvent)} loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedEvent && activePhoto && (
        <div
          className={styles["lightbox-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxIndex(null);
          }}
        >
          <div className={styles["lightbox-panel"]}>
            <div className={styles["lightbox-image-wrap"]}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dealPhotoUrl(activePhoto.storage_path)} alt={activePhoto.caption ?? eventLabel(selectedEvent)} />
            </div>
            <div className={styles["lightbox-foot"]}>
              <button
                type="button"
                className={styles["lightbox-nav"]}
                disabled={lightboxIndex === 0}
                onClick={() => setLightboxIndex((i) => (i != null ? Math.max(0, i - 1) : i))}
              >
                ‹ Prev
              </button>
              <button
                type="button"
                className={styles["lightbox-nav"]}
                disabled={lightboxIndex === selectedEvent.photos.length - 1}
                onClick={() =>
                  setLightboxIndex((i) => (i != null ? Math.min(selectedEvent.photos.length - 1, i + 1) : i))
                }
              >
                Next ›
              </button>
              <button type="button" className={styles["lightbox-nav"]} onClick={() => setLightboxIndex(null)}>
                Back to event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
