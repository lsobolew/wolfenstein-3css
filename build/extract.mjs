#!/usr/bin/env node
// WOLFENSTEIN 3D DATA EXTRACTORS — step zero of the pure-CSS E1M1 port.
//
// Runs once and produces everything the generator needs:
//   .cache/map.json  — the two 64x64 planes of E1M1 plus the objects read
//                            out of them (player start, doors, items, enemies)
//   dist/wolf-*.png        — wall, sprite, static, HUD and screen atlases
//
// Every format below is transcribed from id Software's source, not guessed:
//   ID_CA.C:606-665   CAL_CarmackExpand
//   ID_CA.C:734-810   CA_RLEWexpand
//   ID_CA.H:11-17     maptype (38 bytes)
//   ID_PM.C:485-529   VSWAP header
//   WL_MAIN.C:706-715 tile -> texture page
//   ID_CA.C:197-199   VGAGRAPH: Huffman, dictionary in VGADICT
//
// Run:  node build/extract.mjs [data-directory]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// The game data is not in this repository and cannot be. By default we look in
// ./data; the path can be overridden by an argument or by WOLF3D_DATA.
const DATA_DIR = process.argv[2] || process.env.WOLF3D_DATA || join(ROOT, 'data');
const OUT = join(ROOT, 'dist');
// Atlases are part of the release; the map description is only ever read by the
// generator, so there is no reason to ship it — everything it says is already
// baked into the stylesheet.
const CACHE = join(ROOT, '.cache');
if (!existsSync(DATA_DIR))
  throw new Error(`no game data directory: ${DATA_DIR}\n` +
    'Copy VSWAP / GAMEMAPS / MAPHEAD / VGAGRAPH / VGAHEAD / VGADICT there from ' +
    'your own copy of Wolfenstein 3D. See docs/BUILD.md.');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });
const EXT = existsSync(join(DATA_DIR, 'MAPHEAD.WL6')) ? 'WL6' : 'WL1';
const dataFile = n => join(DATA_DIR, `${n}.${EXT}`);

// ============================================================ decompression

// Carmack: word by word, with backward pointers. NEARTAG 0xA7 is a relative
// offset in one byte, FARTAG 0xA8 an absolute index in one word. count == 0 is
// the escape for a literal whose high byte happens to equal a tag.
// The copy MUST go word by word: an offset of 1 means "repeat the previous
// word", so the ranges legitimately overlap.
function carmackExpand(src, expandedBytes) {
  const out = new Uint16Array(expandedBytes >> 1);
  let i = 0, o = 0, length = expandedBytes >> 1;
  while (length > 0) {
    const ch = src.readUInt16LE(i); i += 2;
    const chhigh = ch >> 8;
    if (chhigh === 0xa7 || chhigh === 0xa8) {
      let count = ch & 0xff;
      if (count === 0) {                       // escape: literal
        const b = src.readUInt8(i); i += 1;
        out[o++] = (chhigh << 8) | b;
        length--;
      } else if (chhigh === 0xa7) {            // near pointer
        const offset = src.readUInt8(i); i += 1;
        let from = o - offset;
        length -= count;
        while (count--) out[o++] = out[from++];
      } else {                                  // far pointer
        const offset = src.readUInt16LE(i); i += 2;
        let from = offset;
        length -= count;
        while (count--) out[o++] = out[from++];
      }
    } else {
      out[o++] = ch; length--;
    }
  }
  return out;
}

// RLEW: the loop terminates on the OUTPUT length, not the input's
// (ID_CA.C:745-765).
function rlewExpand(srcWords, expandedBytes, tag) {
  const out = new Uint16Array(expandedBytes >> 1);
  let i = 0, o = 0;
  while (o < out.length) {
    const w = srcWords[i++];
    if (w !== tag) { out[o++] = w; }
    else {
      const count = srcWords[i++], value = srcWords[i++];
      for (let k = 0; k < count && o < out.length; k++) out[o++] = value;
    }
  }
  return out;
}

// ============================================================ the map

