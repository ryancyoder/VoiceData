import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  canEncodeVideo,
  type VideoCodec,
} from "mediabunny";

// Supabase Storage on the Free plan hard-caps every object at 50MB. Real
// phone videos routinely exceed that, so we re-encode client-side (via
// WebCodecs, through mediabunny) before upload, targeting a bitrate that
// keeps the whole file safely under the cap regardless of clip length.
const TARGET_MAX_BYTES = 45_000_000;
const MAX_DIMENSION = 1280;
const MIN_VIDEO_BITRATE = 300_000;
// A ceiling on the requested bitrate, independent of the size-target math
// below. Short clips would otherwise compute an enormous bitrate (the full
// byte budget divided by only a few seconds) that encoders reject outright
// as an invalid/unsupported request — this keeps every request sane, at the
// cost of not always hitting TARGET_MAX_BYTES for very short, high-bitrate
// source clips (an acceptable trade: those are rarely anywhere near 50MB
// to begin with).
const MAX_VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 96_000;

function evenize(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

// H.264 (avc) has the widest playback compatibility (older iOS/Safari
// especially), so it's preferred when the browser can actually encode it —
// but not every browser/device has an H.264 *encoder* available (encode and
// decode support differ), so we fall back through progressively less
// universal but still broadly-supported codecs rather than giving up and
// uploading the oversized original.
const CODEC_CANDIDATES: { codec: VideoCodec; container: "mp4" | "webm" }[] = [
  { codec: "avc", container: "mp4" },
  { codec: "vp9", container: "webm" },
  { codec: "av1", container: "mp4" },
  { codec: "vp8", container: "webm" },
];

export async function compressVideo(file: File, options: { skipBelowBytes?: number } = {}): Promise<File> {
  const { skipBelowBytes = TARGET_MAX_BYTES } = options;
  if (!file.type.startsWith("video/") || file.size <= skipBelowBytes) return file;

  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const duration = await input.computeDuration();
    if (!duration || duration <= 0) return file;

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return file;

    const displayWidth = await videoTrack.getDisplayWidth();
    const displayHeight = await videoTrack.getDisplayHeight();
    const longEdge = Math.max(displayWidth, displayHeight);
    const scale = Math.min(1, MAX_DIMENSION / longEdge);
    const width = evenize(displayWidth * scale);
    const height = evenize(displayHeight * scale);

    const targetTotalBitrate = (TARGET_MAX_BYTES * 8) / duration;
    const videoBitrate = Math.min(
      MAX_VIDEO_BITRATE,
      Math.max(MIN_VIDEO_BITRATE, Math.round(targetTotalBitrate - AUDIO_BITRATE))
    );

    let chosen: { codec: VideoCodec; container: "mp4" | "webm" } | null = null;
    for (const candidate of CODEC_CANDIDATES) {
      if (await canEncodeVideo(candidate.codec, { width, height, bitrate: videoBitrate })) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) return file;

    const output = new Output({
      format: chosen.container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: { width, height, fit: "contain", codec: chosen.codec, bitrate: videoBitrate },
      audio: { bitrate: AUDIO_BITRATE },
      showWarnings: false,
    });

    if (!conversion.isValid) return file;

    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer) return file;

    const mimeType = chosen.container === "mp4" ? "video/mp4" : "video/webm";
    const blob = new Blob([buffer], { type: mimeType });
    if (blob.size >= file.size) return file;

    const name = file.name.replace(/\.\w+$/, "") + "." + chosen.container;
    return new File([blob], name, { type: mimeType, lastModified: file.lastModified });
  } catch {
    // Decoding/encoding failed (unsupported codec, corrupt file, browser
    // without the needed WebCodecs support, etc.) — upload the original.
    return file;
  }
}
