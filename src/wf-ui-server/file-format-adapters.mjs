// file-format-adapters.mjs
//
// Stateless parsing adapters for Excel / PDF / ZIP workspace files
// (task-upgrade-file-node AC-5..AC-7, PLAN D4).
//
// Contract:
//   - Pure functions: no module state, no caching; every call re-reads the
//     file. File access is async (fs/promises) and zip payloads are streamed —
//     never the whole archive in memory.
//   - Error contract: corrupt/unreadable files throw ComponentNodeError with
//     a machine-readable code (XLSX_PARSE / PDF_PARSE / ZIP_PARSE /
//     ZIP_ENTRY_NOT_TEXT / ZIP_SLIP / ZIP_ENTRY_NOT_FOUND / ZIP_INVALID_NAME /
//     FILE_TOO_LARGE / FILE_EXISTS / PAYLOAD_TOO_LARGE) and a 4xx
//     statusCode, matching the ComponentNodeError precedent
//     (markdown_locked, 409). Message text is never asserted by tests — only
//     err.code and err.statusCode.
//   - Parser libraries are imported dynamically so loading this module stays
//     cheap and unpdf's pdfjs bundle is only fetched on first PDF call.

import fs from 'node:fs/promises'
import { createWriteStream, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ComponentNodeError } from './component-node-store.mjs'

// Text-like extensions allowed for readZipEntry previews. Everything else is
// refused with ZIP_ENTRY_NOT_TEXT (binary previews are out of scope).
const TEXT_ENTRY_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.css', '.html', '.csv', '.log', '.yaml', '.yml',
])

// W4F hardening limits (task-upgrade-file-node security review):
//   - MAX_FORMAT_FILE_BYTES: files larger than this are refused before any
//     xlsx/pdf parser is touched (M3; injectable per call for tests).
//   - MAX_ZIP_PREVIEW_BYTES: hard ceiling for a single readZipEntry preview —
//     maxBytes is clamped to this, and entries whose central-directory size
//     exceeds it are refused without opening a read stream (H1).
//   - MAX_ZIP_ENTRIES: readZipEntries stops scanning after this many entries
//     and reports truncated:true (M2).
//   - MAX_EXTRACT_ENTRY_BYTES: extractZipEntry refuses entries whose
//     uncompressed size exceeds this before writing any byte (M1).
export const MAX_FORMAT_FILE_BYTES = 100 * 1024 * 1024
export const MAX_ZIP_PREVIEW_BYTES = 1 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 10000
export const MAX_EXTRACT_ENTRY_BYTES = 64 * 1024 * 1024

// H1: hard-clamp a caller-supplied byte budget. Non-finite numbers
// (Infinity, 1e999, NaN) fall back to the 64KB default; finite numbers are
// capped at MAX_ZIP_PREVIEW_BYTES so no caller can raise the preview budget
// beyond 1MB (Math.max(1, Math.floor(n) || 65536) failed to clamp those).
function clampPreviewBytes(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 65536
  return Math.min(Math.max(1, Math.floor(n)), MAX_ZIP_PREVIEW_BYTES)
}

// W5F-R1: hard-clamp a caller-supplied format-gate budget (xlsx/pdf size
// gate). Same finite-ness logic as clampPreviewBytes, but the ceiling is
// MAX_FORMAT_FILE_BYTES (100MB), not the 1MB preview cap: an absurd budget
// (Infinity, 1e999, NaN, 'abc') falls back to the 100MB cap so it can never
// disable the size gate, and no caller can raise the gate beyond 100MB.
export function clampFormatMaxBytes(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return MAX_FORMAT_FILE_BYTES
  return Math.min(Math.max(1, Math.floor(n)), MAX_FORMAT_FILE_BYTES)
}

// M3: refuse oversized xlsx/pdf files before any parser library runs. The
// limit is injectable (per-call maxBytes) so tests can exercise the rejection
// without a 100MB fixture; production callers default to MAX_FORMAT_FILE_BYTES.
async function assertParseFileSizeWithin(filePath, maxBytes) {
  const stat = await fs.stat(filePath)
  if (stat.size > maxBytes) {
    throw new ComponentNodeError(
      `File exceeds the format parsing size limit: ${stat.size} bytes`,
      { statusCode: 400, code: 'FILE_TOO_LARGE' },
    )
  }
}

function parseError(message, code) {
  return new ComponentNodeError(message, { statusCode: 400, code })
}

