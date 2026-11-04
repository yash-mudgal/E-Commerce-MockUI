import { api, ApiError } from "./api";
import type { ProductImage, UploadTicket } from "./types";

/** Mirrors the API's MediaRules. The API re-checks the stored file; these checks just fail fast. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 10;

export function checkImageFile(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_IMAGE_BYTES) return `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Images must be 5 MB or smaller.`;
  return null;
}

/** PUT with progress (fetch has no upload progress). */
function put(url: string, headers: Record<string, string>, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, { title: "The upload was rejected by storage. Try again." })));
    xhr.onerror = () => reject(new ApiError(0, { title: "The upload failed. Check your connection and try again." }));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** Ask for a presigned URL, upload the file straight to storage, then ask the API to verify and publish it. */
export async function uploadProductImage(productId: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  const ticket = await api<UploadTicket>(`/admin/products/${productId}/media/uploads`, {
    method: "POST",
    body: { contentType: file.type, sizeBytes: file.size, fileName: file.name },
    signal,
  });
  await put(ticket.uploadUrl, ticket.headers, file, onProgress, signal);
  return api<ProductImage>(`/admin/products/${productId}/media/${ticket.mediaId}/complete`, { method: "POST", signal });
}

/** Moves one item and returns the new order (used by the accessible left/right buttons). */
export function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