function readMap(index) {
  const head = readFileSync(dataFile('MAPHEAD'));
  const tag = head.readUInt16LE(0);
  const offsets = [];
  for (let i = 0; i < 100; i++) offsets.push(head.readInt32LE(2 + i * 4));

  const gm = readFileSync(dataFile('GAMEMAPS'));
  const pos = offsets[index];
  if (pos <= 0) throw new Error(`map ${index} does not exist (offset ${pos})`);

  // maptype: 3x int32 planestart, 3x uint16 planelength, width, height, name[16]
  const planestart = [gm.readInt32LE(pos), gm.readInt32LE(pos + 4), gm.readInt32LE(pos + 8)];
  const planelength = [gm.readUInt16LE(pos + 12), gm.readUInt16LE(pos + 14), gm.readUInt16LE(pos + 16)];
  const width = gm.readUInt16LE(pos + 18), height = gm.readUInt16LE(pos + 20);
  const name = gm.toString('latin1', pos + 22, pos + 38).replace(/\0.*$/, '');
  if (width !== 64 || height !== 64) throw new Error(`map is not 64x64: ${width}x${height}`);

  const planes = [];
  for (let p = 0; p < 2; p++) {                 // MAPPLANES = 2, plane 2 is empty
    const src = gm.subarray(planestart[p], planestart[p] + planelength[p]);
    const expanded = src.readUInt16LE(0);       // leading length prefix
    const carm = carmackExpand(src.subarray(2), expanded);
    // Carmack's own output starts with a redundant length word (ID_CA.C:1466)
    planes.push(Array.from(rlewExpand(carm.subarray(1), 64 * 64 * 2, tag)));
  }
  return { index, name, tag, planes };
}

// ============================================================ VSWAP

function readVswap() {
  const b = readFileSync(dataFile('VSWAP'));
  const chunks = b.readUInt16LE(0);
  const spriteStart = b.readUInt16LE(2);
  const soundStart = b.readUInt16LE(4);
  const offsets = [], lengths = [];
  for (let i = 0; i < chunks; i++) offsets.push(b.readUInt32LE(6 + i * 4));
  for (let i = 0; i < chunks; i++) lengths.push(b.readUInt16LE(6 + chunks * 4 + i * 2));
  return { buf: b, chunks, spriteStart, soundStart, offsets, lengths };
}

// A wall page is 4096 bytes stored COLUMN MAJOR: texel(col,row) = page[col*64+row].
// Transposed to rows here, because PNG runs in rows.
function wallPageRGBA(vs, nr, pal) {
  const off = vs.offsets[nr];
  const px = Buffer.alloc(64 * 64 * 4);
  for (let col = 0; col < 64; col++) {
    for (let row = 0; row < 64; row++) {
      const idx = vs.buf[off + col * 64 + row];
      const [r, g, bl] = pal[idx];
      const d = (row * 64 + col) * 4;
      px[d] = r; px[d + 1] = g; px[d + 2] = bl; px[d + 3] = 255;
    }
  }
  return px;
}

// ============================================================ sprites
// A VSWAP sprite is not a bitmap — it is a list of columns, each of which is a
// list of vertical runs. The format (t_compshape, WL_DEF.H:1072, and the
// drawing loop in WL_SCALE.C/ScaleLine):
//
//   uint16 leftpix, rightpix               first and last non-empty column
//   uint16 dataofs[rightpix-leftpix+1]     run-list offsets from the START of
//                                          the chunk, one per column
//   run list: word triples (endy*2, base, starty*2), terminated by zero
//   the pixel for row y comes from  chunk[base + y]
//
// The doubling is a leftover: the original kept jump-table offsets there for
// the scaling code. Everything outside the runs is TRANSPARENT, which is why
// the sprite atlas has to be a separate file from the opaque wall atlas.
function spriteRGBA(vs, nr, pal) {
  const off = vs.offsets[nr];
  const u16 = p => vs.buf.readUInt16LE(off + p);
  const px = Buffer.alloc(64 * 64 * 4);            // alpha 0 = transparent
  const left = u16(0), right = u16(2);
  if (right < left || right > 63) throw new Error(`page ${nr}: columns ${left}..${right}`);
  for (let c = left; c <= right; c++) {
    let p = u16(4 + (c - left) * 2);
    for (let spin = 0; ; spin++) {
      if (spin > 64) throw new Error(`page ${nr}, column ${c}: run list never ends`);
      const endy = u16(p);
      if (endy === 0) break;
      // THE BASE IS SIGNED. The original stores a 16-bit offset within the
      // sprite's segment and lets it wrap, so a value like 0xFFF0 means -16.
      // Read as unsigned it indexed hundreds of pixels PAST the chunk — 566 of
      // them across the whole set. It only became visible on the weapon,
      // because that is drawn six times larger than anything else: the bottom
      // edge of the sleeve came out as multicoloured garbage.
      const base = vs.buf.readInt16LE(off + p + 2), starty = u16(p + 4);
      p += 6;
      for (let y = starty >> 1; y < (endy >> 1); y++) {
        if (base + y < 0 || base + y >= vs.lengths[nr])
          throw new Error(`page ${nr}: pixel outside the chunk (base ${base}, y ${y})`);
        const idx = vs.buf[off + base + y];
        const d = (y * 64 + c) * 4;
        px[d] = pal[idx][0]; px[d + 1] = pal[idx][1]; px[d + 2] = pal[idx][2]; px[d + 3] = 255;
      }
    }
  }
  return px;
}

