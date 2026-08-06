"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
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

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const center = position ?? defaultCenter ?? FALLBACK_CENTER;
  const zoom = position ? PINNED_ZOOM : defaultCenter ? 11 : FALLBACK_ZOOM;

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
        <p className={styles["location-modal-hint"]}>
          {position ? "Drag the pin to fine-tune, then save." : "Click the map to drop a pin at this property."}
        </p>
        <MapContainer center={center} zoom={zoom} className={styles["location-modal-map"]} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPlace={(lat, lng) => setPosition([lat, lng])} />
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
