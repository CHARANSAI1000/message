/** Preparing, encrypting, uploading and decrypting attachments (photos, files, voice notes). */

import { attachmentsApi } from '../api';
import type { AttachmentMeta } from '../types';
import { decryptFile, encryptFile } from './crypto';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, max: number) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Image conversion failed'))), type, q));

/** Resize photos (saves storage and strips EXIF location data) and build a tiny preview. */
export async function preparePhoto(file: File) {
  const img = await loadImage(file);
  const full = draw(img, 1920);
  const blob = await toBlob(full, 'image/jpeg', 0.85);
  const thumb = draw(img, 48).toDataURL('image/jpeg', 0.6);
  return { blob, w: full.width, h: full.height, thumb };
}

/** Square-crop and shrink a profile photo. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 320;
  canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
  return toBlob(canvas, 'image/jpeg', 0.85);
}

export async function uploadEncrypted(blob: Blob, info: Omit<AttachmentMeta, 'id' | 'key' | 'iv' | 'size'>): Promise<AttachmentMeta> {
  if (blob.size > MAX_FILE_BYTES) throw new Error('Files can be up to 10 MB');
  const { ciphertext, key, iv } = await encryptFile(await blob.arrayBuffer());
  const { id } = await attachmentsApi.upload(ciphertext);
  return { ...info, id, key, iv, size: blob.size };
}

const cache = new Map<string, Promise<string>>();

/** Download + decrypt once per session; returns an object URL for <img>/<audio>/<a download>. */
export function attachmentUrl(att: AttachmentMeta): Promise<string> {
  let p = cache.get(att.id);
  if (!p) {
    p = attachmentsApi.download(att.id)
      .then((ct) => decryptFile(ct, att.key, att.iv))
      .then((plain) => URL.createObjectURL(new Blob([plain], { type: safeMime(att) })));
    p.catch(() => cache.delete(att.id));
    cache.set(att.id, p);
  }
  return p;
}

/** Never let a received file render as HTML/SVG/script in our origin. */
function safeMime(att: AttachmentMeta): string {
  if (att.kind === 'image') return /^image\/(jpeg|png|webp|gif)$/.test(att.mime) ? att.mime : 'image/jpeg';
  if (att.kind === 'audio') return /^audio\//.test(att.mime) ? att.mime : 'audio/webm';
  return 'application/octet-stream';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