// Indices from enum SPRITES (WL_DEF.H:159). VSWAP page = spriteStart + index.
// statinfo[] from WL_ACT1.C:22-80; `block` is the original's own field, the
// rest are itemnumber values read off GetBonus (WL_AGENT.C). E1M1 has neither
// keys nor the crown, so those cases are not transcribed.
const SPR_STAT_0 = 2;      // from WL_DEF.H:159 — SPR_DEMO, SPR_DEATHCAM, then statics
const STATINFO = {
  0:{}, 1:{block:1}, 2:{block:1}, 3:{block:1}, 4:{}, 5:{block:1}, 6:{health:4}, 7:{block:1},
  8:{block:1}, 9:{}, 10:{block:1}, 11:{block:1}, 12:{block:1}, 13:{block:1}, 14:{}, 15:{},
  16:{block:1}, 17:{block:1}, 18:{block:1}, 19:{}, 20:{key:0}, 21:{key:1}, 22:{block:1}, 23:{},
  24:{health:10}, 25:{health:25}, 26:{ammo:8}, 27:{weapon:'machinegun', ammo:6},
  28:{weapon:'chaingun', ammo:6}, 29:{score:100, treasure:1}, 30:{score:500, treasure:1},
  31:{score:1000, treasure:1},
  32:{score:5000, treasure:1}, 33:{health:99, ammo:25, treasure:1, life:1}, 34:{health:1},
  35:{block:1}, 36:{block:1}, 37:{block:1}, 38:{health:1}, 39:{block:1},
};
// Player weapon frames. The numbers were counted out of the enum in WL_DEF.H
// rather than guessed: SPR_STAT_0 comes out at 2, SPR_GRD_S_1 at fifty,
// SPR_DOG_W1_1 at ninety-nine — all three agree with what was already here, so
// the enum reading is trustworthy and SPR_PISTOLREADY at 421 is too.
const SPR_PISTOL = 421;
// Immediately after the pistol: SPR_MACHINEGUNREADY and four attack frames
// (WL_DEF.H:463).
const SPR_MACHINEGUN = SPR_PISTOL + 5;
// The knife sits BEFORE the pistol: SPR_KNIFEREADY and four frames (WL_DEF.H:457).
const SPR_KNIFE = SPR_PISTOL - 5;
const SPR = { GRD_S: 50, GRD_PAIN1: 90, GRD_DIE: 91, GRD_PAIN2: 94, GRD_DEAD: 95,
              GRD_SHOOT: 96, DOG_W1: 99, DOG_DIE: 131, DOG_DEAD: 134 };
