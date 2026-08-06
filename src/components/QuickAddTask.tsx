"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "listening" | "processing";

// Heuristic voice-activity thresholds — a normalized RMS level (0..1) read
// off the mic's raw waveform, no calibration against ambient noise. Tuned
// for a quiet-ish indoor environment; a persistently noisy jobsite may need
// a higher SILENCE_RMS_THRESHOLD to actually detect a pause.
const SILENCE_RMS_THRESHOLD = 0.02;
const SILENCE_DURATION_MS = 1500;
const MIN_RECORDING_MS = 600;
const MAX_RECORDING_MS = 30000;

export default function QuickAddTask() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoudAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);

  function showMessage(text: string, ms = 4500) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  // Releases the mic and stops the silence-monitoring loop — called once
  // recording has actually stopped (or on unmount), never while still
  // capturing audio.
  function cleanupAudio() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
  }

  function monitorSilence() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    if (rms > SILENCE_RMS_THRESHOLD) lastLoudAtRef.current = Date.now();

    const elapsedSinceStart = Date.now() - recordingStartedAtRef.current;
    const silentFor = Date.now() - lastLoudAtRef.current;
    if (elapsedSinceStart > MIN_RECORDING_MS && silentFor > SILENCE_DURATION_MS) {
      stopRecording();
      return;
    }
    rafRef.current = requestAnimationFrame(monitorSilence);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const AudioContextCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleRecordingStopped;
      recorderRef.current = recorder;
      recorder.start();

      recordingStartedAtRef.current = Date.now();
      lastLoudAtRef.current = Date.now();
      setStatus("listening");
      rafRef.current = requestAnimationFrame(monitorSilence);
      // A hard cap so a mic that never reads as silent (background noise,
      // a stuck browser tab) doesn't record indefinitely.
      maxTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch {
      showMessage("Couldn't access the microphone — check your browser permissions.");
    }
  }

  // Only stops the recorder — actual teardown happens in
  // handleRecordingStopped once it has genuinely finished.
  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  async function handleRecordingStopped() {
    cleanupAudio();
    setStatus("processing");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (blob.size === 0) {
        setStatus("idle");
        return;
      }
      const formData = new FormData();
      formData.append("audio", blob, "task.webm");
      const transcribeRes = await fetch("/api/transcribe", { method: "POST", body: formData });
      const transcribeData = await transcribeRes.json();
      if (!transcribeRes.ok) throw new Error(transcribeData.error || "Transcription failed");
      const text = (transcribeData.text || "").trim();
      if (!text) {
        showMessage("Didn't catch that — try again.");
        setStatus("idle");
        return;
      }

      // Logged immediately with the raw dictated text — context/dates get
      // filled in afterward (below) without holding up this confirmation.
      const createRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: text }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || "Failed to log task");

      showMessage(`Task logged: "${text}"`);
      setStatus("idle");
      window.dispatchEvent(new Event("tasks:changed"));
      router.refresh();

      fetch(`/api/tasks/${createData.task.id}/analyze`, { method: "POST" })
        .then(() => window.dispatchEvent(new Event("tasks:changed")))
        .catch(() => {
          /* enrichment is best-effort — the task is already logged either way */
        });
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Something went wrong logging that task.");
      setStatus("idle");
    }
  }

  function handleClick() {
    if (status === "processing") return;
    if (status === "idle") startRecording();
    else stopRecording();
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (recorderRef.current) recorderRef.current.onstop = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={status === "listening" ? "Listening… click to finish" : "Quick add task (voice)"}
        aria-label="Quick add task"
        disabled={status === "processing"}
        className={`fixed bottom-20 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
          status === "listening"
            ? "animate-pulse border-red-600 bg-red-600 text-white"
            : "border-zinc-300 bg-white text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        {status === "processing" ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11Z" />
          </svg>
        )}
      </button>

      {message && (
        <div className="fixed bottom-[7.75rem] right-5 z-40 max-w-[min(320px,80vw)] rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {message}
        </div>
      )}
    </>
  );
}
