// An unusual filename (unicode, stray punctuation, no extension at all) can
// otherwise produce a storage path that fails URL parsing deep inside the
// storage client, surfacing a cryptic "The string did not match the
// expected pattern." error.
export function safeExtension(fileName: string, fallback = "jpg"): string {
  const dot = fileName.lastIndexOf(".");
  const raw = dot === -1 ? "" : fileName.slice(dot + 1);
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return cleaned || fallback;
}
