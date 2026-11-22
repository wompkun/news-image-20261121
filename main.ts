// The World in One Day — 21 November 2026.
// Node 22, standard library only, no network. Copies the entry image
// (JPEG data under the entry.png name) beside this file to
// <MAKEFUN_OUTPUT_DIR>/entry.png and validates it before finishing:
// at most 1 MiB and exactly 1024 by 1024 pixels.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1048576;
const EXPECTED_WIDTH = 1024;
const EXPECTED_HEIGHT = 1024;

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const source = new URL('./entry.png', import.meta.url);
const dest = join(outDir, 'entry.png');

mkdirSync(outDir, { recursive: true });
copyFileSync(source, dest);

const bytes = readFileSync(dest);
const size = statSync(dest).size;
if (size > MAX_BYTES) {
  throw new Error(`entry.png is ${size} bytes, over the 1 MiB limit`);
}

// PNG: width/height live in the IHDR chunk. Layout: 8-byte signature,
// 4-byte chunk length (offset 8), 4-byte chunk type "IHDR" (offset 12),
// then width (offset 16) and height (offset 20), both big-endian.
function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error('PNG signature or IHDR chunk not found');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// JPEG: scan the marker segments for a Start Of Frame marker
// (0xC0-0xCF except 0xC4, 0xC8, 0xCC), whose payload holds the height
// then the width as big-endian 16-bit values. Standalone markers
// (SOI 0xD8, RSTn 0xD0-0xD7, TEM 0x01) carry no length field; every
// other segment is skipped by its own length. The scan stops at SOS
// (0xDA), after which the entropy-coded data begins.
function jpegDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('not a JPEG: missing SOI marker');
  }
  let offset = 2;
  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) {
      throw new Error(`JPEG marker expected at offset ${offset}`);
    }
    // Skip fill bytes (0xFF padding) and the stuffed 0x00.
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) break;
    const marker = buf[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      // Standalone marker: no length field, keep scanning.
      continue;
    }
    if (offset + 1 >= buf.length) break;
    const length = buf.readUInt16BE(offset);
    if (length < 2 || offset + length > buf.length) {
      throw new Error(`JPEG segment at offset ${offset} has bad length ${length}`);
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 7) throw new Error('JPEG SOF segment too short');
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      return { width, height };
    }
    if (marker === 0xda) {
      // Start of scan: no SOF seen before the image data.
      throw new Error('JPEG SOF marker not found before SOS');
    }
    offset += length;
  }
  throw new Error('JPEG SOF marker not found');
}

const isPng = bytes.length >= 8 &&
  bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
  bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
const isJpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;

let dims: { width: number; height: number };
if (isPng) {
  dims = pngDimensions(bytes);
} else if (isJpeg) {
  dims = jpegDimensions(bytes);
} else {
  throw new Error('entry.png is neither a PNG nor a JPEG (unrecognised magic bytes)');
}

if (dims.width !== EXPECTED_WIDTH || dims.height !== EXPECTED_HEIGHT) {
  throw new Error(`entry.png is ${dims.width}x${dims.height}, expected 1024x1024`);
}

console.log(`wrote ${dest} (${size} bytes, 1024x1024)`);
