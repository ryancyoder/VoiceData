"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, formatPropertyLabel } from "@/lib/salesBoard";
import { capturePosterFrame } from "@/lib/videoPoster";

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

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

const MAX_OUTPUT_DIM = 1280;

// Pick a MediaRecorder container the browser supports (Safari → mp4, Chrome → webm).
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4",
    "video/mp4;codecs=h264,aac",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
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

  const [mode, setMode] = useState<"idle" | "recording" | "review">("idle");
  const [frozen, setFrozen] = useState(false);
  const [caption, setCaption] = useState(""); // live caption of the current snap
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [overallCaption, setOverallCaption] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyLite[]>([]);
  const [propFilter, setPropFilter] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);

  const frozenRef = useRef(false);
  const frozenBitmapRef = useRef<HTMLCanvasElement | null>(null);
  const frozenCaptionRef = useRef("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoBlobRef = useRef<{ blob: Blob; mime: string } | null>(null);

  function showMessage(text: string, ms = 4500) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  // ─── Canvas compositing ─────────────────────────────────────────────
  function drawCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number) {
    if (!text) return;
    const fontSize = Math.max(16, Math.round(h * 0.045));
    ctx.font = `600 ${fontSize}px -apple-system, system-ui, sans-serif`;
    const maxWidth = w * 0.9;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    const lineHeight = Math.round(fontSize * 1.3);
    const pad = Math.round(fontSize * 0.6);
    const blockH = lines.length * lineHeight + pad * 2;
    const y0 = h - blockH;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, y0, w, blockH);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, y0 + pad + i * lineHeight));
  }

  function startDrawLoop() {
    const draw = () => {
      const canvas = canvasRef.current;
      const video = videoElRef.current;
      if (canvas && video) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          if (frozenRef.current && frozenBitmapRef.current) {
            ctx.drawImage(frozenBitmapRef.current, 0, 0, w, h);
            drawCaption(ctx, frozenCaptionRef.current, w, h);
          } else if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, w, h);
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
  }

  // ─── Dictation (per snap) ───────────────────────────────────────────
  function startDictation() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
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
    recognition.continuous = true;
    recognition.interimResults = true;
    finalTranscriptRef.current = "";
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
      frozenCaptionRef.current = spoken;
      setCaption(spoken);
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      // A mic conflict with the recorder can surface here on iOS — non-fatal.
    };
    recognition.onend = () => {
      // While still snapped, keep listening for a long caption.
      if (recognitionRef.current === recognition && frozenRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* fall through */
        }
      }
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
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
  }

  // ─── Snap toggle (freeze on / off) ──────────────────────────────────
  function toggleSnap() {
    if (mode !== "recording") return;
    if (!frozenRef.current) {
      const video = videoElRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const off = document.createElement("canvas");
      off.width = canvas.width;
      off.height = canvas.height;
      const octx = off.getContext("2d");
      if (!octx) return;
      octx.drawImage(video, 0, 0, off.width, off.height);
      frozenBitmapRef.current = off;
      frozenCaptionRef.current = "";
      frozenRef.current = true;
      setFrozen(true);
      setCaption("");
      startDictation(); // within this tap's gesture (iOS)
    } else {
      stopDictation();
      frozenRef.current = false;
      frozenBitmapRef.current = null;
      setFrozen(false);
    }
  }

  // ─── Recording lifecycle ────────────────────────────────────────────
  async function startRecording() {
    const testCanvas = document.createElement("canvas");
    const supported =
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof (testCanvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream === "function" &&
      typeof MediaRecorder !== "undefined";
    if (!supported) {
      showMessage("Video snapshot isn't supported in this browser. Try the photo tool, or use Chrome on a computer.");
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
    const canvas = canvasRef.current;
    const stream = streamRef.current;
    if (!canvas || !stream) return;
    try {
      const canvasStream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(30);
      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...stream.getAudioTracks()]);
      const recorder = mimeRef.current ? new MediaRecorder(combined, { mimeType: mimeRef.current }) : new MediaRecorder(combined);
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
        setMode("review");
        if (allProperties.length === 0) loadProperties();
        requestLocation();
      };
      recorderRef.current = recorder;
      recorder.start();
      // Elapsed timer.
      const started = performance.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 500);
    } catch {
      showMessage("Couldn't start recording on this device.");
      teardownCapture();
      setMode("idle");
    }
  }

  function teardownCapture() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stopDictation();
    frozenRef.current = false;
    frozenBitmapRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function finishRecording() {
    if (frozenRef.current) toggleSnap(); // release any open snap first
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // onstop → review
    }
    recorderRef.current = null;
    teardownCapture();
    setFrozen(false);
    setElapsed(0);
  }

  function cancelRecording() {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    teardownCapture();
    setFrozen(false);
    setElapsed(0);
    setMode("idle");
  }

  // Wire the stream to the <video>, size the canvas, and start drawing + recording.
  useEffect(() => {
    if (mode !== "recording") return;
    const video = videoElRef.current;
    const canvas = canvasRef.current;
    const stream = streamRef.current;
    if (!video || !canvas || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    let cancelled = false;
    const onReady = () => {
      if (cancelled) return;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.min(1, MAX_OUTPUT_DIM / Math.max(vw, vh));
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      startDrawLoop();
      startRecorder();
    };
    video.onloadedmetadata = () => {
      video.play().then(onReady).catch(onReady);
    };
    return () => {
      cancelled = true;
      video.onloadedmetadata = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ─── Property resolution + upload ───────────────────────────────────
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

  async function save() {
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
          // No lat/lng: the chosen property determines the album.
          propertyId: selectedPropertyId ?? undefined,
          caption: overallCaption.trim() || undefined,
        }),
      });
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save the video");

      const dest = selectedPropertyId != null ? selectedPropertyLabel() ?? "the selected property" : "unfiled media";
      close();
      showMessage(`Video saved to ${dest}.`);
      router.refresh();
    } catch (err) {
      setSaving(false);
      showMessage(err instanceof Error ? err.message : "Failed to save the video.");
    }
  }

  function resetSession() {
    setCandidates([]);
    setSelectedPropertyId(null);
    setPropFilter("");
    setOverallCaption("");
    setCaption("");
    frozenCaptionRef.current = "";
    videoBlobRef.current = null;
  }

  function close() {
    teardownCapture();
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
    setFrozen(false);
    setElapsed(0);
    setMode("idle");
  }

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      teardownCapture();
      recognitionRef.current?.abort();
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

  return (
    <>
      <button
        type="button"
        onClick={startRecording}
        title="Video with photo snapshots"
        aria-label="Record video with photo snapshots"
        className="fixed bottom-[15.5rem] right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-lg hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m23 7-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </button>

      {/* Hidden source video for the camera stream. */}
      {mode === "recording" && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video ref={videoElRef} playsInline muted className="hidden" />
      )}

      {mode === "recording" && (
        <div className="fixed inset-0 z-50 bg-black">
          <canvas ref={canvasRef} className="h-full w-full object-contain" />

          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancel"
            className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          <div
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            <span className="text-red-500">●</span>
            <span>{mm}:{ss}</span>
            {frozen && <span className="text-emerald-300">snapshot</span>}
          </div>

          {/* Snap toggle on the middle-right edge. */}
          <div
            className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-5"
            style={{ right: "max(1.25rem, env(safe-area-inset-right))" }}
          >
            <button
              type="button"
              onClick={toggleSnap}
              aria-label={frozen ? "Finish snapshot" : "Take snapshot"}
              className={`flex h-16 w-16 items-center justify-center rounded-full border-4 shadow-lg ${
                frozen ? "animate-pulse border-emerald-400 bg-emerald-500 text-white" : "border-white bg-white/30 text-white active:bg-white/60"
              }`}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
          </div>

          {/* Stop / finish. */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-center" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))", paddingTop: "1rem" }}>
            <button
              type="button"
              onClick={finishRecording}
              aria-label="Stop recording"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600 active:bg-red-500"
            >
              <span className="h-5 w-5 rounded-[3px] bg-white" />
            </button>
          </div>

          {frozen && (
            <div className="absolute bottom-24 left-1/2 max-w-[80vw] -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-center text-sm text-white">
              🎤 {caption || "listening…"}
            </div>
          )}
        </div>
      )}

      {mode === "review" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={(e) => e.target === e.currentTarget && !saving && close()}
        >
          <div className="flex h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Save video</span>
              <button type="button" onClick={close} disabled={saving} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200" aria-label="Cancel">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {videoUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={videoUrl} controls playsInline className="mb-4 max-h-[45vh] w-full rounded-xl bg-black object-contain" />
              )}

              <label className="mb-1.5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">Caption (optional)</label>
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
              <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                {saving ? "Saving…" : "Save video"}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="fixed bottom-[19rem] right-5 z-50 max-w-[min(340px,82vw)] rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {message}
        </div>
      )}
    </>
  );
}