// What E1M1 actually needs: 32 guards, 5 dogs, 1 dead guard.
// GROUPS ARE ALIGNED TO ROWS. Not tidiness for its own sake: the rotation frame
// is chosen arithmetically (background-position: calc(var(--facing) * -64px)),
// and that only works if all eight frames of one actor sit in one row, starting
// at column zero.
const SPRITE_GROUPS = [
  { n: 'guard.idle',       pages: Array.from({ length: 8 }, (_, i) => SPR.GRD_S + i) },
  { n: 'guard.action',     pages: [...Array.from({ length: 3 }, (_, i) => SPR.GRD_SHOOT + i),
                                   ...Array.from({ length: 3 }, (_, i) => SPR.GRD_DIE + i),
                                   SPR.GRD_DEAD] },
  { n: 'dog.idle',         pages: Array.from({ length: 8 }, (_, i) => SPR.DOG_W1 + i) },
  { n: 'weapon.pistol',    pages: Array.from({ length: 5 }, (_, i) => SPR_PISTOL + i) },
  { n: 'weapon.machinegun',pages: Array.from({ length: 5 }, (_, i) => SPR_MACHINEGUN + i) },
  { n: 'weapon.knife',     pages: Array.from({ length: 5 }, (_, i) => SPR_KNIFE + i) },
];

// ============================================================ VGAGRAPH
// The status bar artwork does not live in VSWAP but in VGAGRAPH — Huffman
// compressed, with the dictionary in VGADICT and three-byte offsets in VGAHEAD
// (ID_CA.C:197-199, 893-927). A chunk begins with a four-byte expanded length,
// and the root of the tree is node 254.
//
// The images are in LATCH layout: plane p holds the pixels where `x & 3 === p`,
// w/4 bytes per row. That is the same layout VGA hardware loaded memory in
// through its latch registers.
const NUM_STRUCTPIC = 0, NUM_STARTPICS = 3;
const PIC = { STATUSBAR: 86, KNIFE: 91, GUN: 92, MACHINEGUN: 93, GATLING: 94,
              NOKEY: 95, GOLDKEY: 96, SILVERKEY: 97, N_BLANK: 98, N_0: 99,
              FACE1A: 109,
// The intermission screen uses no font — it uses PICTURES OF LETTERS. `Write`
// (WL_INTER.C:331) maps a character to L_APIC..L_ZPIC and blits it like a tile.
// That happens to suit a JavaScript-free port perfectly: no font work at all.
              L_GUY: 43, L_COLON: 44, L_NUM0: 45, L_PERCENT: 55, L_A: 56,
              L_EXPOINT: 82, L_APOSTROPHE: 83, L_GUY2: 84, L_BJWINS: 85,
              TITLE: 87, PG13: 88, GETPSYCHED: 134 };

function readVga() {
  const dict = readFileSync(dataFile('VGADICT'));
  const head = readFileSync(dataFile('VGAHEAD'));
  const graf = readFileSync(dataFile('VGAGRAPH'));
  const offsetOf = i => {
    const v = head[i * 3] | (head[i * 3 + 1] << 8) | (head[i * 3 + 2] << 16);
    return v === 0xFFFFFF ? -1 : v;
  };
  const w0 = i => dict.readUInt16LE(i * 4), w1 = i => dict.readUInt16LE(i * 4 + 2);
  const inflateHuff = (src, len) => {
    const out = Buffer.alloc(len);
    let o = 0, node = 254, bit = 0, byte = 0, i = 0;
    while (o < len) {
      if (bit === 0) { byte = src[i++]; bit = 1; }
      const idx = (byte & bit) ? w1(node) : w0(node);
      bit = (bit << 1) & 255;
      if (idx < 256) { out[o++] = idx; node = 254; } else node = idx - 256;
    }
    return out;
  };
  const grChunk = n => {
    const p = offsetOf(n); if (p < 0) return null;
    let m = n + 1; while (offsetOf(m) === -1) m++;
    return inflateHuff(graf.subarray(p + 4, offsetOf(m)), graf.readUInt32LE(p));
  };
  const tab = grChunk(NUM_STRUCTPIC);
  const size = n => ({ w: tab.readInt16LE((n - NUM_STARTPICS) * 4),
                       h: tab.readInt16LE((n - NUM_STARTPICS) * 4 + 2) });
  return { grChunk, size };
}

