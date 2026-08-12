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

// null = no property chosen yet / file later; a number = a specific property.
type Selection = number | null;

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

export default function CameraCapture() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyLite[]>([]);
  const [propFilter, setPropFilter] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<Selection>(null);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Device location is used only to suggest the nearest property — it is
  // deliberately NOT sent with the upload. The chosen property drives which
  // event/album the photo files under; sending raw device GPS would let the
  // server match the photo to whatever event is physically nearest (e.g. from
  // the office), overriding the user's explicit property choice.

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const captionBaseRef = useRef(""); // caption text present when dictation (re)starts
  const maxListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showMessage(text: string, ms = 4000) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  // ─── Dictation ──────────────────────────────────────────────────────
  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showMessage("Voice dictation isn't supported in this browser — you can still type the note.");
      return;
    }
    if (recognitionRef.current) return; // already running

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    finalTranscriptRef.current = "";
    // Append dictation onto whatever is already in the caption field.
    captionBaseRef.current = caption ? caption.trimEnd() : "";

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
      const spoken = (finalTranscriptRef.current + " " + interimChunk).trim();
      setCaption([captionBaseRef.current, spoken].filter(Boolean).join(" "));
    };

    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was denied — tap the mic to try again, or type the note.",
        network: "Dictation needs an internet connection.",
      };
      showMessage(messages[e.error] || "Voice dictation failed — tap the mic to retry.");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      maxListenTimerRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if called twice in quick succession — ignore.
      recognitionRef.current = null;
      return;
    }
    maxListenTimerRef.current = setTimeout(() => recognitionRef.current?.stop(), MAX_LISTEN_MS);
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function toggleListening() {
    if (listening) stopListening();
    else startListening();
  }

  // ─── Capture ────────────────────────────────────────────────────────
  // Clear any prior draft state; called synchronously at the capture gesture.
  function prepareForCapture() {
    setCaption("");
    setCandidates([]);
    setSelectedPropertyId(null);
    setPropFilter("");
  }

  // Move from a captured File into the review/annotate sheet. Dictation is
  // started separately, at the gesture site, so iOS keeps the user activation.
  function beginReview(captured: File) {
    setFile(captured);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(captured);
    });
    setOpen(true);
    if (allProperties.length === 0) loadProperties();
    requestLocation();
  }

  // Live in-app camera (getUserMedia) so a single shutter tap captures the
  // frame — no native iOS "Use Photo / Retake" confirmation. Falls back to the
  // native file picker when a live camera isn't available or is denied.
  async function openCamera() {
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
      // No camera, or permission denied — fall back to the native picker.
      fileInputRef.current?.click();
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  // Grab the current video frame straight into the review sheet.
  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Speech recognition must begin from this tap's user activation (iOS).
    prepareForCapture();
    startListening();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stopCamera();
      showMessage("Couldn't capture the photo — try again.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          showMessage("Couldn't capture the photo — try again.");
          return;
        }
        beginReview(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  }

  // Fallback path: a photo chosen via the native file input.
  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    // Reset the input so picking the same file again re-fires change.
    e.target.value = "";
    if (!chosen) return;
    prepareForCapture();
    // Start dictation synchronously within this change gesture (iOS).
    startListening();
    beginReview(chosen);
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
            // Preselect the nearest so the common case is one tap to save,
            // but only if the user hasn't already chosen something.
            setSelectedPropertyId((cur) => (cur == null ? (data.candidates[0] as Candidate).id : cur));
          }
        } catch {
          /* no nearby match — user can still pick manually */
        }
      },
      () => {
        /* denied or unavailable — property picker falls back to manual */
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // ─── Save ───────────────────────────────────────────────────────────
  async function save() {
    if (!file || saving) return;
    stopListening();
    setSaving(true);
    try {
      const uploadFile = await compressImage(file);
      const formData = new FormData();
      formData.append("file", uploadFile);
      const trimmed = caption.trim();
      if (trimmed) formData.append("caption", trimmed);
      // No latitude/longitude: the chosen property (below) determines the
      // album, not the device's current location.
      if (selectedPropertyId != null) formData.append("propertyId", String(selectedPropertyId));

      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      const dest =
        selectedPropertyId != null
          ? selectedPropertyLabel() ?? "the selected property"
          : "unfiled photos";
      close();
      showMessage(`Photo saved to ${dest}.`);
      router.refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to save the photo.");
      setSaving(false);
    }
  }

  function selectedPropertyLabel(): string | null {
    if (selectedPropertyId == null) return null;
    const cand = candidates.find((c) => c.id === selectedPropertyId);
    if (cand) return formatPropertyLabel(cand);
    const prop = allProperties.find((p) => p.id === selectedPropertyId);
    return prop ? formatPropertyLabel(prop) : null;
  }

  function close() {
    stopListening();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setOpen(false);
    setSaving(false);
    setListening(false);
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCaption("");
    setCandidates([]);
    setSelectedPropertyId(null);
    setPropFilter("");
  }

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      recognitionRef.current?.abort();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Candidate ids float to the top of the manual list; filter the rest.
  const candidateIds = new Set(candidates.map((c) => c.id));
  const filteredProperties = allProperties
    .filter((p) => !candidateIds.has(p.id))
    .filter((p) => {
      const q = propFilter.trim().toLowerCase();
      return !q || p.address.toLowerCase().includes(q) || (p.contactLastName ?? "").toLowerCase().includes(q);
    })
    .slice(0, 8);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileChosen}
        className="hidden"
      />

      <button
        type="button"
        onClick={openCamera}
        title="Photo + voice note"
        aria-label="Capture photo with voice note"
        className="fixed bottom-[12rem] right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-lg hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>

      {cameraOn && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted autoPlay className="min-h-0 flex-1 w-full object-contain" />
          <button
            type="button"
            onClick={stopCamera}
            aria-label="Close camera"
            className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center justify-center py-6" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
            <button
              type="button"
              onClick={capturePhoto}
              aria-label="Take photo"
              className="h-16 w-16 rounded-full border-4 border-white bg-white/30 ring-2 ring-black/20 active:bg-white/60"
            />
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && !saving && close()}>
          <div className="flex h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">New photo note</span>
              <button type="button" onClick={close} disabled={saving} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200" aria-label="Cancel">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Captured" className="mb-4 max-h-[45vh] w-full rounded-xl object-contain" />
              )}

              <label className="mb-1.5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">Annotation</label>
              <div className="mb-5 flex items-start gap-2">
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={listening ? "Listening…" : "Speak or type a note for this photo…"}
                  rows={4}
                  className="flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  title={listening ? "Stop dictation" : "Start dictation"}
                  aria-label={listening ? "Stop dictation" : "Start dictation"}
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    listening
                      ? "animate-pulse border-red-600 bg-red-600 text-white"
                      : "border-zinc-300 bg-white text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  }`}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
                    <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11Z" />
                  </svg>
                </button>
              </div>

              <label className="mb-1.5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">Property</label>
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
            </div>

            <div className="flex gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <button type="button" onClick={close} disabled={saving} className="flex-1 rounded-lg border border-zinc-300 py-2.5 text-base font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                {saving ? "Saving…" : "Save photo"}
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
