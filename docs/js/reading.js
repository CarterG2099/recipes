/**
 * reading.js — turning links, photos and PDFs into recipe drafts, shared by the
 * edit page and bulk add.
 *   • links  → import-url Edge Function (JSON-LD)
 *   • photos/PDFs → import-photo Edge Function (Gemini); photos are shrunk in
 *     the browser and stored in the recipe-images bucket first.
 */

import { supabase } from './supabase.js';

const BUCKET = 'recipe-images';
const MAX_EDGE = 1600;   // px — plenty for reading a card; keeps uploads small on mobile
const JPEG_QUALITY = 0.85;

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

// Shrink a phone photo and bake in EXIF rotation. Returns { blob, base64, mimeType }.
// Non-images (shouldn't happen here) pass through untouched.
export async function prepImage(file) {
  if (!file.type.startsWith('image/')) {
    return { blob: file, base64: await blobToBase64(file), mimeType: file.type };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  return { blob, base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
}

export async function uploadBlob(blob, ext, contentType) {
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Call an Edge Function and return its JSON, throwing its own error message.
// supabase-js gives a generic message on non-2xx; dig out our real detail.
export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail = error.message || 'request failed';
    try {
      const json = await error.context.json();
      if (json?.error) detail = json.error;
    } catch (_) { /* body wasn't JSON */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Send files (images or a PDF) to the Gemini-backed reader and return its
// single combined draft. images: [{ imageBase64, mimeType }]
export function readWithGemini(images) {
  return invokeFunction('import-photo', { images });
}

/**
 * Store each photo and read them all as one recipe. Returns the draft and the
 * stored photos' public URLs; nothing is uploaded for a PDF.
 */
export async function readFiles(files) {
  const images = [];
  const imageUrls = [];
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const { blob, base64, mimeType } = await prepImage(file);
      imageUrls.push(await uploadBlob(blob, 'jpg', mimeType));
      images.push({ imageBase64: base64, mimeType });
    } else {
      images.push({ imageBase64: await blobToBase64(file), mimeType: file.type || 'application/pdf' });
    }
  }
  return { draft: await readWithGemini(images), imageUrls };
}
