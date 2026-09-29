// Real photos and documents, stored privately in Supabase Storage.
//   job-photos/<job id>/<before|after>-<time>.jpg   (driver uploads; driver + customer can view)
//   driver-docs/<user id>/<kind>-<time>.jpg         (driver uploads; only they + the owner can view)
// Photos are shrunk on the phone first (max 1600px, JPEG) so uploads are fast on cell data.
import { supabase, supabaseEnabled } from "./supabase.js";

export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  if (!file || !file.type?.startsWith("image/")) return file; // PDFs etc. go up as-is
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob || file;
  } catch {
    return file; // e.g. a HEIC the browser can't decode — upload the original
  }
}

const extFor = (blob) => (blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png"
  : blob.type === "image/heic" || blob.type === "image/heif" ? "heic" : "jpg");

// Driver: upload a before/after photo for a job. Returns { path, phase, ts }.
export async function uploadJobPhoto(jobId, phase, file) {
  if (!supabaseEnabled) throw new Error("Photo upload isn't set up");
  const blob = await compressImage(file);
  const ts = Date.now();
  const path = `${jobId}/${phase}-${ts}.${extFor(blob)}`;
  const { error } = await supabase.storage.from("job-photos").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) throw new Error(error.message);
  return { path, phase, ts };
}

// Driver: upload a document (license, registration, insurance) and record it.
export async function uploadDriverDoc(userId, kind, file) {
  if (!supabaseEnabled || !userId) throw new Error("Document upload isn't set up");
  const blob = await compressImage(file, 2200, 0.85); // keep documents readable
  const path = `${userId}/${kind}-${Date.now()}.${extFor(blob)}`;
  const up = await supabase.storage.from("driver-docs").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase.from("driver_documents").insert({ user_id: userId, kind, path }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Driver: my documents, newest first.
export async function myDriverDocs(userId) {
  if (!supabaseEnabled || !userId) return [];
  const { data } = await supabase.from("driver_documents").select("*").eq("user_id", userId).order("uploaded_at", { ascending: false });
  return data || [];
}

// A short-lived private link to view a stored file (cached for a few minutes).
const cache = new Map();
export async function signedUrl(bucket, path) {
  if (!supabaseEnabled || !path) return null;
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 30);
  if (data?.signedUrl) cache.set(key, { url: data.signedUrl, exp: Date.now() + 25 * 60 * 1000 });
  return data?.signedUrl || null;
}
