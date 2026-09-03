/**
 * `/admin/files` - taking a file in, and giving it back.
 *
 * Declared before `AdminController`, like every other literal segment, so
 * `files` is never read as a model name.
 *
 * ## Why the body is raw bytes and not multipart
 *
 * A multipart parser is a dependency - `multer`, or a boundary parser written
 * here - and this package has one runtime dependency in total. It does not need
 * one: the interface uploads with `fetch(url, { method: 'POST', body: file })`,
 * which sends the file as the whole body, and the name travels in a header.
 * The result is a stream from the first byte, no temporary file, and nothing to
 * keep in step with a parser's own security advisories.
 *
 * A browser form post would still need multipart. The admin has never used one.
 *
 * ## The three refusals
 *
 * A file is rejected for being too large **while it streams**, so an oversized
 * upload dies partway rather than after arriving. It is rejected for being a
 * type the field does not accept, decided from the bytes rather than from the
 * header the uploader sent. And whatever is stored is served back with a type
 * decided the same way - so an HTML file called `avatar.png` downloads instead
 * of executing on the admin's own origin.
 */
import { AdapterError, InvalidQueryError, storageKeyFor, type AdminStorage } from '@nest-admin/core'
import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'

import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, type SuccessResponse } from '../http/response.js'
import { AdminAuthGuard } from '../auth/guard.js'
import { ADMIN_FILES } from '../tokens.js'
import { isLocalStorage } from './local.js'
import { accepts, mayRenderInline, sniffType, SNIFF_BYTES } from './sniff.js'

/** Everything the module resolved about file handling, or nothing. */
export interface FilesRuntime {
  readonly storage: AdminStorage
  /** The ceiling no field may exceed, whatever it declares. */
  readonly maxSize: number
}

export interface UploadedFile {
  /** What goes in the record's column. */
  readonly key: string
  /** Where it can be seen. Signed and short-lived for a private bucket. */
  readonly url: string
  readonly type: string
  readonly size: number
}

/**
 * The name the uploader gave, decoded.
 *
 * An HTTP header is bytes, not text: a value outside Latin-1 cannot travel in
 * one, and a browser asked to send `ҳисобот.pdf` raw simply refuses. So the
 * interface percent-encodes it and this decodes it back.
 *
 * Without the decode, a non-Latin filename arrived as `%D2%B3%D0%B8...` and was
 * sanitised into a run of dashes - which made the effort to keep Unicode names
 * intact pointless. Nothing in a test caught that; a real upload did.
 *
 * A malformed sequence is kept as it arrived rather than throwing. The name is
 * decoration; refusing an upload over it would be the wrong trade.
 */
function filenameFrom(value: string | undefined): string {
  if (value === undefined || value === '') return 'file'

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * The refusal, in one place.
 *
 * Two paths reach it - the announced length and the actual stream - and a
 * person should not be able to tell which one caught them.
 */
function tooLarge(limit: number): InvalidQueryError {
  const mb = limit / 1024 / 1024
  const readable = mb >= 1 ? `${Math.round(mb * 10) / 10} MB` : `${Math.round(limit / 1024)} KB`
  return new InvalidQueryError(`This file is larger than the ${readable} limit for this field.`)
}

/**
 * Read a request body, refusing it the moment it grows past the limit.
 *
 * Counted as the chunks arrive rather than checked at the end: a caller that
 * ignores the limit should not be able to make the process hold a gigabyte
 * before being told no.
 */
async function* limited(
  source: AsyncIterable<Uint8Array>,
  limit: number,
  onTotal: (total: number) => void,
): AsyncIterable<Uint8Array> {
  let total = 0

  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > limit) throw tooLarge(limit)
    yield chunk
  }

  onTotal(total)
}

@Controller('files')
@UseFilters(AdminExceptionFilter)
export class AdminFilesController {
  constructor(@Inject(ADMIN_FILES) private readonly files: FilesRuntime | undefined) {}

  /**
   * `POST /admin/files` - the body is the file.
   *
   * `x-admin-filename` names it, `x-admin-accept` says what the field will
   * take, and `x-admin-max-size` narrows the limit. The last two come from the
   * metadata document the interface is rendering, and are re-checked here
   * against the module's own ceiling - a header is a request, not a permission.
   */
  @Post()
  @UseGuards(AdminAuthGuard)
  async upload(@Req() request: unknown): Promise<SuccessResponse<UploadedFile>> {
    try {
      return await this.receive(request)
    } catch (cause) {
      /*
       * Refusing an upload means answering while the client is still sending.
       *
       * The socket is then in a state neither side agrees about: the server has
       * finished, the client has not, and the connection goes back into the
       * client's pool looking reusable. The next request on it fails with
       * ECONNRESET - a spurious failure, on a perfectly good request, caused by
       * the one before it.
       *
       * `Connection: close` is the answer HTTP already has for this. Draining
       * the rest of the body would also work and would mean reading the entire
       * oversized upload, which is the thing the limit exists to avoid.
       */
      closeConnection(request)
      throw cause
    }
  }

