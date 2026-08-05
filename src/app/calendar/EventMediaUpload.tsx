"use client";

import { useRef, useState } from "react";
import styles from "./calendar.module.css";
import type { CalendarEvent, GeoPhoto } from "./CalendarClient";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { capturePosterFrame } from "@/lib/videoPoster";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

const UPLOAD_TIMEOUT_MS = 60000;

// A video's base-level attachment is to the event only — no deal is needed
// at upload time (the event can be attached to a deal separately, in the
// event's own edit form). Clicking the button opens the file picker and
// uploads immediately once a file is chosen.
export default function EventMediaUpload({
  event,
  onUploaded,
}: {
  event: CalendarEvent;
  onUploaded: (photo: GeoPhoto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const posterBlob = await capturePosterFrame(file);

      const urlRes = await fetchWithTimeout(
        `/api/events/${event.id}/videos/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoFileName: file.name, hasPoster: !!posterBlob }),
        },
        UPLOAD_TIMEOUT_MS
      );
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare video upload");

      const { error: videoUploadError } = await supabase.storage
        .from(DEAL_PHOTOS_BUCKET)
        .uploadToSignedUrl(urlData.video.path, urlData.video.token, file, {
          contentType: file.type || undefined,
        });
      if (videoUploadError) throw new Error(videoUploadError.message);

      let posterPath: string | null = null;
      if (posterBlob && urlData.poster) {
        const { error: posterUploadError } = await supabase.storage
          .from(DEAL_PHOTOS_BUCKET)
          .uploadToSignedUrl(urlData.poster.path, urlData.poster.token, posterBlob, {
            contentType: "image/jpeg",
          });
        if (!posterUploadError) posterPath = urlData.poster.path;
      }

      const finalizeRes = await fetchWithTimeout(
        `/api/events/${event.id}/videos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoPath: urlData.video.path, posterPath }),
        },
        UPLOAD_TIMEOUT_MS
      );
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save video");

      onUploaded(finalizeData.photo as GeoPhoto);
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
    }
  }

  return (
    <div className={styles["event-media-upload"]}>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (file) upload(file);
        }}
      />
      <button
        type="button"
        className={styles["nav-btn"]}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "+ Add Video"}
      </button>
      {error && <div className={styles["upload-error"]}>{error}</div>}
    </div>
  );
}
