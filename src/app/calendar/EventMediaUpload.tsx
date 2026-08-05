"use client";

import { useRef, useState } from "react";
import styles from "./calendar.module.css";
import type { CalendarEvent, DealOption, GeoPhoto } from "./CalendarClient";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { capturePosterFrame } from "@/lib/videoPoster";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

const UPLOAD_TIMEOUT_MS = 60000;

// A video always needs a deal_id (deal_photos requires one), so when the
// event is already tied to exactly one deal we upload immediately on file
// select; otherwise a small inline picker asks which deal it belongs to.
export default function EventMediaUpload({
  event,
  dealOptions,
  onUploaded,
}: {
  event: CalendarEvent;
  dealOptions: DealOption[];
  onUploaded: (photo: GeoPhoto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dealId, setDealId] = useState<number | "">(event.dealIds.length === 1 ? event.dealIds[0] : "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDealPicker = event.dealIds.length !== 1;

  function reset() {
    setPendingFile(null);
    setUploading(false);
  }

  async function upload(file: File, targetDealId: number) {
    setUploading(true);
    setError(null);
    try {
      const posterBlob = await capturePosterFrame(file);

      const urlRes = await fetchWithTimeout(
        `/api/sales-board/${targetDealId}/videos/upload-url`,
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

      // Upload straight to this event — no time+location auto-matching,
      // since we already know exactly which event it belongs to.
      const finalizeRes = await fetchWithTimeout(
        `/api/sales-board/${targetDealId}/videos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoPath: urlData.video.path, posterPath, eventId: event.id }),
        },
        UPLOAD_TIMEOUT_MS
      );
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save video");

      onUploaded(finalizeData.photo as GeoPhoto);
      reset();
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Upload timed out — try again"
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setError(message);
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
          if (!file) return;
          setError(null);
          if (needsDealPicker) {
            setPendingFile(file);
          } else {
            upload(file, dealId as number);
          }
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

      {pendingFile && (
        <div className={styles["event-media-picker"]}>
          <select value={dealId} onChange={(e) => setDealId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Which deal?</option>
            {dealOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.deal_name}
                {d.company ? ` (${d.company})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles["card-edit-save"]}
            disabled={dealId === "" || uploading}
            onClick={() => upload(pendingFile, dealId as number)}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <button type="button" className={styles["card-edit-cancel"]} onClick={reset} disabled={uploading}>
            Cancel
          </button>
        </div>
      )}

      {error && <div className={styles["upload-error"]}>{error}</div>}
    </div>
  );
}