// One picture as raw palette indices, already unwoven from the four planes.
function picIndices(vga, n) {
  const { w, h } = vga.size(n), d = vga.grChunk(n);
  if (!d || d.length !== w * h)
    throw new Error(`picture ${n}: ${w}x${h} is ${w * h} bytes, got ${d ? d.length : 0}`);
  const out = new Uint8Array(w * h), bw = w >> 2;
  for (let p = 0; p < 4; p++) for (let y = 0; y < h; y++) for (let j = 0; j < bw; j++)
    out[y * w + j * 4 + p] = d[p * bw * h + y * bw + j];
  return { w, h, idx: out };
}

// ============================================================ palette

// The game palette: 256 six-bit triples. It lives in GAMEPAL.OBJ, part of
// id Software's source release — a separate download — so the result of reading
// it is committed as build/gamepal.json. Set WOLF3D_SRC and the original wins.
function readPalette() {
  const src = process.env.WOLF3D_SRC;
  if (!src || !existsSync(join(src, 'OBJ', 'GAMEPAL.OBJ')))
    return JSON.parse(readFileSync(join(HERE, 'gamepal.json'), 'utf8'));
  const obj = readFileSync(join(src, 'OBJ', 'GAMEPAL.OBJ'));
  // 768 six-bit values; the LEDATA record starts its payload at 119
  const base = 119;
  const pal = [];
  for (let i = 0; i < 256; i++) {
    const r = obj[base + i * 3], g = obj[base + i * 3 + 1], b = obj[base + i * 3 + 2];
    pal.push([(r << 2) | (r >> 4), (g << 2) | (g >> 4), (b << 2) | (b >> 4)]);
  }
  return pal;
}

// ============================================================ PNG, no dependencies

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;                                        // filter None
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============================================================ reading the map

const AREATILE = 107, ELEVATORTILE = 21, AMBUSHTILE = 106;

// The same enemy code appears at three difficulty levels, 36 apart
// (WL_GAME.C: `tile -= 36` in the case fallthroughs). Reduce to the base code
// and read off kind and facing: dir 0..3 is east, north, west, south
// (dirangle[]).
function identifyEnemy(code) {
  let b = code;
  while (b >= 144) b -= 36;
  if (b === 124) return { kind: 'corpse', dir: 0 };
  if (b >= 108 && b <= 111) return { kind: 'guard', dir: b - 108 };
  if (b >= 112 && b <= 115) return { kind: 'guard', dir: b - 112 };
  if (b >= 134 && b <= 137) return { kind: 'dog', dir: b - 134 };
  if (b >= 138 && b <= 141) return { kind: 'dog', dir: b - 138 };
  return { kind: 'other', dir: 0 };
}

function describeMap(m) {
  const [p0, p1] = m.planes;
  const at = (p, x, y) => p[y * 64 + x];

  let start = null;
  const doors = [], statics = [], enemies = [], pushwalls = [];
  let minx = 64, maxx = -1, miny = 64, maxy = -1;

  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = at(p0, x, y), b = at(p1, x, y);
    if (a !== 0) { if (x < minx) minx = x; if (x > maxx) maxx = x;
                   if (y < miny) miny = y; if (y > maxy) maxy = y; }
    if (a >= 90 && a <= 101) {
      doors.push({ x, y, vertical: a % 2 === 0, lock: a % 2 === 0 ? (a - 90) / 2 : (a - 91) / 2 });
    }
    if (b >= 19 && b <= 22) start = { x, y, dir: b - 19, angle: ((1 - (b - 19)) * 90 + 360) % 360 };
    else if (b >= 23 && b <= 74) statics.push({ x, y, n: b - 23 });
    else if (b === 98) pushwalls.push({ x, y });
    else if (b >= 108 && b <= 227) enemies.push({ x, y, code: b, ...identifyEnemy(b) });
  }

  // Solid wall: 1..89 (doors excluded). 107 and up is floor tagged with a
  // region number.
  const solid = [];
  for (let y = 0; y < 64; y++) {
    let lo = 0, hi = 0;
    for (let x = 0; x < 64; x++) {
      const a = at(p0, x, y);
      const isSolid = a >= 1 && a <= 89 && a !== AMBUSHTILE ? 1 : 0;
      if (isSolid) { if (x < 32) lo |= (1 << x); else hi |= (1 << (x - 32)); }
    }
    solid.push([lo >>> 0, hi >>> 0]);
  }

  return { start, doors, statics, enemies, pushwalls, solid,
           extent: { minx, maxx, miny, maxy },
           lift: (() => { const w = []; for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
             if (at(p0, x, y) === ELEVATORTILE) w.push({ x, y }); return w })() };
}