// ── Excel (.xlsx) ──────────────────────────────────────────────────────────
// read-excel-file reads the whole workbook into memory for sheet discovery;
// that is accepted for xlsx (PLAN D4). readXlsxSheet still pages the parsed
// rows instead of returning the whole sheet.

export async function readXlsxSheets(filePath, { maxBytes = MAX_FORMAT_FILE_BYTES } = {}) {
  try {
    // W5F-R1: the gate budget goes through clampFormatMaxBytes so an absurd
    // caller value (1e999 / 'abc') can never fail-open the size gate.
    await assertParseFileSizeWithin(filePath, clampFormatMaxBytes(maxBytes))
    const { default: readXlsxFile } = await import('read-excel-file/node')
    const sheets = await readXlsxFile(filePath)
    return { sheets: sheets.map((sheet) => String(sheet.sheet)) }
  } catch (error) {
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse Excel file: ${error.message}`, 'XLSX_PARSE')
  }
}

// Reads one sheet (name or 1-based index; default first sheet). The returned
// `rows` array keeps the column header as its first row followed by the data
// rows of the requested page, so a caller can split headers = rows[0],
// data = rows.slice(1). Pagination slices the data rows only.
export async function readXlsxSheet(filePath, { sheet, page = 1, pageSize = 100, maxBytes = MAX_FORMAT_FILE_BYTES } = {}) {
  try {
    await assertParseFileSizeWithin(filePath, clampFormatMaxBytes(maxBytes))
    const { readSheet } = await import('read-excel-file/node')
    const sheetRef = sheet === undefined || sheet === null ? 1 : sheet
    const rows = await readSheet(filePath, sheetRef)
    const parsedPage = Math.max(1, Math.floor(Number(page) || 1))
    const parsedPageSize = Math.max(1, Math.floor(Number(pageSize) || 100))
    if (!Array.isArray(rows) || rows.length === 0) {
      return { sheet: sheetRef, rows: [], totalPages: 0, page: parsedPage, pageSize: parsedPageSize }
    }
    const header = rows[0]
    const dataRows = rows.slice(1)
    const totalPages = Math.ceil(dataRows.length / parsedPageSize)
    const start = (parsedPage - 1) * parsedPageSize
    return {
      sheet: sheetRef,
      rows: [header, ...dataRows.slice(start, start + parsedPageSize)],
      totalPages,
      page: parsedPage,
      pageSize: parsedPageSize,
    }
  } catch (error) {
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse Excel file: ${error.message}`, 'XLSX_PARSE')
  }
}

// ── PDF ────────────────────────────────────────────────────────────────────
// unpdf requires a Uint8Array; the file is read whole (pdfjs needs the full
// document to build its xref). Rendering/text extraction runs with
// isEvalSupported:false — no JS evaluation is ever enabled (AC-6 baseline).

export async function readPdfInfo(filePath, { maxBytes = MAX_FORMAT_FILE_BYTES } = {}) {
  try {
    await assertParseFileSizeWithin(filePath, clampFormatMaxBytes(maxBytes))
    const { getDocumentProxy, getMeta } = await import('unpdf')
    const bytes = await fs.readFile(filePath)
    const proxy = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false })
    const { info } = await getMeta(proxy)
    const meta = {}
    for (const [key, value] of Object.entries(info || {})) {
      if (value === null || value === undefined) continue
      meta[key.charAt(0).toLowerCase() + key.slice(1)] = value
    }
    return { pages: proxy.numPages, meta }
  } catch (error) {
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse PDF file: ${error.message}`, 'PDF_PARSE')
  }
}

// Extracts ONLY the requested page range as concatenated text (M3). The
// document proxy stays open and pdf.getPage(n).getTextContent() is called per
// page in the range — extractText is never used, so a huge document's text is
// never materialized just to answer a one-page read.
export const PDF_PAGE_COUNT_CAP = 100
export async function readPdfPageText(filePath, { page = 1, pageCount = 1, maxBytes = MAX_FORMAT_FILE_BYTES } = {}) {
  try {
    await assertParseFileSizeWithin(filePath, clampFormatMaxBytes(maxBytes))
    const { getDocumentProxy } = await import('unpdf')
    const bytes = await fs.readFile(filePath)
    const proxy = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false })
    const start = Math.min(Math.max(1, Math.floor(Number(page) || 1)), proxy.numPages)
    // W5F-R1: the requested page range is capped — 1e9 can no longer force
    // whole-document extraction; the response echoes the clamped count.
    const count = Math.min(Math.max(1, Math.floor(Number(pageCount) || 1)), PDF_PAGE_COUNT_CAP)
    const end = Math.min(proxy.numPages, start + count - 1)
    const parts = []
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const pageProxy = await proxy.getPage(pageNumber)
      const content = await pageProxy.getTextContent()
      parts.push(content.items.map((item) => (item && typeof item.str === 'string' ? item.str : '')).join(' '))
    }
    return {
      page: start,
      pageCount: count,
      text: parts.join('\n'),
      isEvalSupported: false,
    }
  } catch (error) {
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse PDF file: ${error.message}`, 'PDF_PARSE')
  }
}

