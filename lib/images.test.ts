import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALLOWED_MIME_TYPES,
  checkImage,
  describeRejection,
  MAX_BYTES,
  MAX_DIMENSION,
  sniffImage,
} from './images';

/*
 * Fixtures are real encoder output (libvips), not hand-written headers, so the
 * parser is checked against what a browser will actually upload rather than
 * against my own reading of the format specs. All are 23x7 — deliberately
 * asymmetric, so a width/height swap cannot pass.
 */
const WIDTH = 23;
const HEIGHT = 7;

const FIXTURES_BASE64: Record<string, string> = {
  jpeg:
    '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAHABcDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAMC/8QAIxAAAgEEAgAHAAAAAAAAAAAAAQIEAAMREhNRBRQhMUJygf/EABUBAQEAAAAAAAAAAAAAAAAAAAIE/8QAJREAAQMCAwkAAAAAAAAAAAAAAQACEQMhBDGhEzNBYnGBkdHw/9oADAMBAAIRAxEAPwCUwCJ4faiXY62m49LqqAMkJKQjI+uPwVSXctIbaIGVSeQgH5ZiufftiaUpUxdh5Se5j3HRFp2hbPF19FtsxL8ePzF/KlRtrjbDSU79O6UpVOF3Q+zEnVT17w45m58lf//Z',
  jpegProgressive:
    '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wgARCAAHABcDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAVAQEBAAAAAAAAAAAAAAAAAAABA//aAAwDAQACEAMQAAABihKFJ//EABkQAAIDAQAAAAAAAAAAAAAAAAECAAMiMv/aAAgBAQABBQJ81sROT//EABoRAAEFAQAAAAAAAAAAAAAAAAABAhEiUXH/2gAIAQMBAT8BS0dH6f/EABkRAAEFAAAAAAAAAAAAAAAAAAACAzJBcf/aAAgBAgEBPwFNYNRP/8QAHRAAAQQCAwAAAAAAAAAAAAAAAgABESEykaKy4v/aAAgBAQAGPwJhcYq+SbfVCM4+l//EABwQAAICAgMAAAAAAAAAAAAAAAEhABExsUFxwf/aAAgBAQABPyFJCQB0PkEoLA2fcPOVdZYT/9oADAMBAAIAAwAAABDwL//EABsRAAICAwEAAAAAAAAAAAAAAAERACExQZGh/9oACAEDAQE/ECZt28l0WTZ6Z//EAB4RAAEDBAMAAAAAAAAAAAAAAAEAETEhYXGBodHw/9oACAECAQE/EAqdx2W7bCh9Ic8r/8QAGhABAAIDAQAAAAAAAAAAAAAAARFRACExgf/aAAgBAQABPxAGrkwJRpJ48MbGhkDZe2nJTiYcNLerz//Z',
  png:
    'iVBORw0KGgoAAAANSUhEUgAAABcAAAAHCAIAAABsnkFsAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABL0lEQVQYlWNgUPXKn7LzHrOGb9H0PQ/ZtANKZ+1/wqkXXDH30HMew7DqBUdf8ZtE1i0+8VbIPKZx2ekPolbxLSvPfZawTWpfc/GbtENq1/orDD/lnDN6N13/o+iWPWHrrf8qnnmTd9xlUvcpnLb7AauWf8nMfY85dIPK5xx8xm0QWjX/yEs+44jaRcffCJpFNyw99V7EMq55xVmGT+I2iW2rL3yVsk/pXHf5h6xTes/Ga78VXLP6t9z8p+yRO2n7HUY174Kpu+6zaPoVz9j7iF0nsGz2gadc+iGV8w6/4DUKr1l4jOG1gGlU/ZKT74QtYpuWn/koZp3Quur8F0m75I61l77LOKZ1b7j6S94ls2/zjb9K7jkTt93GFgQMJIcBtiBgIDkMsAUBA8lhgC0IALjc7uAbfLPyAAAAAElFTkSuQmCC',
  webpLossy:
    'UklGRswAAABXRUJQVlA4IMAAAABwBQCdASoXAAcAPp0+mkiloyKhMAgAsBOJbACdMoMYMn/ziX9AMsA8ogmgAeA+3cEjraQAAPv7aHxOELw7nVP9//rqHMmZUzmV4F/IZ+wcuRf/6TaitOLtviMcpQOmVMkiBCZSu61OTN7NnmG4Fa/rvN+0/qJG9X9sFf+PiH/gaRNNBf/GL/2oFLv//4mP/GRMoPMU9O/6BLZMdnG0FK3MEMIT030P8Nu6aO5vu7aOJR/9v+ipv1auoKsPKhyGAAA=',
  webpLossless:
    'UklGRioAAABXRUJQVlA4TB4AAAAvFoABAM1lRP8DRNo2aqZv+ufg6Hi2pyQmgGUcRwA=',
  webpExtended:
    'UklGRvAAAABXRUJQVlA4WAoAAAAQAAAAFgAABgAAQUxQSAoAAAABB9C/iAhERP8DVlA4IMAAAABwBQCdASoXAAcAPp0+mkiloyKhMAgAsBOJbACdMoMYMn/ziX9AMsA8ogmgAeA+3cEjraQAAPv7aHxOELw7nVP9//rqHMmZUzmV4F/IZ+wcuRf/6TaitOLtviMcpQOmVMkiBCZSu61OTN7NnmG4Fa/rvN+0/qJG9X9sFf+PiH/gaRNNBf/GL/2oFLv//4mP/GRMoPMU9O/6BLZMdnG0FK3MEMIT030P8Nu6aO5vu7aOJR/9v+ipv1auoKsPKhyGAAA=',
};

