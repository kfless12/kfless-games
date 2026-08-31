import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';

import { checkImage, sniffImage } from './images';
import { encodePng } from './png';

/*
 * The encoder is checked two ways: structurally here, and by feeding its output
 * to sniffImage, which is itself tested against real libvips output. If both
 * agreed only with each other that would prove nothing, but sniffImage is
 * pinned to a real encoder in images.test.ts, so this closes the loop.
 */

function parseChunks(png: Buffer) {
  const chunks: { type: string; length: number; crcValid: boolean; data: Buffer }[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    const data = png.subarray(offset + 8, offset + 8 + length);
    const stated = png.readUInt32BE(offset + 8 + length);
    const computed = crc32(png.subarray(offset + 4, offset + 8 + length)) >>> 0;
    chunks.push({ type, length, crcValid: stated === computed, data });
    offset += 12 + length;
  }
  return chunks;
}

const solid = (r: number, g: number, b: number) => () => [r, g, b] as const;

describe('encodePng', () => {
  it('writes the PNG signature', () => {
    const png = encodePng(4, 4, solid(255, 0, 0));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('writes IHDR, IDAT and IEND in that order, with valid CRCs', () => {
    const chunks = parseChunks(encodePng(8, 5, solid(1, 2, 3)));
    assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    for (const chunk of chunks) {
      assert.ok(chunk.crcValid, `${chunk.type} CRC should be valid`);
    }
  });

  it('records the dimensions and colour type in IHDR', () => {
    const [ihdr] = parseChunks(encodePng(23, 7, solid(0, 0, 0)));
    assert.equal(ihdr.data.readUInt32BE(0), 23);
    assert.equal(ihdr.data.readUInt32BE(4), 7);
    assert.equal(ihdr.data[8], 8, 'bit depth');
    assert.equal(ihdr.data[9], 2, 'colour type 2 = truecolour');
    assert.equal(ihdr.data[12], 0, 'not interlaced');
  });

  // Every scanline needs its filter byte, or a real decoder reads the image
  // shifted by one byte per row.
  it('prefixes every scanline with a filter byte and the exact pixel data', () => {
    const width = 3;
    const height = 2;
    const png = encodePng(width, height, (x, y) => [x * 10, y * 20, 30] as const);
    const idat = parseChunks(png).find((c) => c.type === 'IDAT')!;
    const raw = inflateSync(idat.data);

    assert.equal(raw.length, height * (1 + width * 3));
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * (1 + width * 3);
      assert.equal(raw[rowStart], 0, `row ${y} filter byte`);
      for (let x = 0; x < width; x += 1) {
        const p = rowStart + 1 + x * 3;
        assert.deepEqual([raw[p], raw[p + 1], raw[p + 2]], [x * 10, y * 20, 30]);
      }
    }
  });

  it('produces something our own upload validator accepts', () => {
    const png = encodePng(400, 400, (x, y) => [(x % 256), (y % 256), 128] as const);
    const info = sniffImage(png);
    assert.deepEqual(info, { mimeType: 'image/png', width: 400, height: 400 });
    assert.ok(checkImage(png).ok);
  });

  it('handles a single pixel', () => {
    const png = encodePng(1, 1, solid(7, 8, 9));
    assert.deepEqual(sniffImage(png), { mimeType: 'image/png', width: 1, height: 1 });
  });

  it('refuses nonsense dimensions rather than emitting a broken file', () => {
    for (const [w, h] of [[0, 5], [5, 0], [-1, 5], [2.5, 5]]) {
      assert.throws(() => encodePng(w, h, solid(0, 0, 0)), /bad dimensions/);
    }
  });

  it('masks channel values into a byte instead of overflowing', () => {
    const png = encodePng(1, 1, solid(300, -1, 255));
    assert.ok(sniffImage(png), 'should still be a valid PNG');
  });
});
