function findEocd(view) {
  const len = view.byteLength;
  const min = Math.max(0, len - 22 - 65535);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("Это не ZIP/EPUB");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Браузер не умеет распаковывать EPUB");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeName(bytes, utf8) {
  return new TextDecoder(utf8 ? "utf-8" : "iso-8859-1").decode(bytes);
}

export async function unzip(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const eocd = findEocd(view);
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map();

  for (let i = 0; i < entries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Повреждённый EPUB");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOff = view.getUint32(offset + 42, true);
    const nameBytes = u8.subarray(offset + 46, offset + 46 + nameLen);
    const name = decodeName(nameBytes, flags & 0x800);
    offset += 46 + nameLen + extraLen + commentLen;

    if (!name || name.endsWith("/")) continue;
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + localNameLen + localExtraLen;
    const compressed = u8.subarray(start, start + compSize);
    let data;
    if (method === 0) data = compressed.slice();
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error("Неподдерживаемое сжатие в EPUB");
    files.set(name.replace(/\\/g, "/"), data);
  }
  return files;
}
