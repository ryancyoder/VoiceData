"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "listening" | "processing";

// The Web Speech API isn't in TypeScript's DOM lib — these are just the
// bits actually used here, not the full spec.
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

// Safeguards a stuck recognizer that never fires onend — shouldn't happen
// in continuous=false mode, which is supposed to end itself once Safari's
// own dictation engine detects the pause, but this keeps the button from
// getting permanently stuck if it does.
const MAX_LISTEN_MS = 45000;

export default function QuickAddTask() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");

  function showMessage(text: string, ms = 4500) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), ms);
  }

  async function logTask(text: string) {
    setStatus("processing");
    try {
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

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showMessage("Voice dictation isn't supported in this browser — try Safari on iOS or Mac.");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "en-US";
    // False rather than true — this is what makes Safari's dictation
    // engine stop on its own once it detects the pause, the same signal
    // "click to finish" triggers manually via stop().
    recognition.continuous = false;
    recognition.interimResults = true;
    finalTranscriptRef.current = "";
    setLiveText("");

    recognition.onstart = () => setStatus("listening");

    recognition.onresult = (e) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interimChunk += result[0].transcript;
      }
      if (finalChunk) finalTranscriptRef.current += finalChunk;
      setLiveText((finalTranscriptRef.current + " " + interimChunk).trim());
    };

    recognition.onerror = (e) => {
      // Nothing said before the mic timed out, or a stop()/abort() we
      // triggered ourselves — neither is a real failure worth surfacing.
      if (e.error === "no-speech" || e.error === "aborted") return;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was denied — check Settings > Safari > Microphone.",
        network: "Dictation needs an internet connection.",
      };
      showMessage(messages[e.error] || "Voice dictation failed — try again.");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      maxListenTimerRef.current = null;
      const text = finalTranscriptRef.current.trim();
      setLiveText("");
      if (!text) {
        setStatus("idle");
        return;
      }
      logTask(text);
    };

    recognitionRef.current = recognition;
    recognition.start();
    maxListenTimerRef.current = setTimeout(() => stopListening(), MAX_LISTEN_MS);
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function handleClick() {
    if (status === "processing") return;
    if (status === "idle") startListening();
    else stopListening();
  }

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      recognitionRef.current?.abort();
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

      {(message || liveText) && (
        <div className="fixed bottom-[7.75rem] right-5 z-40 max-w-[min(320px,80vw)] rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {message || liveText}
        </div>
      )}
    </>
  );
}
