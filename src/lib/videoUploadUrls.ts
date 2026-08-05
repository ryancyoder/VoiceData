import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";

// Shared by both the deal-scoped and event-scoped video upload-url routes —
// only the storage path prefix differs between them.
export async function createVideoSignedUploadUrls(pathPrefix: string, videoFileName: string, hasPoster: boolean) {
  const videoExt = safeExtension(videoFileName, "mp4");
  const videoPath = `${pathPrefix}/${Date.now()}-${crypto.randomUUID()}.${videoExt}`;

  const { data: videoSigned, error: videoError } = await supabase.storage
    .from(DEAL_PHOTOS_BUCKET)
    .createSignedUploadUrl(videoPath);
  if (videoError) throw new Error(videoError.message);

  let poster: { path: string; token: string } | null = null;
  if (hasPoster) {
    const posterPath = `${pathPrefix}/${Date.now()}-${crypto.randomUUID()}-poster.jpg`;
    const { data: posterSigned, error: posterError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .createSignedUploadUrl(posterPath);
    if (posterError) throw new Error(posterError.message);
    poster = { path: posterSigned.path, token: posterSigned.token };
  }

  return { video: { path: videoSigned.path, token: videoSigned.token }, poster };
}
