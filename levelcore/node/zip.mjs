// Zip cho nhập / xuất bộ level (trong bộ nhớ) và bản WebGL (đọc từ file, không nạp cả zip) — chép từ
// sand-jam-level-tool server/zip.mjs.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_ENTRIES = 20000;

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function createZip(entries, { level = 6 } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const names = new Set();
  for (const entry of entries) {
    const name = String(entry.name).replace(/\\/g, '/');
    if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Tên file không hợp lệ trong zip: ${name}`);
    if (names.has(name)) throw new Error(`Trùng tên file trong zip: ${name}`);
    names.add(name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const deflated = data.length > 64 ? zlib.deflateRawSync(data, { level }) : null;
    const useDeflate = !!deflated && deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = zlib.crc32(data) >>> 0;
    const nameBytes = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(entry.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(useDeflate ? 8 : 0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(names.size, 8);
  end.writeUInt16LE(names.size, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

export function readZip(buffer, { maxTotalBytes = 512 * 1024 * 1024 } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let endOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === END_SIGNATURE) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) throw new Error('File không phải zip');
  const count = buf.readUInt16LE(endOffset + 10);
  const centralOffset = buf.readUInt32LE(endOffset + 16);
  if (count > MAX_ENTRIES) throw new Error('Zip có quá nhiều file');
  const entries = [];
  let total = 0;
  let cursor = centralOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('Zip hỏng (central directory)');
    const method = buf.readUInt16LE(cursor + 10);
    const crc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (name.startsWith('/') || name.split(/[\\/]/).includes('..')) throw new Error(`Tên file không an toàn trong zip: ${name}`);
    total += size;
    if (total > maxTotalBytes) throw new Error('Zip giải nén ra quá lớn');
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`Zip hỏng (${name})`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
    else throw new Error(`Zip dùng kiểu nén không hỗ trợ (${method}) ở ${name}`);
    if (data.length !== size || (zlib.crc32(data) >>> 0) !== crc) throw new Error(`Zip hỏng: ${name} sai CRC`);
    entries.push({ name, data });
  }
  return entries;
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

// Reads the central directory of a zip on disk without loading the file, so a several-hundred-MB
// web build can be checked and unpacked with memory bounded by the stream buffers.
export async function listZipFile(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 22 + 65535);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === END_SIGNATURE) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('File không phải zip');
    const count = tail.readUInt16LE(end + 10);
    const centralSize = tail.readUInt32LE(end + 12);
    const centralOffset = tail.readUInt32LE(end + 16);
    if (count > MAX_ENTRIES) throw new Error('Zip có quá nhiều file');
    const central = await readAt(handle, centralOffset, centralSize);
    const entries = [];
    let cursor = 0;
    for (let n = 0; n < count; n++) {
      if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('Zip hỏng (central directory)');
      const nameLength = central.readUInt16LE(cursor + 28);
      const entry = {
        method: central.readUInt16LE(cursor + 10),
        crc: central.readUInt32LE(cursor + 16),
        compressedSize: central.readUInt32LE(cursor + 20),
        size: central.readUInt32LE(cursor + 24),
        localOffset: central.readUInt32LE(cursor + 42),
        name: central.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      };
      cursor += 46 + nameLength + central.readUInt16LE(cursor + 30) + central.readUInt16LE(cursor + 32);
      if (entry.name.endsWith('/')) continue;
      if (entry.name.startsWith('/') || entry.name.split(/[\\/]/).includes('..')) throw new Error(`Tên file không an toàn trong zip: ${entry.name}`);
      if (entry.method !== 0 && entry.method !== 8) throw new Error(`Zip dùng kiểu nén không hỗ trợ (${entry.method}) ở ${entry.name}`);
      entries.push(entry);
    }
    return entries;
  } finally {
    await handle.close();
  }
}

export async function extractZipEntry(file, entry, target) {
  const handle = await fsp.open(file, 'r');
  let start;
  try {
    const local = await readAt(handle, entry.localOffset, 30);
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`Zip hỏng (${entry.name})`);
    start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await handle.close();
  }
  let crc = 0;
  let size = 0;
  const check = new Transform({
    transform(chunk, _encoding, done) {
      crc = zlib.crc32(chunk, crc);
      size += chunk.length;
      done(null, chunk);
    },
  });
  const source = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  const stages = entry.compressedSize === 0 ? [] : [source];
  if (entry.method === 8 && stages.length) stages.push(zlib.createInflateRaw());
  if (stages.length) await pipeline(...stages, check, fs.createWriteStream(target));
  else fs.writeFileSync(target, Buffer.alloc(0));
  if (size !== entry.size || (crc >>> 0) !== entry.crc) throw new Error(`Zip hỏng: ${entry.name} sai CRC`);
}