  private async receive(request: unknown): Promise<SuccessResponse<UploadedFile>> {
    const files = this.require()
    const headers = headersOf(request)

    const declared = (headers['x-admin-accept'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')

    const limit = Math.min(numberFrom(headers['x-admin-max-size']) ?? files.maxSize, files.maxSize)

    /*
     * Refused before a single byte is read, when the client says how many there
     * are - which every browser and every sensible client does.
     *
     * The stream is still checked below, because `Content-Length` is a claim.
     * This is about answering *early*: a client that is halfway through sending
     * a hundred megabytes may never get to read the response, so the sooner it
     * goes out the better its chances.
     */
    const announced = numberFrom(headers['content-length'])
    if (announced !== undefined && announced > limit) throw tooLarge(limit)

    let size = 0
    const body = limited(request as AsyncIterable<Uint8Array>, limit, (total) => (size = total))

    // The first chunk decides the type, and it has to be decided before the
    // bytes reach storage - putting a file away and then discovering it is
    // HTML would mean deleting it, and a delete that fails leaves it there.
    const [head, rest] = await splitHead(body)
    const type = sniffType(head)

    if (!accepts(declared, type)) {
      throw new InvalidQueryError(
        declared.length === 0
          ? 'This file type is not accepted.'
          : `This field accepts ${declared.join(', ')}.`,
      )
    }

    const key = storageKeyFor(
      filenameFrom(headers['x-admin-filename']),
      randomBytes(6).toString('hex'),
    )

    await files.storage.put({
      key,
      type: type ?? 'application/octet-stream',
      bytes: rest,
    })

    return success({
      key,
      url: await files.storage.url(key),
      type: type ?? 'application/octet-stream',
      size,
    })
  }

  /**
   * `GET /admin/files/...` - give a stored file back.
   *
   * Only reachable for the local store: anything else answers with a URL that
   * points at the store itself, and never routes bytes through here.
   *
   * Guarded, because a file belongs to a record and the records are guarded.
   * The consequence is that an `<img>` in the admin works - same origin, cookie
   * sent - and a link pasted into a chat does not, which is the right way round.
   */
  @Get('*key')
  @UseGuards(AdminAuthGuard)
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@Param('key') key: string | string[]): Promise<StreamableFile> {
    const files = this.require()
    const storage = files.storage

    if (!isLocalStorage(storage)) {
      throw new AdapterError('This admin does not serve files; its storage provides its own URLs.')
    }

    const path = Array.isArray(key) ? key.join('/') : key
    const stream = storage.read(path)
    if (stream === undefined) throw new InvalidQueryError(`No stored file named "${path}".`)

    // Sniffed again on the way out. The type recorded at upload is not consulted
    // - if anything ever wrote to this directory by another route, the bytes are
    // still the only thing worth believing.
    const head = await firstBytes(storage.read(path))
    const type = sniffType(head)

    return new StreamableFile(stream as Readable, {
      type: type ?? 'application/octet-stream',
      // Anything a browser would not render as a picture leaves as a download.
      // An HTML file uploaded as `avatar.png` is the attack this closes.
      ...(mayRenderInline(type) ? {} : { disposition: 'attachment' }),
    })
  }

  private require(): FilesRuntime {
    if (this.files === undefined) {
      throw new AdapterError('File uploads are not configured for this admin.')
    }
    return this.files
  }
}

/**
 * Ask for this connection to end after the response.
 *
 * Reached through the request rather than through a second decorator, and
 * written defensively: a host that is not Express, or a response already sent,
 * must not turn a refused upload into a crash.
 */
function closeConnection(request: unknown): void {
  const response = (request as { res?: { setHeader?: (name: string, value: string) => void } }).res

  try {
    response?.setHeader?.('Connection', 'close')
  } catch {
    // Headers already sent. The refusal still reaches the client; only the
    // connection hint is lost.
  }
}

/** The request's headers, lower-cased, without depending on an Express type. */
function headersOf(request: unknown): Record<string, string | undefined> {
  const headers = (request as { headers?: Record<string, unknown> }).headers ?? {}
  const found: Record<string, string | undefined> = {}

  for (const [name, value] of Object.entries(headers)) {
    found[name.toLowerCase()] = Array.isArray(value) ? value[0] : (value as string | undefined)
  }
  return found
}

function numberFrom(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Enough of the stream to identify it, and the whole stream to store. */
async function splitHead(
  source: AsyncIterable<Uint8Array>,
): Promise<[Uint8Array, AsyncIterable<Uint8Array>]> {
  const chunks: Uint8Array[] = []
  let read = 0

  const iterator = source[Symbol.asyncIterator]()
  while (read < SNIFF_BYTES) {
    const next = await iterator.next()
    if (next.done === true) break
    chunks.push(next.value)
    read += next.value.byteLength
  }

  const head = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, SNIFF_BYTES)

  // The chunks already taken are handed back first, so nothing is read twice
  // and nothing is lost.
  async function* rest(): AsyncIterable<Uint8Array> {
    for (const chunk of chunks) yield chunk
    while (true) {
      const next = await iterator.next()
      if (next.done === true) return
      yield next.value
    }
  }

  return [head, rest()]
}

async function firstBytes(stream: NodeJS.ReadableStream | undefined): Promise<Uint8Array> {
  if (stream === undefined) return new Uint8Array()

  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    ;(stream as Readable).destroy()
    return Buffer.from(chunk).subarray(0, SNIFF_BYTES)
  }
  return new Uint8Array()
}
