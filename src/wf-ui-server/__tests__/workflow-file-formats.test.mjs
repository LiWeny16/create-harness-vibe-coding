import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

// ---------------------------------------------------------------------------
// task-upgrade-file-node — acceptance tests, wave W2 (implemented actions).
//
// AC mapping (task PLAN "验收标准"):
//   AC-5  Excel: file.readXlsx returns the sheet-name list;
//         file.readXlsxSheet(sheet, page, pageSize) returns headers + the
//         requested page of rows (paged, never whole-sheet parse); a corrupt
//         file produces a clear machine-readable error.
//   AC-6  PDF: file.readPdf returns total page count + metadata;
//         file.readPdfPage({page, pageCount}) returns page-range text with
//         the isEvalSupported:false security baseline; corrupt PDFs fail
//         with a clear error.
//   AC-7  ZIP: file.readZipEntries returns the entry list (name, size,
//         compressedSize, directory flag, UTF-8 flag; GBK names decoded —
//         no whole-archive read); file.readZipEntry previews a single text
//         entry (maxBytes bound); file.extractZipEntry extracts a single
//         entry to a workspace-controlled destDir and rejects Zip Slip
//         traversal entries.
//
// Fixture strategy (PLAN D4):
//   - ZIP fixtures are REAL, generated in-test by the dependency-free builder
//     below (zlib.deflateRawSync + table CRC32). They exercise entry sizes,
//     compression, directory flags, UTF-8 names and a GBK-named entry (GBK
//     bytes for 中文名.txt = d6d0 cec4 c3fb 2e 747874).
//   - XLSX fixture is REAL: an .xlsx is a zip archive, so the same builder
//     emits the 5 required parts (Content_Types, package rels, workbook,
//     workbook rels, one worksheet with inline strings). read-excel-file
//     parses it (verified during authoring: sheets ['Data'], header
//     ['Name','Score'], 4 data rows).
//   - PDF fixture is REAL: a minimal 2-page PDF built by hand with exact xref
//     offsets (objects are assembled first, offsets computed from the byte
//     lengths, trailer startxref points at the computed xref position) plus
//     an /Info dict carrying Title/Author/Subject/Producer. unpdf
//     (getDocumentProxy) parses it (verified during authoring: numPages 2,
//     text ['Hello PDF', 'Second Page']).
//   - The corrupt-input tests use deliberately broken bytes that are NOT
//     valid xlsx/zip/pdf and assert the machine-readable error contract
//     (err.code + 4xx statusCode) — never the message.
//
// Error contract for corrupt inputs:
//   Corrupt/malformed files THROW (ComponentNodeError) with a
//   machine-readable err.code matching
//   /XLSX|PARSE|INVALID|CORRUPT|UNSUPPORTED/i (Excel) and
//   /PDF|PARSE|INVALID|CORRUPT|UNSUPPORTED/i (PDF), statusCode 4xx —
//   consistent with the ComponentNodeError precedent (markdown_locked, 409).
//   Tests match err.code ONLY (never the message).
//
// Async contract: the parsing libraries (read-excel-file / unpdf / yauzl)
// are all promise/callback based, so every file.* format action is async and
// the tests await them (assert.rejects for the corrupt-input cases). All
// assertions from the original RED tests are preserved; only concrete values
// were tightened to the real fixtures (sheet name, page count, header row).
// ---------------------------------------------------------------------------

// ---- Dependency-free minimal ZIP builder ---------------------------------
// Local file header + central directory + EOCD, entries deflated with
// zlib.deflateRawSync. Enough for yauzl-compatible archives.

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

