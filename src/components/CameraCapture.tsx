"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/compressImage";
import { formatPropertyLabel } from "@/lib/salesBoard";

// ─── Web Speech typings ───────────────────────────────────────────────
// The Web Speech API isn't in TypeScript's DOM lib — just the bits used here.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// Safeguard against a recognizer that never fires onend (see QuickAddTask).
const MAX_LISTEN_MS = 45000;

interface Candidate {
  id: number;
  address: string;
  contactLastName: string | null;
  distanceMeters: number;
}

interface PropertyLite {
  id: number;
  address: string;
  contactLastName: string | null;
}

interface BatchItem {
  id: number;
  file: File;
  previewUrl: string;
  caption: string;
}

// null = no property chosen / file later; a number = a specific property.
type Selection = number | null;

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

export default function CameraCapture() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [review, setReview] = useState(false); // review/confirm sheet after Done
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyLite[]>([]);
  const [propFilter, setPropFilter] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<Selection>(null);
  const [listening, setListening] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const maxListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in sync with `batch` so capture/dictation handlers can read the
  // current list synchronously (no stale closures across rapid shutter taps).
  const batchRef = useRef<BatchItem[]>([]);
  const nextIdRef = useRef(0);

  function commitBatch(next: BatchItem[]) {
    batchRef.current = next;
    setBatch(next);
  }

  function setCaptionAt(index: number, caption: string) {
    commitBatch(batchRef.current.map((it, i) => (i === index ? { ...it, caption } : it)));
  }

  function showMessage(text: string, ms = 4000) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  // ─── Dictation (per photo) ──────────────────────────────────────────
  // Starts a fresh recognizer whose results write into batch item `index`.
  function startDictationFor(index: number) {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // silent — user can still type notes in the review sheet

    // Tear down any running recognizer first (rapid shutter taps).
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    finalTranscriptRef.current = "";

    recognition.onstart = () => setListening(true);
    recognition.onresult = (e) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interimChunk += result[0].transcript;
      }
      if (finalChunk) finalTranscriptRef.current += finalChunk;
      setCaptionAt(index, (finalTranscriptRef.current + " " + interimChunk).trim());
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was denied — you can still type the notes.",
        network: "Dictation needs an internet connection.",
      };
      showMessage(messages[e.error] || "Voice dictation failed — you can type the note instead.");
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      return;
    }
    if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
    maxListenTimerRef.current = setTimeout(() => recognitionRef.current?.stop(), MAX_LISTEN_MS);
  }

  function stopDictation() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
    maxListenTimerRef.current = null;
    setListening(false);
  }

  // ─── Live camera ────────────────────────────────────────────────────
  async function openCamera() {
    resetSession();
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const stream = await md.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
    } catch {
      fileInputRef.current?.click();
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  // Shutter: grab the frame, add it to the batch, and start dictating its note.
  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const index = batchRef.current.length;
    // Dictation must begin from this tap's user activation (iOS).
    startDictationFor(index);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      showMessage("Couldn't capture the photo — try again.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          showMessage("Couldn't capture the photo — try again.");
          return;
        }
        const id = ++nextIdRef.current;
        const file = new File([blob], `photo-${id}.jpg`, { type: "image/jpeg" });
        commitBatch([...batchRef.current, { id, file, previewUrl: URL.createObjectURL(file), caption: "" }]);
      },
      "image/jpeg",
      0.92
    );
  }

  // Done: leave the camera and open the confirm sheet for the whole batch.
  function finishBatch() {
    stopDictation();
    stopCamera();
    if (batchRef.current.length === 0) return; // nothing captured
    setReview(true);
    if (allProperties.length === 0) loadProperties();
    requestLocation();
  }

  // Fallback path (no live camera): pick one or more images from the library.
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const items = files.map((file) => ({
      id: ++nextIdRef.current,
      file,
      previewUrl: URL.createObjectURL(file),
      caption: "",
    }));
    commitBatch([...batchRef.current, ...items]);
    setReview(true);
    if (allProperties.length === 0) loadProperties();
    requestLocation();
  }

  // ─── Property resolution ────────────────────────────────────────────
  async function loadProperties() {
    try {
      const res = await fetch("/api/search");
      const data = await res.json();
      if (Array.isArray(data.properties)) {
        setAllProperties(
          data.properties.map((p: { id: number; label: string; contactLastName: string | null }) => ({
            id: p.id,
            address: p.label,
            contactLastName: p.contactLastName ?? null,
          }))
        );
      }
    } catch {
      /* manual picker still works from GPS candidates; non-fatal */
    }
  }

  function requestLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        try {
          const res = await fetch("/api/properties/match-location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(coords),
          });
          const data = await res.json();
          if (res.ok && Array.isArray(data.candidates) && data.candidates.length > 0) {
            setCandidates(data.candidates as Candidate[]);
            setSelectedPropertyId((cur) => (cur == null ? (data.candidates[0] as Candidate).id : cur));
          }
        } catch {
          /* no nearby match — user can still pick manually */
        }
      },
      () => {
        /* denied or unavailable — manual pick */
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function selectedPropertyLabel(): string | null {
    if (selectedPropertyId == null) return null;
    const cand = candidates.find((c) => c.id === selectedPropertyId);
    if (cand) return formatPropertyLabel(cand);
    const prop = allProperties.find((p) => p.id === selectedPropertyId);
    return prop ? formatPropertyLabel(prop) : null;
  }

  // ─── Save the whole batch ───────────────────────────────────────────
  async function saveBatch() {
    const items = batchRef.current;
    if (items.length === 0 || saveProgress) return;
    stopDictation();
    setSaveProgress({ done: 0, total: items.length });
    try {
      // Sequential so all photos in a batch land in one event for the property
      // (the first creates the event; the rest find and join it).
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const uploadFile = await compressImage(it.file);
        const formData = new FormData();
        formData.append("file", uploadFile);
        const cap = it.caption.trim();
        if (cap) formData.append("caption", cap);
        if (selectedPropertyId != null) formData.append("propertyId", String(selectedPropertyId));
        const res = await fetch("/api/photos", { method: "POST", body: formData });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Failed to save photo ${i + 1} of ${items.length}`);
        }
        setSaveProgress({ done: i + 1, total: items.length });
      }
      const n = items.length;
      const dest = selectedPropertyId != null ? selectedPropertyLabel() ?? "the selected property" : "unfiled photos";
      close();
      showMessage(`${n} photo${n === 1 ? "" : "s"} saved to ${dest}.`);
      router.refresh();
    } catch (err) {
      setSaveProgress(null);
      showMessage(err instanceof Error ? err.message : "Failed to save the photos.");
    }
  }

  function removeBatchItem(id: number) {
    const target = batchRef.current.find((it) => it.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    commitBatch(batchRef.current.filter((it) => it.id !== id));
  }

  // Reset all per-session state (called on open and close).
  function resetSession() {
    stopDictation();
    batchRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    commitBatch([]);
    setCandidates([]);
    setSelectedPropertyId(null);
    setPropFilter("");
    setSaveProgress(null);
  }

  function close() {
    stopDictation();
    stopCamera();
    resetSession();
    setReview(false);
  }

  // Attach the live stream once the <video> is mounted.
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        /* autoplay rejection is harmless — the stream still renders */
      });
    }
  }, [cameraOn]);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      recognitionRef.current?.abort();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      batchRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
  }, []);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const filteredProperties = allProperties
    .filter((p) => !candidateIds.has(p.id))
    .filter((p) => {
      const q = propFilter.trim().toLowerCase();
      return !q || p.address.toLowerCase().includes(q) || (p.contactLastName ?? "").toLowerCase().includes(q);
    })
    .slice(0, 8);

  const latestCaption = batch.length > 0 ? batch[batch.length - 1].caption : "";
  const saving = saveProgress != null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onFilesChosen}
        className="hidden"
      />

      <button
        type="button"
        onClick={openCamera}
        title="Photo + voice note"
        aria-label="Capture photos with voice notes"
        className="fixed bottom-[12rem] right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-lg hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>

      {cameraOn && (
        <div className="fixed inset-0 z-50 bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-contain" />

          {/* Cancel the whole batch. */}
          <button
            type="button"
            onClick={close}
            aria-label="Cancel"
            className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          {/* Status: count + live dictation of the latest photo. */}
          <div
            className="absolute left-1/2 flex max-w-[80vw] -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <span className="font-semibold">{batch.length} photo{batch.length === 1 ? "" : "s"}</span>
            {listening && <span className="text-red-400">● rec</span>}
            {latestCaption && <span className="truncate text-zinc-200">“{latestCaption}”</span>}
          </div>

          {/* Shutter + Done on the middle-right edge. */}
          <div
            className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-5"
            style={{ right: "max(1.25rem, env(safe-area-inset-right))" }}
          >
            <button
              type="button"
              onClick={capturePhoto}
              aria-label="Take photo"
              className="h-16 w-16 rounded-full border-4 border-white bg-white/30 ring-2 ring-black/20 active:bg-white/60"
            />
            <button
              type="button"
              onClick={finishBatch}
              disabled={batch.length === 0}
              aria-label="Done taking photos"
              className="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white shadow-lg disabled:opacity-40"
            >
              <span>Done</span>
              {batch.length > 0 && <span className="text-[0.65rem] font-normal">{batch.length}</span>}
            </button>
          </div>
        </div>
      )}

      {review && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={(e) => e.target === e.currentTarget && !saving && close()}
        >
          <div className="flex h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {batch.length} photo{batch.length === 1 ? "" : "s"} — confirm property
              </span>
              <button type="button" onClick={close} disabled={saving} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200" aria-label="Cancel">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <label className="mb-1.5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">Property (applies to all photos)</label>
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <button
                    key={`cand-${c.id}`}
                    type="button"
                    onClick={() => setSelectedPropertyId(c.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-base ${
                      selectedPropertyId === c.id ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    <span>{formatPropertyLabel(c)}</span>
                    <span className={selectedPropertyId === c.id ? "text-emerald-100" : "text-zinc-400"}>{distanceLabel(c.distanceMeters)}</span>
                  </button>
                ))}

                <input
                  value={propFilter}
                  onChange={(e) => setPropFilter(e.target.value)}
                  placeholder="Search other properties…"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
                />
                {propFilter.trim() &&
                  filteredProperties.map((p) => (
                    <button
                      key={`prop-${p.id}`}
                      type="button"
                      onClick={() => setSelectedPropertyId(p.id)}
                      className={`flex w-full items-center rounded-lg px-3 py-2.5 text-left text-base ${
                        selectedPropertyId === p.id ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                      }`}
                    >
                      {formatPropertyLabel(p)}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setSelectedPropertyId(null)}
                  className={`flex w-full items-center rounded-lg px-3 py-2.5 text-left text-base ${
                    selectedPropertyId == null ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  No property — file it later
                </button>
              </div>

              <label className="mb-1.5 mt-5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">Photos &amp; notes</label>
              <div className="space-y-3">
                {batch.map((item, i) => (
                  <div key={item.id} className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt={`Photo ${i + 1}`} className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                    <textarea
                      value={item.caption}
                      onChange={(e) => setCaptionAt(i, e.target.value)}
                      placeholder="Note for this photo…"
                      rows={3}
                      className="flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => removeBatchItem(item.id)}
                      disabled={saving}
                      aria-label="Remove photo"
                      className="h-8 w-8 shrink-0 self-start rounded-full text-zinc-400 hover:text-red-600 disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <button type="button" onClick={close} disabled={saving} className="flex-1 rounded-lg border border-zinc-300 py-2.5 text-base font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200">
                Cancel
              </button>
              <button type="button" onClick={saveBatch} disabled={saving || batch.length === 0} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                {saving ? `Saving ${saveProgress?.done}/${saveProgress?.total}…` : `Save ${batch.length} photo${batch.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="fixed bottom-[15.75rem] right-5 z-50 max-w-[min(320px,80vw)] rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {message}
        </div>
      )}
    </>
  );
}
