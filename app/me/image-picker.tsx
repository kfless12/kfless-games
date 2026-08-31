'use client';

import { useRef, useState } from 'react';

/*
 * Resizes the chosen image in the browser before it is uploaded. SPEC.md §9.3.
 *
 * Two reasons this happens client-side: a phone sends roughly 150 KB instead of
 * 7 MB, which matters on party wifi, and drawing to a canvas discards EXIF, so
 * the GPS coordinates in a phone photo never reach the database.
 *
 * The server does not trust any of it — lib/images.ts re-reads the format and
 * dimensions from the bytes and enforces the caps.
 */

const TARGET_MAX_EDGE = 800;
const JPEG_QUALITY = 0.82;

/*
 * Matches MAX_BYTES in lib/images.ts. Enforced here as well as on the server
 * because a body over the server-action limit fails as a 413 before any of our
 * code runs, which would show a blank error page instead of a readable message.
 * A resized 800px photo is ~200 KB, so this only ever trips if the resize
 * failed on something enormous.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * PNG in, PNG out, so a team logo with transparency does not come back with a
 * black background. Everything else becomes JPEG, which is far smaller for
 * photographs. Both are formats lib/images.ts accepts.
 */
function outputFormat(file: File): { mime: 'image/png' | 'image/jpeg'; extension: string } {
  return file.type === 'image/png'
    ? { mime: 'image/png', extension: 'png' }
    : { mime: 'image/jpeg', extension: 'jpg' };
}

async function resizeImage(file: File): Promise<File> {
  // createImageBitmap applies EXIF orientation, so phone photos are not sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const scale = Math.min(1, TARGET_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const format = outputFormat(file);
  const blob = await new Promise<Blob | null>((resolve) =>
    // toBlob ignores the quality argument for PNG, which is lossless.
    canvas.toBlob(resolve, format.mime, JPEG_QUALITY),
  );
  if (!blob) throw new Error('could not encode');

  return new File([blob], `upload.${format.extension}`, { type: format.mime });
}

export function ImagePicker({
  name,
  label,
  currentUrl,
  shape = 'circle',
}: {
  name: string;
  label: string;
  currentUrl: string | null;
  shape?: 'circle' | 'square';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;

    setBusy(true);
    setStatus('Resizing…');
    try {
      const resized = await resizeImage(chosen);
      accept(resized, `Ready — ${Math.round(resized.size / 1024)} KB`);
    } catch {
      // Resize failed. Send the original if it is small enough, otherwise say so
      // rather than letting the request die as a 413.
      if (chosen.size <= MAX_UPLOAD_BYTES) {
        accept(chosen, `Could not resize this one — sending as-is, ${Math.round(chosen.size / 1024)} KB`);
      } else {
        reject('That image is too big and could not be resized. Try a different one.');
      }
    } finally {
      setBusy(false);
    }
  }

  function accept(file: File, message: string) {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject('That image is still too big after resizing. Try a different one.');
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (inputRef.current) inputRef.current.files = transfer.files;
    setPreview(URL.createObjectURL(file));
    setStatus(message);
  }

  function reject(message: string) {
    if (inputRef.current) inputRef.current.value = '';
    setPreview(null);
    setStatus(message);
  }

  const shown = preview ?? currentUrl;
  const rounded = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  return (
    <div className="flex items-center gap-4">
      {shown ? (
        // Plain img, not next/image: these are already resized, and next/image
        // would want to optimize them to disk.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown}
          alt=""
          className={`size-20 shrink-0 border-2 border-rule object-cover ${rounded}`}
        />
      ) : (
        <div
          aria-hidden
          className={`size-20 shrink-0 border-2 border-dashed border-rule ${rounded}`}
        />
      )}

      <div className="flex flex-col gap-1">
        <label
          htmlFor={name}
          className="flex h-11 w-fit cursor-pointer items-center rounded-lg border-2 border-ink px-4 text-base font-bold"
        >
          {busy ? 'Working…' : label}
        </label>
        <input
          ref={inputRef}
          id={name}
          name={name}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          className="sr-only"
        />
        {status && <span className="text-sm text-muted">{status}</span>}
      </div>
    </div>
  );
}