function fixture(name: string): Uint8Array {
  const b64 = FIXTURES_BASE64[name];
  assert.ok(b64, `no fixture named ${name}`);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const ALL = Object.keys(FIXTURES_BASE64);

describe('sniffImage on real encoder output', () => {
  it('reads the dimensions of every format we accept', () => {
    for (const name of ALL) {
      const info = sniffImage(fixture(name));
      assert.ok(info, `${name} should be recognised`);
      assert.equal(info.width, WIDTH, `${name} width`);
      assert.equal(info.height, HEIGHT, `${name} height`);
    }
  });

  it('identifies the right mime type', () => {
    assert.equal(sniffImage(fixture('jpeg'))?.mimeType, 'image/jpeg');
    assert.equal(sniffImage(fixture('jpegProgressive'))?.mimeType, 'image/jpeg');
    assert.equal(sniffImage(fixture('png'))?.mimeType, 'image/png');
    for (const name of ['webpLossy', 'webpLossless', 'webpExtended']) {
      assert.equal(sniffImage(fixture(name))?.mimeType, 'image/webp', name);
    }
  });

  it('only ever reports a mime type we allow', () => {
    for (const name of ALL) {
      const info = sniffImage(fixture(name));
      assert.ok(ALLOWED_MIME_TYPES.includes(info!.mimeType));
    }
  });
});

describe('sniffImage rejects non-images', () => {
  it('returns null rather than throwing on junk', () => {
    const junk: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array(Buffer.from('hello world')),
      new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      new Uint8Array(Buffer.from('GIF89a')),
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      new Uint8Array(256).fill(0xff),
    ];
    for (const bytes of junk) {
      assert.equal(sniffImage(bytes), null, `should reject: ${Buffer.from(bytes).toString('latin1').slice(0, 20)}`);
    }
  });

  // A .jpg extension or a declared Content-Type proves nothing; only bytes do.
  it('rejects a file that merely claims to be an image', () => {
    const lying = new Uint8Array(Buffer.concat([
      Buffer.from([0x4d, 0x5a]),
      Buffer.from('this is an executable pretending to be image/jpeg'),
    ]));
    assert.equal(sniffImage(lying), null);
  });

  it('rejects a truncated header of each format', () => {
    for (const name of ALL) {
      const full = fixture(name);
      for (const keep of [3, 8, 12, 15]) {
        const truncated = full.slice(0, keep);
        const info = sniffImage(truncated);
        assert.ok(
          info === null || (info.width === WIDTH && info.height === HEIGHT),
          `${name} truncated to ${keep} bytes should be null, not garbage dimensions`,
        );
      }
    }
  });

  // A signature with no IHDR/RIFF payload must not read past the buffer.
  it('does not read past the end of a bare signature', () => {
    const barePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(sniffImage(barePng), null);
    const bareJpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    assert.equal(sniffImage(bareJpeg), null);
    const bareRiff = new Uint8Array(Buffer.from('RIFF????WEBP'));
    assert.equal(sniffImage(bareRiff), null);
  });
});

