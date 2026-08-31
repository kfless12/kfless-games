/*
 * Image validation, SPEC.md §9.3.
 *
 * The browser resizes on a canvas before uploading, but the server must not
 * trust that — anything can POST to the upload route. So this reads the real
 * format and dimensions out of the bytes themselves rather than believing the
 * declared Content-Type or filename.
 *
 * Pure, no database, no next/headers, so it is unit tested directly. That
 * matters more here than elsewhere: header parsing is fiddly per format and a
 * mistake either rejects a friend's photo or lets a 7MB row into Postgres.
 */

export const MAX_BYTES = 5 * 1024 * 1024;

/** Generous ceiling above the 800px the browser targets, per SPEC.md §9.3. */
export const MAX_DIMENSION = 2000;

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ImageMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type ImageInfo = { mimeType: ImageMimeType; width: number; height: number };

export type ImageRejection =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNRECOGNISED_FORMAT'
  | 'DIMENSIONS_TOO_LARGE'
  | 'ZERO_DIMENSION';

export type ImageCheck = { ok: true; info: ImageInfo } | { ok: false; reason: ImageRejection };

/**
 * Identifies the format from its magic bytes and reads the real dimensions.
 * Returns null for anything it does not recognise — including a file whose
 * extension or Content-Type claims to be an image but whose bytes disagree.
 */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

/** The whole server-side gate for an upload. */
export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  if (bytes.length > MAX_BYTES) return { ok: false, reason: 'TOO_LARGE' };

  const info = sniffImage(bytes);
  if (!info) return { ok: false, reason: 'UNRECOGNISED_FORMAT' };
  if (info.width === 0 || info.height === 0) return { ok: false, reason: 'ZERO_DIMENSION' };
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    return { ok: false, reason: 'DIMENSIONS_TOO_LARGE' };
  }

  return { ok: true, info };
}

export function describeRejection(reason: ImageRejection): string {
  switch (reason) {
    case 'EMPTY':
      return 'That file was empty.';
    case 'TOO_LARGE':
      return `That image is over ${MAX_BYTES / 1024 / 1024} MB.`;
    case 'UNRECOGNISED_FORMAT':
      return 'That does not look like a JPEG, PNG, or WebP.';
    case 'DIMENSIONS_TOO_LARGE':
      return `That image is wider or taller than ${MAX_DIMENSION}px.`;
    case 'ZERO_DIMENSION':
      return 'That image has no width or height.';
  }
}

// ---------------------------------------------------------------------------
// Format readers
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** PNG: dimensions are the first two fields of the IHDR chunk, at a fixed offset. */
function readPng(bytes: Uint8Array): ImageInfo | null {
  if (!startsWith(bytes, PNG_SIGNATURE)) return null;
  // 8 signature + 4 length + 4 "IHDR" = 16, then width and height.
  if (bytes.length < 24) return null;
  if (!startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return null;

  return {
    mimeType: 'image/png',
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20),
  };
}

/**
 * JPEG: no fixed dimension offset. Walk the segment markers until a Start Of
 * Frame, whose payload carries height then width. SOF markers are C0–CF except
 * C4 (Huffman tables), C8 (JPG extension), and CC (arithmetic coding), which
 * are not frame headers.
 */
function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null; // not where a marker should be

    const marker = bytes[offset + 1];

    // Padding byte between segments.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers with no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) return null;

    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      // payload: precision(1) height(2) width(2)
      if (offset + 9 >= bytes.length) return null;
      return {
        mimeType: 'image/jpeg',
        height: readUint16BE(bytes, offset + 5),
        width: readUint16BE(bytes, offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

/**
 * WebP: a RIFF container whose dimensions are encoded differently in each of
 * the three chunk types. All three are little-endian and none of them is
 * byte-aligned in the same way, which is why this is worth testing.
 */
function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return null; // "RIFF"
  if (!startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return null; // "WEBP"
  if (bytes.length < 16) return null;

  // Lossy: "VP8 " then a 3-byte start code, then 14-bit width/height.
  if (startsWith(bytes, [0x56, 0x50, 0x38, 0x20], 12)) {
    if (bytes.length < 30) return null;
    return {
      mimeType: 'image/webp',
      width: ((bytes[27] << 8) | bytes[26]) & 0x3fff,
      height: ((bytes[29] << 8) | bytes[28]) & 0x3fff,
    };
  }

  // Lossless: "VP8L", then 14 bits of width and 14 of height, minus one.
  if (startsWith(bytes, [0x56, 0x50, 0x38, 0x4c], 12)) {
    if (bytes.length < 25) return null;
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      mimeType: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  // Extended: "VP8X", 24-bit canvas width and height, minus one.
  if (startsWith(bytes, [0x56, 0x50, 0x38, 0x58], 12)) {
    if (bytes.length < 30) return null;
    return {
      mimeType: 'image/webp',
      width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
      height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
    };
  }

  return null;
}
