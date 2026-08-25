"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import styles from "./properties.module.css";
import { formatPropertyLabel, STAGES, type Stage } from "@/lib/salesBoard";
import type { PropertyRow } from "./page";

// Sales-stage colors (light-mode hex, matching the stage CSS vars) so map pins
// read the same as the board. The map tiles are light, so the light palette is
// the right choice regardless of app theme.
const STAGE_HEX: Record<Stage, string> = {
  Lead: "#9CA3AF",
  Propose: "#EAB308",
  Sent: "#0891B2",
  Sold: "#9333EA",
  "Project Management": "#16A34A",
  Invoiced: "#DC2626",
  "Paid in Full": "#D4AF37",
};
const NO_DEAL_COLOR = "#6B7280";

// A property's representative stage is its least-advanced deal stage (earliest
// in the pipeline), so the pin flags the work still to be moved forward.
function propertyStage(p: PropertyRow): Stage | null {
  if (!p.dealStages || p.dealStages.length === 0) return null;
  return p.dealStages.reduce((best, s) => (STAGES.indexOf(s) < STAGES.indexOf(best) ? s : best));
}

// Colored teardrop pin as a divIcon (Leaflet's default icon is a fixed blue PNG).
const iconCache = new Map<string, L.DivIcon>();
function pinIcon(color: string): L.DivIcon {
  const cached = iconCache.get(color);
  if (cached) return cached;
  const html =
    `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M13 1C6.4 1 1 6.3 1 12.9 1 22 13 37 13 37s12-15 12-24.1C25 6.3 19.6 1 13 1Z" fill="${color}" stroke="#fff" stroke-width="2"/>` +
    `<circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>`;
  const icon = L.divIcon({
    html,
    className: styles["map-pin"],
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
    tooltipAnchor: [0, -38],
  });
  iconCache.set(color, icon);
  return icon;
}

type GeocodedProperty = PropertyRow & { latitude: number; longitude: number };

// Text a property is searchable by: contact name (last, first) and address.
function searchText(p: GeocodedProperty): string {
  return [p.contact?.last_name, p.contact?.first_name, p.address].filter(Boolean).join(" ").toLowerCase();
}

// Flies/fits the map to the current search matches. Rendered only while a query
// is active, so it never fights the initial center/zoom on load: one match flies
// in close, several fit their bounds.
function MapSearchController({ matches }: { matches: GeocodedProperty[] }) {
  const map = useMap();
  const key = matches.map((m) => m.id).join(",");
  useEffect(() => {
    if (matches.length === 0) return;
    if (matches.length === 1) {
      map.flyTo([matches[0].latitude, matches[0].longitude], Math.max(map.getZoom(), 15), { duration: 0.6 });
    } else {
      const bounds = L.latLngBounds(matches.map((m) => [m.latitude, m.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    }
    // Keyed on the matched-id set so it re-runs as the query narrows/widens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export default function PropertyMap({ properties }: { properties: PropertyRow[] }) {
  const geocoded = useMemo(
    () => properties.filter((p): p is GeocodedProperty => p.latitude != null && p.longitude != null),
    [properties]
  );

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? geocoded.filter((p) => searchText(p).includes(q)) : geocoded), [geocoded, q]);

  if (geocoded.length === 0) {
    return <div className={styles.empty}>No geocoded properties to show on the map yet.</div>;
  }

  const center: [number, number] = [
    geocoded.reduce((sum, p) => sum + p.latitude, 0) / geocoded.length,
    geocoded.reduce((sum, p) => sum + p.longitude, 0) / geocoded.length,
  ];

  return (
    <div className={styles["map-view"]}>
      <div className={styles["map-search"]}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          className={styles["map-search-input"]}
          placeholder="Search name or address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <span className={styles["map-search-count"]}>
            {matches.length === 0 ? "No matches" : `${matches.length} of ${geocoded.length}`}
          </span>
        )}
      </div>

      <MapContainer center={center} zoom={geocoded.length === 1 ? 14 : 9} className={styles["map-wrap"]} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {q && <MapSearchController matches={matches} />}
        {matches.map((p) => {
          const stage = propertyStage(p);
          return (
            <Marker key={p.id} position={[p.latitude, p.longitude]} icon={pinIcon(stage ? STAGE_HEX[stage] : NO_DEAL_COLOR)}>
              <Tooltip permanent direction="top" offset={[0, 0]} className={styles["map-pin-label"]}>
                {p.contact?.last_name?.trim() || formatPropertyLabel({ address: p.address, contactLastName: null })}
              </Tooltip>
              <Popup>
                <div className={styles["map-popup-title"]}>
                  {formatPropertyLabel({ address: p.address, contactLastName: p.contact?.last_name ?? null })}
                </div>
                <div className={styles["map-popup-detail"]}>
                  {stage ? stage : "No deals"} · {p.dealCount} deal{p.dealCount === 1 ? "" : "s"} · {p.eventCount} event{p.eventCount === 1 ? "" : "s"}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
