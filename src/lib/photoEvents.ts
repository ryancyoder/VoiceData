export interface GeoPhoto {
  id: number;
  deal_id: number;
  storage_path: string;
  caption: string | null;
  created_at: string;
  taken_at: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PhotoEvent {
  id: string;
  start: string;
  end: string;
  latitude: number;
  longitude: number;
  dealIds: number[];
  photos: GeoPhoto[];
}

export const DEFAULT_MAX_GAP_MS = 60 * 60 * 1000;
export const DEFAULT_MAX_DISTANCE_METERS = 150;

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)));
}

function photoTimestamp(photo: GeoPhoto) {
  return photo.taken_at ?? photo.created_at;
}

interface ClusterState {
  photos: GeoPhoto[];
  latSum: number;
  lonSum: number;
}

function finalizeCluster(cluster: ClusterState): PhotoEvent {
  const photos = cluster.photos;
  return {
    id: `evt-${photos[0].id}`,
    start: photoTimestamp(photos[0]),
    end: photoTimestamp(photos[photos.length - 1]),
    latitude: cluster.latSum / photos.length,
    longitude: cluster.lonSum / photos.length,
    dealIds: Array.from(new Set(photos.map((p) => p.deal_id))),
    photos,
  };
}

/**
 * Groups geotagged photos into events: consecutive (by capture time) photos
 * within maxDistanceMeters of the cluster's running location, with no gap
 * longer than maxGapMs between successive photos, belong to the same event.
 * Photos without GPS coordinates are excluded — there's no location to
 * cluster them by.
 */
export function buildPhotoEvents(
  photos: GeoPhoto[],
  options: { maxGapMs?: number; maxDistanceMeters?: number } = {}
): PhotoEvent[] {
  const { maxGapMs = DEFAULT_MAX_GAP_MS, maxDistanceMeters = DEFAULT_MAX_DISTANCE_METERS } = options;

  const geotagged = photos
    .filter((p): p is GeoPhoto & { latitude: number; longitude: number } => p.latitude != null && p.longitude != null)
    .slice()
    .sort((a, b) => new Date(photoTimestamp(a)).getTime() - new Date(photoTimestamp(b)).getTime());

  const events: PhotoEvent[] = [];
  let current: ClusterState | null = null;

  for (const photo of geotagged) {
    const t = new Date(photoTimestamp(photo)).getTime();

    if (current) {
      const last = current.photos[current.photos.length - 1];
      const lastT = new Date(photoTimestamp(last)).getTime();
      const centroidLat = current.latSum / current.photos.length;
      const centroidLon = current.lonSum / current.photos.length;
      const gapMs = t - lastT;
      const distanceM = haversineMeters(centroidLat, centroidLon, photo.latitude, photo.longitude);

      if (gapMs <= maxGapMs && distanceM <= maxDistanceMeters) {
        current.photos.push(photo);
        current.latSum += photo.latitude;
        current.lonSum += photo.longitude;
        continue;
      }
      events.push(finalizeCluster(current));
    }

    current = { photos: [photo], latSum: photo.latitude, lonSum: photo.longitude };
  }
  if (current) events.push(finalizeCluster(current));

  return events;
}