// entries: [{ name, content?, nameBytes?, utf8?, directory?, usize? }]
//   name      display name (utf8-encoded unless nameBytes given)
//   nameBytes raw name bytes (for GBK names); utf8:false leaves the UTF-8
//             general-purpose flag unset
//   content   string or Buffer; absent for directory entries
//   usize     OPTIONAL uncompressed-size override written to both the local
//             header and the central directory (W4F-M1 test seam: lets a test
//             fabricate a lying central-directory size WITHOUT real payload)
function buildZip(entries) {
  const localChunks = [];
  const centralRecords = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = entry.nameBytes || Buffer.from(entry.name, 'utf8');
    const content = entry.content == null
      ? Buffer.alloc(0)
      : (Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8'));
    const usize = Number.isInteger(entry.usize) ? entry.usize : content.length;
    const flags = entry.utf8 === false ? 0 : 0x0800;
    const crc = crc32(content);
    const deflated = content.length === 0 ? Buffer.alloc(0) : zlib.deflateRawSync(content);
    const method = content.length === 0 ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);            // mod time
    local.writeUInt16LE(0x21, 12);         // mod date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);            // extra length
    localChunks.push(local, nameBytes, deflated);

    centralRecords.push({
      nameBytes,
      flags,
      method,
      crc,
      csize: deflated.length,
      usize,
      offset,
      isDir: Boolean(entry.directory),
    });
    offset += 30 + nameBytes.length + deflated.length;
  }

  const cdChunks = [];
  for (const rec of centralRecords) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);               // version made by
    cd.writeUInt16LE(20, 6);               // version needed
    cd.writeUInt16LE(rec.flags, 8);
    cd.writeUInt16LE(rec.method, 10);
    cd.writeUInt16LE(0, 12);               // mod time
    cd.writeUInt16LE(0x21, 14);            // mod date
    cd.writeUInt32LE(rec.crc, 16);
    cd.writeUInt32LE(rec.csize, 20);
    cd.writeUInt32LE(rec.usize, 24);
    cd.writeUInt16LE(rec.nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);               // extra length
    cd.writeUInt16LE(0, 32);               // comment length
    cd.writeUInt16LE(0, 34);               // disk number
    cd.writeUInt16LE(0, 36);               // internal attrs
    cd.writeUInt32LE(rec.isDir ? 0x10 : 0, 38);
    cd.writeUInt32LE(rec.offset, 42);
    cdChunks.push(cd, rec.nameBytes);
  }
  const centralBuf = Buffer.concat(cdChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

// GBK bytes for 中文名.txt (d6d0 cec4 c3fb 2e 747874). Node cannot encode
// GBK natively and tests must not depend on iconv-lite; this fixed constant
// is the GBK payload the adapter decodes (iconv-lite, PLAN D4).
const GBK_NAME_BYTES = Buffer.from('d6d0cec4c3fb2e747874', 'hex');

// ---- REAL minimal .xlsx fixture -------------------------------------------
// An .xlsx is a zip archive; the same builder emits the parts
// read-excel-file requires (PLAN D4): workbook + workbook rels + one
// worksheet with inline strings. Parsed during authoring to:
//   sheets: ['Data']
//   sheet 'Data': [['Name','Score'], ['Alice',42], ['Bob',17], ['Carol',88], ['Dave',5]]
function buildMinimalXlsx() {
  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1"'
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
    + ' Target="worksheets/sheet1.xml"/>'
    + '</Relationships>';
  const cell = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const num = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + `<row r="1">${cell('A1', 'Name')}${cell('B1', 'Score')}</row>`
    + `<row r="2">${cell('A2', 'Alice')}${num('B2', 42)}</row>`
    + `<row r="3">${cell('A3', 'Bob')}${num('B3', 17)}</row>`
    + `<row r="4">${cell('A4', 'Carol')}${num('B4', 88)}</row>`
    + `<row r="5">${cell('A5', 'Dave')}${num('B5', 5)}</row>`
    + '</sheetData></worksheet>';
  return buildZip([
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: relsXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]);
}

// ---- REAL minimal 2-page PDF fixture --------------------------------------
// Hand-built PDF with exact xref offsets: objects are assembled first, byte
// offsets are computed from the emitted text, the xref table and trailer
// startxref point at those offsets. Page 1 "Hello PDF", page 2 "Second
// Page"; an /Info dict carries Title/Author/Subject/Producer. Verified during
// authoring with unpdf: numPages 2, text ['Hello PDF', 'Second Page'],
// meta.info.Title === 'Fixture Report'.
function buildMinimalPdf() {
  const pages = ['Hello PDF', 'Second Page'];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const kids = pages.map((unused, i) => `${3 + i * 3} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (let i = 0; i < pages.length; i += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 3} 0 R`
      + ` /Resources << /Font << /F1 ${5 + i * 3} 0 R >> >> >>`,
    );
    const stream = `BT /F1 12 Tf 72 720 Td (${pages[i]}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  }
  const info = '/Title (Fixture Report) /Author (Test Suite) /Subject (Minimal PDF) /Producer (node test builder)';
  objects.push(`<< ${info} >>`);

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'utf8'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out, 'utf8');
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n`
    + `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'utf8');
}

// Deliberately broken bytes for the corrupt-input contract tests (not a real
// xlsx / pdf).
const CORRUPT_XLSX_BYTES = Buffer.from('not-a-real-xlsx');
const CORRUPT_PDF_BYTES = Buffer.from('%PDF-1.4 placeholder\n');

const XLSX_FIXTURE = buildMinimalXlsx();
const PDF_FIXTURE = buildMinimalPdf();

async function loadFileNode() {
  return import('../workflow-node-types/file-node.mjs');
}

async function loadComponentStore() {
  return import('../component-node-store.mjs');
}

function makeProject(prefix = 'wf-file-formats-') {
  const projectRoot = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  return projectRoot;
}

function createFileNode(projectRoot, store, filePayload) {
  return store.createComponentNode(projectRoot, {
    type: 'file',
    title: filePayload.title || 'File Node',
    file: filePayload.file,
  });
}

function bindNode(projectRoot, store, relPath, mime) {
  return createFileNode(projectRoot, store, {
    file: { path: relPath, mime, name: path.basename(relPath) },
  }).node.nodeId;
}

function is4xxError(err) {
  return Boolean(err) && typeof err.statusCode === 'number'
    && err.statusCode >= 400 && err.statusCode < 500;
}

// ---- AC-5 Excel -----------------------------------------------------------

test('AC-5 readXlsx: a corrupt xlsx file throws a clear machine-readable error', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'data.xlsx'), CORRUPT_XLSX_BYTES);
    const nodeId = bindNode(projectRoot, store, 'src/data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    await assert.rejects(
      fileNode.readXlsx(nodeId, projectRoot),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.ok(is4xxError(err), 'corrupt xlsx must surface a 4xx status');
        assert.match(err.code, /XLSX|PARSE|INVALID|CORRUPT|UNSUPPORTED/i,
          'corrupt xlsx must carry a clear machine-readable code');
        return true;
      },
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-5 readXlsx/readXlsxSheet: sheet-name list + headers + paged rows (real minimal xlsx fixture)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'data.xlsx'), XLSX_FIXTURE);
    const nodeId = bindNode(projectRoot, store, 'src/data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const info = await fileNode.readXlsx(nodeId, projectRoot);
    assert.ok(Array.isArray(info.sheets), 'readXlsx returns the sheet-name list');
    assert.ok(info.sheets.length >= 1, 'at least one sheet');
    assert.ok(info.sheets.every((name) => typeof name === 'string'), 'sheet names are strings');
    assert.deepEqual(info.sheets, ['Data'], 'fixture sheet is parsed with its real name');

    const page1 = await fileNode.readXlsxSheet(nodeId, projectRoot, { sheet: info.sheets[0], page: 1, pageSize: 2 });
    assert.ok(Array.isArray(page1.headers) && page1.headers.length >= 1,
      'readXlsxSheet returns the column headers');
    assert.deepEqual(page1.headers, ['Name', 'Score'], 'header row matches the fixture');
    assert.ok(Array.isArray(page1.rows), 'readXlsxSheet returns the page rows');
    assert.ok(page1.rows.length <= 2, 'rows are bounded by pageSize (paged, not whole-sheet)');
    assert.deepEqual(page1.rows, [['Alice', 42], ['Bob', 17]], 'page 1 carries the first data rows');

    const page2 = await fileNode.readXlsxSheet(nodeId, projectRoot, { sheet: info.sheets[0], page: 2, pageSize: 2 });
    assert.notDeepEqual(page2.rows, page1.rows, 'page 2 yields different rows than page 1');
    assert.deepEqual(page2.rows, [['Carol', 88], ['Dave', 5]], 'page 2 carries the remaining rows');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---- AC-6 PDF -------------------------------------------------------------

test('AC-6 readPdf: a corrupt pdf throws a clear machine-readable error', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'report.pdf'), CORRUPT_PDF_BYTES);
    const nodeId = bindNode(projectRoot, store, 'src/report.pdf', 'application/pdf');

    await assert.rejects(
      fileNode.readPdf(nodeId, projectRoot),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.ok(is4xxError(err), 'corrupt pdf must surface a 4xx status');
        assert.match(err.code, /PDF|PARSE|INVALID|CORRUPT|UNSUPPORTED/i,
          'corrupt pdf must carry a clear machine-readable code');
        return true;
      },
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-6 readPdf/readPdfPage: total pages + metadata + page-range text with isEvalSupported:false baseline (real minimal pdf)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'report.pdf'), PDF_FIXTURE);
    const nodeId = bindNode(projectRoot, store, 'src/report.pdf', 'application/pdf');

    const info = await fileNode.readPdf(nodeId, projectRoot);
    assert.ok(Number.isInteger(info.totalPages) && info.totalPages >= 1,
      'readPdf returns the total page count');
    assert.equal(info.totalPages, 2, 'fixture pdf has its real page count');
    assert.ok(info.metadata && typeof info.metadata === 'object', 'readPdf returns metadata');
    assert.equal(info.metadata.title, 'Fixture Report', 'metadata carries the real title');

    const page = await fileNode.readPdfPage(nodeId, projectRoot, { page: 1, pageCount: 2 });
    assert.equal(typeof page.text, 'string', 'readPdfPage returns page-range text');
    assert.ok(page.text.includes('Hello PDF'), 'page-range text contains the first page text');
    assert.ok(page.text.includes('Second Page'), 'page-range text contains the second page text');
    assert.equal(page.isEvalSupported, false,
      'AC-6 security baseline: PDF rendering must run with isEvalSupported:false');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---- AC-7 ZIP -------------------------------------------------------------

function writeZipFixture(projectRoot, relPath, entries) {
  fs.writeFileSync(path.join(projectRoot, relPath), buildZip(entries));
}

test('AC-7 readZipEntries: entry list with size/compressedSize/directory flags; GBK names decoded; UTF-8 flag honored', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [
      { name: 'readme.txt', content: 'hello zip\n' },
      { name: 'docs/', directory: true },
      { name: 'big.txt', content: 'Z'.repeat(20000) },
      { nameBytes: GBK_NAME_BYTES, content: 'gbk content', utf8: false },
      { name: '中文utf8.txt', content: 'utf8 name', utf8: true },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');

    const entries = await fileNode.readZipEntries(nodeId, projectRoot);
    assert.ok(Array.isArray(entries), 'readZipEntries returns the entry list');
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    const readme = byName.get('readme.txt');
    assert.ok(readme, 'plain text entry is listed');
    assert.equal(readme.size, Buffer.byteLength('hello zip\n'));
    assert.equal(readme.directory, false);

    const docs = entries.find((entry) => entry.directory === true);
    assert.ok(docs, 'directory entry carries the directory flag');
    assert.equal(docs.size, 0);

    const big = byName.get('big.txt');
    assert.equal(big.size, 20000);
    assert.ok(big.compressedSize > 0 && big.compressedSize < 20000,
      'compressedSize reflects deflation');

    const gbk = byName.get('中文名.txt');
    assert.ok(gbk, 'GBK-named entry must be decoded to 中文名.txt (iconv-lite)');
    assert.equal(gbk.isUtf8, false, 'GBK entry must carry isUtf8:false');

    const utf8 = byName.get('中文utf8.txt');
    assert.ok(utf8, 'UTF-8-named entry is listed under its decoded name');
    assert.equal(utf8.isUtf8, true, 'UTF-8 entry must carry isUtf8:true');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-7 readZipEntry: single text entry preview with maxBytes truncation', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [
      { name: 'readme.txt', content: 'hello zip\n' },
      { name: 'big.txt', content: 'Z'.repeat(20000) },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');

    const small = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'readme.txt' });
    assert.equal(small.text, 'hello zip\n', 'single text entry is previewed');
    assert.equal(small.truncated, false, 'small entry is not truncated');

    const capped = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'big.txt', maxBytes: 1024 });
    assert.equal(capped.truncated, true, 'entry larger than maxBytes is flagged truncated');
    assert.ok(capped.text.length <= 1024, 'preview text respects the maxBytes bound');
    assert.ok(capped.text.startsWith('Z'), 'preview starts at the entry beginning');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-7 extractZipEntry: single entry extracts into a workspace-controlled destDir', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [
      { name: 'readme.txt', content: 'hello zip\n' },
      { name: 'skip.txt', content: 'not extracted\n' },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');

    const destDir = 'Harness/.extracted/zip-test';
    const result = await fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', destDir });
    assert.equal(result.ok, true, 'extraction reports success');

    const outPath = path.join(projectRoot, destDir, 'readme.txt');
    assert.equal(fs.readFileSync(outPath, 'utf8'), 'hello zip\n', 'entry content lands in destDir');
    assert.equal(fs.existsSync(path.join(projectRoot, destDir, 'skip.txt')), false,
      'only the requested entry is extracted');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-7 extractZipEntry: rejects Zip Slip entries (../ and ..\\) — nothing escapes the workspace', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/evil.zip', [
      { name: '../evil.txt', content: 'escape me' },
      { name: '..\\evil2.txt', content: 'escape me too' },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/evil.zip', 'application/zip');

    const destDir = 'Harness/.extracted/zip-test';
    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: '../evil.txt', destDir }),
      /traversal|escape|invalid|path/i,
      'forward-slash traversal entry must be rejected',
    );
    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: '..\\evil2.txt', destDir }),
      /traversal|escape|invalid|path/i,
      'backslash traversal entry must be rejected on Windows too',
    );

    assert.equal(fs.existsSync(path.join(projectRoot, destDir, 'evil.txt')), false,
      'no traversal entry may land in destDir');
    assert.equal(fs.existsSync(path.join(projectRoot, '..', 'evil.txt')), false,
      'no traversal entry may land outside the workspace');
    assert.equal(fs.existsSync(path.join(projectRoot, '..', 'evil2.txt')), false,
      'no backslash traversal entry may land outside the workspace');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-7 extractZipEntry: destDir escaping the workspace is rejected', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [{ name: 'readme.txt', content: 'hello zip\n' }]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', destDir: '../escape' }),
      /workspace|traversal|escape/i,
      'destDir outside the workspace must be rejected',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, '..', 'escape')), false,
      'nothing may be written outside the workspace');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W4F security-review regression tests (task-upgrade-file-node W4F wave):
//   H1  maxBytes hard clamp (Infinity/1e999/1e15 can never raise the preview
//       budget above 1MB; entries over the hard cap are never streamed).
//   M1  extractZipEntry hardening: lock gate, no-overwrite, 64MB entry cap,
//       NTFS ADS ':' rejection, Windows segment validation reuse.
//   M2  readZipEntries entry-count cap with truncated:true.
//   M3  xlsx/pdf FILE_TOO_LARGE gate + per-page PDF text extraction.
// ---------------------------------------------------------------------------

test('W4F-H1 maxBytes clamp: 1e999/Infinity fall back to 64KB, 1e15 caps at 1MB, >1MB entries never stream', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [
      { name: 'readme.txt', content: 'hello zip\n' },
      { name: 'mid.txt', content: 'M'.repeat(100 * 1024) },       // 100KB, under the 1MB cap
      { name: 'huge.txt', content: 'H'.repeat(2 * 1024 * 1024) }, // 2MB, over the 1MB cap
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');

    // Non-finite budget (1e999): clamp to the 64KB default; a small file
    // still reads in full and the echoed maxBytes field proves the clamp.
    const smallInfinity = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', maxBytes: 1e999 });
    assert.equal(smallInfinity.text, 'hello zip\n', '1e999 still returns the full small file');
    assert.equal(smallInfinity.truncated, false, '1e999 does not truncate a small file');
    assert.equal(smallInfinity.maxBytes, 65536, '1e999 clamps to the 64KB default');

    const smallInfinityLiteral = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', maxBytes: Infinity });
    assert.equal(smallInfinityLiteral.maxBytes, 65536, 'literal Infinity clamps to the 64KB default');

    // Finite-but-huge budget (1e15): clamp to 1MB; a sub-1MB file reads fully.
    const mid = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'mid.txt', maxBytes: 1e15 });
    assert.equal(mid.maxBytes, 1048576, '1e15 clamps to the 1MB hard cap');
    assert.equal(mid.truncated, false, 'a 100KB file is fully read under the 1MB clamp');
    assert.equal(mid.text.length, 100 * 1024, 'the full 100KB is returned');

    // A >1MB entry with an absurd budget proves the effective cap is <=1MB
    // (an unclamped budget would have read all 2MB with truncated:false).
    const hugeFinite = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'huge.txt', maxBytes: 1e15 });
    assert.equal(hugeFinite.truncated, true, 'a 2MB entry cannot fit the 1MB clamp');
    assert.ok(hugeFinite.text.length <= 1048576, 'preview text respects the 1MB clamp');
    assert.equal(hugeFinite.maxBytes, 1048576);

    // Over-cap entries are refused WITHOUT opening a read stream: the
    // truncation marker carries no decompressed bytes at all.
    const hugeInfinity = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'huge.txt', maxBytes: 1e999 });
    assert.equal(hugeInfinity.text, '', 'a >1MB entry returns the empty truncation marker (no stream)');
    assert.equal(hugeInfinity.truncated, true);
    assert.equal(hugeInfinity.maxBytes, 65536);

    // Entries UP TO the hard cap keep the streamed-prefix behavior (existing
    // AC-7 contract: preview starts at the entry beginning).
    const midSmallBudget = await fileNode.readZipEntry(nodeId, projectRoot, { entryName: 'mid.txt', maxBytes: 1024 });
    assert.equal(midSmallBudget.truncated, true, 'mid-size entry at a small budget is flagged truncated');
    assert.equal(midSmallBudget.text.length, 1024, 'mid-size entry streams exactly the budgeted prefix');
    assert.ok(midSmallBudget.text.startsWith('M'), 'mid-size entry preview starts at the entry beginning');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M1 extractZipEntry: refuses overwrite of an existing target with 409 FILE_EXISTS', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [
      { name: 'readme.txt', content: 'hello zip\n' },
      { name: 'skip.txt', content: 'not extracted\n' },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');
    const destDir = 'Harness/.extracted/zip-test';

    const first = await fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', destDir });
    assert.equal(first.ok, true, 'first extraction succeeds');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', destDir }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'FILE_EXISTS', 'overwrite attempt must carry code FILE_EXISTS');
        assert.equal(err.statusCode, 409, 'overwrite attempt must be HTTP 409');
        return true;
      },
      'extracting onto an existing file must be refused (requireMissing semantics)',
    );
    assert.equal(fs.readFileSync(path.join(projectRoot, destDir, 'readme.txt'), 'utf8'), 'hello zip\n',
      'the rejected overwrite must leave the existing file untouched');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M1 extractZipEntry: foreign lock refuses with 409 file_locked before any write', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/bundle.zip', [{ name: 'readme.txt', content: 'hello zip\n' }]);
    const nodeId = bindNode(projectRoot, store, 'src/bundle.zip', 'application/zip');

    const lock = store.acquireLock(nodeId, 'agent-a', 60000, { projectRoot });
    assert.ok(lock.lockId, 'lock acquired for the extract gate test');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'readme.txt', destDir: 'Harness/.extracted/locked' }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'file_locked', 'extract under a foreign lease must carry code file_locked');
        assert.equal(err.statusCode, 409, 'extract lock conflict must be HTTP 409');
        return true;
      },
      'extract must honor the same lock gate as file.writeText',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'Harness', '.extracted', 'locked', 'readme.txt')), false,
      'nothing may be written under a foreign lease');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M1 extractZipEntry: central-directory uncompressed size over 64MB is refused before writing', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    // The archive payload is tiny; the central-directory usize is the test
    // seam that simulates a lying 64MB+1 uncompressed size (64MB cap + 1).
    writeZipFixture(projectRoot, 'src/huge.zip', [
      { name: 'big.bin', content: 'tiny', usize: 64 * 1024 * 1024 + 1 },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/huge.zip', 'application/zip');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'big.bin', destDir: 'Harness/.extracted/big' }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'PAYLOAD_TOO_LARGE', 'oversized entry must carry code PAYLOAD_TOO_LARGE');
        assert.equal(err.statusCode, 413, 'oversized entry must be HTTP 413');
        return true;
      },
      'an entry over the 64MB extract cap must be refused before any byte is written',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'Harness', '.extracted', 'big', 'big.bin')), false,
      'nothing may be written for an over-cap entry');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M1 extractZipEntry: NTFS ADS (colon) and Windows-reserved entry names are rejected', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    writeZipFixture(projectRoot, 'src/evil.zip', [
      { name: 'notes.txt:evil', content: 'ads payload' },
      { name: 'CON.txt', content: 'reserved name' },
      { name: 'trail.txt.', content: 'trailing dot' },
    ]);
    const nodeId = bindNode(projectRoot, store, 'src/evil.zip', 'application/zip');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'notes.txt:evil', destDir: 'Harness/.extracted/ads' }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'ZIP_INVALID_NAME', 'colon entry must carry code ZIP_INVALID_NAME');
        assert.equal(err.statusCode, 400, 'colon entry must be HTTP 400');
        return true;
      },
      'NTFS ADS colon entry names must be rejected regardless of position',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'Harness', '.extracted', 'ads', 'evil')), false,
      'no ADS payload may land in destDir');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'CON.txt', destDir: 'Harness/.extracted/reserved' }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.ok(is4xxError(err), 'reserved-name entry must surface a 4xx status');
        return true;
      },
      'Windows reserved names must be rejected via the workspace segment validation',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'Harness', '.extracted', 'reserved', 'CON.txt')), false,
      'no reserved-name payload may land in destDir');

    await assert.rejects(
      fileNode.extractZipEntry(nodeId, projectRoot, { entryName: 'trail.txt.', destDir: 'Harness/.extracted/trail' }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.ok(is4xxError(err), 'trailing-dot entry must surface a 4xx status');
        return true;
      },
      'trailing-dot entry names must be rejected via the workspace segment validation',
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M2 readZipEntries: entry scan is capped with truncated:true (injectable limit)', async () => {
  const projectRoot = makeProject();
  try {
    const adapters = await import('../file-format-adapters.mjs');
    const zipAbs = path.join(projectRoot, 'src', 'many.zip');
    writeZipFixture(projectRoot, 'src/many.zip',
      Array.from({ length: 8 }, (unused, i) => ({ name: `f${i}.txt`, content: `c${i}` })));

    const capped = await adapters.readZipEntries(zipAbs, { maxEntries: 5 });
    assert.equal(capped.truncated, true, 'over-cap scan must report truncated:true');
    assert.ok(Array.isArray(capped.entries) && capped.entries.length <= 5,
      'truncated scan returns at most maxEntries entries');
    assert.equal(capped.total, null, 'truncated scan reports an unknown total');

    const full = await adapters.readZipEntries(zipAbs);
    assert.equal(full.truncated, false, 'an under-cap scan is not truncated');
    assert.equal(full.entries.length, 8, 'the default scan returns every entry');
    assert.equal(full.total, 8, 'a full scan reports the actual entry count');

    // The injectable limit can never RAISE the scan budget above the
    // MAX_ZIP_ENTRIES constant (cap-the-cap).
    const overRidden = await adapters.readZipEntries(zipAbs, { maxEntries: 1e12 });
    assert.equal(overRidden.truncated, false, 'an absurd maxEntries is clamped to the hard cap');
    assert.equal(overRidden.entries.length, 8);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M3 xlsx/pdf size gate: oversized files are refused with 400 FILE_TOO_LARGE before parsing', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'data.xlsx'), XLSX_FIXTURE);
    fs.writeFileSync(path.join(projectRoot, 'src', 'report.pdf'), PDF_FIXTURE);
    const xlsxNodeId = bindNode(projectRoot, store, 'src/data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const pdfNodeId = bindNode(projectRoot, store, 'src/report.pdf', 'application/pdf');

    const assertFileTooLarge = (err) => {
      if (!err || typeof err.code !== 'string') return false;
      assert.equal(err.code, 'FILE_TOO_LARGE', 'oversized format file must carry code FILE_TOO_LARGE');
      assert.equal(err.statusCode, 400, 'oversized format file must be HTTP 400');
      return true;
    };

    await assert.rejects(fileNode.readXlsxSheet(xlsxNodeId, projectRoot, { maxBytes: 10 }), assertFileTooLarge,
      'xlsx sheet read must be gated by the injectable size limit');
    await assert.rejects(fileNode.readXlsx(xlsxNodeId, projectRoot, { maxBytes: 10 }), assertFileTooLarge,
      'xlsx sheet-list read must be gated by the injectable size limit');
    await assert.rejects(fileNode.readPdfPage(pdfNodeId, projectRoot, { maxBytes: 10 }), assertFileTooLarge,
      'pdf page read must be gated by the injectable size limit');
    await assert.rejects(fileNode.readPdf(pdfNodeId, projectRoot, { maxBytes: 10 }), assertFileTooLarge,
      'pdf info read must be gated by the injectable size limit');

    // The production default (100MB) still parses the fixtures.
    const page = await fileNode.readPdfPage(pdfNodeId, projectRoot, { page: 1, pageCount: 1 });
    assert.ok(page.text.includes('Hello PDF'), 'default limit still parses the fixture');
    const sheets = await fileNode.readXlsx(xlsxNodeId, projectRoot);
    assert.deepEqual(sheets.sheets, ['Data'], 'default limit still parses the xlsx fixture');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-M3 readPdfPage: per-page extraction returns only the requested page range', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'report.pdf'), PDF_FIXTURE);
    const pdfNodeId = bindNode(projectRoot, store, 'src/report.pdf', 'application/pdf');

    const page2 = await fileNode.readPdfPage(pdfNodeId, projectRoot, { page: 2, pageCount: 1 });
    assert.equal(page2.page, 2, 'the requested page is reported');
    assert.equal(page2.pageCount, 1, 'only the requested single page is returned');
    assert.ok(page2.text.includes('Second Page'), 'page 2 text is present');
    assert.ok(!page2.text.includes('Hello PDF'), 'page 1 text is NOT extracted for a page-2-only read');
    assert.equal(page2.isEvalSupported, false, 'AC-6 security baseline is preserved per page');

    const over = await fileNode.readPdfPage(pdfNodeId, projectRoot, { page: 99, pageCount: 5 });
    assert.equal(over.page, 2, 'an out-of-range start page clamps to the last page');
    assert.ok(over.text.includes('Second Page'), 'clamped read still returns the last page text');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W5F final-wave regression tests (task-upgrade-file-node W5F wave):
//   R1  format-gate maxBytes fail-open fix: clampFormatMaxBytes hard-clamps
//       absurd budgets (1e999 / 'abc') to MAX_FORMAT_FILE_BYTES so the xlsx /
//       pdf size gate can never be disabled; readPdfPage pageCount is capped
//       at PDF_PAGE_COUNT_CAP so 1e9 cannot force whole-document extraction.
//   R2  extractZipEntry byte counting: the write stream counts bytes as they
//       land (the central-directory declared size can lie), destroys the
//       write over the effective cap with 413 PAYLOAD_TOO_LARGE, and cleans
//       up the half-written target on any write-path failure.
// ---------------------------------------------------------------------------

test('W5F-R1 clampFormatMaxBytes: absurd/NaN budgets fall back to the 100MB cap; finite budgets clamp but pass through', async () => {
  const adapters = await import('../file-format-adapters.mjs');
  assert.equal(adapters.clampFormatMaxBytes(1e999), adapters.MAX_FORMAT_FILE_BYTES,
    '1e999 (Infinity) must fall back to the 100MB format cap');
  assert.equal(adapters.clampFormatMaxBytes(Infinity), adapters.MAX_FORMAT_FILE_BYTES,
    'literal Infinity must fall back to the 100MB format cap');
  assert.equal(adapters.clampFormatMaxBytes('abc'), adapters.MAX_FORMAT_FILE_BYTES,
    'NaN budget must fall back to the 100MB format cap');
  assert.equal(adapters.clampFormatMaxBytes(1e15), adapters.MAX_FORMAT_FILE_BYTES,
    'a finite budget above the cap is capped at 100MB');
  assert.equal(adapters.clampFormatMaxBytes(adapters.MAX_FORMAT_FILE_BYTES), adapters.MAX_FORMAT_FILE_BYTES,
    'the cap itself passes through');
  assert.equal(adapters.clampFormatMaxBytes(50), 50,
    'a small finite budget passes through unchanged');
  assert.equal(adapters.clampFormatMaxBytes(0), 1, 'a zero budget is floored at 1');
  assert.equal(adapters.clampFormatMaxBytes(-5), 1, 'a negative budget is floored at 1');
});

test('W5F-R1 readPdfPage: pageCount is capped at 100 — an absurd pageCount cannot force whole-document extraction', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const adapters = await import('../file-format-adapters.mjs');
    fs.writeFileSync(path.join(projectRoot, 'src', 'report.pdf'), PDF_FIXTURE);
    const pdfNodeId = bindNode(projectRoot, store, 'src/report.pdf', 'application/pdf');

    const capped = await fileNode.readPdfPage(pdfNodeId, projectRoot, { page: 1, pageCount: 1e9 });
    assert.equal(capped.pageCount, adapters.PDF_PAGE_COUNT_CAP,
      'pageCount must be clamped to the 100-page cap');
    assert.equal(capped.pageCount, 100, 'the clamped cap value is 100');
    assert.equal(capped.page, 1, 'the start page is preserved');
    assert.ok(capped.text.includes('Hello PDF'), 'page 1 text is present');
    assert.ok(capped.text.includes('Second Page'), 'page 2 text is present');
    assert.equal((capped.text.match(/Hello PDF/g) || []).length, 1,
      'a 2-page fixture yields exactly one page-1 text fragment (no repeated extraction)');
    assert.equal((capped.text.match(/Second Page/g) || []).length, 1,
      'a 2-page fixture yields exactly one page-2 text fragment');
    assert.equal(capped.isEvalSupported, false, 'AC-6 security baseline is preserved');

    const nan = await fileNode.readPdfPage(pdfNodeId, projectRoot, { page: 2, pageCount: 'abc' });
    assert.equal(nan.pageCount, 1, 'NaN pageCount falls back to a single page');
    assert.ok(nan.text.includes('Second Page'), 'the single requested page is still returned');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W5F-R2 extractZipEntry: streamed byte counting caps the write even when the declared size lies', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const adapters = await import('../file-format-adapters.mjs');
    // The central-directory usize lies (declared 4, inside the injected cap);
    // the real payload is 20 bytes — only streamed byte counting can stop it.
    writeZipFixture(projectRoot, 'src/liar.zip', [
      { name: 'big.bin', content: 'Y'.repeat(20), usize: 4 },
    ]);
    const zipAbs = path.join(projectRoot, 'src', 'liar.zip');
    const destDirAbs = path.join(projectRoot, 'Harness', '.extracted', 'bytecap');

    await assert.rejects(
      adapters.extractZipEntry(zipAbs, 'big.bin', destDirAbs, { maxBytes: 4 }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'PAYLOAD_TOO_LARGE',
          'an over-limit streamed entry must carry code PAYLOAD_TOO_LARGE');
        assert.equal(err.statusCode, 413, 'an over-limit streamed entry must be HTTP 413');
        return true;
      },
      'a 20-byte payload must be refused at the injected 4-byte stream cap',
    );
    assert.equal(fs.existsSync(path.join(destDirAbs, 'big.bin')), false,
      'the half-written target must be cleaned up on failure');

    // The node action forwards payload.maxBytes to the adapter cap.
    writeZipFixture(projectRoot, 'src/liar2.zip', [
      { name: 'big2.bin', content: 'Z'.repeat(20), usize: 4 },
    ]);
    const actionNodeId = bindNode(projectRoot, store, 'src/liar2.zip', 'application/zip');
    await assert.rejects(
      fileNode.extractZipEntry(actionNodeId, projectRoot, {
        entryName: 'big2.bin', destDir: 'Harness/.extracted/action-cap', maxBytes: 4,
      }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'PAYLOAD_TOO_LARGE', 'the node action must forward the byte cap');
        assert.equal(err.statusCode, 413, 'the node action refusal must be HTTP 413');
        return true;
      },
      'the file node action must enforce the injected stream cap too',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'Harness', '.extracted', 'action-cap', 'big2.bin')), false,
      'no half-written target may remain after the action-level refusal');

    // Cap-the-cap: an absurd budget cannot raise the effective extract limit —
    // the declared-size precheck still refuses a 64MB+1 entry.
    writeZipFixture(projectRoot, 'src/huge2.zip', [
      { name: 'huge.bin', content: 'x', usize: adapters.MAX_EXTRACT_ENTRY_BYTES + 1 },
    ]);
    const hugeAbs = path.join(projectRoot, 'src', 'huge2.zip');
    const hugeDest = path.join(projectRoot, 'Harness', '.extracted', 'huge-cap');
    const assert413 = (err) => {
      if (!err || typeof err.code !== 'string') return false;
      assert.equal(err.code, 'PAYLOAD_TOO_LARGE', 'over-cap entry must carry code PAYLOAD_TOO_LARGE');
      assert.equal(err.statusCode, 413, 'over-cap entry must be HTTP 413');
      return true;
    };
    await assert.rejects(adapters.extractZipEntry(hugeAbs, 'huge.bin', hugeDest, { maxBytes: 1e999 }), assert413,
      '1e999 cannot disable the extract size gate');
    await assert.rejects(adapters.extractZipEntry(hugeAbs, 'huge.bin', hugeDest, { maxBytes: 'abc' }), assert413,
      'NaN cannot disable the extract size gate');
    assert.equal(fs.existsSync(path.join(hugeDest, 'huge.bin')), false,
      'nothing may be written for an over-cap entry');

    // Success path with an explicit budget: entries within the cap still
    // extract fully.
    const okDest = path.join(projectRoot, 'Harness', '.extracted', 'ok-cap');
    const ok = await adapters.extractZipEntry(zipAbs, 'big.bin', okDest, { maxBytes: 1024 });
    assert.equal(ok.bytes, 20, 'an entry within the injected budget extracts fully');
    assert.equal(fs.readFileSync(path.join(okDest, 'big.bin'), 'utf8'), 'Y'.repeat(20),
      'extracted content is complete and intact');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
