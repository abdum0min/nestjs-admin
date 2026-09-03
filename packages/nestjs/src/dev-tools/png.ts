/**
 * A PNG encoder, in about sixty lines.
 *
 * ## Why this exists at all
 *
 * Generated avatars want to be SVG - a few hundred bytes, no encoder, and
 * sharp at any size. They cannot be. The file routes added in 0.13 serve only
 * PNG, JPEG, GIF and WebP inline and send everything else as a download,
 * **SVG deliberately included**, because an SVG is an image that can contain
 * script and these files are served from the admin's own origin.
 *
 * So a generated avatar stored as SVG would be a file the admin refuses to
 * render - the whole feature failing on the one screen it exists for. The
 * choice was between weakening the sniffer for our own convenience and writing
 * an encoder. Weakening it would mean every application that takes uploads
 * carries the risk so that generated data can be prettier, which is not a trade
 * anybody would accept if it were written down.
 *
 * Node's `zlib` does the compression, so this is chunk framing and a CRC. The
 * images are flat colour, which deflates to almost nothing.
 */
import { deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A PNG chunk: length, type, payload, CRC of type and payload. */
function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)

  const typed = Buffer.concat([Buffer.from(type, 'latin1'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))

  return Buffer.concat([length, typed, crc])
}

/** One pixel, as the encoder wants it. */
export type Rgb = readonly [number, number, number]

/**
 * Encode an image from a function that answers what colour each pixel is.
 *
 * A callback rather than a buffer because every image this module draws is
 * described that way - a grid, a gradient - and building the buffer at each
 * call site would be the same loop written three times.
 */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): Buffer {
  // Each scanline is prefixed with its filter type. Zero - "none" - because
  // these images are blocks of flat colour, which deflate perfectly well
  // unfiltered, and the alternative is implementing five filters.
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0

  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0
    offset += 1

    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour, no alpha
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlacing

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    // Level 9: these run once, are cached by nobody, and end up in a database
    // somebody has to look at. Smaller is worth the milliseconds.
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
