"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, dealPhotoUrl, formatPropertyLabel, type DealPhoto } from "@/lib/salesBoard";
import { capturePosterFrame } from "@/lib/videoPoster";
import { compressImage } from "@/lib/compressImage";
import PhotoAnnotator from "@/components/PhotoAnnotator";

// ─── Web Speech typings ───────────────────────────────────────────────
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
type Selection = number | null;

// A still grabbed during recording, before upload.
interface LocalSnap {
  id: number;
  blob: Blob;
  previewUrl: string;
  takenAt: string;
}

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

const MAX_OUTPUT_DIM = 1280;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["video/mp4", "video/mp4;codecs=h264,aac", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}
function extFor(mime: string): string {
  return mime.includes("mp4") ? "mp4" : "webm";
}

export default function VideoSnapshot() {
  const router = useRouter();

  const [mode, setMode] = useState<"idle" | "recording" | "details" | "cycle">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [flash, setFlash] = useState(false);
  const [snaps, setSnaps] = useState<LocalSnap[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [overallCaption, setOverallCaption] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyLite[]>([]);
  const [propFilter, setPropFilter] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  // Post-upload cycle state.
  const [uploaded, setUploaded] = useState<DealPhoto[]>([]);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [draftCaption, setDraftCaption] = useState("");
  const [listening, setListening] = useState(false);
  const [annotating, setAnnotating] = useState<DealPhoto | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardRef = useRef(false);
  const recordStartIsoRef = useRef<string | null>(null);

  const snapsRef = useRef<LocalSnap[]>([]);
  const snapIdRef = useRef(0);
  const videoBlobRef = useRef<{ blob: Blob; mime: string } | null>(null);

  const uploadedRef = useRef<DealPhoto[]>([]);
  const cycleIndexRef = useRef(0);
  const draftCaptionRef = useRef("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const captionIntentRef = useRef(false);
  const captionBaseRef = useRef("");
  const finalTranscriptRef = useRef("");
  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function commitSnaps(next: LocalSnap[]) {
    snapsRef.current = next;
    setSnaps(next);
  }
  function removeSnap(id: number) {
    const target = snapsRef.current.find((s) => s.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    commitSnaps(snapsRef.current.filter((s) => s.id !== id));
  }
  function commitUploaded(next: DealPhoto[]) {
    uploadedRef.current = next;
    setUploaded(next);
  }
  function setDraft(text: string) {
    draftCaptionRef.current = text;
    setDraftCaption(text);
  }
  function showMessage(text: string, ms = 4500) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  // ─── Recording (raw stream — reliable; snapshots are instant) ────────
  async function startRecording() {
    const supported = typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
    if (!supported) {
      showMessage("Video recording isn't supported in this browser. Try the photo tool, or Chrome on a computer.");
      return;
    }
    resetSession();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      mimeRef.current = pickMimeType();
      setMode("recording");
    } catch {
      showMessage("Couldn't access the camera or microphone.");
    }
  }

  function startRecorder() {
    const stream = streamRef.current;
    if (!stream || recorderRef.current) return;
    try {
      const recorder = mimeRef.current ? new MediaRecorder(stream, { mimeType: mimeRef.current }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const mime = recorder.mimeType || mimeRef.current || "video/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        if (discardRef.current) {
          discardRef.current = false;
          return;
        }
        videoBlobRef.current = { blob, mime };
        const url = URL.createObjectURL(blob);
        setVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        if (allProperties.length === 0) loadProperties();
        requestLocation();
        setMode("details");
      };
      recorderRef.current = recorder;
      recordStartIsoRef.current = new Date().toISOString();
      recorder.start();
      const started = performance.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 500);
    } catch {
      showMessage("Couldn't start recording on this device.");
      teardownCapture();
      setMode("idle");
    }
  }

  function teardownCapture() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function takeSnapshot() {
    const video = videoElRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_OUTPUT_DIM / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    off.getContext("2d")?.drawImage(video, 0, 0, w, h);
    const takenAt = new Date().toISOString();
    off.toBlob(
      (blob) => {
        if (!blob) return;
        const id = ++snapIdRef.current;
        commitSnaps([...snapsRef.current, { id, blob, previewUrl: URL.createObjectURL(blob), takenAt }]);
      },
      "image/jpeg",
      0.92
    );
    // Quick visual confirmation (recording + narration keep going).
    setFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(false), 140);
  }

  function finishRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop → details
    recorderRef.current = null;
    teardownCapture();
    setElapsed(0);
  }

  function cancelRecording() {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    teardownCapture();
    setElapsed(0);
    setMode("idle");
  }

  useEffect(() => {
    if (mode !== "recording") return;
    const video = videoElRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.play().catch(() => {});
    startRecorder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
      /* manual picker still works from GPS candidates */
    }
  }
  function requestLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/properties/match-location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          });
          const data = await res.json();
          if (res.ok && Array.isArray(data.candidates) && data.candidates.length > 0) {
            setCandidates(data.candidates as Candidate[]);
            setSelectedPropertyId((cur) => (cur == null ? (data.candidates[0] as Candidate).id : cur));
          }
        } catch {
          /* ignore */
        }
      },
      () => {},
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

  // ─── Upload, then move into the caption/markup cycle ────────────────
  async function saveAndContinue() {
    const current = videoBlobRef.current;
    if (!current || saving) return;
    setSaving(true);
    try {
      const ext = extFor(current.mime);
      const fileName = `video-snapshot.${ext}`;
      const videoFile = new File([current.blob], fileName, { type: current.mime });
      const posterBlob = await capturePosterFrame(videoFile);

      const urlRes = await fetch("/api/videos/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoFileName: fileName, hasPoster: !!posterBlob }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare the upload");

      const { error: videoErr } = await supabase.storage
        .from(DEAL_PHOTOS_BUCKET)
        .uploadToSignedUrl(urlData.video.path, urlData.video.token, current.blob, { contentType: current.mime });
      if (videoErr) throw new Error(videoErr.message);

      let posterPath: string | null = null;
      if (posterBlob && urlData.poster) {
        const { error: posterErr } = await supabase.storage
          .from(DEAL_PHOTOS_BUCKET)
          .uploadToSignedUrl(urlData.poster.path, urlData.poster.token, posterBlob, { contentType: "image/jpeg" });
        if (!posterErr) posterPath = urlData.poster.path;
      }

      const finalizeRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPath: urlData.video.path,
          posterPath,
          propertyId: selectedPropertyId ?? undefined,
          caption: overallCaption.trim() || undefined,
          takenAt: recordStartIsoRef.current ?? undefined,
          walkthrough: true, // tag it for the distinct gallery walkthrough badge
        }),
      });
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save the video");

      const uploadedPhotos: DealPhoto[] = [];
      for (const s of snapsRef.current) {
        try {
          const uploadFile = await compressImage(new File([s.blob], `snap-${s.id}.jpg`, { type: "image/jpeg" }));
          const fd = new FormData();
          fd.append("file", uploadFile);
          if (s.takenAt) fd.append("takenAt", s.takenAt);
          if (selectedPropertyId != null) fd.append("propertyId", String(selectedPropertyId));
          const res = await fetch("/api/photos", { method: "POST", body: fd });
          const data = await res.json();
          if (res.ok && data.photo) uploadedPhotos.push(data.photo as DealPhoto);
        } catch {
          /* one failed still shouldn't sink the whole save */
        }
      }

      router.refresh(); // the gallery already has everything; the cycle just annotates it

      if (uploadedPhotos.length > 0) {
        commitUploaded(uploadedPhotos);
        cycleIndexRef.current = 0;
        setCycleIndex(0);
        setDraft(uploadedPhotos[0].caption ?? "");
        setSaving(false);
        setMode("cycle");
      } else {
        const dest = selectedPropertyId != null ? selectedPropertyLabel() ?? "the selected property" : "unfiled media";
        close();
        showMessage(`Video saved to ${dest}.`);
      }
    } catch (err) {
      setSaving(false);
      showMessage(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  // ─── Caption/markup cycle over the uploaded photos ──────────────────
  function stopRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
  }
  function startRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showMessage("Voice dictation isn't supported here — type the caption instead.");
      captionIntentRef.current = false;
      setListening(false);
      return;
    }
    stopRecognition();
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
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
      setDraft([captionBaseRef.current, spoken].filter(Boolean).join(" "));
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      if (captionIntentRef.current) {
        try {
          startRecognition();
        } catch {
          setListening(false);
        }
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  }
  function toggleDictation() {
    if (!listening) {
      captionIntentRef.current = true;
      captionBaseRef.current = (draftCaptionRef.current || "").trimEnd();
      finalTranscriptRef.current = "";
      setListening(true);
      startRecognition();
    } else {
      captionIntentRef.current = false;
      stopRecognition();
      setListening(false);
    }
  }

  async function saveDraftIfNeeded() {
    const cur = uploadedRef.current[cycleIndexRef.current];
    if (!cur) return;
    const cap = draftCaptionRef.current.trim() || null;
    if (cap === (cur.caption ?? null)) return;
    try {
      const res = await fetch(`/api/photos/${cur.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: cap }),
      });
      const d = await res.json();
      if (res.ok && d.photo) {
        commitUploaded(uploadedRef.current.map((p, i) => (i === cycleIndexRef.current ? (d.photo as DealPhoto) : p)));
      }
    } catch {
      /* non-fatal — caption can be fixed later from the gallery */
    }
  }

  async function goToPhoto(index: number) {
    captionIntentRef.current = false;
    stopRecognition();
    setListening(false);
    await saveDraftIfNeeded();
    if (index >= uploadedRef.current.length) {
      finishCycle();
      return;
    }
    cycleIndexRef.current = index;
    setCycleIndex(index);
    setDraft(uploadedRef.current[index].caption ?? "");
  }

  async function finishCycle() {
    captionIntentRef.current = false;
    stopRecognition();
    setListening(false);
    const n = uploadedRef.current.length;
    const dest = selectedPropertyId != null ? selectedPropertyLabel() ?? "the selected property" : "unfiled media";
    close();
    showMessage(`Video + ${n} photo${n === 1 ? "" : "s"} saved to ${dest}.`);
    router.refresh();
  }

  async function openMarkup() {
    await saveDraftIfNeeded();
    const cur = uploadedRef.current[cycleIndexRef.current];
    if (cur) setAnnotating(cur);
  }

  function resetSession() {
    setCandidates([]);
    setSelectedPropertyId(null);
    setPropFilter("");
    setOverallCaption("");
    setDraft("");
    setListening(false);
    setAnnotating(null);
    setCycleIndex(0);
    cycleIndexRef.current = 0;
    videoBlobRef.current = null;
    commitUploaded([]);
    snapsRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    commitSnaps([]);
  }
  function close() {
    teardownCapture();
    stopRecognition();
    captionIntentRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      discardRef.current = true;
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    resetSession();
    setSaving(false);
    setElapsed(0);
    setMode("idle");
  }

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      teardownCapture();
      recognitionRef.current?.abort();
      snapsRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const filteredProperties = allProperties
    .filter((p) => !candidateIds.has(p.id))
    .filter((p) => {
      const q = propFilter.trim().toLowerCase();
      return !q || p.address.toLowerCase().includes(q) || (p.contactLastName ?? "").toLowerCase().includes(q);
    })
    .slice(0, 8);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const currentPhoto = uploaded[cycleIndex];

  return (
    <>
      <button
        type="button"
        onClick={startRecording}
        title="Record video with photo snapshots"
        aria-label="Record video with snapshots"
        className="fixed bottom-[15.5rem] right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-lg hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m23 7-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </button>

      {mode === "recording" && (
        <div className="fixed inset-0 z-50 bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoElRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-contain" />

          {flash && <div className="absolute inset-0 bg-white/70" />}

          {/* Center aiming dot. */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="block h-3.5 w-3.5 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.85)]" />
          </div>

          {/* Recording indicator (info) stays top-center. */}
          <div
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <span className="flex items-center gap-1.5"><span className="text-red-500">●</span>{mm}:{ss}</span>
            {snaps.length > 0 && <span className="text-zinc-300">📷 {snaps.length}</span>}
          </div>

          {/* All controls on the right edge — thumb reach (iPad held two-handed). */}
          <div className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-5" style={{ right: "max(1rem, env(safe-area-inset-right))" }}>
            <button
              type="button"
              onClick={cancelRecording}
              aria-label="Cancel"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={takeSnapshot}
              aria-label="Take snapshot"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/30 text-white active:bg-white/60"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={finishRecording}
              aria-label="Stop recording"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600 active:bg-red-500"
            >
              <span className="h-5 w-5 rounded-[3px] bg-white" />
            </button>
          </div>
        </div>
      )}

      {mode === "details" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && !saving && close()}>
          <div className="flex h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {snaps.length} photo{snaps.length === 1 ? "" : "s"} — pick a property
              </span>
              <button type="button" onClick={close} disabled={saving} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200" aria-label="Cancel">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {videoUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={videoUrl} controls playsInline className="mb-4 max-h-[35vh] w-full rounded-xl bg-black object-contain" />
              )}

              {snaps.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {snaps.map((s, i) => (
                    <div key={s.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.previewUrl} alt={`Snapshot ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
                      <button
                        type="button"
                        onClick={() => removeSnap(s.id)}
                        disabled={saving}
                        aria-label="Remove snapshot"
                        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 text-white disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="mb-1.5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">Video caption (optional)</label>
              <textarea
                value={overallCaption}
                onChange={(e) => setOverallCaption(e.target.value)}
                placeholder="Overall note for this video…"
                rows={2}
                className="mb-5 w-full resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
              />

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
                Discard
              </button>
              <button type="button" onClick={saveAndContinue} disabled={saving} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                {saving ? "Saving…" : snaps.length > 0 ? "Save & caption" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "cycle" && currentPhoto && (
        <div className="fixed inset-0 z-50 bg-black">
          {/* Photo fills the area to the left of the control column. */}
          <div className="absolute inset-0 flex items-center justify-center pb-28 pl-4 pr-24 pt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dealPhotoUrl(currentPhoto.storage_path)} alt={`Photo ${cycleIndex + 1}`} className="max-h-full max-w-full rounded-xl object-contain" />
          </div>

          {/* Caption bar (kept clear of the right control column). */}
          <div className="absolute bottom-0 left-0 right-24 px-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <textarea
              value={draftCaption}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={listening ? "Listening…" : "Speak (mic →) or type a caption…"}
              rows={2}
              className="w-full resize-none rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-base text-white outline-none placeholder:text-zinc-400"
            />
          </div>

          {/* All controls on the right edge — thumb reach. */}
          <div className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-3" style={{ right: "max(1rem, env(safe-area-inset-right))" }}>
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">{cycleIndex + 1}/{uploaded.length}</span>
            <button
              type="button"
              onClick={openMarkup}
              aria-label="Mark up"
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/50 text-white"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggleDictation}
              className={`flex h-20 w-20 items-center justify-center rounded-full border-4 ${
                listening ? "animate-pulse border-red-400 bg-red-600 text-white" : "border-white bg-white/15 text-white"
              }`}
              aria-label={listening ? "Stop dictation" : "Dictate caption"}
            >
              <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
                <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => goToPhoto(cycleIndex + 1)}
              aria-label={cycleIndex + 1 >= uploaded.length ? "Finish" : "Next photo"}
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/50 text-white"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <button type="button" onClick={finishCycle} className="rounded-full bg-white/15 px-3 py-2 text-xs font-semibold text-white">
              Done
            </button>
          </div>
        </div>
      )}

      {annotating && (
        <PhotoAnnotator
          photo={annotating}
          onClose={() => setAnnotating(null)}
          onSaved={(updated) => {
            commitUploaded(uploadedRef.current.map((p) => (p.id === updated.id ? updated : p)));
            // If the caption was dictated inside the annotator, adopt it so the
            // cycle's draft doesn't overwrite it on the next step.
            if (uploadedRef.current[cycleIndexRef.current]?.id === updated.id) setDraft(updated.caption ?? "");
            setAnnotating(null);
          }}
        />
      )}

      {message && (
        <div className="fixed bottom-[19rem] right-5 z-50 max-w-[min(340px,82vw)] rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {message}
        </div>
      )}
    </>
  );
}