// ── ZIP ────────────────────────────────────────────────────────────────────
// yauzl lazyEntries + decodeStrings:false: the central directory is walked
// entry by entry — no whole-archive read. Entry names are decoded UTF-8 when
// the general-purpose bit 11 (fileNameIsUTF8) is set, otherwise GBK
// (iconv-lite) so legacy Chinese-named archives are readable.

async function openZip(filePath, options) {
  const { default: yauzl } = await import('yauzl')
  return new Promise((resolve, reject) => {
    // validateEntrySizes defaults to FALSE here: yauzl 2.10.0's
    // AssertByteCountStream swallows the over-limit callback error on Node 24
    // and hangs forever on forged uncompressedSize entries. Size enforcement
    // is instead owned by our own declared-value pre-checks + stream byte
    // counters (stronger, and they reject instead of hanging).
    yauzl.open(filePath, { lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: false, ...options }, (err, zipfile) => {
      if (err) reject(err)
      else resolve(zipfile)
    })
  })
}

function isUtf8Name(entry) {
  // yauzl does not expose a fileNameIsUTF8 property; the UTF-8 flag is
  // general-purpose bit 11 of the entry's central-directory bit flag.
  return (entry.generalPurposeBitFlag & 0x800) !== 0
}

function decodeEntryName(entry, iconv) {
  const nameBuffer = Buffer.isBuffer(entry.fileName)
    ? entry.fileName
    : Buffer.from(String(entry.fileName || ''), 'utf8')
  if (isUtf8Name(entry)) return nameBuffer.toString('utf8')
  return iconv.decode(nameBuffer, 'gbk')
}

function closeZip(zipfile) {
  try {
    zipfile.close()
  } catch {
    // Already closed or failed to open; nothing else to clean up.
  }
}

// Scan (lazily) for the entry whose decoded name equals targetName.
function findZipEntry(zipfile, targetName, iconv) {
  return new Promise((resolve, reject) => {
    zipfile.on('entry', (entry) => {
      const name = decodeEntryName(entry, iconv)
      if (name === targetName) return resolve(entry)
      zipfile.readEntry()
    })
    zipfile.on('end', () => reject(
      new ComponentNodeError(`ZIP entry not found: ${targetName}`, {
        statusCode: 404,
        code: 'ZIP_ENTRY_NOT_FOUND',
      }),
    ))
    zipfile.on('error', reject)
    zipfile.readEntry()
  })
}

