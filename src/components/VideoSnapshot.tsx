"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, formatPropertyLabel } from "@/lib/salesBoard";
import { capturePosterFrame } from "@/lib/videoPoster";
import { compressImage } from "@/lib/compressImage";

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

interface Point {
  x: number;
  y: number;
}
interface Stroke {
  color: string;
  width: number;
  points: Point[];
}
interface Snap {
  id: number;
  blob: Blob;
  previewUrl: string;
  caption: string;
  takenAt: string; // ISO time the shot was taken (offset into the video is taken_at - video start)
}

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

const MAX_OUTPUT_DIM = 1280;
const PEN_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#facc15" },
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#111111" },
];

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

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
  }
}

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const offX = (rect.width - canvas.width * scale) / 2;
  const offY = (rect.height - canvas.height * scale) / 2;
  const x = Math.max(0, Math.min(canvas.width, (clientX - rect.left - offX) / scale));
  const y = Math.max(0, Math.min(canvas.height, (clientY - rect.top - offY) / scale));
  return { x, y };
}

export default function VideoSnapshot() {
  const router = useRouter();

  const [mode, setMode] = useState<"idle" | "recording" | "captioning" | "review">("idle");
  const [markingUp, setMarkingUp] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [markColor, setMarkColor] = useState(PEN_COLORS[0].value);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [captionIndex, setCaptionIndex] = useState(0);
  const [captionLive, setCaptionLive] = useState("");
  const [listening, setListening] = useState(false);
  const [overallCaption, setOverallCaption] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyLite[]>([]);
  const [propFilter, setPropFilter] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);

  // Markup overlay (a still image drawn on its own light loop — no video).
  const stillCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markStrokesRef = useRef<Stroke[]>([]);
  const markCurrentRef = useRef<Stroke | null>(null);
  const penSeenRef = useRef(false);
  const markColorRef = useRef(PEN_COLORS[0].value);

  const snapsRef = useRef<Snap[]>([]);
  const snapIdRef = useRef(0);
  const videoBlobRef = useRef<{ blob: Blob; mime: string } | null>(null);
  const recordStartIsoRef = useRef<string | null>(null);
  const pendingSnapTakenAtRef = useRef<string>("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const captionIntentRef = useRef(false);
  const captionBaseRef = useRef("");
  const finalTranscriptRef = useRef("");
  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function commitSnaps(next: Snap[]) {
    snapsRef.current = next;
    setSnaps(next);
  }
  function setSnapCaption(id: number, caption: string) {
    commitSnaps(snapsRef.current.map((s) => (s.id === id ? { ...s, caption } : s)));
  }
  function removeSnap(id: number) {
    const target = snapsRef.current.find((s) => s.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    commitSnaps(snapsRef.current.filter((s) => s.id !== id));
  }
  function showMessage(text: string, ms = 4500) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  // ─── Recording (raw camera stream — no canvas, so it's stable + smooth) ─
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
        if (snapsRef.current.length > 0) {
          setCaptionIndex(0);
          setCaptionLive("");
          setMode("captioning");
        } else {
          setMode("review");
        }
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

  function finishRecording() {
    setMarkingUp(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop → captioning/review
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
    setMarkingUp(false);
    setElapsed(0);
    setMode("idle");
  }

  // Attach the stream to the preview <video> and start recording the stream.
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

  // ─── Snapshot → markup overlay (recording keeps running underneath) ─────
  function takeSnapshot() {
    const video = videoElRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_OUTPUT_DIM / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const still = document.createElement("canvas");
    still.width = w;
    still.height = h;
    still.getContext("2d")?.drawImage(video, 0, 0, w, h);
    stillCanvasRef.current = still;
    pendingSnapTakenAtRef.current = new Date().toISOString(); // the moment the shot was taken
    markStrokesRef.current = [];
    markCurrentRef.current = null;
    setMarkingUp(true);
  }

  // Light draw loop for the markup canvas (a static image + a few strokes).
  useEffect(() => {
    if (!markingUp) return;
    const canvas = markCanvasRef.current;
    const still = stillCanvasRef.current;
    if (canvas && still) {
      canvas.width = still.width;
      canvas.height = still.height;
    }
    let raf = 0;
    const draw = () => {
      const c = markCanvasRef.current;
      const s = stillCanvasRef.current;
      if (c && s) {
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(s, 0, 0, c.width, c.height);
          drawStrokes(ctx, markStrokesRef.current);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [markingUp]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = markCanvasRef.current;
    if (!canvas) return;
    if (e.pointerType === "pen") penSeenRef.current = true;
    else if (e.pointerType === "touch" && penSeenRef.current) return;
    const width = Math.max(3, Math.round(canvas.width * 0.006));
    const stroke: Stroke = { color: markColorRef.current, width, points: [canvasPoint(canvas, e.clientX, e.clientY)] };
    markCurrentRef.current = stroke;
    markStrokesRef.current = [...markStrokesRef.current, stroke];
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = markCanvasRef.current;
    if (!canvas || !markCurrentRef.current) return;
    if (e.pointerType === "touch" && penSeenRef.current) return;
    markCurrentRef.current.points.push(canvasPoint(canvas, e.clientX, e.clientY));
    e.preventDefault();
  }
  function onPointerUp() {
    markCurrentRef.current = null;
  }
  function undoStroke() {
    markStrokesRef.current = markStrokesRef.current.slice(0, -1);
  }
  function clearStrokes() {
    markStrokesRef.current = [];
  }
  function chooseColor(value: string) {
    markColorRef.current = value;
    setMarkColor(value);
  }

  function finishMarkup() {
    const still = stillCanvasRef.current;
    if (still) {
      const off = document.createElement("canvas");
      off.width = still.width;
      off.height = still.height;
      const octx = off.getContext("2d");
      if (octx) {
        octx.drawImage(still, 0, 0);
        drawStrokes(octx, markStrokesRef.current);
        off.toBlob(
          (blob) => {
            if (!blob) return;
            const id = ++snapIdRef.current;
            const takenAt = pendingSnapTakenAtRef.current || new Date().toISOString();
            commitSnaps([...snapsRef.current, { id, blob, previewUrl: URL.createObjectURL(blob), caption: "", takenAt }]);
          },
          "image/jpeg",
          0.92
        );
      }
    }
    stillCanvasRef.current = null;
    markStrokesRef.current = [];
    markCurrentRef.current = null;
    setMarkingUp(false);
    videoElRef.current?.play().catch(() => {});
  }

  function discardMarkup() {
    stillCanvasRef.current = null;
    markStrokesRef.current = [];
    markCurrentRef.current = null;
    setMarkingUp(false);
    videoElRef.current?.play().catch(() => {});
  }

  // ─── Caption cycle (recording done — mic is free) ───────────────────
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
  function startRecognition(snapId: number) {
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
      setCaptionLive(spoken);
      setSnapCaption(snapId, [captionBaseRef.current, spoken].filter(Boolean).join(" "));
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      if (captionIntentRef.current) {
        try {
          startRecognition(snapId);
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
  function captionButtonClick() {
    const snap = snapsRef.current[captionIndex];
    if (!snap) return;
    if (!listening) {
      captionIntentRef.current = true;
      captionBaseRef.current = (snap.caption || "").trimEnd();
      finalTranscriptRef.current = "";
      setCaptionLive("");
      setListening(true);
      startRecognition(snap.id);
    } else {
      captionIntentRef.current = false;
      stopRecognition();
      setListening(false);
      advanceCaption();
    }
  }
  function advanceCaption() {
    captionIntentRef.current = false;
    stopRecognition();
    setListening(false);
    setCaptionLive("");
    const next = captionIndex + 1;
    if (next >= snapsRef.current.length) {
      setCaptionIndex(0);
      setMode("review");
    } else {
      setCaptionIndex(next);
    }
  }

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
    stopRecognition();
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
          // Recording start — each snapshot's offset is its taken_at minus this,
          // which is all a later splicing step needs.
          takenAt: recordStartIsoRef.current ?? undefined,
        }),
      });
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save the video");

      const snapList = snapsRef.current;
      let snapOk = 0;
      for (const s of snapList) {
        try {
          const uploadFile = await compressImage(new File([s.blob], `snap-${s.id}.jpg`, { type: "image/jpeg" }));
          const fd = new FormData();
          fd.append("file", uploadFile);
          const cap = s.caption.trim();
          if (cap) fd.append("caption", cap);
          if (s.takenAt) fd.append("takenAt", s.takenAt);
          if (selectedPropertyId != null) fd.append("propertyId", String(selectedPropertyId));
          const res = await fetch("/api/photos", { method: "POST", body: fd });
          if (res.ok) snapOk += 1;
        } catch {
          /* one failed still shouldn't sink the whole save */
        }
      }

      const dest = selectedPropertyId != null ? selectedPropertyLabel() ?? "the selected property" : "unfiled media";
      const photoNote = snapList.length > 0 ? ` + ${snapOk} photo${snapOk === 1 ? "" : "s"}` : "";
      close();
      showMessage(`Video${photoNote} saved to ${dest}.`);
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
    setCaptionLive("");
    setCaptionIndex(0);
    setListening(false);
    setMarkingUp(false);
    penSeenRef.current = false;
    stillCanvasRef.current = null;
    markStrokesRef.current = [];
    videoBlobRef.current = null;
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
  const currentSnap = snaps[captionIndex];

  return (
    <>
      <button
        type="button"
        onClick={startRecording}
        title="Video with Pencil markup + photo snapshots"
        aria-label="Record video with markup and snapshots"
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

          {!markingUp && (
            <>
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
              </div>

              <div className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center" style={{ right: "max(1.25rem, env(safe-area-inset-right))" }}>
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
              </div>

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
            </>
          )}

          {markingUp && (
            <div className="absolute inset-0 bg-black">
              <canvas
                ref={markCanvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="absolute inset-0 h-full w-full touch-none object-contain"
              />

              <div
                className="absolute left-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 rounded-full bg-black/55 px-2 py-3"
                style={{ left: "max(1rem, env(safe-area-inset-left))" }}
              >
                {PEN_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => chooseColor(c.value)}
                    aria-label={c.name}
                    className={`h-8 w-8 rounded-full border-2 ${markColor === c.value ? "border-white" : "border-transparent"}`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
                <button type="button" onClick={undoStroke} aria-label="Undo" className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
                  </svg>
                </button>
                <button type="button" onClick={clearStrokes} aria-label="Clear" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[0.6rem] font-semibold text-white">
                  CLR
                </button>
              </div>

              <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 text-xs text-white" style={{ top: "max(1rem, env(safe-area-inset-top))" }}>
                Mark up the shot — recording continues
              </div>

              <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-3 px-6" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))", paddingTop: "1rem" }}>
                <button type="button" onClick={discardMarkup} className="rounded-full bg-white/15 px-6 py-3 text-base font-medium text-white">
                  Discard
                </button>
                <button type="button" onClick={finishMarkup} className="rounded-full bg-emerald-600 px-8 py-3 text-base font-semibold text-white">
                  Save shot
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "captioning" && currentSnap && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <button type="button" onClick={close} aria-label="Cancel" className="text-zinc-300">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <span className="text-sm font-semibold">Caption photo {captionIndex + 1} of {snaps.length}</span>
            <button type="button" onClick={advanceCaption} className="text-sm text-zinc-300">
              Skip
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center px-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentSnap.previewUrl} alt={`Snapshot ${captionIndex + 1}`} className="max-h-full max-w-full rounded-xl object-contain" />
          </div>

          <div className="px-5 pb-2 text-center text-sm text-white">
            {currentSnap.caption || (listening ? captionLive || "listening…" : "No caption yet — tap the mic to dictate.")}
          </div>

          <div className="flex flex-col items-center gap-3 px-5 pb-8" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
            <button
              type="button"
              onClick={captionButtonClick}
              className={`flex h-20 w-20 items-center justify-center rounded-full border-4 ${
                listening ? "animate-pulse border-red-400 bg-red-600 text-white" : "border-white bg-white/15 text-white"
              }`}
              aria-label={listening ? "Finish and next" : "Start dictation"}
            >
              {listening ? (
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
                  <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11Z" />
                </svg>
              )}
            </button>
            <span className="text-xs text-zinc-300">{listening ? "Tap to finish & go to next" : "Tap to dictate this photo"}</span>
          </div>
        </div>
      )}

      {mode === "review" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && !saving && close()}>
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

              {snaps.length > 0 && (
                <>
                  <label className="mb-1.5 block text-sm font-semibold uppercase tracking-wide text-zinc-400">
                    Snapshots ({snaps.length}) — also saved as photos
                  </label>
                  <div className="mb-5 space-y-3">
                    {snaps.map((s, i) => (
                      <div key={s.id} className="flex gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.previewUrl} alt={`Snapshot ${i + 1}`} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                        <textarea
                          value={s.caption}
                          onChange={(e) => setSnapCaption(s.id, e.target.value)}
                          placeholder="Note for this photo…"
                          rows={2}
                          className="flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
                        />
                        <button
                          type="button"
                          onClick={() => removeSnap(s.id)}
                          disabled={saving}
                          aria-label="Remove snapshot"
                          className="h-8 w-8 shrink-0 self-start rounded-full text-zinc-400 hover:text-red-600 disabled:opacity-50"
                        >
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
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
