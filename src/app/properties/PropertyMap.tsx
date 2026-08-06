"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import styles from "./properties.module.css";
import { formatPropertyLabel } from "@/lib/salesBoard";
import type { PropertyRow } from "./page";

// Leaflet's default marker icon paths are relative to the package on disk,
// which breaks under bundlers that don't resolve those image assets —
// pointing at the same file names on a CDN sidesteps needing any bundler
// asset configuration for it.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type GeocodedProperty = PropertyRow & { latitude: number; longitude: number };

export default function PropertyMap({ properties }: { properties: PropertyRow[] }) {
  const geocoded = properties.filter((p): p is GeocodedProperty => p.latitude != null && p.longitude != null);

  if (geocoded.length === 0) {
    return <div className={styles.empty}>No geocoded properties to show on the map yet.</div>;
  }

  const center: [number, number] = [
    geocoded.reduce((sum, p) => sum + p.latitude, 0) / geocoded.length,
    geocoded.reduce((sum, p) => sum + p.longitude, 0) / geocoded.length,
  ];

  return (
    <MapContainer center={center} zoom={geocoded.length === 1 ? 14 : 9} className={styles["map-wrap"]} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {geocoded.map((p) => (
        <Marker key={p.id} position={[p.latitude, p.longitude]}>
          <Popup>
            <div className={styles["map-popup-title"]}>
              {formatPropertyLabel({ address: p.address, contactLastName: p.contact?.last_name ?? null })}
            </div>
            <div className={styles["map-popup-detail"]}>
              {p.dealCount} deal{p.dealCount === 1 ? "" : "s"} · {p.eventCount} event{p.eventCount === 1 ? "" : "s"}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
