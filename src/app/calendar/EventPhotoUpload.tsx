"use client";

import { useRef, useState } from "react";
import styles from "./calendar.module.css";
import type { CalendarEvent, GeoPhoto } from "./CalendarClient";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { readClientExif } from "@/lib/clientExif";
import { compressImage } from "@/lib/compressImage";

const UPLOAD_TIMEOUT_MS = 60000;

// A photo's base-level attachment is to the event only — same as video, no
// deal is needed at upload time. Supports picking several photos at once,
// uploaded one at a time.
export default function EventPhotoUpload({
  event,
  onUploaded,
}: {
  event: CalendarEvent;
  onUploaded: (photo: GeoPhoto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadOne(file: File) {
    const { gps, takenAt } = await readClientExif(file);
    const uploadFile = await compressImage(file);

    const formData = new FormData();
    formData.append("file", uploadFile);
    if (gps) {
      formData.append("latitude", String(gps.latitude));
      formData.append("longitude", String(gps.longitude));
    }
    if (takenAt) formData.append("takenAt", takenAt);

    const res = await fetchWithTimeout(
      `/api/events/${event.id}/photos`,
      { method: "POST", body: formData },
      UPLOAD_TIMEOUT_MS
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    onUploaded(data.photo as GeoPhoto);
  }

  async function uploadAll(files: File[]) {
    setUploading(true);
    setError(null);
    setProgress({ done: 0, total: files.length });
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadOne(files[i]);
        setProgress({ done: i + 1, total: files.length });
      }
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Upload timed out — try again"
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setError(message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <div className={styles["event-media-upload"]}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length > 0) uploadAll(files);
        }}
      />
      <button
        type="button"
        className={styles["nav-btn"]}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {progress ? `Uploading ${progress.done}/${progress.total}…` : "+ Add Photo"}
      </button>
      {error && <div className={styles["upload-error"]}>{error}</div>}
    </div>
  );
}