// ============================================================ main run

const pal = readPalette();
const map = readMap(0);                           // E1M1 = index 0
const desc = describeMap(map);
const vs = readVswap();

const WALL_PAGES = vs.spriteStart;                // pages 0..spriteStart-1 are walls + doors
const COLS = 16, ROWS = Math.ceil(WALL_PAGES / COLS);
const atlas = Buffer.alloc(COLS * 64 * ROWS * 64 * 4);
for (let i = 0; i < WALL_PAGES; i++) {
  const px = wallPageRGBA(vs, i, pal);
  const cx = (i % COLS) * 64, cy = Math.floor(i / COLS) * 64;
  for (let row = 0; row < 64; row++) {
    px.copy(atlas, ((cy + row) * COLS * 64 + cx) * 4, row * 64 * 4, (row + 1) * 64 * 4);
  }
}
writeFileSync(join(OUT, 'wolf-atlas.png'), png(COLS * 64, ROWS * 64, atlas));

// --- a separate sprite atlas: it has transparency, so it cannot share a file
//     with the opaque walls
const SCOLS = 8, SROWS = SPRITE_GROUPS.length;
const atlasS = Buffer.alloc(SCOLS * 64 * SROWS * 64 * 4);
const spriteIndex = {};
let blank = 0;
SPRITE_GROUPS.forEach((g, row) => {
  if (g.pages.length > SCOLS) throw new Error(`group ${g.n} does not fit in a row`);
  g.pages.forEach((page, col) => {
    const px = spriteRGBA(vs, vs.spriteStart + page, pal);
    let visible = 0;
    for (let k = 3; k < px.length; k += 4) if (px[k]) visible++;
    if (!visible) blank++;
    const cx = col * 64, cy = row * 64;
    for (let r = 0; r < 64; r++)
      px.copy(atlasS, ((cy + r) * SCOLS * 64 + cx) * 4, r * 64 * 4, (r + 1) * 64 * 4);
  });
  spriteIndex[g.n] = { row, frames: g.pages.length };
});
if (blank) throw new Error(`${blank} sprites came out empty — wrong format or wrong indices`);
writeFileSync(join(OUT, 'wolf-sprites.png'), png(SCOLS * 64, SROWS * 64, atlasS));

// --- statics: only the kinds that actually stand on E1M1
const staticKinds = [...new Set(desc.statics.map(s => s.n))].sort((a, b) => a - b);
const TCOLS = 8, TROWS = Math.ceil(staticKinds.length / TCOLS);
const atlasT = Buffer.alloc(TCOLS * 64 * TROWS * 64 * 4);
const staticTable = {};
staticKinds.forEach((kind, i) => {
  const col = i % TCOLS, row = Math.floor(i / TCOLS);
  const px = spriteRGBA(vs, vs.spriteStart + SPR_STAT_0 + kind, pal);
  let visible = 0;
  for (let k = 3; k < px.length; k += 4) if (px[k]) visible++;
  if (!visible) throw new Error(`static ${kind} came out empty`);
  const cx = col * 64, cy = row * 64;
  for (let r = 0; r < 64; r++)
    px.copy(atlasT, ((cy + r) * TCOLS * 64 + cx) * 4, r * 64 * 4, (r + 1) * 64 * 4);
  staticTable[kind] = { col, row, ...(STATINFO[kind] || {}) };
});
writeFileSync(join(OUT, 'wolf-statics.png'), png(TCOLS * 64, TROWS * 64, atlasT));
console.log(`statics: ${staticKinds.length} kinds in a ${TCOLS}x${TROWS} grid`);

