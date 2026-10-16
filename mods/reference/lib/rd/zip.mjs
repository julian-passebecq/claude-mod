// reference - a minimal ZIP writer (deflate, no dependency) for « Exporter pour audit ». Node only (node:zlib): the
// scanner uses it, the hooks module never imports it. entries: [{ name, data: Buffer|string, mtimeMs? }].
import { deflateRawSync } from 'node:zlib'

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(ms) {
  const d = new Date(ms || Date.now())
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** The bytes of a .zip holding the entries (UTF-8 names, deflated unless that makes them bigger). */
export function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(String(e.name).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8')
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ''), 'utf8')
    const packed = deflateRawSync(data)
    const deflate = packed.length < data.length
    const body = deflate ? packed : data
    const crc = crc32(data)
    const { time, date } = dosTime(e.mtimeMs)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(deflate ? 8 : 0, 8)
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28)
    locals.push(head, name, body)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(deflate ? 8 : 0, 10)
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42)
    centrals.push(cen, name)
    offset += head.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** The entry names of a .zip written by zip() (central directory), for tests and the manifest check. */
export function names(buf) {
  const out = []
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (endAt < 0) return out
  let p = buf.readUInt32LE(endAt + 16)
  const n = buf.readUInt16LE(endAt + 10)
  for (let i = 0; i < n; i++) {
    const len = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32)
    out.push(buf.slice(p + 46, p + 46 + len).toString('utf8'))
    p += 46 + len + extra + comment
  }
  return out
}
