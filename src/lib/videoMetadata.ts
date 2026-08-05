// Reads the real embedded capture time from an MP4/QuickTime video file by
// walking the ISO base media box tree directly (moov > mvhd). This is the
// technical creation_time field virtually every camera/phone writes,
// distinct from — and more reliable than — the browser's File.lastModified,
// which reflects when the file was last touched on disk (e.g. after a copy
// or export) rather than when it was recorded. Not exposed by mediabunny
// (which only reads optional descriptive udta/meta tags), so parsed here
// directly against the spec.

// QuickTime/ISO-BMFF timestamps are seconds since 1904-01-01T00:00:00Z; this
// is the offset to convert to the Unix epoch (1970-01-01).
const QT_EPOCH_OFFSET_SECONDS = 2082844800;

const MAX_SCAN_BYTES = 200 * 1024 * 1024;

interface BoxHeader {
  size: number;
  type: string;
  headerSize: number;
}

function parseBoxHeader(view: DataView): BoxHeader | null {
  if (view.byteLength < 8) return null;
  let size = view.getUint32(0, false);
  const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
  let headerSize = 8;
  if (size === 1) {
    if (view.byteLength < 16) return null;
    const high = view.getUint32(8, false);
    const low = view.getUint32(12, false);
    size = high * 2 ** 32 + low;
    headerSize = 16;
  }
  return { size, type, headerSize };
}

function findMvhdCreationTime(moovBody: ArrayBuffer): Date | null {
  const view = new DataView(moovBody);
  let offset = 0;
  while (offset + 8 <= view.byteLength) {
    const header = parseBoxHeader(new DataView(moovBody, offset));
    if (!header) break;
    const boxSize = header.size === 0 ? view.byteLength - offset : header.size;

    if (header.type === "mvhd") {
      const bodyOffset = offset + header.headerSize;
      const version = view.getUint8(bodyOffset);
      const creationTimeSize = version === 1 ? 8 : 4;
      if (bodyOffset + 4 + creationTimeSize > view.byteLength) return null;
      const creationTimeRaw =
        version === 1 ? Number(view.getBigUint64(bodyOffset + 4, false)) : view.getUint32(bodyOffset + 4, false);
      if (!creationTimeRaw) return null;
      const unixSeconds = creationTimeRaw - QT_EPOCH_OFFSET_SECONDS;
      if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
      return new Date(unixSeconds * 1000);
    }

    if (boxSize <= 0) break;
    offset += boxSize;
  }
  return null;
}

/**
 * Extracts the real embedded capture time from a video file's moov/mvhd box,
 * without loading the whole file into memory (moov is located by walking
 * top-level box headers, then only its own bytes are read in full). Returns
 * null if the file isn't a parseable MP4/QuickTime container or has no
 * creation_time set.
 */
export async function readVideoCreationTime(file: File): Promise<Date | null> {
  try {
    let offset = 0;
    while (offset + 8 <= file.size && offset < MAX_SCAN_BYTES) {
      const headerBuf = await file.slice(offset, offset + 16).arrayBuffer();
      const header = parseBoxHeader(new DataView(headerBuf));
      if (!header) break;
      const boxSize = header.size === 0 ? file.size - offset : header.size;
      if (boxSize <= 0) break;

      if (header.type === "moov") {
        const moovBody = await file.slice(offset + header.headerSize, offset + boxSize).arrayBuffer();
        return findMvhdCreationTime(moovBody);
      }

      offset += boxSize;
    }
  } catch {
    return null;
  }
  return null;
}