// --- the HUD atlas: bar, digits, faces, keys and weapons in one file.
// Everything at NATIVE 320x200 scale; the page scales it once with a single
// background-size, so the CSS positions are exactly the ones in WL_AGENT.C.
const vga = readVga();
const HUD_W = 320, HUD_H = 112;
const atlasHud = Buffer.alloc(HUD_W * HUD_H * 4);
const paste = (n, dx, dy) => {
  const { w, h, idx } = picIndices(vga, n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pal[idx[y * w + x]], o = ((dy + y) * HUD_W + dx + x) * 4;
    atlasHud[o] = c[0]; atlasHud[o + 1] = c[1]; atlasHud[o + 2] = c[2]; atlasHud[o + 3] = 255;
  }
  return { w, h };
};
const hud = { file: 'wolf-hud.png', w: HUD_W, h: HUD_H };
hud.bar = { x: 0, y: 0, ...paste(PIC.STATUSBAR, 0, 0) };
// digits: [blank, 0..9] — blank comes first, because that is what LatchNumber
// pads a number with
hud.digits = { x: 0, y: 40, w: 8, h: 16, count: 11 };
paste(PIC.N_BLANK, 0, 40);
for (let i = 0; i < 10; i++) paste(PIC.N_0 + i, 8 + i * 8, 40);
// keys: [none, gold, silver]
hud.keys = { x: 88, y: 40, w: 8, h: 16 };
[PIC.NOKEY, PIC.GOLDKEY, PIC.SILVERKEY].forEach((n, i) => paste(n, 88 + i * 8, 40));
// faces: eight health levels, frame A
hud.faces = { x: 0, y: 56, w: 24, h: 32, count: 8 };
for (let i = 0; i < 8; i++) paste(PIC.FACE1A + i * 3, i * 24, 56);
// weapons: knife, pistol, machine gun, gatling
hud.weapons = { x: 0, y: 88, w: 48, h: 24 };
[PIC.KNIFE, PIC.GUN, PIC.MACHINEGUN, PIC.GATLING].forEach((n, i) => paste(n, i * 48, 88));
writeFileSync(join(OUT, 'wolf-hud.png'), png(HUD_W, HUD_H, atlasHud));
console.log(`HUD: atlas ${HUD_W}x${HUD_H}, bar ${hud.bar.w}x${hud.bar.h}`);

// --- the SCREEN atlas: title, "Get Psyched!", BJ and the intermission letters.
// Native 320x200 scale again, same as the HUD.
const SC_W = 320, SC_H = 400;
const atlasSc = Buffer.alloc(SC_W * SC_H * 4);
const pasteScreen = (n, dx, dy) => {
  const { w, h, idx } = picIndices(vga, n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pal[idx[y * w + x]], o = ((dy + y) * SC_W + dx + x) * 4;
    atlasSc[o] = c[0]; atlasSc[o + 1] = c[1]; atlasSc[o + 2] = c[2]; atlasSc[o + 3] = 255;
  }
  return { w, h };
};
const screens = { file: 'wolf-screens.png', w: SC_W, h: SC_H };
screens.title   = { x: 0,   y: 0,   ...pasteScreen(PIC.TITLE, 0, 0) };
screens.psyched = { x: 0,   y: 200, ...pasteScreen(PIC.GETPSYCHED, 0, 200) };
screens.pg13    = { x: 224, y: 200, ...pasteScreen(PIC.PG13, 224, 200) };
screens.bj      = { x: 0,   y: 264, ...pasteScreen(PIC.L_GUY, 0, 264) };
screens.bj2     = { x: 104, y: 264, ...pasteScreen(PIC.L_GUY2, 104, 264) };
screens.bjwins  = { x: 208, y: 264, ...pasteScreen(PIC.L_BJWINS, 208, 264) };
// The digit row starts with a BLANK cell, so that suppressing leading zeros is
// plain arithmetic on the index — the same trick the status bar plays with
// N_BLANKPIC.
screens.digits = { x: 0, y: 352, w: 16, h: 16, count: 11 };
for (let i = 0; i < 10; i++) pasteScreen(PIC.L_NUM0 + i, 16 + i * 16, 352);
// The rest of the characters: colon, percent, exclamation mark, apostrophe,
// then the alphabet. `Write` advances 16 px per letter but only 8 for : ! ' —
// hence `step`.
const glyphs = {};
const put = (ch, pic, x, y, step) => { const g = pasteScreen(pic, x, y);
  glyphs[ch] = { x, y, w: g.w, h: g.h, step }; };