export async function readZipEntries(filePath, { maxEntries = MAX_ZIP_ENTRIES } = {}) {
  // M2: the scan budget is caller-injectable for tests but can never be raised
  // above MAX_ZIP_ENTRIES — a huge archive stops being scanned once the cap is
  // hit and the result reports truncated:true instead of a full listing.
  const limit = Math.min(Math.max(1, Math.floor(Number(maxEntries) || MAX_ZIP_ENTRIES)), MAX_ZIP_ENTRIES)
  let zipfile = null
  try {
    const { default: iconv } = await import('iconv-lite')
    zipfile = await openZip(filePath)
    const { entries, truncated } = await new Promise((resolve, reject) => {
      const list = []
      let truncated = false
      zipfile.on('entry', (entry) => {
        if (list.length >= limit) {
          // Cap reached: stop driving the scan and report the truncated list.
          truncated = true
          return resolve({ entries: list, truncated })
        }
        const name = decodeEntryName(entry, iconv)
        list.push({
          name,
          size: entry.uncompressedSize,
          compressedSize: entry.compressedSize,
          directory: name.endsWith('/') || ((entry.externalFileAttributes >>> 16) & 0x10) !== 0,
          isUtf8: isUtf8Name(entry),
        })
        zipfile.readEntry()
      })
      zipfile.on('end', () => resolve({ entries: list, truncated }))
      zipfile.on('error', reject)
      zipfile.readEntry()
    })
    return { entries, truncated, total: truncated ? null : entries.length }
  } catch (error) {
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse ZIP archive: ${error.message}`, 'ZIP_PARSE')
  } finally {
    if (zipfile) closeZip(zipfile)
  }
}

// Stream one entry's content with a maxBytes cap; once the cap is reached the
// stream is destroyed and the remaining payload is never read.
function streamEntry(zipfile, entry, maxBytes) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err)
      const chunks = []
      let bytes = 0
      let truncated = false
      let settled = false
      const settle = (error, value) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve(value)
      }
      stream.on('data', (chunk) => {
        if (settled) return
        const remaining = maxBytes - bytes
        if (remaining <= 0) {
          truncated = true
          stream.destroy()
          settle(null, { text: Buffer.concat(chunks).toString('utf8'), truncated, bytes })
          return
        }
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
        chunks.push(slice)
        bytes += slice.length
        if (bytes >= maxBytes) {
          // yauzl's destroy() on the inflate-filter stream never emits
          // 'close', so settle right here; the settle guard absorbs any late
          // 'error'/'end' that destroy may still trigger.
          truncated = true
          stream.destroy()
          settle(null, { text: Buffer.concat(chunks).toString('utf8'), truncated, bytes })
        }
      })
      stream.on('end', () => settle(null, { text: Buffer.concat(chunks).toString('utf8'), truncated, bytes }))
      stream.on('error', settle)
    })
  })
}

export async function readZipEntryText(filePath, entryName, { maxBytes = 65536 } = {}) {
  const name = String(entryName || '')
  const extension = path.extname(name).toLowerCase()
  if (!TEXT_ENTRY_EXTENSIONS.has(extension)) {
    throw new ComponentNodeError(
      `ZIP entry is not a text file (extension ${extension || 'none'} is not supported for preview): ${name}`,
      { statusCode: 400, code: 'ZIP_ENTRY_NOT_TEXT' },
    )
  }
  // H1: the caller-visible budget is the clamped limit; the response echoes it
  // as maxBytes so callers can verify the clamp took effect (1e999 / 1e15 /
  // Infinity can never raise the effective budget above 1MB).
  const limit = clampPreviewBytes(maxBytes)
  let zipfile = null
  try {
    const { default: iconv } = await import('iconv-lite')
    zipfile = await openZip(filePath)
    const entry = await findZipEntry(zipfile, name, iconv)
    // H1: an entry whose central-directory size already exceeds the hard cap
    // can never fit the preview budget — return the truncation marker without
    // opening (or decompressing) the read stream at all. Entries up to the
    // cap are streamed and destroyed at `limit`, so memory stays bounded
    // either way.
    if (entry.uncompressedSize > MAX_ZIP_PREVIEW_BYTES) {
      return { entryName: name, text: '', truncated: true, bytes: 0, maxBytes: limit }
    }
    const result = await streamEntry(zipfile, entry, limit)
    return { entryName: name, text: result.text, truncated: result.truncated, bytes: result.bytes, maxBytes: limit }
  } catch (error) {
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse ZIP archive: ${error.message}`, 'ZIP_PARSE')
  } finally {
    if (zipfile) closeZip(zipfile)
  }
}

// Zip Slip guard: entry names with ../ segments, backslash ../ segments, or
// absolute paths must be rejected before anything is written. destDir is
// caller-validated to stay inside the workspace (file-node action resolves it
// through the workspace boundary); the target filename is basename-only so a
// nested entry lands flat inside destDir.
function assertSafeEntryName(entryName) {
  const name = String(entryName || '')
  if (!name) return name
  // M1: NTFS Alternate Data Streams are rejected wherever the ':' appears —
  // before any path.basename() on win32 (which treats ':' as a separator) can
  // hide or re-target the payload.
  if (name.includes(':')) {
    throw new ComponentNodeError(
      `Zip entry name with a colon (NTFS ADS) is not allowed: ${name}`,
      { statusCode: 400, code: 'ZIP_INVALID_NAME' },
    )
  }
  const normalized = name.replace(/\\/g, '/')
  const isAbsolute = path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || normalized.startsWith('/')
  const hasTraversal = normalized.split('/').includes('..')
  if (isAbsolute || hasTraversal) {
    throw new ComponentNodeError(
      `Zip Slip traversal rejected: entry name must stay inside the archive (${name})`,
      { statusCode: 400, code: 'ZIP_SLIP' },
    )
  }
  return name
}

