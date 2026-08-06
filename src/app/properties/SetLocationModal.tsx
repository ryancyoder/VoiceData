"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import type { LeafletMouseEvent, Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import styles from "./properties.module.css";
import { fetchWithTimeout } from "@/lib/withTimeout";

// Leaflet's default marker icon paths are relative to the package on disk,
// which breaks under bundlers that don't resolve those image assets —
// pointing at the same file names on a CDN sidesteps needing any bundler
// asset configuration for it.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const SEARCH_TIMEOUT_MS = 10000;
const SAVE_TIMEOUT_MS = 15000;
// Roughly the middle of the contiguous US — only ever shown when there
// isn't a single other geocoded property on file to center on instead.
const FALLBACK_CENTER: [number, number] = [39.8283, -98.5795];
const FALLBACK_ZOOM = 4;
const PINNED_ZOOM = 15;

interface SetLocationModalProps {
  propertyId: number;
  address: string;
  initialLatitude: number | null;
  initialLongitude: number | null;
  defaultCenter: [number, number] | null;
  onClose: () => void;
  onSaved: (latitude: number, longitude: number) => void;
}

// The bare HTTP call, with no state of its own — reused by both the search
// button and the on-open auto-search, which each drive their own
// loading/error state around it.
async function geocodeQuery(address: string): Promise<[number, number] | null> {
  const res = await fetchWithTimeout(
    "/api/properties/match-address",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) },
    SEARCH_TIMEOUT_MS
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Search failed");
  return data.latitude != null && data.longitude != null ? [data.latitude, data.longitude] : null;
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Pans/zooms the already-mounted map to a search result — MapContainer's
// own center/zoom props only apply once, at first render, so moving the
// map after that has to go through the map instance directly.
function FlyTo({ target }: { target: { pos: [number, number]; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target.pos, target.zoom);
  }, [target, map]);
  return null;
}

export default function SetLocationModal({
  propertyId,
  address,
  initialLatitude,
  initialLongitude,
  defaultCenter,
  onClose,
  onSaved,
}: SetLocationModalProps) {
  const [position, setPosition] = useState<[number, number] | null>(
    initialLatitude != null && initialLongitude != null ? [initialLatitude, initialLongitude] : null
  );
  const [flyTo, setFlyTo] = useState<{ pos: [number, number]; zoom: number } | null>(null);
  const [query, setQuery] = useState(address);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const center = position ?? defaultCenter ?? FALLBACK_CENTER;
  const zoom = position ? PINNED_ZOOM : defaultCenter ? 11 : FALLBACK_ZOOM;

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError("");
    try {
      const found = await geocodeQuery(trimmed);
      if (!found) {
        setSearchError("Couldn't find that address — click the map to drop the pin by hand, or try a different search.");
        return;
      }
      setPosition(found);
      setFlyTo({ pos: found, zoom: PINNED_ZOOM });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  // Best-effort head start: try the property's address on open, same as
  // typing it into the search bar and hitting Search, so there's often
  // already a pin to fine-tune instead of a blank map. Only when nothing's
  // geocoded yet — an existing pin means someone already resolved this.
  // The fetch is inlined here (rather than reusing handleSearch) so its
  // state updates are scoped to this effect, not a call into an outer
  // function, per the project's established fetch-in-effect pattern.
  useEffect(() => {
    const trimmed = address.trim();
    if (initialLatitude != null || initialLongitude != null || !trimmed) return;
    let cancelled = false;
    async function run() {
      setSearching(true);
      setSearchError("");
      try {
        const found = await geocodeQuery(trimmed);
        if (cancelled) return;
        if (!found) {
          setSearchError("Couldn't find that address — click the map to drop the pin by hand, or try a different search.");
          return;
        }
        setPosition(found);
        setFlyTo({ pos: found, zoom: PINNED_ZOOM });
      } catch (err) {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // Runs once, for the initial open only — deliberately not re-run if
    // props were to change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!position) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithTimeout(
        `/api/properties/${propertyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: position[0], longitude: position[1] }),
        },
        SAVE_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save location");
      onSaved(position[0], position[1]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save location");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={styles["modal-overlay"]}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className={`${styles["modal-panel"]} ${styles["location-modal-panel"]}`}>
        <div className={styles["modal-head"]}>
          <h2 className={styles["modal-title"]}>Set location</h2>
          <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={onClose} disabled={saving}>
            ×
          </button>
        </div>
        <p className={styles["location-modal-address"]}>{address}</p>
        <div className={styles["location-search-bar"]}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Search an address…"
            disabled={searching}
          />
          <button type="button" className={styles["nav-btn"]} onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError && <div className={styles["location-search-note"]}>{searchError}</div>}
        <p className={styles["location-modal-hint"]}>
          {position ? "Drag the pin to fine-tune, then save." : "Search an address above, or click the map to drop a pin."}
        </p>
        <MapContainer center={center} zoom={zoom} className={styles["location-modal-map"]} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPlace={(lat, lng) => setPosition([lat, lng])} />
          <FlyTo target={flyTo} />
          {position && (
            <Marker
              position={position}
              draggable
              eventHandlers={{
                dragend: (e: { target: LeafletMarker }) => {
                  const latlng = e.target.getLatLng();
                  setPosition([latlng.lat, latlng.lng]);
                },
              }}
            />
          )}
        </MapContainer>
        {error && <div className={styles["form-error"]}>{error}</div>}
        <div className={styles["form-actions"]}>
          <button type="button" className={styles["btn-cancel"]} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles["btn-submit"]} onClick={handleSave} disabled={saving || !position}>
            {saving ? "Saving…" : "Save location"}
          </button>
        </div>
      </div>
    </div>
  );
}