put(':', PIC.L_COLON, 0, 368, 8);
put('%', PIC.L_PERCENT, 16, 368, 16);
put('!', PIC.L_EXPOINT, 32, 368, 8);
put("'", PIC.L_APOSTROPHE, 48, 368, 8);
for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(97 + i);
  if (i < 15) put(ch, PIC.L_A + i, 64 + i * 16, 368, 16);
  else        put(ch, PIC.L_A + i, (i - 15) * 16, 384, 16);
}
screens.glyphs = glyphs;
// Background colours: the intermission bar is VWB_Bar(...,127) (WL_INTER.C:560)
// and the death screen VW_Bar(...,4) (WL_GAME.C:1199) — palette indices, not
// inventions.
screens.bg = pal[127];
screens.deathColour = pal[4];
writeFileSync(join(OUT, 'wolf-screens.png'), png(SC_W, SC_H, atlasSc));
console.log(`screens: atlas ${SC_W}x${SC_H}, bg127 ${screens.bg}, death4 ${screens.deathColour}`);

const used = new Set();
for (const v of map.planes[0]) if (v >= 1 && v <= 63) used.add(v);

writeFileSync(join(CACHE, 'map.json'), JSON.stringify({
  source: EXT, name: map.name, tagRLEW: '0x' + map.tag.toString(16),
  atlas: { cols: COLS, rows: ROWS, pages: WALL_PAGES, tile: 64,
           spriteStart: vs.spriteStart, soundStart: vs.soundStart, chunks: vs.chunks },
  floorColour: pal[0x19], ceilColour: pal[0x1d],
  planes: map.planes, ...desc,
  wallTilesUsed: [...used].sort((a, b) => a - b),
  sprites: { cols: SCOLS, rows: SROWS, tile: 64, index: spriteIndex },
  staticIndex: { cols: TCOLS, rows: TROWS, tile: 64, index: staticTable },
  hud, screens,
}, null, 0));

// --- 2D plan for the diagnostic overlay: one pixel per tile -----------------
// Drawn as a PNG rather than 4096 divs; the page only has to blow it up with
// image-rendering: pixelated.
{
  const px = Buffer.alloc(64 * 64 * 4);
  const colour = { wall: [70, 80, 95], floor: [21, 26, 34], door: [201, 162, 39],
                   secret: [141, 91, 181], lift: [226, 114, 110] };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = map.planes[0][y * 64 + x], b = map.planes[1][y * 64 + x];
    let c = colour.floor;
    if (a === 21 || a === 22) c = colour.lift;
    else if (a >= 90 && a <= 101) c = colour.door;
    else if (a >= 1 && a <= 89 && a !== AMBUSHTILE) c = b === 98 ? colour.secret : colour.wall;
    const d = (y * 64 + x) * 4;
    px[d] = c[0]; px[d + 1] = c[1]; px[d + 2] = c[2]; px[d + 3] = 255;
  }
  writeFileSync(join(OUT, 'wolf-minimap.png'), png(64, 64, px));
}

writeFileSync(join(CACHE, 'palette.json'), JSON.stringify(pal));

console.log(`data: ${EXT}, map "${map.name}", RLEW tag 0x${map.tag.toString(16)}`);
console.log(`VSWAP: ${vs.chunks} chunks, spriteStart ${vs.spriteStart}, soundStart ${vs.soundStart}`);
console.log(`atlas: ${WALL_PAGES} pages in a ${COLS}x${ROWS} grid = ${COLS * 64}x${ROWS * 64} px`);
console.log(`player start: ${JSON.stringify(desc.start)}`);
console.log(`doors ${desc.doors.length}, statics ${desc.statics.length}, ` +
            `enemies ${desc.enemies.length}, pushwalls ${desc.pushwalls.length}`);
console.log(`lift: ${JSON.stringify(desc.lift)}`);
console.log(`tile extent: x ${desc.extent.minx}..${desc.extent.maxx}, ` +
            `y ${desc.extent.miny}..${desc.extent.maxy}`);
console.log(`wall tiles used: ${[...used].sort((a, b) => a - b).join(', ')}`);
console.log(`floor ${pal[0x19]}, ceiling ${pal[0x1d]}`);