export async function extractZipEntry(filePath, entryName, destDir, { maxBytes = MAX_EXTRACT_ENTRY_BYTES } = {}) {
  const name = assertSafeEntryName(entryName)
  // W5F-R2: the effective extract budget is the caller-injectable limit,
  // cap-the-capped at MAX_EXTRACT_ENTRY_BYTES — an absurd budget (1e999, NaN)
  // falls back to the 64MB hard cap and can never disable the gate.
  const limit = Math.min(
    Math.max(1, Math.floor(Number(maxBytes) || MAX_EXTRACT_ENTRY_BYTES)),
    MAX_EXTRACT_ENTRY_BYTES,
  )
  let zipfile = null
  let outPath = null
  let writeStarted = false
  let writeStream = null
  try {
    const { default: iconv } = await import('iconv-lite')
    await fs.mkdir(destDir, { recursive: true })
    // W5F-R2: yauzl's validateEntrySizes (AssertByteCountStream) swallows the
    // over-limit callback error on Node 24 and hangs forever when an entry's
    // declared uncompressed size lies below its real payload. Size enforcement
    // is fully covered by our own declared-size precheck plus the streamed
    // byte count below, so yauzl's check is redundant here — disable it.
    zipfile = await openZip(filePath, { validateEntrySizes: false })
    const entry = await findZipEntry(zipfile, name, iconv)
    outPath = path.join(destDir, path.basename(name))
    // M1: extraction never silently overwrites an existing target
    // (requireMissing semantics) — the caller must pick another destDir.
    if (existsSync(outPath)) {
      throw new ComponentNodeError(
        `Extract target already exists, refusing overwrite: ${path.basename(name)}`,
        { statusCode: 409, code: 'FILE_EXISTS' },
      )
    }
    // M1: an entry whose central-directory uncompressed size already exceeds
    // the effective cap is rejected BEFORE any byte is written — a lying size
    // field cannot force an oversized disk write (quick-fail precheck; the
    // streamed byte count below is the authoritative enforcement).
    if (entry.uncompressedSize > limit) {
      throw new ComponentNodeError(
        `ZIP entry exceeds the extract size limit: ${name}`,
        { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' },
      )
    }
    const bytes = await new Promise((resolve, reject) => {
      zipfile.openReadStream(entry, (err, stream) => {
        if (err) return reject(err)
        writeStarted = true
        const out = createWriteStream(outPath)
        writeStream = out
        let written = 0
        let failed = false
        const fail = (error) => {
          if (failed) return
          failed = true
          stream.destroy()
          out.destroy()
          reject(error)
        }
        // W5F-R2: the declared central-directory size can lie, so the written
        // bytes are counted as they land; the write is destroyed and refused
        // with 413 as soon as the effective cap is crossed.
        stream.on('data', (chunk) => {
          if (failed) return
          written += chunk.length
          if (written > limit) {
            fail(new ComponentNodeError(
              `ZIP entry exceeds the extract byte limit: ${name}`,
              { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' },
            ))
          }
        })
        stream.on('error', fail)
        out.on('error', fail)
        out.on('finish', () => resolve(written))
        stream.pipe(out)
      })
    })
    return { path: outPath, bytes }
  } catch (error) {
    // W5F-R2: a failed extraction (byte-limit reached, stream error) must not
    // leave a half-written target on disk. Only runs once the write stream
    // actually opened — the FILE_EXISTS / declared-size precheck paths are
    // untouched, so a pre-existing target is never deleted.
    if (writeStarted && outPath) {
      // W5F-R2: Windows cannot unlink a file whose handle is still open, and
      // the destroyed write stream closes its fd asynchronously — wait for the
      // stream's 'close' (bounded) before removing the half-written target so
      // cleanup is deterministic instead of racing the fd close.
      if (writeStream && !writeStream.closed) {
        await Promise.race([
          new Promise((resolve) => writeStream.once('close', resolve)),
          new Promise((resolve) => setTimeout(resolve, 500)),
        ])
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          rmSync(outPath, { force: true })
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
      }
    }
    if (error instanceof ComponentNodeError) throw error
    throw parseError(`Failed to parse ZIP archive: ${error.message}`, 'ZIP_PARSE')
  } finally {
    if (zipfile) closeZip(zipfile)
  }
}