describe('checkImage', () => {
  it('accepts every fixture', () => {
    for (const name of ALL) {
      const result = checkImage(fixture(name));
      assert.ok(result.ok, `${name} should pass: ${!result.ok ? result.reason : ''}`);
    }
  });

  it('rejects an empty upload', () => {
    assert.deepEqual(checkImage(new Uint8Array(0)), { ok: false, reason: 'EMPTY' });
  });

  // This is the check that keeps a 7MB phone photo out of Postgres when the
  // client-side resize is skipped or bypassed.
  it('rejects anything over the byte cap, before parsing it', () => {
    const huge = new Uint8Array(MAX_BYTES + 1);
    huge.set(fixture('png').slice(0, 24));
    assert.deepEqual(checkImage(huge), { ok: false, reason: 'TOO_LARGE' });
  });

  it('accepts a payload exactly at the byte cap', () => {
    const png = fixture('png');
    const padded = new Uint8Array(MAX_BYTES);
    padded.set(png);
    assert.equal(padded.length, MAX_BYTES);
    assert.ok(checkImage(padded).ok);
  });

  it('rejects an unrecognised format', () => {
    assert.deepEqual(checkImage(new Uint8Array(Buffer.from('GIF89a...'))), {
      ok: false,
      reason: 'UNRECOGNISED_FORMAT',
    });
  });

  it('rejects dimensions over the cap, and accepts them exactly at it', () => {
    const over = pngWithDimensions(MAX_DIMENSION + 1, 10);
    assert.deepEqual(checkImage(over), { ok: false, reason: 'DIMENSIONS_TOO_LARGE' });

    const overTall = pngWithDimensions(10, MAX_DIMENSION + 1);
    assert.deepEqual(checkImage(overTall), { ok: false, reason: 'DIMENSIONS_TOO_LARGE' });

    const exact = pngWithDimensions(MAX_DIMENSION, MAX_DIMENSION);
    assert.ok(checkImage(exact).ok, 'exactly at the cap should pass');
  });

  it('rejects a zero dimension', () => {
    assert.deepEqual(checkImage(pngWithDimensions(0, 10)), { ok: false, reason: 'ZERO_DIMENSION' });
    assert.deepEqual(checkImage(pngWithDimensions(10, 0)), { ok: false, reason: 'ZERO_DIMENSION' });
  });

  it('has a human-readable message for every rejection', () => {
    const reasons = [
      'EMPTY',
      'TOO_LARGE',
      'UNRECOGNISED_FORMAT',
      'DIMENSIONS_TOO_LARGE',
      'ZERO_DIMENSION',
    ] as const;
    for (const reason of reasons) {
      const message = describeRejection(reason);
      assert.ok(message.length > 0 && !message.includes('undefined'), reason);
    }
  });
});

describe('sniffImage segment walking (JPEG)', () => {
  /** Splices a synthetic segment in right after SOI, before the real SOF. */
  function withSegmentBeforeFrame(marker: number, payload: number[]): Uint8Array {
    const jpeg = fixture('jpeg');
    const length = payload.length + 2;
    const segment = [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
    return new Uint8Array([...jpeg.slice(0, 2), ...segment, ...jpeg.slice(2)]);
  }

  // 0xC4 is DHT, not a Start Of Frame, even though it is inside the C0-CF
  // range. Real camera JPEGs routinely put it before the SOF, and mistaking it
  // for a frame header yields dimensions read out of a Huffman table.
  it('skips a DHT segment rather than mistaking it for a frame header', () => {
    const bytes = withSegmentBeforeFrame(0xc4, [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    assert.deepEqual(sniffImage(bytes), { mimeType: 'image/jpeg', width: WIDTH, height: HEIGHT });
  });

  it('skips the other non-frame markers in the C0-CF range', () => {
    for (const marker of [0xc8, 0xcc]) {
      const bytes = withSegmentBeforeFrame(marker, [0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
      assert.deepEqual(
        sniffImage(bytes),
        { mimeType: 'image/jpeg', width: WIDTH, height: HEIGHT },
        `marker 0x${marker.toString(16)} should be skipped`,
      );
    }
  });

  it('skips an EXIF block, which is where phone photos keep their GPS', () => {
    const exif = [...Buffer.from('Exif\0\0'), ...new Array(64).fill(0x2a)];
    const bytes = withSegmentBeforeFrame(0xe1, exif);
    assert.deepEqual(sniffImage(bytes), { mimeType: 'image/jpeg', width: WIDTH, height: HEIGHT });
  });

  it('skips fill bytes between segments', () => {
    const jpeg = fixture('jpeg');
    const bytes = new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xff, 0xff, ...jpeg.slice(2)]);
    assert.deepEqual(sniffImage(bytes), { mimeType: 'image/jpeg', width: WIDTH, height: HEIGHT });
  });

  it('gives up rather than looping when a segment length is nonsense', () => {
    const jpeg = fixture('jpeg');
    // A declared length of 0 would leave the offset stuck forever.
    const bytes = new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xdb, 0x00, 0x00, ...jpeg.slice(2)]);
    assert.equal(sniffImage(bytes), null);
  });
});

describe('sniffImage requires the real signature, not just an inner marker', () => {
  // Without the signature check, anything carrying "IHDR" at offset 12 would be
  // served back as image/png.
  it('does not accept a file with IHDR at the right offset but no PNG signature', () => {
    const bytes = new Uint8Array(24);
    bytes.set(Buffer.from('NOTAPNG!'), 0);
    bytes.set(Buffer.from('IHDR'), 12);
    new DataView(bytes.buffer).setUint32(16, 100);
    new DataView(bytes.buffer).setUint32(20, 50);
    assert.equal(sniffImage(bytes), null);
  });

  it('does not accept a WEBP chunk header without the RIFF container', () => {
    const bytes = new Uint8Array(32);
    bytes.set(Buffer.from('NOPE'), 0);
    bytes.set(Buffer.from('WEBP'), 8);
    bytes.set(Buffer.from('VP8 '), 12);
    assert.equal(sniffImage(bytes), null);
  });
});

/** Takes the real PNG fixture and rewrites the IHDR width/height in place. */
function pngWithDimensions(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(fixture('png'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
