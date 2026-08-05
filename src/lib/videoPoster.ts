import { withTimeout } from "@/lib/withTimeout";

const POSTER_CAPTURE_TIMEOUT_MS = 8000;

// Videos can't be shown in an <img> tag, so we grab a still frame client-side
// to use as a thumbnail — both for pending-upload previews and as the poster
// stored alongside the video for calendar/gallery views.
function capturePosterFrameRaw(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;

    function finish(blob: Blob | null) {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(blob);
    }

    video.addEventListener("loadeddata", () => {
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    });
    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.8);
      } catch {
        finish(null);
      }
    });
    video.addEventListener("error", () => finish(null));
  });
}

export async function capturePosterFrame(file: File): Promise<Blob | null> {
  try {
    return await withTimeout(capturePosterFrameRaw(file), POSTER_CAPTURE_TIMEOUT_MS, "poster capture");
  } catch {
    return null;
  }
}
