#!/usr/bin/env node
// WOLFENSTEIN 3D, E1M1 — a port to pure HTML + CSS.
// Real geometry out of GAMEMAPS, real textures out of VSWAP, and an engine
// made of nothing but inherited custom properties, container queries and
// scroll-driven animations.
//
// COORDINATE SYSTEM. Wolfenstein has x running east and y running SOUTH on
// screen, angles increasing counter-clockwise with 0° = east, and `Thrust`
// gives the direction as (cos a, -sin a) in (x, y) — WL_AGENT.C:940-941. Here y
// maps to CSS Z, so the direction in (X, Z) is also (cos a, -sin a). A CSS
// camera with heading H looks along (sin H, -cos H), therefore
//         H = 90° - wolf_angle
// Check: angle 0 (east) -> H=90 -> (1,0) = +X ✓; angle 90 (north) -> H=0
// -> (0,-1) = -Z ✓.
//
// SCALE. The pixel size of a tile is arbitrary — it cancels out in the
// projection — so 64 px it is, making one world unit equal one texel. Then for
// a screen W pixels wide, perspective = 0.68359375 * W (that is `scale` from
// WL_MAIN.C:661, the distance to the projection plane), and a wall one tile
// high at distance d tiles occupies exactly scale/d pixels — as in the original.
//
// Rebuild: node build/extract.mjs && node build/generate.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const REPO = 'https://github.com/lsobolew/wolfenstein-3css';
const M = JSON.parse(readFileSync(join(ROOT, '.cache', 'map.json'), 'utf8'));
const [P0, P1] = M.planes;
const at = (p, x, y) => (x < 0 || y < 0 || x > 63 || y > 63) ? 0 : p[y * 64 + x];

// ---------------------------------------------------------------- parameters
const U = 64;                    // tile in world px = 64 texels
const W = 640;                   // screen width; the original view is 2x 320
const H = W / 2;                 // viewheight = viewwidth/2 (WL_MAIN.C:1330)
const PERSP = 0.68359375 * W;    // = scale, distance to the projection plane
const ASPECT = 1.2;              // 320x200 stretched to 4:3
// The whole screen: 160 rows of view plus the 40-row status bar, x2.4.
const GAME_H = H * ASPECT + M.hud.bar.h * (H * ASPECT / 160);   // 480

// Page padding, and the factor that fits the fixed 640x480 screen into the
// width the page actually has.
//
// The width is read as 100cqw off a size container on <body>, NOT as 100vw:
// 100vw includes the scrollbar, and on a platform with classic scrollbars that
// is fifteen pixels the game does not have — enough to push a horizontal
// scrollbar onto a narrow window. cqw is the content box, which is exact.
//
// Dividing a length by a length is the part that used to be impossible here.
// It is not any more: current Chrome computes calc(100cqw / 640px) to a plain
// number, so the fit is one continuous expression instead of a ladder of media
// queries. Measured in Chrome 151: a 400px container gives exactly 0.625.
const PAD_WIDE = '1.6rem', PAD_NARROW = '.6rem';
const FIT = `clamp(.25, calc(100cqw / ${W}px), 1)`;
// SUB = 1, so a wall face is ONE 64 px plane. There used to be two reasons to
// subdivide it, and neither survives here:
//   1. No near clipping — in this port COLLISION replaces it: the player's
//      radius equals MINDIST, so the camera can never pass through a face. The
//      build plan called that an "unobvious bonus"; this is it being collected.
//   2. A plane with a large depth span stops rasterising — except the threshold
//      was never actually measured. Door leaves were given a full 64 px face
//      with clip-path and rasterise without gaps even up close at a sharp
//      angle, so 64 px is on the safe side of wherever the threshold is.
const SUB = 1;
const FOCAL = 0.33984375 * U;    // the camera stands THIS far behind the player
                                 // (WL_DRAW.C:1307)

const ATL_W = M.atlas.cols * 64, ATL_H = M.atlas.rows * 64;
const DOORWALL = M.atlas.spriteStart - 8;

const f6 = n => Number(n.toFixed(6));   // must exist before the door geometry

const solidTile = (x, y) => { const v = at(P0, x, y); return v >= 1 && v <= 89 && v !== 106 };
const doorTile = (x, y) => { const v = at(P0, x, y); return v >= 90 && v <= 101 };
// for wall geometry a door is a "hole" — it has its own plane inside the tile
const blocks = (x, y) => solidTile(x, y);

// ---------------------------------------------------------------- wall faces
// Face directions. `ang` comes from the NORMAL, not from the direction of the
// neighbour: rotateY(t) turns local +Z into (sin t, 0, cos t), so a face looking
// north (-Z) is 180°, south (+Z) is 0°, east (+X) is 90°, west (-X) is 270°.
//
// THERE IS NO MIRRORING — and this is a correction the original settles outright.
// WL_DRAW.C, HitVertWall:  texture = (yintercept>>4)&0xfc0;
//                          if (xtilestep == -1) texture = 0xfc0-texture;
// HitHorizWall does the same for the X axis. That flip does NOT mirror the wall
// — it STRAIGHTENS it: it makes the face look the same from either side of the
// block. A rotateY rotation achieves the same thing on its own, because for the
// "far" face it reverses the horizontal direction — so scale: -1 1 is
// SUPERFLUOUS here, and it was corrupting the image: the portrait on the east
// and north faces came out mirrored relative to the atlas page.
//
// A SEPARATE MATTER, and the one that is easy to confuse with the above: the
// ORDER OF SLICES when a face is split into SUB panels. The direction of u
// inside a panel is set by the rotation, but WHICH half of the texture a panel
// shows follows from where it sits in the world. On north and east faces u runs
// against the world axis, so the panel nearer the axis origin shows the FARTHER
// slice. The previous code did both things at once and corrected twice: the
// image came out cut in half with the halves swapped. Verified by comparing both
// faces of the same texture (tile 11 at (28,13) and (40,13)) against the raw
// atlas page.
const DIRS = [
  { dx: 0, dy: -1, ang: 180, ns: true,  flipU: true  },   // face pointing north
  { dx: 1, dy: 0,  ang: 90,  ns: false, flipU: true  },   // east
  { dx: 0, dy: 1,  ang: 0,   ns: true,  flipU: false },   // south
  { dx: -1, dy: 0, ang: 270, ns: false, flipU: false },   // west
];

// ---------------------------------------------------------------- secret walls
// PUSHABLETILE 98 on the second plane. PushWall (WL_ACT1.C) moves the tile TWO
// squares in the direction the player is facing, 128 tics per square — 1.829 s
// each. The vacated tile only becomes passable once the block has fully entered
// the next one, so for a moment TWO squares are solid at once.
//
// The direction is not guessed: each of the five walls stands in a passage that
// is open on both sides, but the player can only stand on one of them. Which
// one falls out of an ITERATIVE FLOOD FILL — the last two stand behind other
// secrets, so they have to be opened in order (a three-level chain).
const PUSH_TIME = 2 * 128 / 70;      // 3.657 s for two squares
const PUSH_INSET = 0.15;                  // faces inset so they do not fight the wall
const pushWalls = (() => {
  const goal = M.pushwalls.map(p => ({ x: p.x, y: p.y }));
  const solved = [];
  const opened = new Set();
  for (let round = 0; round < goal.length + 1 && solved.length < goal.length; round++) {
    const isFree = (x, y) => !solidTile(x, y) || opened.has(x + ',' + y);
    const seen = new Set([M.start.x + ',' + M.start.y]);
    const q = [[M.start.x, M.start.y]];
    while (q.length) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = cx + dx, b = cy + dy;
        if (a < 0 || a > 63 || b < 0 || b > 63 || !isFree(a, b) || seen.has(a + ',' + b)) continue;
        seen.add(a + ',' + b); q.push([a, b]);
      }
    }
    for (const p of goal) {
      if (opened.has(p.x + ',' + p.y)) continue;
      for (const k of DIRS) {
        if (solidTile(p.x + k.dx, p.y + k.dy) || solidTile(p.x + 2 * k.dx, p.y + 2 * k.dy)) continue;
        if (!seen.has((p.x - k.dx) + ',' + (p.y - k.dy))) continue;
        opened.add(p.x + ',' + p.y);
        solved.push({ n: solved.length, x: p.x, y: p.y, k,
                      gx: p.x - k.dx, gy: p.y - k.dy,       // the player's tile
                      t: [0, 1, 2].map(i => [p.x + k.dx * i, p.y + k.dy * i]) });
        break;
      }
    }
  }
  if (solved.length !== goal.length)
    throw new Error(`could not resolve the direction of ${goal.length - solved.length} secret walls`);
  return solved;
})();
const isPushWall = new Set(pushWalls.map(p => p.x + ',' + p.y));

const wallFaces = [];
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  if (!solidTile(x, y) || isPushWall.has(x + ',' + y)) continue;   // pushwall blocks drawn separately
  const t = at(P0, x, y);
  for (const k of DIRS) {
    const nx = x + k.dx, ny = y + k.dy;
    // A face pointing OUTSIDE THE MAP is never visible: the border ring is
    // solid all the way round (verified: zero non-solid tiles on the edge), so
    // the player has no way to stand on that side. Without this test `at()`
    // returned zero off the map, the tile read as non-solid and the face was
    // emitted — 256 faces out of 1014, A QUARTER OF ALL WALLS projected into
    // the void.
    if (nx < 0 || ny < 0 || nx > 63 || ny > 63) continue;
    // A pushwall tile does NOT occlude: once the block slides away, the walls
    // around its original square need something to show, or you would see
    // straight through them.
    if (blocks(nx, ny) && !isPushWall.has(nx + ',' + ny)) continue;
    // door jamb: a wall touching a door shows the frame texture on that face
    // rather than its own (bit 0x40, WL_DRAW.C:521-530)
    const page = doorTile(nx, ny)
      ? (k.ns ? DOORWALL + 2 : DOORWALL + 3)
      : (t - 1) * 2 + (k.ns ? 0 : 1);
    wallFaces.push({ x, y, k, page });
  }
}

// ---------------------------------------------------------------- the lift
// ELEVATORTILE 21. Cmd_Use (WL_AGENT.C) reduces the heading to the four
// compass directions and checks the tile in front of the player, but
// `elevatorok` is true ONLY for east and west. The reason is visible on the
// map: the lift alcove carries the switch texture on three walls while only one
// of them is the switch. So that condition never has to be written down here —
// it is enough to treat only east and west faces as switches, and the geometry
// picks out exactly the right two.
//
// Using it turns tile 21 into 22 (`tilemap[checkx][checky]++`), that is atlas
// page (21-1)*2+1 = 41 into (22-1)*2+1 = 43. If the player is STANDING on tile
// 107 (ALTELEVATORTILE, region zero), the lift leads to the secret level.
const LIFT_TILE = 21, LIFT_SWITCHED = 22, SECRET_REGION = 107;
const lifts = [];
for (const L of wallFaces) {
  if (at(P0, L.x, L.y) !== LIFT_TILE || L.k.ns) continue;   // east/west only
  const gx = L.x + L.k.dx, gy = L.y + L.k.dy;                 // the tile you use it from
  L.lift = lifts.length;
  lifts.push({ n: lifts.length, x: L.x, y: L.y, gx, gy,
               page2: (LIFT_SWITCHED - 1) * 2 + 1,
               secret: at(P0, gx, gy) === SECRET_REGION });
}
if (!lifts.length) throw new Error('found no lift switch at all');

// doors: one plane in the MIDDLE of the tile, across the passage
const doorLeaves = [];
for (const d of M.doors) {
  const page = d.lock === 5 ? DOORWALL + 4 : (d.lock === 0 ? DOORWALL : DOORWALL + 6);
  // a vertical door separates east from west, so its leaf has its normal along
  // X; the odd page is the vertical variant (WL_DRAW.C:725-741)
  doorLeaves.push({ ...d, page: page + (d.vertical ? 1 : 0),
                   ang: d.vertical ? 270 : 0, flip: false });
}

// ---------------------------------------------------------------- face CSS
// Every face is split into SUB narrow panels. A panel shows a 64/SUB texel
// slice of the same atlas page — the atlas is 1:1 with the world, so shifting
// the background is all it takes.
const STEP = U / SUB;
const panels = [];
const pos = [];
for (const L of wallFaces) {
  const { x, y, k, page } = L;
  const cx = (page % M.atlas.cols) * 64, cy = Math.floor(page / M.atlas.cols) * 64;
  // centre of the face in world space
  const sx = x * U + U / 2 + k.dx * U / 2;
  const sz = y * U + U / 2 + k.dy * U / 2;
  for (let i = 0; i < SUB; i++) {
    // panel offset along the face, on the axis perpendicular to the normal
    const off = (i - (SUB - 1) / 2) * STEP;
    const px = sx + (k.ns ? off : 0);
    const pz = sz + (k.ns ? 0 : off);
    // On faces where u runs against the world axis, the panels show their
    // slices in reverse order. Only visible when SUB > 1.
    const ui = k.flipU ? (SUB - 1 - i) : i;
    if (L.lift !== undefined) {
      // A switch face has TWO atlas pages and crosses between them when used.
      // --lift is 0 or 1, so the interpolation is exact.
      const w = lifts[L.lift];
      const dx2 = (w.page2 % M.atlas.cols) * 64, dy2 = Math.floor(w.page2 / M.atlas.cols) * 64;
      pos.push(`.p${panels.length}{translate:${px}px 0 ${pz}px;rotate:y ${k.ang}deg;` +
        `background-position:calc((${cx + ui * STEP} + var(--lift${w.n}) * ${dx2 + ui * STEP - cx - ui * STEP}) * -1px)` +
        ` calc((${cy} + var(--lift${w.n}) * ${dy2 - cy}) * -1px)}`);
    } else {
      pos.push(`.p${panels.length}{translate:${px}px 0 ${pz}px;rotate:y ${k.ang}deg;` +
               `background-position:${-(cx + ui * STEP)}px ${-cy}px}`);
    }
    panels.push(`<i class="f p${panels.length}"></i>`);
  }
}
// ---------------------------------------------------------------- door leaves
// A leaf does NOT slide as a solid — it would stick out of its tile. The slab
// stays put and shows the texture shifted by --open (which is exactly
// `texture = (intercept - doorposition) >> 4` from WL_DRAW.C), and whatever has
// already slid into the jamb is CUT AWAY by `clip-path`.
//
// The first version split the tile into eight fixed slices, each switched off
// as the opening edge passed it. The reasoning was that "there is nothing to
// clip with, because overflow flattens the 3D context" — true of `overflow`,
// but `clip-path` is a different property and I had NEVER tried it. Tried: the
// slab stays where it is in 3D, sorts correctly against the jamb, and
// rasterises up close at a sharp angle. That mistake cost 154 unnecessary
// planes and an 8 px staircase along the edge of the leaf.
//
// There is NO subdivision at all — one slab per leaf. An intermediate version
// used two, like the walls, and showed a 1-pixel seam: `clip-path` composites
// each slab separately, so the shared edge of two coplanar slabs stops being
// blended away by antialiasing. With one slab there is no seam, and a 64-pixel
// face rasterises up close at a sharp angle without gaps — measured.
const SUBD = 1;
const STEPD = U / SUBD;
const DOOR_TIME = 64 / 70;                  // 0.914 s — tics<<10 to 0xffff at 70 tics/s
const DOOR_HOLD = 300 / 70;               // 4.286 s — OPENTICS
const DOOR_CYCLE = 2 * DOOR_TIME + DOOR_HOLD;

const panelsDoor = [], posDoor = [];
doorLeaves.forEach((D, nr) => {
  const cx = (D.page % M.atlas.cols) * 64, cy = Math.floor(D.page / M.atlas.cols) * 64;
  for (let i = 0; i < SUBD; i++) {
    const o = (i + 0.5) * STEPD;             // slab centre along the sliding axis
    const px = D.vertical ? D.x * U + U / 2 : D.x * U + o;
    const pz = D.vertical ? D.y * U + o : D.y * U + U / 2;
    const nrP = panels.length + panelsDoor.length;
    // The texture travels with the leaf, so the slab's local X axis runs along
    // the sliding axis REGARDLESS of the rotation — we always clip from the
    // left. The edge in pixels is --open * 64, i.e. --open * 100% of the slab.
    posDoor.push(`.p${nrP}{width:${STEPD}px;margin:${-U / 2}px ${-STEPD / 2}px;` +
      `translate:${px}px 0 ${pz}px;rotate:y ${D.ang}deg;` +
      `background-position:calc((${f6(cx + i * STEPD)} - var(--open${nr}) * ${U}) * -1px) ${-cy}px;` +
      `clip-path:inset(0 0 0 clamp(0%, calc(var(--open${nr}) * ${U / STEPD * 100}%${
        i ? ` - ${i * 100}%` : ''}), 100%))}`);
    panelsDoor.push(`<i class="f p${nrP}"></i>`);
  }
});

// ---------------------------------------------------------------- pushwall blocks
// Four faces, because the passage widens halfway along and the sides of the
// block come into view. Every face is INSET by PUSH_INSET towards the centre of
// the tile: without it, in the final position the block's front face lies
// exactly on the rock face behind it and the sides lie on the corridor walls —
// and all three z-fight.
const panelsPush = [], posPush = [];
pushWalls.forEach(P => {
  const t = at(P0, P.x, P.y);
  for (const k of DIRS) {
    const page = (t - 1) * 2 + (k.ns ? 0 : 1);
    const cx = (page % M.atlas.cols) * 64, cy = Math.floor(page / M.atlas.cols) * 64;
    const sx = P.x * U + U / 2 + k.dx * (U / 2 - PUSH_INSET);
    const sz = P.y * U + U / 2 + k.dy * (U / 2 - PUSH_INSET);
    for (let i = 0; i < SUB; i++) {
      const off = (i - (SUB - 1) / 2) * STEP;
      const px = sx + (k.ns ? off : 0);
      const pz = sz + (k.ns ? 0 : off);
      const ui = k.flipU ? (SUB - 1 - i) : i;
      const nrP = panels.length + panelsDoor.length + panelsPush.length;
      posPush.push(`.p${nrP}{translate:calc(${f6(px)}px + var(--push${P.n}) * ${P.k.dx * U}px) 0` +
        ` calc(${f6(pz)}px + var(--push${P.n}) * ${P.k.dy * U}px);rotate:y ${k.ang}deg;` +
        `background-position:${-(cx + ui * STEP)}px ${-cy}px}`);
      panelsPush.push(`<i class="f p${nrP}"></i>`);
    }
  }
});

// ---------------------------------------------------------------- floor and ceiling
// The original has no floor textures — they are flat colours
// (WL_DRAW.C:946-1004). The only reason for a grid here is that a plane with a
// huge depth span stops rasterising.
const BLOK = 16;                      // 16x16 tiles per slab
const slabs = [];
// A block without a single free tile is entirely under walls — neither its
// floor nor its ceiling can be seen from anywhere. On E1M1 that is 22 blocks
// out of 64, so 44 slabs out of 128 were standing there for nothing.
const blockEmpty = (bx, by) => {
  for (let j = 0; j < BLOK; j++) for (let i = 0; i < BLOK; i++)
    if (!solidTile(bx * BLOK + i, by * BLOK + j)) return false;
  return true;
};
for (let by = 0; by < 64 / BLOK; by++) for (let bx = 0; bx < 64 / BLOK; bx++) {
  if (blockEmpty(bx, by)) continue;
  const cx = bx * BLOK * U + BLOK * U / 2, cz = by * BLOK * U + BLOK * U / 2;
  slabs.push(`<i class="g gp" style="translate:${cx}px ${U / 2}px ${cz}px"></i>`);
  slabs.push(`<i class="g gs" style="translate:${cx}px ${-U / 2}px ${cz}px"></i>`);
}

// ---------------------------------------------------------------- camera
const start = M.start;
const angle = start.angle;                        // wolf angle, 0 = east
const cssH0 = ((90 - angle) % 360 + 360) % 360; // CSS heading at spawn
const gx = start.x * U + U / 2, gz = start.y * U + U / 2;

const rgb = a => `rgb(${a[0]},${a[1]},${a[2]})`;

// ============================================================ CONTROLS
// The stick and the path integral, retuned to the original's numbers
// (WL_AGENT.C:18-20, WL_PLAY.C:246-249):
//   walk  5.6 tiles/s   run 11.2 tiles/s  -> 358.4 and 716.8 px/s at 64 px tiles
//   turn  122.5 deg/s   run 245 deg/s
// The speed steps ADD UP, so they are chosen so that the first step is exactly
// walking speed and all of them together are running speed — which makes the
// original's walk/run split fall out on its own.
let COLLISION = false;
let DOORS = false;
let ENEMIES = false;
let ITEMS = false;
let LIFT = false;
let SECRETS = false;
let WEAPONS = false;
let SIGHT = false;
const THROW = 700;              // half the stick range in px; full range = 2*THROW
// NUDGING THE SNAP TARGET. Symptom: after a sideways gesture the scroll
// sometimes does not return to centre on its own and the player keeps turning.
// Measured: moving the target DRAGS the scroll position along with it
// (382 -> 381.5 -> 382.5 -> 383 -> 384), so cycling its position gives the
// browser a reason to snap again. Amplitude and period live here because both
// are tuning knobs.
const NUDGE_PX = 0.3;          // px each way. A smaller amplitude would not help:
                              // Chrome QUANTISES the scroll offset to 0.5 px,
                              // so at both 0.3 and 0.5 scrollLeft jumps
                              // 381.5 <-> 382.5 (measured). That yields a turn
                              // deflection of about 0.9 against a threshold of
                              // 2, i.e. 2.2x of headroom — which is all this
                              // mechanism has to give. 0.3 stays, because it
                              // perturbs the layout less.
const NUDGE_PERIOD = 0.1;    // s per step. It started at 0.4; the player does
                              // not notice 0.1 interfering with holding a turn,
                              // and the return to centre is four times quicker.
// ---- stick response curve --------------------------------------------------
// Deflection does not have to grow linearly with stick travel.
// `animation-timing-function` on a scroll axis is an ordinary Bezier curve, so
// the response can be bent with it: gentle near centre (precision), steep at
// the end (speed). This is the same trick as "expo" on a model-aircraft
// transmitter.
//
// THE TURN AXIS MUST HAVE A SYMMETRIC CURVE, and this is a trap worth
// remembering: it is bipolar (-100 to +100) and its rest point is in the MIDDLE
// of the range. The value at rest is -100 + 200*e(0.5), so if e(0.5) != 0.5 the
// player spins on the spot without touching anything. A Bezier is symmetric
// about (0.5, 0.5) exactly when x2 = 1-x1 and y2 = 1-y1.
// The movement axis is unipolar (rest at zero), so its curve can be any
// monotone one.
// The direction of the bend has to be thought through too, because it is easy
// to be 180° wrong. Movement axis: rest at the START, so the start is what
// should be gentle — a plain ease-in. Turn axis: rest in the MIDDLE, so the
// MIDDLE of the curve is what should be flat. The classic S-curve
// (0.6, 0, 0.4, 1) is steepest exactly there and makes things worse: the first
// step engaged 3 px from centre instead of 11.
const MOVE_CURVE = [0.3, 0, 1, 1];              // unipolar: gentle start
const TURN_CURVE = [0.25, 0.45, 0.75, 0.55];   // bipolar: flat in the middle
{ const [x1, y1, x2, y2] = TURN_CURVE;
  // with a tolerance, because 1 - 0.35 is not exactly 0.65
  if (Math.abs(x2 - (1 - x1)) > 1e-9 || Math.abs(y2 - (1 - y1)) > 1e-9)
    throw new Error('the turn curve must be symmetric about (0.5, 0.5), or ' +
                    'rest will not read as zero and the player spins forever'); }

const bezierCss = k => `cubic-bezier(${k.join(', ')})`;
const bezAxis = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
// How much stick travel it takes for the deflection to reach y (0..1).
function xAtY(y, [x1, y1, x2, y2]) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    if (bezAxis(t, y1, y2) < y) lo = t; else hi = t;
  }
  return bezAxis((lo + hi) / 2, x1, x2);
}
const BUCKETS = 16, BUCKET_DEG = 360 / BUCKETS;
// Speeds trimmed against the original, on request for gentler handling:
// run 11.2 -> 8.4 tiles/s, turn 245 -> 196 deg/s. Walking stays at 5.6, the
// original's own value (WL_AGENT.C:18-20) — that is the working speed.
const TURN_STEPS = [2, 12, 30, 55];      // 4 steps of 49 deg/s
const TURN_RATE = 196 / 4;
const MOVE_STEPS = [2, 30];               // 2 steps: walk, then the run top-up
const MOVE_RATE = [5.6 * U, 2.8 * U];
// BACKWARDS is walk-only. Reversing is the one direction still served by the
// old snap-based channel, so it carries that channel's latency — and at half
// speed the distance it can penetrate before stopping is half as long. The
// second step stays in the chain with zero amplitude: it contributes nothing
// and costs nothing beyond one level.
//
// WALKING BACKWARDS HAS ITS OWN, NESTED SCROLL CONTAINER.
// Clamping a range can only take away the UPPER end of an axis, so one axis can
// hard-stop only one direction. The answer: TWO containers, one per direction,
// each with its rest point at its own end of the range.
//   - outer (.stick): rest at scrollTop 0, travels DOWN = forward
//   - inner (.back):    rest at scrollTop max, travels UP  = backward
// An upward gesture is taken by the inner one; a downward gesture, when the
// inner one is already at its end, is HANDED to the outer one by the browser.
//
// A necessary condition, found by measurement: the inner container's clamped
// range must be EXACTLY ZERO. With even 1 px of slack (the height of the snap
// target) the inner container swallows the downward gesture instead of passing
// it on — and forward movement stops working. At zero the element stops being
// a scroll container at all and the gesture goes straight past it.
//
// How far the stick may deflect when the far probe calls for a slowdown to
// walking pace: far enough that the run threshold is UNREACHABLE. Computed
// through the curve and then checked directly, because the first version
// rounded by eye and landed EXACTLY on the threshold: against a wall the
// deflection reached 30.032 against a threshold of 30, so running engaged, the
// collision budget halved and the player went through walls. The 1 px snap
// target counts towards the range too — that also has to be remembered.
function yAtX(x, [x1, y1, x2, y2]) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const t = (lo + hi) / 2;
    if (bezAxis(t, x1, x2) < x) lo = t; else hi = t }
  return bezAxis((lo + hi) / 2, y1, y2);
}
const deflectionAt = px => 100 * yAtX(px / THROW, MOVE_CURVE);
const WALK_CLAMP = (() => {
  let p = Math.floor(THROW * xAtY(MOVE_STEPS[1] / 100, MOVE_CURVE));
  // +1 px, because the snap target also counts towards the scroll range
  while (p > 0 && deflectionAt(p + 1) >= MOVE_STEPS[1]) p--;
  if (deflectionAt(p + 1) >= MOVE_STEPS[1])
    throw new Error('the walk clamp does not cut off running');
  return p;
})();

const BACK_RANGE = 300;              // backward deflection range; backwards is walk-only
// The backward animation's range is this much wider than the scroll range. The
// reason is not obvious and cost a separate measurement: the animation MUST
// have `fill: none`, because with `both` it freezes the last value when the
// clamp zeroes the range mid-deflection — and the player kept walking backwards
// through the wall. But with `fill: none` the animation stops applying exactly
// at the end of its active phase. A 10% margin means progress never gets there.
const BACK_SLACK = 0.1;
const SPAN = 600;                          // accumulator length in seconds
const sinB = k => Math.sin(k * BUCKET_DEG * Math.PI / 180);
const cosB = k => Math.cos(k * BUCKET_DEG * Math.PI / 180);

function controlsCss() {
  const w = [];
  const prop = (n, syntax, init) =>
    w.push(`@property ${n} { syntax: '${syntax}'; initial-value: ${init}; inherits: true }`);
  prop('--jx', '<number>', 0); prop('--jy', '<number>', 0);
  prop('--h', '<number>', cssH0); prop('--hw', '<number>', 0);
  prop('--bucket', '<integer>', 0);
  prop('--px', '<number>', gx); prop('--pz', '<number>', gz);
  // How far the stick may travel forwards. Nothing touches this until collision
  // exists, but the declaration has to be here: without it the spacer gets
  // height auto and the forward half of the range simply disappears.
  prop('--fwdRange', '<number>', THROW);
  prop('--dx', '<number>', f6(sinB(Math.round(cssH0 / BUCKET_DEG) % BUCKETS)));
  prop('--dz', '<number>', f6(-cosB(Math.round(cssH0 / BUCKET_DEG) % BUCKETS)));
  TURN_STEPS.forEach((_, j) => {
    prop(`--tR${j}`, '<integer>', 0); prop(`--tL${j}`, '<integer>', 0);
    prop(`--hR${j}`, '<number>', 0); prop(`--hL${j}`, '<number>', 0);
  });
  MOVE_STEPS.forEach((_, j) => { prop(`--mF${j}`, '<integer>', 0) });
  prop('--jyB', '<number>', 0); prop('--mB', '<integer>', 0);
  prop('--back', '<number>', BACK_RANGE);
  for (let k = 0; k < BUCKETS; k++) {
    MOVE_STEPS.forEach((_, j) => prop(`--f${k}_${j}`, '<number>', 0));
    prop(`--b${k}`, '<number>', 0);
  }

  w.push(`@keyframes osx { from { --jx: -100 } to { --jx: 100 } }`);
  // The vertical axis now starts AT REST rather than at full deflection: the
  // rest point is scrollTop 0 and the only way out of it is downwards.
  w.push(`@keyframes osy { from { --jy: 0 } to { --jy: 100 } }`);
  // Backwards: rest lies at the START of the scroll range (see column-reverse
  // below), so progress 0 is zero deflection. The end value is 10% too large,
  // because the animation range is that much wider than the scroll range — at
  // full deflection it therefore comes out at exactly 100.
  w.push(`@keyframes axisB { from { --jyB: 0 } to { --jyB: ${f6(100 * (1 + BACK_SLACK))} } }`);
  TURN_STEPS.forEach((_, j) => {
    w.push(`@keyframes turnRk${j} { from { --hR${j}: 0 } to { --hR${j}: ${TURN_RATE * SPAN} } }`);
    w.push(`@keyframes turnLk${j} { from { --hL${j}: 0 } to { --hL${j}: ${TURN_RATE * SPAN} } }`);
  });
  for (let k = 0; k < BUCKETS; k++) {
    MOVE_STEPS.forEach((t, j) =>
      w.push(`@keyframes kf${k}_${j} { from { --f${k}_${j}: 0 } to { --f${k}_${j}: ${MOVE_RATE[j] * SPAN} } }`));
    w.push(`@keyframes kb${k} { from { --b${k}: 0 } to { --b${k}: ${MOVE_RATE[0] * SPAN} } }`);
  }

  w.push(`
/* The stick OVERLAYS THE SCREEN — a scrollable layer above the scene. Its only
   snap point sits at its centre, so it parks itself there on load and returns
   after every gesture. Scrollbars stay visible in debug mode: their thumbs are
   a live read-out of the deflection. NO scrollbar-gutter — it widens the range
   without moving the snap point, which breaks the centring. */
.game { timeline-scope: --sx, --sy, --sb }
.stick { position:absolute; inset:0; z-index:3; overflow:auto;
          scroll-snap-type:both mandatory;
          scroll-timeline:--sx inline, --sy block;
          /* Without this, a fast gesture that bottoms the stick out SCROLLS THE
             PAGE, and a container scrolled out of view loses its active
             timeline — so the collision clamp simply goes dark. Scrolling over
             the game should drive the game and nothing else. */
          overscroll-behavior: none;
          /* scrollbar-WIDTH, not ::-webkit-scrollbar. Setting scrollbar-color
             switches Chrome to the standard scrollbar implementation, which
             IGNORES ::-webkit-* rules — narrowing them to zero did nothing, and
             a red track added as a test never painted at all. Measured: the
             window width stayed 621 whatever the value. */
          scrollbar-width:none }
/* Removing the scrollbar widens the stick's window, but NO calibration depends
   on that: the turn axis has no animation-range, so it maps onto a FRACTION of
   the range, and with snapping to centre that fraction is always 50% —
   (700 - cw/2)/(1400 - cw) is one half for every cw. The forward and backward
   ranges are set by spacers, not by the window. Only turn sensitivity changes,
   by under two percent. */
.pad { width:.1px; height:1px; margin:0 ${THROW}px; position:relative;
       /* The nudge is DISCRETE (steps), not smooth: the browser only needs a
          layout change as a reason to re-snap, and stepping costs a couple of
          recalculations per second instead of sixty. The margins change in
          opposition, so the content width stays the same and the axis range
          does not move — only the rest point shifts, symmetrically both ways,
          so its average stays exactly at the centre. */
       animation: nudge ${NUDGE_PERIOD}s steps(1, end) infinite alternate;
       scroll-snap-stop: always;
       /* VERTICALLY at the start, HORIZONTALLY at the centre. The vertical rest
          point therefore lies at scrollTop 0 and the only way out of it is
          DOWN — the direction the clamp can take away. */
       scroll-snap-align:start center }
@keyframes nudge {
  from { margin-left: ${THROW - NUDGE_PX}px; margin-right: ${THROW + NUDGE_PX}px }
  to   { margin-left: ${THROW + NUDGE_PX}px; margin-right: ${THROW - NUDGE_PX}px }
}

/* The forward-travel spacer. calc(100% + Npx) is measured against the stick
   window's height, so the deflection range comes out at exactly N px without
   writing the window height or the scrollbar width down anywhere.
   IT IS A PSEUDO-ELEMENT, and that is not cosmetic: when the spacers lived in
   the HTML, all it took was the browser pairing a fresh stylesheet with a
   cached page and the stick's range dropped to zero — controls gone, nothing in
   the console. In CSS the mechanism cannot fall out of step with itself. */
.stick::after { content:''; display:block; width:1px;
                 height:calc(var(--fwdRange) * 1px) }

/* THE BACKWARD CONTAINER, nested and stuck across the whole viewport. Rest at
   the END of the range, so the only way out is UP — also a clippable
   direction. A downward gesture, when it sits at its end, is handed to the
   outer container by the browser.
   THE CLAMPED RANGE MUST BE ZERO: with 1 px of slack the inner container eats
   the downward gesture and forward movement stops working (measured). Hence the
   1 px subtracted on the spacer, which cancels the height of the snap target. */
.back { position:sticky; top:0; left:0; width:100%; height:100%;
       overflow-y:scroll; overflow-x:hidden; scrollbar-width:none;
       scroll-snap-type:y mandatory; scroll-timeline:--sb block;
       /* COLUMN-REVERSE MOVES THE START OF THE SCROLL TO THE BOTTOM, and that
          is the crux here. Without it the backward rest point lay at the END of
          the range — and then, when a wall behind the player disappeared and
          the range grew back from zero, the position stayed at the bottom, i.e.
          at FULL backward deflection. Symptom: you walk forwards and something
          keeps yanking you back. With rest at the start, a change of range
          never changes what the current position means. */
       display:flex; flex-direction:column-reverse }
.back::-webkit-scrollbar { width:0; height:0 }
.back::after { content:''; display:block; width:1px; flex:0 0 auto;
              height:calc(100% - 1px + calc(var(--back) * 1px)) }
.aimBack { display:block; width:1px; height:1px; flex:0 0 auto; scroll-snap-align:start }
/* The trigger now sits in the frame rather than in the pad: the pad rides at
   the top of the range, so a button inside it would land at the top edge of the
   picture instead of at its centre. */
.trigger { appearance:none; all:unset; position:absolute; left:50%; top:50%; z-index:4;
         width:28px; height:28px; margin:-14px; border-radius:50%;
         /* The border is two pixels and transparent FROM THE START: action
            highlights only change its colour, so the box never jitters. The
            resting outline is drawn by outline, not border — that way debug
            mode and the action highlight fight over neither the same property
            nor the same specificity. */
         border:2px solid transparent }
.hint { position:absolute; left:0; right:0; top:8px; margin:0; text-align:center;
       color:#8a9098; font:12px ui-monospace, Menlo, monospace; pointer-events:none;
       text-shadow:0 1px 3px #000 }

.rdx { animation:osx ${bezierCss(TURN_CURVE)} both; animation-timeline:--sx }
/* The backward axis gets its own level, because the forward axis states its
   animation-range in absolute units while the backward one is to stay
   normalised. */
.rdb { animation:axisB ${bezierCss(MOVE_CURVE)}; animation-timeline:--sb;
       animation-range: 0px ${f6(BACK_RANGE * (1 + BACK_SLACK))}px }
/* AN ABSOLUTE RANGE, and here it is a necessary condition. A scroll timeline
   normalises itself to the CURRENT range, so merely shortening the content
   would rescale the mapping and the clamped maximum would come back as FULL
   deflection. With animation-range given in PIXELS the mapping holds still:
   0 -> 0, ${THROW} -> 100, no matter how much of that range happens to be
   reachable — and the clamp changes exactly how much of it there is. */
.rdy { animation:osy ${bezierCss(MOVE_CURVE)} both; animation-timeline:--sy;
       animation-range: 0px ${THROW}px }

/* Thresholds. A continuous value will never match a literal, so the predicate
   is computed first — one flag per speed step. */
.rdx { ${TURN_STEPS.map((t, j) =>
  `--tR${j}: clamp(0, round(down, calc(var(--jx) / ${t}), 1), 1);
       --tL${j}: clamp(0, round(down, calc(var(--jx) / -${t}), 1), 1)`).join(';\n       ')} }
.rdy { ${MOVE_STEPS.map((t, j) =>
  `--mF${j}: clamp(0, round(down, calc(var(--jy) / ${t}), 1), 1)`).join(';\n       ')} }
.rdb { --mB: clamp(0, round(down, calc(var(--jyB) / ${MOVE_STEPS[0]}), 1), 1);
       container: wejscie / normal }

/* WALKING BACKWARDS IS DISABLED IN SAFARI, and not out of laziness — it cannot
   be done there without breaking walking forwards. The backward container has
   to satisfy two conditions at once:
     (1) rest at offset ZERO, because the collision clamp can collapse the range
         to zero and the position then lands on zero anyway — if zero does not
         mean rest, the player gets full backward deflection the moment they
         step away from a wall;
     (2) have no slack DOWNWARDS, or it eats the gesture meant for the outer
         forward container.
   "column-reverse" gives both: rest falls at scrollTop 0 while sitting visually
   at the end. Chrome computes it that way. Safari does NOT: with
   "column-reverse" the scroll timeline measures from the opposite end to
   "scrollTop". Measured at scrollTop 0 with a range of 300:
     column-reverse         -> --jyB 96.2 of 110  (wrong, full deflection)
     column, first spacer   -> --jyB 96.2, scrollTop 300
     column, last spacer    -> --jyB 0            (right, but the downward slack
                                                   eats forward movement)
   The third arrangement satisfies (1) and breaks (2); the second does the
   reverse. Without a third scroll axis there is no way out, so in Safari the
   backward axis is dead: the container does not scroll at all, so it neither
   deflects nor swallows gestures. Forward and turning work fully. */
.noBack { display: none; margin:.4rem 0 0; font:12px ui-monospace, Menlo, monospace;
           color: var(--dim) }
@supports (font: -apple-system-body) {
  /* CLIP, not HIDDEN. "hidden" still creates a scroll container — merely one
     the user cannot scroll — and it can still swallow the wheel, which is
     exactly what we are avoiding. "clip" creates no container at all, so the
     gesture passes to the outer one, the backward timeline stops existing and
     --jyB returns to zero. */
  .back { overflow: clip }
  .rdb { --mB: 0 }
  .noBack { display: block }
}
${TURN_STEPS.map((_, j) => `.turnP${j} { animation:turnRk${j} ${SPAN}s linear 1 paused both }
.turnL${j} { animation:turnLk${j} ${SPAN}s linear 1 paused both }`).join('\n')}
${TURN_STEPS.map((_, j) =>
`@container wejscie style(--tR${j}: 1) { .turnP${j} { animation-play-state:running } }
@container wejscie style(--tL${j}: 1) { .turnL${j} { animation-play-state:running } }`).join('\n')}

/* The spawn heading is ${cssH0}° = 90 - the wolf angle (${angle}°). */
.heading { --h: calc(${cssH0} + ${TURN_STEPS.map((_, j) => `var(--hR${j}) - var(--hL${j})`).join(' + ')});
        --hw: mod(calc(var(--h) + 36000), 360);
        /* to NEAREST, not down: rounding down shifts the walking direction by
           half a bucket systematically, and it shows up as walking sideways. */
        --bucket: mod(round(nearest, calc(var(--hw) / ${BUCKET_DEG}), 1), ${BUCKETS});
        container: heading / normal }
.ak { display:block }`);

  for (let k = 0; k < BUCKETS; k++) {
    MOVE_STEPS.forEach((_, j) =>
      w.push(`.f${k}_${j} { animation:kf${k}_${j} ${SPAN}s linear 1 paused both }`));
    w.push(`.b${k} { animation:kb${k} ${SPAN}s linear 1 paused both }`);
  }
  for (let k = 0; k < BUCKETS; k++) MOVE_STEPS.forEach((_, j) => {
    // The gate carries no collision condition, and that is deliberate: the
    // stick's range CLAMP handles that, and it acts immediately. Adding a
    // loop-based gate here would only hurt — a loop releases late, so after
    // turning away from a wall forward movement would stay blocked for a
    // moment.
    w.push(`@container heading style(--bucket: ${k}) and style(--mF${j}: 1) { .f${k}_${j} { animation-play-state:running } }`);
  });
  for (let k = 0; k < BUCKETS; k++)
    w.push(`@container heading style(--bucket: ${k}) and style(--mB: 1) { .b${k} { animation-play-state:running } }`);

  // The path integral. It holds only SUMS, so the order of the steps cannot be
  // recovered from it — which is why collision CANNOT be a correction computed
  // further down (median reconstruction error: 5.2 tiles). It has to brake in
  // real time, i.e. from above, through the scroll range.
  {
    const sx = [], sz = [];
    for (let k = 0; k < BUCKETS; k++) {
      const netMove = MOVE_STEPS.map((_, j) => `var(--f${k}_${j})`).join(' + ') + ` - var(--b${k})`;
      sx.push(`(${netMove}) * ${f6(sinB(k))}`);
      sz.push(`(${netMove}) * ${f6(-cosB(k))}`);
    }
    w.push(`
/* Player position = spawn + the path integral, split across 16 heading buckets. */
.sum { --px: calc(${gx} + ${sx.join(' + ')});
        --pz: calc(${gz} + ${sz.join(' + ')}) }
/* THE WALKING DIRECTION as a pair of numbers. The probe MUST look along this
   and not along the continuous heading: the player walks along the centre of a
   bucket, so the divergence would reach 11.25°, i.e. 17 px sideways against a
   89 px margin — exactly enough to clip a corner. */
${Array.from({ length: BUCKETS }, (_, k) =>
  `@container heading style(--bucket: ${k}) { .sum { --dx: ${f6(sinB(k))}; --dz: ${f6(-cosB(k))} } }`).join('\n')}`);
  }
  w.push(`
/* The camera stands ${f6(FOCAL)} px BEHIND the player, along the view direction
   (WL_DRAW.C:1307). */
.position { translate:
  calc((var(--px) - ${f6(FOCAL)} * sin(var(--h) * 1deg)) * -1px) 0
  calc((var(--pz) + ${f6(FOCAL)} * cos(var(--h) * 1deg)) * -1px) }`);
  return w.join('\n');
}


// ============================================================ DOORS
// The range from which a door may be used. A tile and a half — enough to open
// one from a normal approach distance, not from the far end of a corridor.
const DOOR_REACH = 96;
const doorAt = new Map();
doorLeaves.forEach((D, n) => doorAt.set(D.x + ',' + D.y, n));

// ============================================================ REGIONS
// A stand-in for line of sight, computed ONCE AT BUILD TIME instead of being
// raycast. Casting a ray from an enemy to the player would mean sampling tiles
// along a segment, and every sample is another level of the tree — thirty-seven
// enemies times a handful of samples is not affordable. The level is static,
// though, so it is flooded into regions separated by walls AND DOORS, and the
// only question asked is whether the player stands in the same region as the
// enemy. In Wolfenstein's blocky interiors that is a very good approximation
// and, more importantly, it never lets anyone shoot through a wall.
const blocksSight = (x, y) => solidTile(x, y) || doorAt.has(x + ',' + y);
const REGION = (() => {
  const r = Array.from({ length: 64 }, () => new Array(64).fill(-1));
  let nr = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (blocksSight(x, y) || r[y][x] >= 0) continue;
    const q = [[x, y]]; r[y][x] = nr;
    while (q.length) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = cx + dx, b = cy + dy;
        if (a >= 0 && a < 64 && b >= 0 && b < 64 && !blocksSight(a, b) && r[b][a] < 0) {
          r[b][a] = nr; q.push([a, b]);
        }
      }
    }
    nr++;
  }
  return r;
})();

// The opening properties are registered WHENEVER there are leaves in the scene,
// including on the early stages where nothing animates them. Without the
// registration var(--otw0) in a panel's background is unsubstitutable and the
// whole declaration is dropped in silence.
const doorPropsCss = () => doorLeaves.map((_, n) =>
  `@property --open${n} { syntax: '<number>'; initial-value: 0; inherits: true }`).join('\n');
// The lift switch face exists on every stage and refers to --lift on every one
// of them; without the registration calc() will not compute and the entire
// background declaration is dropped in silence, leaving the switch showing a
// corner of the atlas.
const liftPropsCss = () => lifts.map(W =>
  `@property --lift${W.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`).join('\n')
  + '\n' + pushWalls.map(P =>
  `@property --push${P.n} { syntax: '<number>'; initial-value: 0; inherits: true }`).join('\n');

function doorsCss() {
  const w = [];
  doorLeaves.forEach((_, n) => {
    w.push(`@property --fullyOpen${n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --useNear${n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --doorState${n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  });
  // Two sets of keyframes with IDENTICAL content and different names. An
  // animation restarts when its NAME changes, so alternating A/B re-triggers
  // it — and without that a checkbox would open a door exactly once.
  const p1 = f6(DOOR_TIME / DOOR_CYCLE * 100);
  const p2 = f6((DOOR_TIME + DOOR_HOLD) / DOOR_CYCLE * 100);
  doorLeaves.forEach((_, n) => {
    for (const w2 of ['A', 'B'])
      w.push(`@keyframes cycle${w2}${n} { 0% { --open${n}: 0 } ${p1}% { --open${n}: 1 } ` +
             `${p2}% { --open${n}: 1 } 100% { --open${n}: 0 } }`);
  });

  // The animation slots live on a SHARED element, .stateAnim, together with
  // enemy deaths — see statesCss(). It has to be one element, because
  // animation-name is a single list: a second rule would replace the first
  // rather than extend it. And it has to be a SIBLING of the controls, because
  // `~` does not reach into descendants.
  doorLeaves.forEach((_, n) => {
    w.push(`#dr${n}a:checked ~ .stateAnim { --doorSlot${n}: cycleA${n}; --doorState${n}: 1 }`);
    w.push(`#dr${n}b:checked ~ .stateAnim { --doorSlot${n}: cycleB${n}; --doorState${n}: 2 }`);
  });

  // The tile stops being solid ONLY at full opening (WL_ACT1.C: actorat = 0
  // happens in dr_open). The animated value is read on a DESCENDANT.
  w.push(`.stateRead { ${doorLeaves.map((_, n) =>
    `--fullyOpen${n}: clamp(0, round(down, var(--open${n}), 1), 1)`).join(';\n              ')} }`);

  // Proximity measured in TILES, not pixels. The probe under the player already
  // reports its tile, so an integer comparison suffices — twenty-two divisions
  // with abs() and round() per frame cost noticeably more.
  // clamp(0, 2-|d|, 1) is 1 exactly for |d| <= 1, i.e. for an adjacent tile.
  const near = (os, k) => `clamp(0, calc(2 - abs(calc(var(${os}) - ${k}))), 1)`;
  // Proximity alone is not enough now that the control sits on the crosshair:
  // standing with your back to a door, you do not want to open it. The dot
  // product of the "towards the door" vector with the view vector (which the
  // probes already compute as --dx/--dz) is 1 for the tile straight ahead, 0.71
  // diagonally and negative behind you; +0.5 before rounding down turns that
  // into a bit.
  w.push(`@property --doorNear { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  const ahead = (D) => `clamp(0, round(down, calc((${D.x} - var(--sc0x)) * var(--dx)` +
                       ` + (${D.y} - var(--sc0y)) * var(--dz) + 0.5), 1), 1)`;
  w.push(`.probeOR { ${doorLeaves.map((D, n) =>
    `--useNear${n}: calc(${near('--sc0x', D.x)} * ${near('--sc0y', D.y)} * ${ahead(D)})`)
    .join(';\n           ')};
           --doorNear: clamp(0, calc(${doorLeaves.map((_, n) => `var(--useNear${n})`).join(' + ')}), 1) }`);

  // The "use" control sits ON THE CROSSHAIR. All 22 pairs of labels lie on top
  // of one another in the middle of the screen; the only visible one belongs to
  // the door you are standing at and looking towards, and only the half of the
  // pair that switches to the opposite state.
  // This is NOT the same as shooting: there, the cursor hitting the sprite does
  // the addressing; here the proximity-and-facing condition selects the control
  // and the crosshair is merely the fixed place the selected one lands in.
  w.push(`
/* The door control lies ON THE CROSSHAIR, like a shot label on an enemy: walk
   up, the crosshair lights, click. all:unset MUST come FIRST — placed after
   position it would wipe that out along with inset, and the label would fall
   back to static layout. Its z-index is above the stick, so the click does not
   even need a hole in it; the trigger has pointer-events:none because it sits
   in exactly this spot. */
.use { all:unset; display:none; position:absolute; left:50%; top:50%;
        width:20px; height:20px; margin:-10px; border-radius:50%; z-index:5;
        cursor:pointer }
.frame > .trigger { pointer-events:none }
/* .frame > .trigger, not bare .trigger: the button has autofocus, so .trigger:focus
   (0,2,0) would beat a single-class rule and the crosshair would never turn
   yellow. */
@container koliz style(--doorNear: 1) { .frame > .trigger {
  border:2px solid #f0c000; background:#f0c00022 } }
.boxesD { position:absolute; opacity:0; pointer-events:none; width:0; height:0 }`);
  // States 0 (rest) and 2 (B) show label A; state 1 (A) shows B. They lie on
  // top of each other, so the player keeps clicking the same spot.
  doorLeaves.forEach((_, n) => {
    for (const pausedSlots of [0, 2])
      w.push(`@container koliz style(--useNear${n}: 1) and style(--doorState${n}: ${pausedSlots}) { .u${n}a { display:block } }`);
    w.push(`@container koliz style(--useNear${n}: 1) and style(--doorState${n}: 1) { .u${n}b { display:block } }`);
  });
  return w.join('\n');
}

// One element for EVERY cycle in the game: 22 doors and 37 enemy deaths.
// `animation-name` is a single list, so two rules on two elements will not do —
// the second would replace the first. And the element has to be a sibling of
// the controls, because the `~` combinator does not descend.
function statesCss() {
  const slots = [];
  if (DOORS) doorLeaves.forEach((_, n) =>
    slots.push({ zm: `--doorSlot${n}`, czas: f6(DOOR_CYCLE) + 's', step: 'linear' }));
  if (ENEMIES) alive.forEach(e =>
    slots.push({ zm: `--dieSlot${e.n}`, czas: f6(DEATH_TIME) + 's', step: 'steps(3, end)' }));
  if (SECRETS) pushWalls.forEach(P =>
    slots.push({ zm: `--pushSlot${P.n}`, czas: f6(PUSH_TIME) + 's', step: 'linear' }));
  if (!slots.length) return '';
  return `.stateAnim { ${slots.map(g => `${g.zm}: none`).join('; ')};
  animation-name: ${slots.map(g => `var(${g.zm})`).join(', ')};
  animation-duration: ${slots.map(g => g.czas).join(', ')};
  animation-timing-function: ${slots.map(g => g.step).join(', ')};
  animation-fill-mode: ${slots.map(() => 'forwards').join(', ')} }`;
}

function doorsHtml() {
  return doorLeaves.map((_, n) =>
    `<input class="boxesD" type="radio" name="dr${n}" id="dr${n}0" checked autocomplete="off">` +
    `<input class="boxesD" type="radio" name="dr${n}" id="dr${n}a" autocomplete="off">` +
    `<input class="boxesD" type="radio" name="dr${n}" id="dr${n}b" autocomplete="off">`).join('\n');
}

function useLabelsHtml() {
  return doorLeaves.map((_, n) =>
    `<label class="use u${n}a" for="dr${n}a"></label>` +
    `<label class="use u${n}b" for="dr${n}b"></label>`).join('');
}

// ============================================================ ENEMIES
// E1M1 holds 32 guards, 5 dogs and one dead guard (decoration).
// Enemies DO NOT WALK — the original's `SelectChaseDir` needs per-actor memory,
// and CSS does not write to the DOM. They stand, wake up and shoot.
//
// A sprite is a BILLBOARD: counter-rotated by the camera heading, so it faces
// the camera from every angle. One declaration.
//
// THE ROTATION FRAME is computed exactly as in the original
// (WL_DRAW.C/CalcRotate):
//   angle = (direction from enemy to player) - (direction the enemy faces) + 22.5°
//   frame = floor(angle / 45) mod 8
// Angles in wolf convention: 0 = east, increasing counter-clockwise. Our Z is
// wolf's y (running south), hence atan2(ez - pz, px - ex).
const DIR_ANGLE = [0, 90, 180, 270];        // dirangle[]: east, north, west, south
const SPRITE_ROW = M.sprites.index;
// A guard's death: three frames of 15 tics, then the corpse (WL_ACT2.C:441-443,
// 70 tics per second). Columns in the "action" row: 3,4,5 are the fall, 6 is the
// corpse.
const DEATH_FRAME = 15 / 70;
const DEATH_TIME = 3 * DEATH_FRAME;
const COL_FALL = 3, COL_CORPSE = 6;
// Waking: the original gives a guard a 180° cone along its axis plus 1.5 tiles
// unconditionally (WL_STATE.C/CheckSight). Stage 6 has no line of sight —
// casting a ray up the chain is not feasible — so it takes a 6-tile square and
// the front three of the eight rotation octants. That is an approximation and
// it is described as one. Stage 9 replaces it with the real thing.
const WAKE_RANGE = 6 * U;
// A shot: three states of 20 tics (WL_ACT2.C/s_grdshoot1..3).
const SHOT_CYCLE = 60 / 70;
// Damage. The original rolls 1..255 and scales it by distance; with no
// randomness available this is a constant rate instead. A hundred points at
// twelve per second gave eight seconds of life — not enough to even aim, so the
// rate went a hundred times slower, then back up five times when the game got
// too easy. The animation's duration FOLLOWS from the rate: it has to reach a
// full hundred points, or the accumulator reaches the end of its range and the
// player becomes immortal.
const DAMAGE_RATE = 0.6;
const HEALTH_FULL = 100;
// THE ACCUMULATOR HAS TO OUTRUN EVERY MEDKIT ON THE LEVEL, and getting that
// wrong made the player immortal. Health is `100 - damage + healing`, and the
// damage accumulator is a single animation: once it reaches the end of its
// range it stops, and with `forwards` it holds there. Sized to exactly 100, the
// most damage anyone can ever take is 100 — so after collecting 25 points of
// medkits, health floors at 100 - 100 + 25 = 25 and nothing can push it lower.
// Measured before the fix: healing 25, --dmg 100, health stuck at 25, death
// never triggered.
// The range therefore has to cover 100 plus ALL the healing lying on the map
// (283 on E1M1), and the duration follows from it so that the rate per second
// is unchanged. Computed lazily because the loot list is built further down.
const woundRange = () => HEALTH_FULL + loot.reduce((a, s) => a + (s.health || 0), 0);
const woundTime = () => woundRange() / DAMAGE_RATE;
const alive = M.enemies.map((e, n) => ({ ...e, n }))
                       .filter(e => e.kind === 'guard' || e.kind === 'dog');
// Each enemy's region, and the list of regions that need testing at all.
alive.forEach(e => {
  e.region = REGION[e.y][e.x];
  if (e.region < 0) throw new Error(`enemy ${e.n} stands on a blocking tile (${e.x},${e.y})`);
});
const REGIONS = [...new Set(alive.map(e => e.region))];
const regionSlot = new Map(REGIONS.map((r, i) => [r, i]));

// The region number hangs off the EXISTING probe under the player: `sc0`
// already computes the player's tile and picks the mask quarter. Rather than a
// bitmask PER REGION (fifteen regions times four quarters is 60 inherited
// properties dragged down the whole chain on every heading change), the region
// NUMBER is packed into nibbles: four tiles to a number, sixteen numbers to a
// row. Nineteen properties instead of seventy-five, and testing an enemy is one
// comparison.
const NIBBLE = 4, NO_REGION = 15;
if (REGIONS.length > NO_REGION) throw new Error('too many regions to fit in a nibble');
function regionsCss() {
  const w = [];
  for (let j = 0; j < 64 / NIBBLE; j++)
    w.push(`@property --regionNib${j} { syntax: '<number>'; initial-value: 0; inherits: true }`);
  w.push(`@property --regionNib { syntax: '<number>'; initial-value: 0; inherits: true }`);
  w.push(`@property --regionNibIdx { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  w.push(`@property --regionId { syntax: '<integer>'; initial-value: ${NO_REGION}; inherits: true }`);
  w.push(`.sc0 { --regionNibIdx: round(down, calc(var(--sc0x) / ${NIBBLE}), 1) }`);
  for (let y = 0; y < 64; y++) {
    const decls = [];
    for (let j = 0; j < 64 / NIBBLE; j++) {
      let v = 0;
      for (let k = 0; k < NIBBLE; k++) {
        const r = REGION[y][j * NIBBLE + k];
        const id = regionSlot.has(r) ? regionSlot.get(r) : NO_REGION;
        v |= id << (4 * k);
      }
      if (v) decls.push(`--regionNib${j}: ${v}`);
    }
    if (decls.length) w.push(`@container sc0 style(--sc0y: ${y}) { .sc0w { ${decls.join('; ')} } }`);
  }
  for (let j = 0; j < 64 / NIBBLE; j++)
    w.push(`@container sc0w style(--regionNibIdx: ${j}) { .sc0b { --regionNib: var(--regionNib${j}) } }`);
  w.push(`.sc0b { --regionId: mod(round(down, calc(var(--regionNib)` +
         ` / pow(2, calc(4 * mod(var(--sc0x), ${NIBBLE}))))), 16) }`);
  return w.join('\n');
}

// ============================================================ LINE OF SIGHT
// The region approximation had one flaw you can feel while playing: an enemy
// around the corner of the same room shoots, with no way of seeing you. A real
// ray looked unaffordable, because sampling tiles along a segment is a loop and
// every sample is another level of the tree — thirty-seven enemies times a
// handful of samples cannot be bought.
//
// But THE ENEMY STANDS STILL and the map does not change. The set of tiles it
// can be seen from is therefore CONSTANT, and is computed once, at build time.
// What is left for CSS is reading one bit — exactly the same machinery as the
// tile and region masks.
//
// The mask covers only a 13x13 window around the enemy (a 6-tile radius),
// because beyond that the distance gate cuts in anyway. Thirteen bits fit in
// one number, so a map row costs about eight declarations rather than a hundred
// and fifty.
const SIGHT_R = 6;
const visibleFrom = (() => {
  const blocksSight = (x, y) => solidTile(x, y) || doorAt.has(x + ',' + y);
  const canSee = (ax, ay, bx, by) => {
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 8;
    if (!n) return true;
    for (let i = 1; i < n; i++) {
      const x = ax + 0.5 + (bx - ax) * i / n, y = ay + 0.5 + (by - ay) * i / n;
      const tx = Math.floor(x), ty = Math.floor(y);
      if ((tx === ax && ty === ay) || (tx === bx && ty === by)) continue;
      if (blocksSight(tx, ty)) return false;
    }
    return true;
  };
  const m = new Map();
  for (const e of alive) {
    const x0 = e.x - SIGHT_R;
    const rowsOf = new Map();
    for (let dy = -SIGHT_R; dy <= SIGHT_R; dy++) {
      const ty = e.y + dy; if (ty < 0 || ty > 63) continue;
      let bits = 0;
      for (let dx = -SIGHT_R; dx <= SIGHT_R; dx++) {
        const tx = e.x + dx; if (tx < 0 || tx > 63 || blocksSight(tx, ty)) continue;
        if (canSee(e.x, e.y, tx, ty)) bits |= 1 << (tx - x0);
      }
      if (bits) rowsOf.set(ty, bits);
    }
    m.set(e.n, { x0, rowsOf });
  }
  return m;
})();

function sightCss() {
  const w = [];
  alive.forEach(e => {
    w.push(`@property --losMask${e.n} { syntax: '<number>'; initial-value: 0; inherits: true }`);
    w.push(`@property --los${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  });
  for (let y = 0; y < 64; y++) {
    const decls = [];
    alive.forEach(e => {
      const b = visibleFrom.get(e.n).rowsOf.get(y);
      if (b) decls.push(`--losMask${e.n}: ${b}`);
    });
    if (decls.length) w.push(`@container sc0 style(--sc0y: ${y}) { .sc0w { ${decls.join('; ')} } }`);
  }
  // The exponent is clamped to 0..12: outside the window the mask is zero
  // anyway and the distance gate cuts those tiles independently — the clamp only
  // guards against a negative power, which would give a fraction and garbage
  // out of the remainder.
  w.push(`.sc0b { ${alive.map(e => {
    const x0 = visibleFrom.get(e.n).x0;
    return `--los${e.n}: mod(round(down, calc(var(--losMask${e.n})` +
           ` / pow(2, clamp(0, calc(var(--sc0x) - ${x0}), 12)))), 2)`;
  }).join(';\n         ')} }`);
  return w.join('\n');
}

function enemiesCss() {
  const w = [SIGHT ? sightCss() : regionsCss()];
  alive.forEach(e => {
    w.push(`@property --facing${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --falling${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --slain${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --spriteX${e.n} { syntax: '<number>'; initial-value: 0; inherits: true }`);
    w.push(`@property --spriteY${e.n} { syntax: '<number>'; initial-value: 0; inherits: true }`);
    w.push(`@property --awake${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --sees${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --inRange${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@keyframes fall${e.n} { from { --falling${e.n}: 0 } to { --falling${e.n}: 3 } }`);
    // The waking latch: the animation starts paused, a container query releases
    // it, and `forwards` holds the one forever after — including after being
    // paused again, because a finished animation does not undo its fill.
    w.push(`@keyframes wake${e.n} { from { --awake${e.n}: 0 } to { --awake${e.n}: 1 } }`);
  });
  w.push(`@property --beat { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  w.push(`@property --underFire { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  w.push(`@property --playerDead { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  w.push(`@keyframes beat { from { --beat: 0 } to { --beat: 3 } }`);
  w.push(`@keyframes wound { from { --dmg: 0 } to { --dmg: ${woundRange()} } }`);
  w.push(`@keyframes pulse { 0%, 100% { opacity: 0 } 4% { opacity: .3 } 16% { opacity: 0 } }`);

  w.push(`
.w { position:absolute; left:0; top:0; width:${U}px; height:${U}px; margin:${-U / 2}px;
     rotate:y var(--billboardTurn);
     background-image:url(wolf-sprites.png); background-repeat:no-repeat;
     background-size:${M.sprites.cols * 64}px ${M.sprites.rows * 64}px;
     image-rendering:pixelated }
/* The crosshair. The label lies ON the sprite, so the addressing happens by
   itself: you hit whoever is in your sights. Without that, the enemy would have
   to be selected by a computed value, and CSS cannot do that (see doors). */
.shot { position:absolute; inset:0; cursor:crosshair }
.boxesW { position:absolute; opacity:0; pointer-events:none; width:0; height:0 }

/* A HOLE IN THE STICK FOR THE CROSSHAIR. clip-path clips the hit region too, so
   a click in the middle of the screen bypasses the scrolling layer and reaches
   the scene. z-index does not help here: .screen has a scale, so it creates a
   stacking context and the whole scene is trapped inside it, under the stick. */
.stick { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,
          calc(50% - 26px) calc(50% - 26px), calc(50% - 26px) calc(50% + 26px),
          calc(50% + 26px) calc(50% + 26px), calc(50% + 26px) calc(50% - 26px),
          calc(50% - 26px) calc(50% - 26px)) }
`);

  alive.forEach(e => {
    if (!WEAPONS || e.kind === 'dog') {
      w.push(`#z${e.n}:checked ~ .stateAnim { --dieSlot${e.n}: fall${e.n}; --slain${e.n}: 1${
        WEAPONS ? `; --dogShot${e.n}: 1` : ''} }`);
      // A dog has 1 hit point, so the knife kills it in one stroke just as a
      // bullet does — but it MUST be a different checkbox, see --shots below.
      if (WEAPONS) {
        w.push(`#kz${e.n}:checked ~ .stateAnim { --dieSlot${e.n}: fall${e.n}; --slain${e.n}: 1;` +
               ` --dogKnife${e.n}: 1 }`);
        for (const f of ['dogShot', 'dogKnife'])
          w.push(`@property --${f}${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
      }
      return;
    }
    // A guard has 25 hit points, and the pistol hits harder the closer it is:
    // rnd/4 up close, rnd/6 further out, and past four tiles a chance to miss
    // (GunAttack, WL_AGENT.C:1228-1240). With no randomness available that
    // becomes a HIT THRESHOLD by distance: one shot up close, two at medium
    // range, three far away. Hits are counted by CHECKBOXES rather than a radio
    // group — a group would clear the previous state, and that state is needed
    // for counting ammunition.
    w.push(`#c${e.n}1:checked ~ .stateAnim { --c1${e.n}: 1 }`);
    w.push(`#c${e.n}2:checked ~ .stateAnim { --c2${e.n}: 1 }`);
    w.push(`#c${e.n}d:checked ~ .stateAnim { --dieSlot${e.n}: fall${e.n}; --slain${e.n}: 1; --gunKill${e.n}: 1 }`);
    // THE KNIFE HAS ITS OWN CHECKBOXES, and that is not redundancy. Ammunition
    // is `start + collected - number of clicks`, and a knife stroke costs no
    // bullet. If the knife clicked the same boxes, the counter would overshoot
    // downwards and a clip picked up later would go towards paying off the debt
    // instead of into the weapon — once you switched to the knife you could
    // never get back to shooting.
    w.push(`#k${e.n}1:checked ~ .stateAnim { --n1${e.n}: 1 }`);
    w.push(`#k${e.n}2:checked ~ .stateAnim { --n2${e.n}: 1 }`);
    w.push(`#k${e.n}d:checked ~ .stateAnim { --dieSlot${e.n}: fall${e.n}; --slain${e.n}: 1;` +
           ` --knifeKill${e.n}: 1 }`);
    for (const c of ['c1', 'c2', 'gunKill', 'n1', 'n2', 'knifeKill'])
      w.push(`@property --${c}${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  });

  // Angle to the player, and the frame. A dead enemy no longer turns to follow
  // — it runs through three falling frames and stays as a corpse.
  const expr = [];
  const near = (zm, v) =>
    `(1 - clamp(0, round(down, calc(abs(var(${zm}) - ${v}) / ${WAKE_RANGE}), 1), 1))`;
  alive.forEach(e => {
    const ex = e.x * U + U / 2, ez = e.y * U + U / 2;
    // The +800 before the remainder is not decoration. Safari gets `mod()`
    // wrong at exactly the NEGATIVE INTEGER MULTIPLES of the divisor: it
    // returns the divisor instead of zero. Measured: mod(-9,8)=7 and
    // mod(-7,8)=1 are right, but mod(-8,8)=8 and mod(-5,5)=5. The angle to the
    // player is sometimes exactly -8, so the rotation frame came out as 8 of
    // eight available (0..7) and the sprite showed a column from outside its
    // row. 800 is a multiple of eight, so it changes nothing in Chrome, and the
    // argument never goes below zero.
    expr.push(`--facing${e.n}: mod(calc(round(down, calc((atan2(${ez} - var(--pz), var(--px) - ${ex}) / 1deg` +
             ` - ${DIR_ANGLE[e.dir]} + 22.5) / 45), 1) + 800), 8)`);
    // Waking condition: near, facing, and still alive. Frames 7, 0 and 1 are
    // the front 135°, and `mod(kl + 1, 8) <= 2` reduces that test to one
    // expression instead of three literal comparisons.
    expr.push(`--inRange${e.n}: calc(${near('--px', ex)} * ${near('--pz', ez)}` +
             ` * ${SIGHT ? `var(--los${e.n})`
                : `(1 - clamp(0, abs(calc(var(--regionId) - ${regionSlot.get(e.region)})), 1))`})`);
    expr.push(`--sees${e.n}: calc(var(--inRange${e.n})` +
             ` * clamp(0, calc(3 - mod(calc(var(--facing${e.n}) + 1), 8)), 1)` +
             ` * (1 - var(--slain${e.n})))`);
  });
  if (expr.length) w.push(`.probeOR { ${expr.join(';\n           ')} }`);

  // ---- the waking level. It MUST sit below the probes, because the condition
  // is computed from the player's position and the result then has to be read
  // when the frame is chosen.
  // The animation names stay fixed; ONLY the play state is switched — that is a
  // list too, and with fixed names there is no need for `none` slots.
  const pausedSlots = alive.map(e => `--wakeSlot${e.n}: paused`).join('; ');
  w.push(`.waker { ${pausedSlots};
  animation-name: ${alive.map(e => `wake${e.n}`).join(', ')}, beat;
  animation-duration: ${alive.map(() => '1ms').join(', ')}, ${f6(SHOT_CYCLE)}s;
  animation-timing-function: ${alive.map(() => 'steps(1, end)').join(', ')}, steps(3);
  animation-iteration-count: ${alive.map(() => '1').join(', ')}, infinite;
  animation-fill-mode: ${alive.map(() => 'forwards').join(', ')}, none;
  animation-play-state: ${alive.map(e => `var(--wakeSlot${e.n})`).join(', ')}, running }`);
  alive.forEach(e => w.push(
    `@container koliz style(--sees${e.n}: 1) { .waker { --wakeSlot${e.n}: running } }`));

  // ---- choosing the frame, now knowing whether the enemy is awake.
  // A dead one runs through three falling frames and stays as a corpse. An
  // awakened guard turns to face you and shoots; a dog only turns, because
  // VSWAP holds no attack frames for it other than the leap, which is not
  // extracted.
  const expr2 = [];
  const AKCJA = SPRITE_ROW['guard.action'].row;
  alive.forEach(e => {
    const wier = SPRITE_ROW[e.kind + '.idle'].row;
    const dog = e.kind === 'dog';
    const colAwake = dog ? '0' : 'var(--beat)';
    const rowAwake = dog ? wier : AKCJA;
    expr2.push(`--spriteX${e.n}: calc((1 - var(--slain${e.n})) * ((1 - var(--awake${e.n})) * var(--facing${e.n})` +
              ` + var(--awake${e.n}) * ${colAwake}) + var(--slain${e.n}) * (${COL_FALL} + var(--falling${e.n})))`);
    expr2.push(`--spriteY${e.n}: calc((1 - var(--slain${e.n})) * ((1 - var(--awake${e.n})) * ${wier}` +
              ` + var(--awake${e.n}) * ${rowAwake}) + var(--slain${e.n}) * ${AKCJA})`);
  });
  // THE DISTANCE BAND AND THE HIT THRESHOLD ARE COMPUTED HERE, NOT ON .probeOR,
  // and the move was forced by the knife. The threshold now depends on whether
  // the magazine is empty, and that is only known below the loot (collected
  // ammunition) and below the shot count — i.e. lower than the probes. A
  // container query sees only the style of the CONTAINER ITSELF, so the labels
  // have to query the element on which the threshold comes into being.
  // Hence .enemyFrames: it is already the `walka` container and --outOfAmmo already
  // lives here.
  if (WEAPONS) alive.forEach(e => {
    // Band: 2 up close (<2 tiles), 1 at medium range (<4), 0 far. Distance as
    // in the original — Chebyshev over tiles, not Euclidean.
    const dist = `max(abs(calc(var(--sc0x) - ${e.x})), abs(calc(var(--sc0y) - ${e.y})))`;
    expr2.push(`--band${e.n}: clamp(0, calc(2 - round(down, calc(${dist} / 2), 1)), 2)`);
    // The knife reaches 0x18000, a tile and a half (KnifeAttack) — here, the
    // closest band. Out of ammunition and further than that: nothing to strike
    // with, and the labels disappear.
    expr2.push(`--knife${e.n}: calc(var(--outOfAmmo) * clamp(0, calc(var(--band${e.n}) - 1), 1))`);
    if (e.kind === 'dog') return;
    expr2.push(`--hits${e.n}: calc(var(--c1${e.n}) + var(--c2${e.n})` +
              ` + var(--n1${e.n}) + var(--n2${e.n}))`);
    // Two branches, selected by multiplying with --outOfAmmo. Pistol/machine
    // gun: hits plus band, threshold 1. Knife: rnd/16 against 25 hit points is
    // three to four strokes, so THREE clicks and only from close up.
    expr2.push(`--kill${e.n}: clamp(0, calc(` +
      `(1 - var(--outOfAmmo)) * (var(--hits${e.n}) + var(--band${e.n})` +
      ` + var(--machinegun) * ${MG_BURST} - 1)` +
      ` + var(--outOfAmmo) * (var(--hits${e.n})` +
      ` + clamp(0, calc(var(--band${e.n}) - 1), 1) - 2)), 1)`);
  });
  // Is anyone shooting at me — a sum over all of them, clipped to a bit. Dogs
  // do not count, because they bite from close range and biting is not modelled.
  // The condition is the CURRENT distance, not the latch alone: waking is
  // permanent, but the shooting stops once you leave the range. Without that,
  // one awakened guard bled the player out across the whole level, from the far
  // side of the map.
  expr2.push(`--underFire: clamp(0, calc(` +
    alive.filter(e => e.kind !== 'dog')
        .map(e => `var(--awake${e.n}) * var(--inRange${e.n}) * (1 - var(--slain${e.n}))`).join(' + ') + `), 1)`);
  w.push(`.enemyFrames { ${expr2.join(';\n         ')}; container: walka / normal }`);

  // ---- damage. A paused accumulator, released by a query on incoming fire;
  // pausing stops it where it got to, so the wound does not heal.
  w.push(`
.blood { --dmg: 0; animation: wound ${f6(woundTime())}s linear paused forwards;
        --playerDead: clamp(0, round(down, calc((var(--dmg) - var(--healing)) / ${HEALTH_FULL}), 1), 1);
        container: life / normal }
@container walka style(--underFire: 1) { .blood { animation-play-state: running } }
.flash { position:absolute; inset:0; background:#f00; opacity:0; pointer-events:none }
@container walka style(--underFire: 1) { .flash { animation: pulse ${f6(SHOT_CYCLE)}s infinite } }
/* The death curtain is not just a picture: it covers the stick, so the stick
   snaps back to centre and the player really does stop walking. Its appearance
   lives in screensCss. */`);

  M.enemies.forEach((e, n) => {
    const ex = e.x * U + U / 2, ez = e.y * U + U / 2;
    if (e.kind === 'other') return;
    if (e.kind === 'corpse') {
      const g = SPRITE_ROW['guard.action'];
      w.push(`.w${n} { translate:${ex}px 0 ${ez}px; pointer-events:none;` +
             `background-position:${-COL_CORPSE * 64}px ${-g.row * 64}px }`);
    } else {
      w.push(`.w${n} { translate:${ex}px 0 ${ez}px;` +
             `background-position:calc(var(--spriteX${n}) * -64px) calc(var(--spriteY${n}) * -64px) }`);
    }
  });

  if (WEAPONS) {
    const guards = alive.filter(e => e.kind !== 'dog');
    const dogs = alive.filter(e => e.kind === 'dog');
    alive.forEach(e => {
      w.push(`@property --band${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
      w.push(`@property --knife${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    });
    guards.forEach(e => {
      w.push(`@property --kill${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
      w.push(`@property --hits${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    });
    // EXACTLY ONE label per enemy is visible, and the conditions are DISJOINT:
    // --hits has one value, so "first hit" and "second hit" cannot both light
    // up. That removed an old specificity trick — an id-bearing rule used to
    // switch off the earlier label, because both could match at once.
    //
    // A DEAD ENEMY IS ONE MORE CONDITION, NOT TWO MORE RULES, and that matters
    // more than it looks. Hiding a dead enemy's labels used to be
    // `#c{n}d:checked ~ .stateAnim .target{n} { display:none }`, a pair per
    // enemy. With selector statistics switched on, those 74 rules measured
    // 150 ms out of 280 ms of all selector matching — HALF of it — because each
    // one walks the entire subtree under .stateAnim looking for a class.
    // Folding the same fact into the container queries that already gate the
    // labels costs nothing: --slain{n} is right there in the container, and a
    // plain class match replaces a descendant search.
    w.push(`.a1w, .a2w, .kw, .b1w, .b2w, .bkw, .dw, .dnw { display:none }`);
    guards.forEach(e => {
      const P = `@container walka`, alive = ` and style(--slain${e.n}: 0)`;
      w.push(`${P} style(--outOfAmmo: 0)${alive} and style(--kill${e.n}: 0) and style(--hits${e.n}: 0) { .a1w${e.n} { display:block } }`);
      w.push(`${P} style(--outOfAmmo: 0)${alive} and style(--kill${e.n}: 0) and style(--hits${e.n}: 1) { .a2w${e.n} { display:block } }`);
      w.push(`${P} style(--outOfAmmo: 0)${alive} and style(--kill${e.n}: 1) { .kw${e.n} { display:block } }`);
      w.push(`${P} style(--knife${e.n}: 1)${alive} and style(--kill${e.n}: 0) and style(--hits${e.n}: 0) { .b1w${e.n} { display:block } }`);
      w.push(`${P} style(--knife${e.n}: 1)${alive} and style(--kill${e.n}: 0) and style(--hits${e.n}: 1) { .b2w${e.n} { display:block } }`);
      w.push(`${P} style(--knife${e.n}: 1)${alive} and style(--kill${e.n}: 1) { .bkw${e.n} { display:block } }`);
    });
    dogs.forEach(e => {
      const alive = ` and style(--slain${e.n}: 0)`;
      w.push(`@container walka style(--outOfAmmo: 0)${alive} { .dw${e.n} { display:block } }`);
      w.push(`@container walka style(--knife${e.n}: 1)${alive} { .dnw${e.n} { display:block } }`);
    });
    // Ammunition. Every click on a sprite is one shot — including the killing
    // one. The sum contains ONLY firearm checkboxes: the knife has its own and
    // costs nothing.
    const shots = [
      ...guards.map(e => `var(--c1${e.n}) + var(--c2${e.n}) + var(--gunKill${e.n})`),
      ...dogs.map(e => `var(--dogShot${e.n})`)];
    w.push(`@property --outOfAmmo { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    // The sum over ALL hits has about 100 terms. It is computed ONCE and
    // substituted with var() — written out four times it did four times as many
    // additions per frame, and --shots was not being read even once.
    // DWA LICZNIKI, i to jest sedno poprawki. --shots liczy AMUNICJĘ, więc nóż
    // do niego nie wchodzi — machnięcie nie kosztuje naboju. Ale to samo --shots
    // napędzało też parzystość przełączającą animację ataku, więc nóż nie
    // animował się nigdy. Rozdzielone: amunicja zostaje na --shots, animacja
    // przechodzi na --attacks, które liczy KAŻDY atak, palny i biały.
    const attacks = [...shots,
      ...guards.map(e => `var(--n1${e.n}) + var(--n2${e.n}) + var(--knifeKill${e.n})`),
      ...dogs.map(e => `var(--dogKnife${e.n})`)];
    w.push(`@property --attacks { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`.enemyFrames { --attacks: calc(${attacks.join(' + ')}) }`);
    w.push(`.enemyFrames { --shots: calc(${shots.join(' + ')});
           --ammoLeft: clamp(0, calc(${AMMO_START} + var(--ammoTaken)` +
           ` - var(--shots)), ${AMMO_MAX});
           --outOfAmmo: calc(1 - clamp(0, var(--ammoLeft), 1));
           --shotParity: mod(var(--attacks), 2);
           --hasFired: clamp(0, var(--attacks), 1) }`);
    w.push(`@property --shots { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    // Which weapon is drawn in the frame, and which icon in the status bar.
    // Computed ONCE, here, because this is the only place that can see both the
    // empty magazine and the machine gun at the same time.
    w.push(`@property --weaponRow { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --weaponIcon { syntax: '<integer>'; initial-value: 1; inherits: true }`);
    {
      const rP = M.sprites.index['weapon.pistol'].row;
      const rM = M.sprites.index['weapon.machinegun'].row;
      const rN = M.sprites.index['weapon.knife'].row;
      w.push(`.enemyFrames { --weaponRow: calc(var(--outOfAmmo) * ${rN}` +
        ` + (1 - var(--outOfAmmo)) * (${rP} + var(--machinegun) * ${rM - rP}));` +
        ` --weaponIcon: calc((1 - var(--outOfAmmo)) * (1 + var(--machinegun))) }`);
    }
    w.push(weaponCss());
  }

  // The kill counter — an abacus: a zero-size element at the top of the
  // document contributes, and the state is read globally through :has().
  w.push(`
/* THE RESET IS NECESSARY, and not as a formality. Without it the implicit reset
   happens on the element that increments the counter, and its scope covers only
   that element, its descendants and its SIBLINGS — so it never leaves the
   abacus. The read-out in the HUD then saw a fresh counter and showed zero,
   even though counter-increment was counting perfectly. */
body { counter-reset: killCount 0 }
.abacus { display:block; width:0; height:0 }
.abacus i { display:block; width:0; height:0; counter-increment:killCount var(--u, 0) }
.vKills::after { content:counter(killCount) }`);
  alive.forEach(e => {
    const pola = !WEAPONS ? ['z' + e.n]
      : e.kind === 'dog' ? ['z' + e.n, 'kz' + e.n]
      : ['c' + e.n + 'd', 'k' + e.n + 'd'];
    w.push(pola.map(id => `body:has(#${id}:checked) .lz${e.n}`).join(', ') + ` { --u: 1 }`);
  });
  return w.join('\n');
}

const enemiesHtml = () => M.enemies.map((e, n) => {
  if (e.kind === 'other') return '';
  if (e.kind === 'corpse') return `<i class="w w${n}"></i>`;
  const et = (kl, id) => `<label class="shot ${kl} ${kl}${n}" for="${id}"></label>`;
  const targets = !WEAPONS ? `<label class="shot" for="z${n}"></label>`
    : e.kind === 'dog'
      ? et('dw', 'z' + n) + et('dnw', 'kz' + n)
      : et('a1w', 'c' + n + '1') + et('a2w', 'c' + n + '2') + et('kw', 'c' + n + 'd')
      + et('b1w', 'k' + n + '1') + et('b2w', 'k' + n + '2') + et('bkw', 'k' + n + 'd');
  return `<div class="w w${n}">${targets}</div>`;
}).filter(Boolean).join('\n');

const enemiesBoxes = () => alive.map(e => {
  const pole = id => `<input class="boxesW" type="checkbox" id="${id}" autocomplete="off">`;
  if (!WEAPONS) return pole('z' + e.n);
  if (e.kind === 'dog') return pole('z' + e.n) + pole('kz' + e.n);
  return ['c' + e.n + '1', 'c' + e.n + '2', 'c' + e.n + 'd',
          'k' + e.n + '1', 'k' + e.n + '2', 'k' + e.n + 'd'].map(pole).join('');
}).join('');

const abacusHtml = () => `<span class="abacus">` +
  alive.map(e => `<i class="lz${e.n}"></i>`).join('') + `</span>`;

// ============================================================ ITEMS
// E1M1 holds 121 statics: 48 collectable, 34 blocking and 39 pure decoration.
// The split and the values come from `statinfo[]` (WL_ACT1.C:22-80) and
// `GetBonus` (WL_AGENT.C) — the extractor transcribes them, so the generator
// does no guessing.
//
// PICKING UP is the same latch as waking an enemy, and has the same difficulty:
// the condition "I am standing on this tile" is computed at the bottom of the
// chain, and CSS cannot tick a checkbox. A paused animation plus `forwards`
// solves it with no click.
//
// The condition is a PAIR of queries on the tile coordinates the probe under
// the player already computes — no new property. The first version combined
// them into one tile number (y*64+x) and queried that; it looks cheaper, but it
// DOES NOT WORK: a style query on an `<integer>` computed by calc() matches only
// up to 255 and never from 256 on, while getComputedStyle reports the right
// value throughout. Measured at the boundary: 255 yes, 256 no, and the same
// number as a `<number>` yes.
const AMMO_START = 8, AMMO_MAX = 99, HEALTH_MAX = 100;
const statics = M.statics.map((s, i) => ({ x: s.x, y: s.y, kind: s.n, i,
                                           ...(M.staticIndex.index[s.n] || {}) }));
// THE MACHINE GUN. statinfo[27] is `bo_machinegun` — E1M1 holds exactly one, at
// (28,25), in the secret chamber behind a pushwall. The extractor transcribes
// its `weapon: 'machinegun'` from GetBonus, so the generator does not guess.
const MG_KIND = 27;
const machineguns = statics.filter(s => s.kind === MG_KIND);
if (machineguns.length !== 1)
  throw new Error(`E1M1 should hold exactly one machine gun, found ${machineguns.length}`);
const loot = statics.filter(s => s.health || s.ammo || s.score || s.treasure);
// A dead guard leaves a CLIP. `KillActor` (WL_STATE.C:825) calls
// `PlaceItemType(bo_clip2, …)`, and `bo_clip2` is the same sprite as a clip
// from the map (SPR_STAT_26), only worth FOUR rounds instead of eight. Without
// it the ammunition economy does not close: shooting costs, and the only supply
// is eleven clips lying around the level.
const CLIP_ROUNDS = 4, CLIP_KIND = 26;
const SCORE_FOR = { guard: 100, dog: 200 };   // KillActor, WL_STATE.C:825-853
// Functions, not constants: on the item stage there are no enemies yet, and
// then --slain{n} is unregistered and a reference to it would drop the whole
// declaration in silence.
const KILLABLE = () => (ENEMIES ? alive : []);
const CORPSES_WITH_CLIP = () => (ENEMIES ? alive.filter(e => e.kind === 'guard') : []);
const blockers = new Set(statics.filter(s => s.block).map(s => s.x + ',' + s.y));
const TREASURE_TOTAL = loot.reduce((a, s) => a + (s.treasure || 0), 0);

// A blocker is meant to be in the way, not to seal anything off. A barrel
// standing in a doorway or a table in a corridor would cut off part of the
// level, and that would only show up in play — so the build asks the question
// instead: how many tiles are lost, and does any loot or lift tile go with them.
(() => {
  const lift = new Set(M.lift.map(w => w.x + ',' + w.y));
  const pushWalls = new Set(M.pushwalls.map(w => w.x + ',' + w.y));
  const flood = (withBlockers) => {
    const blocksSight = (x, y) => {
      if (at(P0, x, y) === 21 || pushWalls.has(x + ',' + y)) return false;
      return solidTile(x, y) || (withBlockers && blockers.has(x + ',' + y));
    };
    const w = new Set([M.start.x + ',' + M.start.y]);
    const q = [[M.start.x, M.start.y]];
    while (q.length) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = cx + dx, b = cy + dy;
        if (a < 0 || a > 63 || b < 0 || b > 63 || blocksSight(a, b) || w.has(a + ',' + b)) continue;
        w.add(a + ',' + b); q.push([a, b]);
      }
    }
    return w;
  };
  const bez = flood(false), z = flood(true);
  const lost = [...bez].filter(k => !z.has(k));
  const lostLoot = loot.filter(s => lost.includes(s.x + ',' + s.y));
  const lostLift = [...lift].filter(k => bez.has(k) && !z.has(k));
  if (lostLoot.length || lostLift.length)
    throw new Error(`blockers cut off ${lostLoot.length} items and ${lostLift.length} lift tiles`);
  if (lost.length !== blockers.size)
    throw new Error(`blockers cut off ${lost.length} tiles instead of their own ${blockers.size}`);
})();

function staticsCss() {
  const w = [];
  w.push(`.pausedSlots { position:absolute; left:0; top:0; width:${U}px; height:${U}px;
     margin:${-U / 2}px; rotate:y var(--billboardTurn);
     background-image:url(wolf-statics.png); background-repeat:no-repeat;
     background-size:${M.staticIndex.cols * 64}px ${M.staticIndex.rows * 64}px;
     image-rendering:pixelated; pointer-events:none }`);
  // One rule per KIND, not per instance: thirty ceiling lamps share one
  // background. The position goes in a style attribute, because it differs for
  // every instance.
  Object.entries(M.staticIndex.index).forEach(([kind, g]) =>
    w.push(`.t${kind} { background-position:${-g.col * 64}px ${-g.row * 64}px }`));
  // A collected item disappears through `scale: 0`, not `opacity: 0` — a
  // transparent plane still rasterises, a zero-sized one does not.
  loot.forEach(s => {
    w.push(`@property --taken${s.i} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@keyframes take${s.i} { from { --taken${s.i}: 0 } to { --taken${s.i}: 1 } }`);
  });
  statics.forEach(s => {
    const pos = `translate:${s.x * U + U / 2}px 0 ${s.y * U + U / 2}px`;
    w.push(loot.includes(s)
      ? `.s${s.i} { ${pos}; scale:calc(1 - var(--taken${s.i})) }`
      : `.s${s.i} { ${pos} }`);
  });

  // Clips dropped by corpses share the animation list with the loot —
  // animation-name is one list, so a second rule on the same element would
  // replace it.
  const corpses = CORPSES_WITH_CLIP();
  const slots = [...loot.map(s => ({ id: 'takeSlot' + s.i, kl: 'take' + s.i })),
                   ...corpses.map(e => ({ id: 'clipSlot' + e.n, kl: 'takeDrop' + e.n }))];
  corpses.forEach(e => {
    w.push(`@property --clipTaken${e.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@keyframes takeDrop${e.n} { from { --clipTaken${e.n}: 0 } to { --clipTaken${e.n}: 1 } }`);
  });
  w.push(`.loot { ${slots.map(g => `--${g.id}: paused`).join('; ')};
  animation-name: ${slots.map(g => g.kl).join(', ')};
  animation-duration: ${slots.map(() => '1ms').join(', ')};
  animation-timing-function: ${slots.map(() => 'steps(1, end)').join(', ')};
  animation-fill-mode: ${slots.map(() => 'forwards').join(', ')};
  animation-play-state: ${slots.map(g => `var(--${g.id})`).join(', ')} }`);
  loot.forEach(s => w.push(
    `@container koliz style(--sc0x: ${s.x}) and style(--sc0y: ${s.y})` +
    ` { .loot { --takeSlot${s.i}: running } }`));
  // A clip from a corpse can only be picked up once the guard IS dead — hence
  // the third condition. `--slain{n}` sits on .stateAnim, above the container, so
  // the query can see it.
  corpses.forEach(e => w.push(
    `@container koliz style(--sc0x: ${e.x}) and style(--sc0y: ${e.y})` +
    ` and style(--slain${e.n}: 1) { .loot { --clipSlot${e.n}: running } }`));
  // The sprite lies on the guard's tile: visible once he is dead and not yet
  // collected.
  const g26 = M.staticIndex.index[CLIP_KIND];
  corpses.forEach(e => w.push(`.dk${e.n} { translate:${e.x * U + U / 2}px 0 ${e.y * U + U / 2}px;` +
    `background-position:${-g26.col * 64}px ${-g26.row * 64}px;` +
    `scale:calc(var(--slain${e.n}) * (1 - var(--clipTaken${e.n}))) }`));

  // The totals. Four declarations for forty-eight items.
  const sum = (pole) => {
    const t = loot.filter(s => s[pole]).map(s => `var(--taken${s.i}) * ${s[pole]}`);
    return t.length ? `calc(${t.join(' + ')})` : '0';
  };
  const corpseAmmo = CORPSES_WITH_CLIP().map(e =>
    `var(--clipTaken${e.n}) * ${CLIP_ROUNDS}`);
  const scoreForKills = KILLABLE().map(e => `var(--slain${e.n}) * ${SCORE_FOR[e.kind]}`);
  const killedSum = KILLABLE().map(e => `var(--slain${e.n})`);
  w.push(`.spoils { --healing: ${sum('health')};
           --ammoTaken: calc(${sum('ammo')}${corpseAmmo.length ? ' + ' + corpseAmmo.join(' + ') : ''});
           --score: calc(${sum('score')}${scoreForKills.length ? ' + ' + scoreForKills.join(' + ') : ''});
           --treasureSum: ${sum('treasure')};
           --killedSum: ${killedSum.length ? `calc(${killedSum.join(' + ')})` : '0'} }`);
  w.push(`@property --killedSum { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  // Percentages as on the original's intermission screen (WL_INTER.C) — that is
  // the number a player actually looks for after finishing a level.
  for (const z of ['--pctKill', '--pctSecret', '--pctTreasure'])
    w.push(`@property ${z} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  const proc = (numAt, mian) => mian
    ? `round(nearest, calc(${numAt} * 100 / ${mian}), 1)` : '0';
  w.push(`.spoils { --pctKill: ${proc('var(--killedSum)', ENEMIES ? alive.length : 0)};
           --pctSecret: ${proc('var(--secrets)', SECRETS ? pushWalls.length : 0)};
           --pctTreasure: ${proc('var(--treasureSum)', TREASURE_TOTAL)};
           counter-reset: pkt round(nearest, var(--score), 1)
                          skb round(nearest, var(--treasureSum), 1)
                          taj var(--secrets)
                          pctK var(--pctKill) pctS var(--pctSecret) pctT var(--pctTreasure) }
.pctK::after { content:counter(pctK) "%" }
.pctS::after { content:counter(pctS) "%" }
.pctT::after { content:counter(pctT) "%" }`);
  return w.join('\n');
}

const staticsHtml = () => statics
  .map(s => `<i class="pausedSlots t${s.kind} s${s.i}"></i>`).join('\n')
  + CORPSES_WITH_CLIP().map(e => `\n<i class="pausedSlots dk${e.n}"></i>`).join('');

// The status bar. It has to sit BELOW both the loot and the blood, so it lives
// inside the frame wrapper.
function statusCss() {
  const w = [];
  for (const [zm, ini] of [['--dmg', 0], ['--healing', 0], ['--ammoTaken', 0],
                           ['--score', 0], ['--treasureSum', 0]])
    w.push(`@property ${zm} { syntax: '<number>'; initial-value: ${ini}; inherits: true }`);
  w.push(`@property --ammoLeft { syntax: '<integer>'; initial-value: ${AMMO_START}; inherits: true }`);
  w.push(`@property --healthNow { syntax: '<number>'; initial-value: ${HEALTH_MAX}; inherits: true }`);
  // --healthNow is computed on .hudRead, because that is where both the wound and
  // the healing are visible.
  w.push(`
/* Treasure and score are reset HIGHER UP, on .spoils: the level-end screen is
   not a descendant of the status bar, and a counter's scope covers only the
   element, its descendants and its siblings. This is the same trap that ate the
   kill counter. */
.spoils { --ammoLeft: clamp(0, calc(${AMMO_START} + var(--ammoTaken)), ${AMMO_MAX}) }
.vSecret::after { content:counter(taj) "/${pushWalls.length}" }
.vScore::after { content:counter(pkt) }
.vTreasure::after { content:counter(skb) "/${TREASURE_TOTAL}" }`);
  return w.join('\n');
}

const statusHtmlUnused = () => `<div class="doorState"><span class="pas"><i></i></span>` +
  `<b class="wZdr"></b><b>&#9679;</b><b class="wAmu"></b><b>&#9679;</b>` +
  `<b class="vTreasure"></b><b>&#9679;</b><b class="vScore"></b></div>`;

// ============================================================ THE LIFT
// End of level. The control works like a door's — on the crosshair, selected by
// a condition — with one difference: here the condition is the player's EXACT
// tile rather than adjacency. Cmd_Use looks at the tile directly in front of
// the player, and the lift alcove has one entrance, so adjacency slack has
// nothing to make easier here.
//
// The latch is an ordinary checkbox: a level ends once and there is no way
// back, so monotonicity happens to be exactly right.
function liftCss() {
  const w = [];
  lifts.forEach(W => {
    // WITHOUT THIS REGISTRATION the style query never matches while every value
    // still looks correct — the third time for the same trap.
    w.push(`@property --liftNear${W.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`#wi${W.n}:checked ~ .stateAnim { --lift${W.n}: 1 }`);
  });
  // Condition: I am standing on the tile in front of the switch and looking at it.
  w.push(`.probeOR { ${lifts.map(W =>
    `--liftNear${W.n}: calc((1 - clamp(0, abs(calc(var(--sc0x) - ${W.gx})), 1))` +
    ` * (1 - clamp(0, abs(calc(var(--sc0y) - ${W.gy})), 1))` +
    ` * clamp(0, round(down, calc((${W.x} - var(--sc0x)) * var(--dx)` +
    ` + (${W.y} - var(--sc0y)) * var(--dz) + 0.5), 1), 1))`).join(';\n           ')};
           --windaPrzy: clamp(0, calc(${lifts.map(W => `var(--liftNear${W.n})`).join(' + ')}), 1) }`);
  w.push(`@property --windaPrzy { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  lifts.forEach(W => w.push(
    `@container koliz style(--liftNear${W.n}: 1) { .uw${W.n} { display:block } }`));
  // A red crosshair — unlike the yellow one at doors, because this move has no
  // way back.
  w.push(`@container koliz style(--windaPrzy: 1) { .frame > .trigger {
  border:2px solid #e2726e; background:#e2726e33 } }`);
  // The level-end curtain covers the stick, so the player really does stop.
  // Its appearance and reveal rules live in screensCss with the other screens.
  return w.join('\n');
}

const liftHtml = () => lifts.map(W =>
  `<label class="use uw${W.n}" for="wi${W.n}"></label>`).join('');

const liftBoxes = () => lifts.map(W =>
  `<input class="boxesD" type="checkbox" id="wi${W.n}" autocomplete="off">`).join('');



// ============================================================ SECRET WALLS
// Once all five have been pushed, the level must be passable in its entirety:
// that is the only reason secret walls are needed for play at all, so the build
// asks the question rather than finding out afterwards.
(() => {
  const freeSq = new Set(), solidSq = new Set();
  for (const P of pushWalls) { freeSq.add(P.t[0].join(',')); freeSq.add(P.t[1].join(',')); solidSq.add(P.t[2].join(',')); }
  const blocksSight = (x, y) => {
    const k = x + ',' + y;
    if (solidSq.has(k)) return true;
    if (freeSq.has(k)) return false;
    if (at(P0, x, y) === 21) return false;                 // the lift is passable
    return solidTile(x, y) || blockers.has(k);
  };
  const w = new Set([M.start.x + ',' + M.start.y]);
  const q = [[M.start.x, M.start.y]];
  while (q.length) {
    const [cx, cy] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = cx + dx, b = cy + dy;
      if (a < 0 || a > 63 || b < 0 || b > 63 || blocksSight(a, b) || w.has(a + ',' + b)) continue;
      w.add(a + ',' + b); q.push([a, b]);
    }
  }
  const missing = loot.filter(s => !w.has(s.x + ',' + s.y));
  const missingLift = lifts.filter(W => !w.has(W.gx + ',' + W.gy));
  if (missing.length || missingLift.length)
    throw new Error(`still unreachable after opening the secrets: ${missing.length} items, ` +
                    `${missingLift.length} lift alcoves`);
})();

function secretsCss() {
  const w = [];
  pushWalls.forEach(P => {
    w.push(`@property --pushed${P.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@property --pushNear${P.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    for (const c of ['A', 'B', 'C'])
      w.push(`@property --p${c}${P.n} { syntax: '<integer>'; initial-value: 0; inherits: true }`);
    w.push(`@keyframes pushKf${P.n} { from { --push${P.n}: 0 } to { --push${P.n}: 2 } }`);
    w.push(`#pw${P.n}:checked ~ .stateAnim { --pushSlot${P.n}: pushKf${P.n}; --pushed${P.n}: 1 }`);
  });
  // The animated value is read on a DESCENDANT. Three bits per wall:
  //   A — the source square has been vacated (push >= 1)
  //   B — the middle square is occupied (0 < push < 2)
  //   C — the destination square is occupied (push >= 1)
  w.push(`.stateRead { ${pushWalls.map(P =>
    `--pA${P.n}: clamp(0, round(down, var(--push${P.n}), 1), 1);\n` +
    `              --pB${P.n}: calc(clamp(0, round(up, var(--push${P.n}), 1), 1)` +
    ` * (1 - clamp(0, round(down, calc(var(--push${P.n}) / 2), 1), 1)));\n` +
    `              --pC${P.n}: clamp(0, round(down, var(--push${P.n}), 1), 1)`).join(';\n              ')};
              --secrets: calc(${pushWalls.map(P => `var(--pushed${P.n})`).join(' + ')}) }`);
  w.push(`@property --secrets { syntax: '<integer>'; initial-value: 0; inherits: true }`);

  // The condition is the same as for the lift: exact player tile plus facing.
  // Additionally the wall must be untouched — it can be pushed once (PushWall
  // clears the marker from the second plane), and after the push the player
  // walks onto its square anyway.
  w.push(`.probeOR { ${pushWalls.map(P =>
    `--pushNear${P.n}: calc((1 - clamp(0, abs(calc(var(--sc0x) - ${P.gx})), 1))` +
    ` * (1 - clamp(0, abs(calc(var(--sc0y) - ${P.gy})), 1))` +
    ` * clamp(0, round(down, calc((${P.x} - var(--sc0x)) * var(--dx)` +
    ` + (${P.y} - var(--sc0y)) * var(--dz) + 0.5), 1), 1))`).join(';\n           ')};
           --secretNear: clamp(0, calc(${pushWalls.map(P =>
             `var(--pushNear${P.n}) * (1 - var(--pushed${P.n}))`).join(' + ')}), 1) }`);
  w.push(`@property --secretNear { syntax: '<integer>'; initial-value: 0; inherits: true }`);
  pushWalls.forEach(P => w.push(
    `@container koliz style(--pushNear${P.n}: 1) and style(--pushed${P.n}: 0)` +
    ` { .ut${P.n} { display:block } }`));
  // A blue crosshair: neither a door nor the end of the level.
  w.push(`@container koliz style(--secretNear: 1) { .frame > .trigger {
  border:2px solid #6f9dd6; background:#6f9dd633 } }`);
  return w.join('\n');
}

const secretsHtml = () => pushWalls.map(P =>
  `<label class="use ut${P.n}" for="pw${P.n}"></label>`).join('');
const secretsBoxes = () => pushWalls.map(P =>
  `<input class="boxesD" type="checkbox" id="pw${P.n}" autocomplete="off">`).join('');

// ============================================================ WEAPONS
// The pistol is drawn as in the original: SimpleScaleShape, centred at the
// bottom, scaled to the height of the view. It does not sit in the scene but in
// the frame — it is HUD, not geometry — so it picks up neither the perspective
// nor the rotation.
const WEAPON_W = W / 2;                       // 320 px, half the view width
// Four frames of 6 tics (attackinfo[1], WL_AGENT.C:70) — 24/70 s per shot.
// That is ONE cycle: for that long the pistol animates, and for exactly that
// long it cannot fire again. So one animation handles both the recoil and the
// rate of fire.
const SHOT_TIME = 24 / 70;
// The machine gun is attackinfo[2] (WL_AGENT.C:71):
// {6,0},{6,1 fire},{6,3},{6,-1}. The third frame has attack==3, i.e. "if the
// trigger is held, go back two" — so with the trigger held the cycle is THREE
// frames, not four. Eighteen tics per round instead of twenty-four.
const MG_SHOT_TIME = 18 / 70;
// Damage per round is IDENTICAL for the pistol and the machine gun in the
// original (GunAttack does not look at the weapon). The machine gun wins by
// sending a burst per trigger pull. Here a click IS a trigger pull, so the
// burst adds ONE hit to the threshold: one click fewer at every distance — one
// up close and at medium range, two instead of three far away. Two would strip
// distance of all meaning: the threshold would be met before the click, so the
// machine gun would drop a guard from the far side of the map.
const MG_BURST = 1;
function weaponCss() {
  const g = M.sprites.index['weapon.pistol'];
  const gm = M.sprites.index['weapon.machinegun'];
  const KW = WEAPON_W, KH = H * ASPECT;
  return `
/* THE MACHINE GUN LATCH SITS ABOVE .probeOR, and that is not a layout whim. The
   weapon changes the hit threshold --kill{n}, and that is computed on .probeOR
   and read by an @container koliz query — that is, ON THE SAME ELEMENT. A
   container query sees only the style of the container itself, so a flag set
   lower down (with the other loot, on .loot) would be invisible to it. Higher
   up works, because .sc0 — the probe standing under the player — is a container
   far above the whole chain and publishes the tile coordinates itself.
   It costs one level of the tree and one extra latch per item: --taken{i} still
   hides the sprite and adds the ammunition, --machinegun switches the weapon. */
@property --machinegun { syntax: '<integer>'; initial-value: 0; inherits: true }
@keyframes takeMg { from { --machinegun: 0 } to { --machinegun: 1 } }
.mgLatch { --km: paused; animation-name: takeMg; animation-duration: 1ms;
            animation-timing-function: steps(1, end); animation-fill-mode: forwards;
            animation-play-state: var(--km) }
${machineguns.map(s2 => `@container sc0 style(--sc0x: ${s2.x}) and style(--sc0y: ${s2.y})` +
  ` { .mgLatch { --km: running } }`).join('\n')}
@property --kb { syntax: '<integer>'; initial-value: 0; inherits: true }
@property --ready { syntax: '<integer>'; initial-value: 1; inherits: true }
@property --ready2 { syntax: '<integer>'; initial-value: 1; inherits: true }
@property --shotParity { syntax: '<integer>'; initial-value: 0; inherits: true }
@property --hasFired { syntax: '<integer>'; initial-value: 0; inherits: true }
.weapon { position:absolute; left:50%; bottom:0; width:${KW}px; height:${KH}px;
        margin-left:${-KW / 2}px; pointer-events:none; z-index:3;
        background-image:url(wolf-sprites.png); background-repeat:no-repeat;
        image-rendering:pixelated;
        background-size:${M.sprites.cols * KW}px ${M.sprites.rows * KH}px;
        background-position:calc(var(--kb) * ${-KW}px) calc(var(--weaponRow) * ${-KH}px) }

/* RATE OF FIRE. The latch has to FIRE AGAIN after every shot, and the same
   animation name will not start a second time. The answer is the one used for
   doors: two names, alternated. Alternated by what? THE PARITY OF THE SHOT
   COUNT — consecutive shots always change it, so the name is always different
   from the previous one. Zero shots is a separate case, so that the pistol does
   not fire by itself on load. */
@keyframes rateA { from { --ready: 0 } to { --ready: 1 } }
@keyframes rateB { from { --ready: 0 } to { --ready: 1 } }
@keyframes framesA { from { --kb: 1 } to { --kb: ${g.frames} } }
@keyframes framesB { from { --kb: 1 } to { --kb: ${g.frames} } }
.cooldown { animation-name: none, none;
          animation-duration: ${f6(SHOT_TIME)}s, ${f6(SHOT_TIME)}s;
          animation-timing-function: steps(1, end), steps(${g.frames - 1});
          animation-fill-mode: forwards, none }
@container walka style(--shotParity: 1) { .cooldown { animation-name: rateB, framesB } }
@container walka style(--shotParity: 0) and style(--hasFired: 1) {
  .cooldown { animation-name: rateA, framesA } }
/* The animated value is read by a DESCENDANT — on the element itself the query
   would see the base value. */
.cooldownRead { --ready2: var(--ready); container: tempo / normal }
@container tempo style(--ready2: 0) { .shot { pointer-events:none } }

/* THE MACHINE GUN'S RATE GOES THROUGH A QUERY RATHER THAN calc(), AND NOT OUT
   OF LAZINESS. Written out directly — animation-duration: calc(24tics -
   var(--machinegun) * 6tics) — it computes to ZERO SECONDS, silently. --machinegun is
   held by an animation (the pickup latch, with fill-mode forwards), and an
   animated value must not be substituted into an animation-* property: that
   would be a cycle, so the declaration is invalid at computed-value time and
   falls back to the initial 0s. Measured side by side: the same formula with
   --kb (registered, not currently animated) computes correctly, with --machinegun
   it gives 0s.
   A container query creates no cycle, because it substitutes no value — it just
   selects a rule containing a literal. */
@container walka style(--machinegun: 1) {
  .cooldown { animation-duration: ${f6(MG_SHOT_TIME)}s, ${f6(MG_SHOT_TIME)}s } }
/* The knife is attackinfo[0]: four frames of 6 tics again. This rule comes
   AFTER the machine gun's, because with an empty magazine it has to win
   regardless of what you are carrying. */
@container walka style(--outOfAmmo: 1) {
  .cooldown { animation-duration: ${f6(SHOT_TIME)}s, ${f6(SHOT_TIME)}s } }`;
}
const weaponHtml = () => `<i class="weapon"></i>`;

// ============================================================ SCREENS
// Title, "Get Psyched!", the death screen and the intermission — all from the
// original VGAGRAPH artwork and in the original layout.
//
// THE INTERMISSION SCREEN USES NO FONT. `Write` (WL_INTER.C:331) maps a
// character to L_APIC..L_ZPIC and blits it like a tile: 16 px per letter, 8 for
// the colon, exclamation mark and apostrophe, a new line every 16 px down. For
// a JavaScript-free port that is a gift — the whole caption is a set of <i>
// elements with background-position, computed at build time.
const EK = M.screens;
const ekx = n => f6(n * HUD_SX) + 'px';
const eky = n => f6(n * HUD_SY) + 'px';
// Times for E1M1: par 1:30 (parTimes[0], WL_INTER.C:452), a bonus of 500 per
// second of margin and 10000 for each hundred-percent tally (PAR_AMOUNT,
// PERCENT100AMT).
const PAR_SEC = 90, PAR_TEXT = '01:30', FLOOR_NO = '1';
const CLOCK_MAX = 99 * 60;

function screenGlyph(ch) {
  if (ch >= '0' && ch <= '9')
    return { x: EK.digits.x + (1 + (+ch)) * 16, y: EK.digits.y, w: 16, step: 16 };
  const g = EK.glyphs[ch];
  if (!g) throw new Error(`screens: no glyph for ${JSON.stringify(ch)}`);
  return g;
}
// A static caption. Returns HTML; the positions are computed here, not in CSS.
function caption(x, y, text) {
  const out = [];
  let nx = x, ny = y;
  for (const ch of text) {
    if (ch === '\n') { nx = x; ny += 16; continue; }
    if (ch === ' ') { nx += 16; continue; }
    const g = screenGlyph(ch);
    out.push(`<i class="eg" style="left:${ekx(nx)};top:${eky(ny)};width:${ekx(g.w)};` +
             `background-position:${ekx(-g.x)} ${eky(-g.y)}"></i>`);
    nx += g.step;
  }
  return out.join('');
}
// A number aligned to its RIGHT edge, exactly as `Write(x, y, itoa(...))` does
// it in the original: x = 36 - 2*length, so the right edge stays put.
function numAt(rightEdge, y, places, zm, always) {
  return Array.from({ length: places }, (_, i) =>
    `<i class="eg ec" style="left:${ekx(rightEdge - (places - i) * 16)};top:${eky(y)};` +
    `--g:${digitGlyph(zm, places, i, always)}"></i>`).join('');
}

function screensCss() {
  const t = EK.bg, sm = EK.deathColour;
  return `
/* Everything is drawn at native 320x200 scale and scaled once: x2 horizontally
   and x2.4 vertically. The view is 160 rows, the status bar 40 — 200 together,
   as in the original. */
.eg { position:absolute; height:${eky(16)}; pointer-events:none;
      background-image:url(${EK.file}); background-repeat:no-repeat;
      background-size:${ekx(EK.w)} ${eky(EK.h)}; image-rendering:pixelated }
.ec { width:${ekx(16)};
      background-position:calc(var(--g) * ${ekx(-16)}) ${eky(-EK.digits.y)} }

/* --- FITTING THE SCREEN TO THE PAGE. The screen keeps its native 640x480 and
   is scaled with a TRANSFORM, never resized, for the same reason the maximise
   button does it that way: the engine is calibrated in pixels and a transform
   leaves layout — and therefore the stick's scroll calibration — untouched.

   A transform does not shrink the layout box, though, so the wrapper reserves
   the right space itself — the same factor, applied to a height rather than a
   ratio. Without it a scaled-down screen trails the rest of its 480 pixels as
   empty page below. */
.hudRead { width:100%; max-width:${W}px; height:calc(${GAME_H}px * ${FIT}) }
.gameScreen { position:relative; width:${W}px; height:${GAME_H}px;
              transform-origin:0 0; scale:${FIT} }

/* --- the start screen: PC-13, then the title, both on black as in the original */
.intro { position:absolute; inset:0; z-index:10; background:#000; overflow:hidden }
#play:checked ~ .stateAnim .intro { display:none }
.intro > i { position:absolute; image-rendering:pixelated;
             background-image:url(${EK.file}); background-repeat:no-repeat;
             background-size:${ekx(EK.w)} ${eky(EK.h)} }
@keyframes pg13Out { from { opacity:1 } to { opacity:0 } }
@keyframes titleIn { from { opacity:0 } to { opacity:1 } }
.introPg13 { left:${ekx((320 - EK.pg13.w) / 2)}; top:${eky((200 - EK.pg13.h) / 2)};
             width:${ekx(EK.pg13.w)}; height:${eky(EK.pg13.h)};
             background-position:${ekx(-EK.pg13.x)} ${eky(-EK.pg13.y)};
             animation:pg13Out 1ms steps(1, end) .9s forwards }
.introTitle { left:0; top:0; width:${ekx(320)}; height:${eky(200)};
              background-position:0 0;
              animation:titleIn 1ms steps(1, end) .9s both }
.introClick { position:absolute; inset:0; cursor:pointer; z-index:2 }

/* --- "Get Psyched!": a bar of palette colour 127 over the VIEW area, with the
   picture at (48,56). LatchDrawPic counts x in bytes, hence (20-14)*8
   (PreloadGraphics, WL_INTER.C:1002). */
@keyframes psychedOut { from { opacity:1; visibility:visible }
                          to   { opacity:0; visibility:hidden } }
.psyched { position:absolute; left:0; top:0; width:${W}px; height:${f6(H * ASPECT)}px;
           z-index:9; display:none; background:rgb(${t[0]},${t[1]},${t[2]}) }
#play:checked ~ .stateAnim .psyched { display:block;
           animation:psychedOut 1.4s steps(1, end) forwards }
.psyched > i { position:absolute; left:${ekx(48)}; top:${eky(56)};
               width:${ekx(EK.psyched.w)}; height:${eky(EK.psyched.h)};
               image-rendering:pixelated;
               background:url(${EK.file}) no-repeat ${ekx(-EK.psyched.x)} ${eky(-EK.psyched.y)};
               background-size:${ekx(EK.w)} ${eky(EK.h)} }

/* --- the death screen. In the original it is ONE RECTANGLE:
   VW_Bar(0,0,viewwidth,viewheight,4) after turning to face the killer and
   fading the palette to red (Died, WL_GAME.C:1199). No caption — the
   information is in the status bar, where the face switches to FACE8APIC and
   LIVES drops by one. */
.death { position:absolute; inset:0; display:none; z-index:5;
        background:rgb(${sm[0]},${sm[1]},${sm[2]}) }
@container life style(--playerDead: 1) { .death { display:block } }

/* --- the intermission screen. The background is VWB_Bar(0,0,320,160,127); the
   status bar stays visible underneath, exactly as in the game. */
.endScreen { position:absolute; inset:0; display:none; z-index:6;
          background:rgb(${t[0]},${t[1]},${t[2]});
          animation:endIn .35s steps(1, end) .8s both }
@keyframes endIn { from { opacity:0 } to { opacity:1 } }
@keyframes breathe { from { background-position-x:0 } to { background-position-x:${ekx(-208)} } }
.bj { position:absolute; left:0; top:${eky(16)};
      width:${ekx(EK.bj.w)}; height:${eky(EK.bj.h)}; image-rendering:pixelated;
      background-image:url(${EK.file}); background-repeat:no-repeat;
      background-size:${ekx(EK.w)} ${eky(EK.h)};
      background-position:0 ${eky(-EK.bj.y)};
      animation:breathe 1s steps(2) infinite }

/* --- the level clock. One linear animation, one step per second, stopped by
   the lift, because in the original TimeCount halts at the end of a level. The
   animated value is read by a DESCENDANT (.frame), not by the element carrying
   the animation. */
@property --sec { syntax: '<integer>'; initial-value: 0; inherits: true }
${['--secClamped', '--minClamped', '--secRest', '--bonus', '--perfect'].map(z =>
  `@property ${z} { syntax: '<integer>'; initial-value: 0; inherits: true }`).join('\n')}
@keyframes clock { from { --sec: 0 } to { --sec: ${CLOCK_MAX} } }
.hudRead { animation:clock ${CLOCK_MAX}s steps(${CLOCK_MAX}) 0s 1 forwards;
             animation-play-state:var(--clockState, running) }
${lifts.map(W2 => `#wi${W2.n}:checked ~ .stateAnim { --clockState: paused }`).join('\n')}
.frame { --secClamped: clamp(0, var(--sec), ${CLOCK_MAX});
        --minClamped: round(down, calc(var(--secClamped) / 60), 1);
        --secRest: mod(var(--secClamped), 60);
        --perfect: calc(${['--pctKill', '--pctSecret', '--pctTreasure']
          .map(z => `clamp(0, round(down, calc(var(${z}) / 100), 1), 1)`).join(' + ')});
        --bonus: calc(clamp(0, calc(${PAR_SEC} - var(--secClamped)), ${PAR_SEC}) * 500
                      + var(--perfect) * 10000) }
${lifts.map(W2 => `#wi${W2.n}:checked ~ .stateAnim .endScreen { display:block }`).join('\n')}`;
}

// The layout is transcribed from LevelCompleted (WL_INTER.C:568-604) to the
// pixel: Write(x,y,...) counts x and y in 8 px cells, so Write(14,2,…) is
// (112,16).
function endScreenHtml() {
  return `<div class="endScreen">
  <i class="bj"></i>
  ${caption(112, 16, 'floor\ncompleted')}${caption(208, 16, FLOOR_NO)}
  ${caption(112, 56, 'bonus')}${numAt(288, 56, 5, '--bonus')}
  ${caption(128, 80, 'time')}${caption(240, 80, ':')}
  ${/* minutes at 208 and 224, seconds at 248 and 264 — exactly the offsets the
       i += 2*8 loop produces in WL_INTER.C:637-646 */ ''}
  ${numAt(240, 80, 2, '--minClamped', true)}${numAt(280, 80, 2, '--secRest', true)}
  ${caption(128, 96, ' par')}${caption(208, 96, PAR_TEXT)}
  ${caption(72, 112, 'kill ratio    %')}${numAt(296, 112, 3, '--pctKill')}
  ${caption(40, 128, 'secret ratio    %')}${numAt(296, 128, 3, '--pctSecret')}
  ${caption(8, 144, 'treasure ratio    %')}${numAt(296, 144, 3, '--pctTreasure')}
</div>`;
}

const introHtml = () => `<div class="intro">
  <i class="introTitle"></i><i class="introPg13"></i>
  <label class="introClick" for="play"></label>
</div>
<div class="psyched"><i></i></div>`;

// ============================================================ STATUS BAR
// The real bar from VGAGRAPH, in the original layout. The positions come
// straight from WL_AGENT.C, where StatusDrawPic(x, y, …) counts x in BYTES
// (eight pixels each) and y in pixels from the top of the bar:
//   FLOOR (2,16) SCORE (6,16) LIVES (14,16) face (17,4)
//   HEALTH (21,16) AMMO (27,16) keys (30,4)(30,20) weapon (32,8)
//
// The scale is the same as the view's: 320x200 stretched to 640x480, i.e. 2x
// horizontally and 2.4x vertically. The view is 640x384, the bar 640x96 —
// exactly 640x480 together, as the original was on a 4:3 monitor.
const HUD_SX = W / 320, HUD_SY = (H * ASPECT) / 160;
// Choosing the glyph for a number laid out across digit positions. `show`
// suppresses leading zeros but never suppresses the units; `always` forces the
// leading zero where the original draws it (the clock: 01:30, not 1:30). Glyph
// 0 is BLANK, hence the `+ 1`.
const digitGlyph = (zm, places, i, always) => {
  const dz = Math.pow(10, places - 1 - i);
  const d = `mod(round(down, calc(var(${zm}) / ${dz}), 1), 10)`;
  const show = (always || i === places - 1) ? '1'
    : `clamp(0, round(down, calc(var(${zm}) / ${dz}), 1), 1)`;
  return `calc(${show} * (${d} + 1))`;
};
const hudAt = (bajt, y) => ({ x: bajt * 8, y });
const HUD_FIELDS = {
  floorNo:  { ...hudAt(2, 16),  places: 2 },
  score:  { ...hudAt(6, 16),  places: 6 },
  lives:   { ...hudAt(14, 16), places: 1 },
  health: { ...hudAt(21, 16), places: 3 },
  ammoLeft:  { ...hudAt(27, 16), places: 2 },
};
function hudCss() {
  const g = M.hud, w = [];
  const px = (n, os) => f6(n * (os === 'x' ? HUD_SX : HUD_SY)) + 'px';
  // One background for everything: scaled once, so the positions stay native.
  w.push(`
.statusBar { position:relative; width:${W}px; height:${px(g.bar.h, 'y')};
       background:url(${g.file}) no-repeat 0 0 / ${px(g.w, 'x')} ${px(g.h, 'y')};
       image-rendering:pixelated; overflow:hidden;
       border:2px solid #000; border-top:0 }
.statusBar i { position:absolute; display:block; image-rendering:pixelated;
         background-image:url(${g.file}); background-repeat:no-repeat;
         background-size:${px(g.w, 'x')} ${px(g.h, 'y')} }
.hc { width:${px(g.digits.w, 'x')}; height:${px(g.digits.h, 'y')};
      background-position:calc(var(--g) * ${px(-g.digits.w, 'x')}) ${px(-g.digits.y, 'y')} }
.htw { width:${px(g.faces.w, 'x')}; height:${px(g.faces.h, 'y')};
       left:${px(136, 'x')}; top:${px(4, 'y')};
       background-position:calc(var(--twarz) * ${px(-g.faces.w, 'x')}) ${px(-g.faces.y, 'y')} }
.hkl { width:${px(g.keys.w, 'x')}; height:${px(g.keys.h, 'y')}; left:${px(240, 'x')};
       background-position:0 ${px(-g.keys.y, 'y')}; background-position-x:${px(-g.keys.x, 'x')} }
.hkl1 { top:${px(4, 'y')} }
.hkl2 { top:${px(20, 'y')} }
.hbr { width:${px(g.weapons.w, 'x')}; height:${px(g.weapons.h, 'y')};
       left:${px(256, 'x')}; top:${px(8, 'y')};
       background-position:${WEAPONS ? `calc(var(--weaponIcon) * ${px(-g.weapons.w, 'x')})`
                                   : px(-g.weapons.w, 'x')} ${px(-g.weapons.y, 'y')} }`);
  // Digits: the position of each place and the choice of glyph. Glyph 0 is
  // BLANK — exactly how LatchNumber pads a number to the field width.
  for (const [name, p] of Object.entries(HUD_FIELDS))
    for (let i = 0; i < p.places; i++)
      w.push(`.h_${name}${i} { left:${px(p.x + i * g.digits.w, 'x')}; top:${px(p.y, 'y')} }`);
  const decls = [];
  for (const [name, p] of Object.entries(HUD_FIELDS)) {
    const zm = { floorNo: '--hudFloor', score: '--score', lives: '--hudLives',
                 health: '--healthNow', ammoLeft: '--ammoLeft' }[name];
    for (let i = 0; i < p.places; i++)
      decls.push(`.h_${name}${i} { --g: ${digitGlyph(zm, p.places, i)} }`);
  }
  w.push(decls.join('\n'));
  // The face: FACE1APIC + 3*((100-health)/16), and FACE8APIC at zero
  // (WL_AGENT.C:279).
  w.push(`@property --twarz { syntax: '<integer>'; initial-value: 0; inherits: true }
@property --g { syntax: '<integer>'; initial-value: 0; inherits: false }
@property --hudFloor { syntax: '<integer>'; initial-value: 1; inherits: true }
@property --hudLives { syntax: '<integer>'; initial-value: 3; inherits: true }
.hudRead { ${ENEMIES ? '--hudLives: calc(3 - var(--playerDead));' : ''}
             --healthNow: clamp(0, calc(${HEALTH_MAX} - var(--dmg) + var(--healing)), ${HEALTH_MAX});
             --twarz: clamp(0, calc(round(down, calc((${HEALTH_MAX} - var(--healthNow)) / 16), 1)
                     + (1 - clamp(0, var(--healthNow), 1))), ${g.faces.count - 1}) }`);
  return w.join('\n');
}
const hudHtml = () => {
  const pola = Object.entries(HUD_FIELDS).flatMap(([n, p]) =>
    Array.from({ length: p.places }, (_, i) => `<i class="hc h_${n}${i}"></i>`));
  return `<div class="statusBar">\n  ${pola.join('')}\n` +
    `  <i class="htw"></i><i class="hkl hkl1"></i><i class="hkl hkl2"></i><i class="hbr"></i>\n</div>`;
};

// ============================================================ COLLISION
// The third version, and the one that stayed. The two that did not:
//   1. braking the accumulator with a scroll-driven loop: it worked against a
//      single wall, but in play it both leaked through and jammed;
//   2. tile-by-tile stepped movement: perfect collision, but the movement stops
//      being smooth and the keyboard does not scale to 991 cells;
//   3. the stick stays, and the loop gets LATENCY COMPENSATION.
//
// The key measurement: a snap in Safari takes about 75 ms REGARDLESS of the
// distance (8 px and 400 px alike). Since the latency is constant, it is enough
// to look further ahead by however far the player travels in that time.
//
// The second measurement: a single-point probe misses corners. THREE probes —
// the centre and two sides offset perpendicular by the player's radius — cut
// leakage from 5.2% to 1.25% with zero false stops. A fifth and sixth add
// nothing.
const MASKS = 4, MASK_BITS = 16;
const RADIUS = 0.34375 * U;        // PLAYERSIZE = MINDIST (WL_DEF.H:88)
// The probe's margin is how far it MUST see ahead to stop in time. Measured on
// this page: loop latency 74 ms, 53 px travelled after the probe lit, frame
// 19.6 ms (up to 14 px of quantisation). Plus the player's radius of 22.
// Walking needs 54 px, running needs 89 — and that is the upper limit, because
// at 99 px the probe reaches ACROSS THE CORRIDOR and false blocks jump from 0
// to 7%.
// The cushion in front of a wall. When the forward direction was cut by the
// LOOP, its latency had to be covered and the margin was 32 px — the player
// stopped 27 px from the face, nearly half a tile too early, and hitting a
// doorway was hard. The CLAMP acts within the same frame, so it only has to
// cover ONE frame of walking: 358.4 px/s times 32 ms (the 99th percentile frame
// in Chrome) is 11.5 px. 16 leaves some margin on top.
const MARGIN = 16;                   // walking: 22 + 16 = 38 px
const MARGIN_RUN = 51;              // running adds: 38 + 51 = 89 px
const PROBE_OFF = [0, RADIUS, -RADIUS];   // perpendicular offsets
// The FAR probe does not stop anything — it switches off the running step. That
// is the answer to "at full speed I go through walls": the probe's budget is
// 89 px minus the 22 px radius, i.e. 67 px for loop latency and a long frame.
// At running speed (716.8 px/s) that is a mere 93 ms of tolerance, at walking
// speed 187. Rather than cut the speed permanently, it is cut ONLY when a wall
// is near — which on E1M1 works out at 40.7% of positions and headings, so
// running survives in about 60% of situations.
// 160 px, because the near probe sits at 89 and the far one has to act sooner:
// while running, the player covers another 54 px during its own latency.
const FAR = 160;

// Returns a row's masks and, separately, the terms to subtract for open doors.
// Doors enter the mask as SOLID and drop out of it arithmetically exactly when
// the leaf stands fully open.
function rowMasks(y) {
  const m = new Array(MASKS).fill(0);
  const subtract = Array.from({ length: MASKS }, () => []);
  for (let x = 0; x < 64; x++) {
    const nr = DOORS ? doorAt.get(x + ',' + y) : undefined;
    // A static with the `block` bit obstructs exactly like a wall. It is
    // resolved at build time, so barrels and tables cost not one rule.
    const blocker = ITEMS && blockers.has(x + ',' + y);
    const sl = Math.floor(x / MASK_BITS), bit = 1 << (x % MASK_BITS);
    // Secret walls: the source square goes out as the block leaves it, and the
    // next two light up and go out in turn — for a moment TWO are solid at
    // once, exactly as in MovePWalls.
    if (SECRETS) for (const P of pushWalls) {
      if (P.t[0][0] === x && P.t[0][1] === y) subtract[sl].push(`- var(--pA${P.n}) * ${bit}`);
      if (P.t[1][0] === x && P.t[1][1] === y) subtract[sl].push(`+ var(--pB${P.n}) * ${bit}`);
      if (P.t[2][0] === x && P.t[2][1] === y) subtract[sl].push(`+ var(--pC${P.n}) * ${bit}`);
    }
    if (!solidTile(x, y) && nr === undefined && !blocker) continue;
    m[sl] |= bit;
    if (nr !== undefined) subtract[sl].push(`- var(--fullyOpen${nr}) * ${bit}`);
  }
  return { m, subtract };
}

// A probe: a point dl ahead along the view direction and dp to the side,
// reduced to "is this tile solid". Row masks are 16 bits wide, because numbers
// in custom properties are SINGLE precision: 0xFFFF comes out exactly, 0xFFFFFF
// does not.
function probeCss(name, distExpr, dp) {
  const w = [];
  const P = `--${name}`;
  for (const [suffix, syntax] of [['x', '<integer>'], ['y', '<integer>'], ['mi', '<integer>'],
                            ['m', '<number>'], ['solid', '<integer>']])
    w.push(`@property ${P}${suffix} { syntax: '${syntax}'; initial-value: 0; inherits: true }`);
  for (let i = 0; i < MASKS; i++)
    w.push(`@property ${P}m${i} { syntax: '<number>'; initial-value: 0; inherits: true }`);

  // the perpendicular of (dx,dz) is (-dz,dx) — hence the signs on the sideways
  // offset
  const X = `calc(var(--px) + (${distExpr}) * var(--dx) - ${f6(dp)} * var(--dz))`;
  const Z = `calc(var(--pz) + (${distExpr}) * var(--dz) + ${f6(dp)} * var(--dx))`;
  w.push(`.${name} {
  ${P}x: clamp(0, round(down, calc((${X}) / ${U}), 1), 63);
  ${P}y: clamp(0, round(down, calc((${Z}) / ${U}), 1), 63);
  ${P}mi: round(down, calc(var(${P}x) / ${MASK_BITS}), 1);
  container: ${name} / normal }`);
  for (let y = 0; y < 64; y++) {
    const { m, subtract } = rowMasks(y);
    w.push(`@container ${name} style(${P}y: ${y}) { .${name}w { ${
      m.map((v, i) => `${P}m${i}: ${subtract[i].length
        ? `calc(${v} ${subtract[i].join(' ')})` : v}`).join('; ')} } }`);
  }
  w.push(`.${name}w { container: ${name}w / normal }`);
  for (let i = 0; i < MASKS; i++)
    w.push(`@container ${name}w style(${P}mi: ${i}) { .${name}b { ${P}m: var(${P}m${i}) } }`);
  w.push(`.${name}b { ${P}solid: mod(round(down, calc(var(${P}m) / pow(2, mod(var(${P}x), ${MASK_BITS})))), 2) }`);
  return w.join('\n');
}

// The margin grows with speed, because the running-step flag is known HIGHER UP
// than the probes — inheritance happens to work in our favour here.
// It is the EFFECTIVE step that counts, not the requested one: once the far
// probe has cut running, the player is walking, so the margin should drop from
// 89 back to 54. Otherwise they would stop a whole tile short of the wall and
// an invisible barrier would be visible.
// --mF1 is already the EFFECTIVE step: the clamp physically prevents reaching
// it when the far probe calls for a slowdown, so it needs no correction.
const DL_F = `${f6(RADIUS + MARGIN)} + var(--mF1) * ${MARGIN_RUN}`;
// A seventh probe stands UNDER the player and is a safety valve: if you somehow
// end up inside a wall, both locks release. Without it you could wedge
// permanently — and wedging is worse than clipping through.
// Backwards is walk-only, so its probe needs no running supplement.
const DL_B = `-1 * ${f6(RADIUS + MARGIN)}`;
const PROBE_DEFS = [{ n: 'swf', dl: `${FAR}`, dp: 0 },
                   { n: 'sc0', dl: '0', dp: 0 }];
for (let i = 0; i < PROBE_OFF.length; i++) {
  PROBE_DEFS.push({ n: `sf${i}`, dl: DL_F, dp: PROBE_OFF[i] });
  PROBE_DEFS.push({ n: `sb${i}`, dl: DL_B, dp: PROBE_OFF[i] });
}

function collisionCss() {
  const w = [];
  for (const s2 of PROBE_DEFS) w.push(probeCss(s2.n, s2.dl, s2.dp));
  const sumF = PROBE_OFF.map((_, i) => `var(--sf${i}solid)`).join(' + ');
  const sumB = PROBE_OFF.map((_, i) => `var(--sb${i}solid)`).join(' + ');
  w.push(`
@property --solidF { syntax: '<integer>'; initial-value: 0; inherits: true }
@property --solidB { syntax: '<integer>'; initial-value: 0; inherits: true }

/* The three near probes combined with OR: any hit means a wall in front. The
   fourth, further out, only switches off the running step.

   THE SAFETY VALVE IS LIMITED, and both extremes were measured.
   An unlimited valve ("inside a wall? then walk") tunnelled: one frame hitch
   pushed the player into a wall, the valve opened and from then on they walked
   through wall after wall — in the measurement they escaped the map and
   travelled 14,232 px, because outside the board the probe clamps the tile to
   the edge, which is also solid, so the condition never ended. No valve at all
   gives the opposite evil: a player pushed into a thick wall is stuck for good
   (measured: 1245 frames, zero distance).
   The right version is in between: inside a wall you may walk only when there
   is FLOOR ${FAR} px ahead of you. The escape is therefore limited to two and
   a half tiles and always ends on open ground.

   NO LOOP. The whole path back up the chain disappeared along with it: the
   stick sits BELOW the probes in the tree, so it reads them by plain
   inheritance, and what used to be a "stop" signal is now simply a shorter
   range. */
.probeOR { --solidF: clamp(0, calc(${sumF}), 1);
           --fwdRange: calc((1 - var(--sc0solid))
                         * (1 - var(--solidF))
                         * (${WALK_CLAMP} + (1 - var(--swfsolid)) * ${THROW - WALK_CLAMP})
                       + var(--sc0solid) * (1 - var(--swfsolid)) * ${WALK_CLAMP});
           --solidB: clamp(0, calc(${sumB}), 1);
           /* Backwards: no valve. You get out of a wall FORWARDS, because that
              is the only direction with a limited gate — reversing inside a
              wall would only make the problem worse. */
           --back: calc((1 - var(--sc0solid)) * (1 - var(--solidB)) * ${BACK_RANGE});
           container: koliz / normal }

/* The 2D plan is a diagnostic tool, not part of the game. */
.minimap { position: absolute; left: 6px; top: 6px; width: 128px; height: 128px;
        background: url(wolf-minimap.png) 0 0 / 128px 128px no-repeat #05070b;
        image-rendering: pixelated; border: 1px solid #2b3341;
        box-shadow: 0 2px 10px #000a }
.minimap { filter: brightness(.62) contrast(1.15) }
.minimap > i { filter: brightness(2.4) }
.minimap > i { position: absolute; left: 0; top: 0 }
.minimap .me { width: 5px; height: 5px; margin: -2px; border-radius: 50%;
            background: #6fd6c6; box-shadow: 0 0 0 1px #000;
            translate: calc(var(--px) * 0.03125px) calc(var(--pz) * 0.03125px) }
.minimap .look { width: 12px; height: 1px; transform-origin: 0 50%;
               background: linear-gradient(90deg, #6fd6c6, #6fd6c600);
               translate: calc(var(--px) * 0.03125px) calc(var(--pz) * 0.03125px);
               rotate: calc(var(--h) * 1deg - 90deg) }
/* The dot turns red when forward travel is taken away — collision visible
   directly on the plan. */
@container koliz style(--fwdRange: 0) { .minimap .me { background: #e2726e } }`);
  return w.join('\n');
}

function chainHtml(body) {
  let r = `<div class="sum">\n${COLLISION ? probesHtml(body) : body}\n</div>`;
  // One backward accumulator per bucket (backwards is walk-only) and two forward.
  for (let k = BUCKETS - 1; k >= 0; k--) {
    r = `<div class="ak b${k}">\n${r}\n</div>`;
    for (let j = MOVE_STEPS.length - 1; j >= 0; j--)
      r = `<div class="ak f${k}_${j}">\n${r}\n</div>`;
  }
  r = `<div class="heading">\n${r}\n</div>`;
  for (let j = TURN_STEPS.length - 1; j >= 0; j--)
    r = `<div class="turnP${j}"><div class="turnL${j}">\n${r}\n</div></div>`;
  r = `<div class="rdx"><div class="rdy"><div class="rdb">\n${r}\n</div></div></div>`;
  // Two levels for the doors, shared by all 22: one carries the animations (one
  // slot per door), the other reads the "fully open" value off them — an
  // animated value is read on a descendant.
  if (DOORS || ENEMIES)
    r = `<div class="stateAnim"><div class="stateRead">\n${r}\n</div></div>`;
  return r;
}

// The probes are threaded one inside another — each needs three levels: the
// row, the choice of mask, and the extraction of the bit. At the bottom sit the
// OR, the flags and the SNAP TARGET, with the scene right behind the target so
// that snapping parks it inside the viewport.
function probesHtml(body) {
  let inner = body;
  // Waking and frame selection MUST sit below the probes: the "I can see the
  // player" condition is computed from the player's position, and the waking
  // latch then has to be read when the frame is chosen. Higher up would close
  // a loop.
  // The view and the status bar share one wrapper: together they are exactly
  // the original's 320x200 (160 + 40 rows), so the start screen can cover both.
  if (ITEMS || ENEMIES)
    inner = `<div class="hudRead"><div class="gameScreen">\n${inner}\n` +
      `${hudHtml()}\n${introHtml()}\n</div></div>`;
  if (WEAPONS) inner = `<div class="cooldown"><div class="cooldownRead">\n${inner}\n</div></div>`;
  if (ENEMIES) inner =
    `<div class="waker"><div class="enemyFrames"><div class="blood">\n${inner}\n</div></div></div>`;
  // The loot MUST sit above the blood: health is `100 - damage + healing`, so
  // the status bar at the very bottom reads both sums at once.
  if (ITEMS) inner =
    `<div class="loot"><div class="spoils">\n${inner}\n</div></div>`;
  let r = `<div class="probeOR">\n${inner}\n</div>`;
  if (WEAPONS) r = `<div class="mgLatch">\n${r}\n</div>`;
  for (let i = PROBE_DEFS.length - 1; i >= 0; i--) {
    const n = PROBE_DEFS[i].n;
    r = `<div class="${n}"><div class="${n}w"><div class="${n}b">\n${r}\n</div></div></div>`;
  }
  return r;
}

// ============================================================ the page
const COMMON_CSS = `:root { --bg:#0d0f13; --fg:#e9e7e0; --dim:#7f8189; --edge:#23272e }
* { box-sizing:border-box }
html { -webkit-text-size-adjust:100% }
/* A size container on <body> so the screen can measure the width it really has.
   Everything the game counts lives inside it, so the style containment that
   comes with container-type crosses no counter scope. */
body { container:page / inline-size; margin:0; padding:${PAD_WIDE}; background:var(--bg); color:var(--fg);
       font:15px/1.6 ui-sans-serif, system-ui, sans-serif }
h1 { font-size:1.3rem; margin:0 0 .3rem }
.lead { color:var(--dim); max-width:62rem; margin:0 0 1.1rem; font-size:.9rem }
.lead b { color:var(--fg) }
code { font-family:ui-monospace, Menlo, monospace; font-size:.88em; color:#b7c5d8 }
a { color:#6fd6c6 }

/* Stretching 320x200 to 4:3: the original's pixels are 1.2x taller than wide. */
.frame { width:${W}px; height:${H * ASPECT}px; overflow:hidden; border:2px solid #000;
        background:#000; position:relative; overscroll-behavior:none }
.screen { width:${W}px; height:${H}px; overflow:hidden; position:relative;
         transform-origin:0 0; scale:1 ${ASPECT} }
/* overflow and perspective MUST live on different elements, or the 3D context
   is flattened. */
/* The billboard angle is computed ONCE. A hundred and fifty-nine sprites each
   had their own calc(var(--h) * -1deg) — the same value, recomputed separately
   on every one of them on every heading change. A registered property is
   inherited as a computed value, so this leaves one computation and 159
   substitutions. */
@property --billboardTurn { syntax: '<angle>'; initial-value: 0deg; inherits: true }
.world { position:absolute; inset:0; perspective:${PERSP}px; transform-style:preserve-3d;
         --billboardTurn: calc(var(--h) * -1deg) }
.eye, .turn, .position { position:absolute; left:50%; top:50%; transform-style:preserve-3d }
.eye   { translate:0 0 ${PERSP}px }
.turn { rotate:y calc(var(--h) * 1deg) }

.f { position:absolute; left:0; top:0; width:${STEP}px; height:${U}px;
     margin:${-U / 2}px ${-STEP / 2}px; transform-style:preserve-3d;
     background-image:url(wolf-atlas.png); background-repeat:no-repeat;
     background-size:${ATL_W}px ${ATL_H}px; image-rendering:pixelated;
     pointer-events:none }
.g { position:absolute; left:0; top:0; width:${BLOK * U}px; height:${BLOK * U}px;
     margin:${-BLOK * U / 2}px; pointer-events:none }
.gp { background:${rgb(M.floorColour)}; transform:rotateX(90deg) }
.gs { background:${rgb(M.ceilColour)};   transform:rotateX(90deg) }

.stats { margin-top:.6rem; font:12px ui-monospace, Menlo, monospace; color:var(--dim) }
.stats b { color:#6fd6c6 }
`;

const world = zDrzwiami => `<div class="world"><div class="eye"><div class="turn"><div class="position">
${ENEMIES ? enemiesHtml() : ''}
${ITEMS ? staticsHtml() : ''}
${slabs.map(s => '  ' + s).join('\n')}
${panels.map(s => '  ' + s).join('\n')}
${zDrzwiami ? panelsDoor.map(s => '  ' + s).join('\n') : ''}
${panelsPush.map(s => '  ' + s).join('\n')}
</div></div></div></div>`;

// By default the page shows ONLY what was in the game. Every prosthesis of mine
// — the minimap, the hint line, the crosshair outline, coloured scrollbars, the
// statistics row — appears only once the "debug" box is ticked.
//
// The scrollbars lose their COLOUR, not their width. Those 12 px count towards
// the width of the stick's window, and the horizontal rest point is measured
// against it: the pad sits at 700, the window is 621 wide, so rest falls at
// 389.5. Hiding the scrollbar with width:0 would widen the window to 633 and
// shift the turn zero by 6 px — the stick would acquire a permanent bias one
// way. Measured, not deduced.
//
// The crosshair highlight STAYS in both modes: in the original a door was
// opened with a key, here with a click, so without that one signal the game
// cannot be played.
const debugCss = () => `
.diffs { max-width:82rem; margin:0 0 .7rem; padding:.4rem .75rem .55rem;
         border:1px solid var(--edge); border-radius:8px; background:#0f131a;
         font-size:.82rem; color:var(--dim); line-height:1.5 }
.diffs summary { cursor:pointer; color:var(--fg); font-size:.86rem;
                 padding:.15rem 0; user-select:none }
.diffs ul { margin:.45rem 0 .15rem; padding:0 0 0 1rem; columns:3; column-gap:1.6rem }
.diffs li { margin:0 0 .35rem; break-inside:avoid }
@media (max-width: 78rem) { .diffs ul { columns:2 } }
.diffs b { color:var(--fg); font-weight:600 }
@media (max-width: 52rem) { .diffs ul { columns:1 } }
/* The list is a real <details>, but only on a narrow screen. Thirteen bullets
   in one column push the game 1158px down a 390px-wide page — a screen and a
   half of scrolling before you can play — so on a phone it starts collapsed
   and is one tap away. From 40rem up it is forced open and the marker and the
   toggle are taken away, so it reads as a plain block above the game. */
@media (min-width: 40rem) {
  .diffs::details-content { content-visibility:visible }
  .diffs summary { list-style:none; pointer-events:none }
  .diffs summary::-webkit-details-marker { display:none }
}
.controls { max-width:48rem; margin:0 0 .55rem; padding:.55rem .75rem;
              border:1px solid var(--edge); border-radius:8px; background:#0f131a;
              font-size:.88rem; color:var(--dim); line-height:1.55 }
.controls b { color:var(--fg) }
/* --- MAXIMISE. Real fullscreen needs requestFullscreen(), which is JavaScript,
   and this page has none. What a checkbox can do is lift the game out of the
   flow, pin it to the viewport and blow it up.

   The factor is exact rather than stepped: current Chrome CAN divide a length
   by a length inside calc(), so "the largest that fits" is one expression — the
   smaller of the two axes' ratios. dvh rather than vh, so the game is not left
   half-hidden behind a phone browser's retracting toolbar.

   Scaling with a TRANSFORM, not by resizing: the whole engine is calibrated in
   pixels (perspective 437.5px, every plane placed by translate), and the stick's
   scroll ranges are layout pixels too. A transform leaves layout alone, so the
   controls keep exactly the calibration they were measured with. */
.maxBtn { display:inline-block; margin-left:.9rem; padding:.15rem .55rem;
          border:1px solid var(--edge); border-radius:4px; cursor:pointer;
          user-select:none; color:var(--dim) }
.maxBtn:hover { border-color:#6fd6c6; color:var(--fg) }
.maxBtn:has(:focus-visible) { outline:2px solid #6fd6c6; outline-offset:2px }
.maxBtn input { position:absolute; width:0; height:0; opacity:0; margin:0 }
.maxOut { display:none; position:fixed; right:12px; top:12px; z-index:21;
          padding:.2rem .5rem; border:1px solid #6fd6c655; border-radius:4px;
          background:#0d0f13cc; color:#8a9098; cursor:pointer; user-select:none;
          font:12px ui-monospace, Menlo, monospace }
.maxOut:hover { color:var(--fg); border-color:#6fd6c6 }
/* Maximise pins the screen to the viewport, and a size container is a
   containing block for fixed descendants — so it has to go while that lasts. */
body:has(#big:checked) { overflow:hidden; container-type:normal }
body:has(#big:checked) .maxOut { display:block }
/* The letterbox. A pseudo-element rather than a div, so the markup does not
   grow for something only one state ever shows. */
body:has(#big:checked)::before { content:''; position:fixed; inset:0;
                                 background:#000; z-index:19 }
body:has(#big:checked) .gameScreen { position:fixed; left:50%; top:50%; z-index:20;
                                     transform-origin:50% 50%; translate:-50% -50%;
                                     scale:min(calc(100vw / ${W}px),
                                               calc(100dvh / ${GAME_H}px)) }

/* --- NARROW SCREENS. The page around the game gets out of the way, and the
   screen's own factor follows the smaller padding so the two stay in step. */
@media (max-width: 40rem) {
  body { padding:${PAD_NARROW} }
  h1 { font-size:1.05rem }
  .lead { font-size:.82rem; margin-bottom:.7rem }
  .diffs, .controls { font-size:.78rem; padding:.4rem .55rem }
  .diffs summary { font-size:.8rem }
  .maxBtn { display:block; width:max-content; margin:.4rem 0 0 }
}
.toggle { margin:0 0 .6rem; font:12px ui-monospace, Menlo, monospace; color:var(--dim) }
.toggle label { cursor:pointer; user-select:none }
.toggle input { margin-right:.4rem; vertical-align:-1px }
.minimap, .hint, p.stats { display:none }
body:has(#debug:checked) .minimap { display:block }
body:has(#debug:checked) .hint { display:block }
body:has(#debug:checked) p.stats { display:block }
body:has(#debug:checked) .trigger { outline:1px dashed #6fd6c655 }
body:has(#debug:checked) .trigger:focus { outline-style:solid; outline-color:#6fd6c6 }
body:has(#debug:checked) .stick { scrollbar-width:auto; scrollbar-color:#6fd6c6 #0e1218 }
`;

// CO SIĘ RÓŻNI OD ORYGINAŁU. Lista stoi NAD grą, nie pod nią, i jest domyślnie
// rozwinięta: połowa tych punktów to rzeczy, o które gracz inaczej oskarżyłby
// grę o zepsucie — pies, który nie gryzie, wróg, który nie goni, i klawiatura,
// która nic nie robi. <details> zamiast skryptu, więc da się to zwinąć bez
// ani jednej linijki JavaScriptu.
const differencesHtml = () => `<details class="diffs">
  <summary>How this differs from the original &mdash; and what does not work</summary>
  <ul>
    <li><b>Chrome or Edge, and a quick machine.</b> Every frame restyles about
      thirteen hundred elements with no game loop to skip work, so a slow CPU
      shows up as stutter. Safari cannot walk backwards; Firefox cannot run it.</li>
    <li><b>Enemies never walk.</b> They stand where the map put them, turn, wake
      and shoot. Chasing needs memory per actor, and CSS cannot write anything
      down.</li>
    <li><b>Dogs do not attack.</b> They wake and turn towards you, and that is
      all.</li>
    <li><b>You survive far longer than in the original.</b> Damage arrives at a
      steady 0.6 points a second instead of in random hits, so a guard needs
      about three minutes to finish you. Scroll-aiming is harder than a mouse
      and the port has rough edges, so the difficulty is turned down on
      purpose.</li>
    <li><b>No keyboard.</b> CSS cannot see a key: scroll to move, click the
      crosshair to act.</li>
    <li><b>No strafing, no sliding along walls.</b> A blocked direction is
      blocked completely.</li>
    <li><b>Nothing is random.</b> Damage rolls became a fixed number of clicks
      by range: one close, two medium, three far.</li>
    <li><b>An open door still blocks an enemy's sight</b> &mdash; and their
      bullets.</li>
    <li><b>The machine gun costs no more ammunition than the pistol</b>, though
      a burst should be three rounds.</li>
    <li><b>Death is final and the lift leads nowhere.</b> One level, and
      reloading is the only restart.</li>
    <li><b>No sound, saving, difficulty levels or extra lives.</b></li>
    <li><b>Smaller things:</b> the end-screen bonus never reaches the score,
      there is no fizzle fade, and the key slots stay empty &mdash; E1M1 has no
      keys.</li>
    <li><b>There are bugs.</b> Something will misbehave sooner or later.</li>
  </ul>
</details>`;

// THE CONTROLS GO ABOVE THE GAME, not below it. The input here is unusual —
// there are no keys, because CSS cannot see a key; there is scrolling and
// clicking — so without these two sentences the player simply will not move.
const controlsHtml = () => `<p class="controls">
  <b>Controls:</b> <b>scroll on the picture</b> with a wheel or a trackpad
  &mdash; vertically you walk forwards and backwards, horizontally you turn.
  ${WEAPONS || DOORS ? `<b>Click the crosshair</b> to ${
    [WEAPONS ? 'shoot' : null,
     DOORS ? 'open doors, secret walls and the lift' : null].filter(Boolean).join(' and ')
    } &mdash; the crosshair changes colour when there is something to use.` : ''}
</p>`;



const toggleHtml = () => `<p class="toggle"><label>` +
  `<input type="checkbox" id="debug" autocomplete="off">` +
  `debug overlays (not in the game: minimap, crosshair outline, scrollbars, statistics)` +
  `</label>` +
  `<label class="maxBtn"><input type="checkbox" id="big" autocomplete="off">` +
  `&#9974; maximise</label></p>` +
  `<label class="maxOut" for="big">&times; exit &mdash; F11 for real fullscreen</label>`;

// The build stages, kept as a record of what arrived in what order. The page
// itself is generated only once, from FINAL — but every feature is gated by
// `E.n >= …`, numbered by the stage that introduced it, and FINAL carries the
// number after the last one, so it opens all of them. Adding a feature behind a
// new gate therefore lands in the build with nothing else to update.
//
//   1  static scene            geometry, textures, camera parked at the spawn
//   2  the stick               walking and turning as integrals over scrolling
//   3  collision               walls take the stick's range away
//   4  doors                   the original 6.114 s cycle, opened by the crosshair
//   5  items                   121 statics, 48 of them collectable
//   6  enemies                 37 of them, waking, shooting, dying
//   7  secrets and the lift    pushwalls and the end of the level
//   8  weapons                 ammunition, hit thresholds, machine gun, knife
//   9  line of sight           precomputed visibility replaces the region guess
const LAST_STAGE = 9;

// The released page. It has its own file rather than another number, because it
// is not a step in the build but what came out of it: the full feature set with
// none of the "what this stage adds" narrative. The history lives in docs/.
const FINAL = {
  n: LAST_STAGE + 1, file: 'index',
  blurb: `The first level of Wolfenstein 3D, played in a browser with <b>no
    JavaScript on the page</b> &mdash; the walking, the collision, the doors,
    the enemies and the shooting are all computed by the CSS engine. Geometry
    and artwork come from the original game data. How it is done, with the
    measurements and the dead ends, is in the
    <a href="${REPO}#readme">project documentation</a>.`,
};
// Analiza opisana przy wywołaniu niżej. Parser świadomy nawiasów, bo reguły
// siedzą także wewnątrz @container i @media.
const PAGES = [FINAL];
const fileOf = E => E.file || `stage-${E.n}`;

for (const E of PAGES) {
  const file = fileOf(E);
  const movable = E.n >= 2;
  COLLISION = E.n >= 3;
  DOORS = E.n >= 4;
  ITEMS = E.n >= 5;
  ENEMIES = E.n >= 6;
  LIFT = E.n >= 7;
  SECRETS = E.n >= 7;
  WEAPONS = E.n >= 8;
  SIGHT = E.n >= 9;
  const body = `<div class="frame">
  <div class="screen"${movable ? '' : ` style="--h:${cssH0};--px:${gx};--pz:${gz}"`}>
${world(E.n !== 3).split('\n').map(s => '    ' + s).join('\n')}
  </div>
  ${movable ? '<div class="stick"><div class="pad"></div>'
      + '<div class="back"><i class="aimBack"></i></div></div>'
      + '<button type="button" autofocus class="trigger"></button>' : ''}
  ${COLLISION ? '<div class="minimap"><i class="look"></i><i class="me"></i></div>' : ''}
  ${DOORS ? `<p class="hint">crosshair: ${DOORS ? 'yellow &mdash; door' : ''}${
  SECRETS ? ', blue &mdash; secret wall' : ''}${
  LIFT ? ', red &mdash; lift' : ''}. click to use</p>` : ''}
  ${DOORS ? useLabelsHtml() : ''}
  ${LIFT ? liftHtml() : ''}
  ${SECRETS ? secretsHtml() : ''}
  ${ENEMIES ? '<i class="flash"></i>' : ''}
  ${WEAPONS ? weaponHtml() : ''}
  ${ENEMIES ? '<i class="death"></i>' : ''}
  ${LIFT ? endScreenHtml() : ''}
</div>`;

  const bodyHtml = movable
    ? `<div class="game">\n` +
      `${ITEMS || ENEMIES
        ? '<input class="boxesD" type="checkbox" id="play" autocomplete="off">\n' : ''}` +
      `${DOORS ? doorsHtml() + '\n' : ''}` +
      `${ENEMIES ? enemiesBoxes() + '\n' + abacusHtml() + '\n' : ''}` +
      `${LIFT ? liftBoxes() + '\n' : ''}` +
      `${SECRETS ? secretsBoxes() + '\n' : ''}` +
      `${chainHtml(body)}\n</div>`
    : body;

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wolfenstein 3D E1M1 in pure CSS</title>
<link rel="stylesheet" href="${file}.css">

<h1>Wolfenstein 3D &mdash; E1M1 in pure HTML and CSS</h1>
<p class="lead">${E.blurb}</p>

${differencesHtml()}
${movable ? controlsHtml() : ''}
${toggleHtml()}
${bodyHtml}
<p class="noBack">Walking backwards is disabled in Safari: the inner scroll
container that handles it measures its deflection from the opposite end to its
own position there, and without that it would swallow the forward gesture.
Forward movement and turning work.</p>

<p class="stats">
  planes <b>${panels.length + slabs.length + panelsPush.length
    + (E.n !== 3 ? panelsDoor.length : 0)}</b> &nbsp;
  ${ENEMIES ? `enemies <b>${alive.length}</b> &nbsp; killed <b class="vKills"></b>
    <b class="pctK"></b> &nbsp;` : ''}
  ${ITEMS ? `treasure <b class="vTreasure"></b> <b class="pctT"></b> &nbsp;
    ${SECRETS ? `secrets <b class="vSecret"></b> <b class="pctS"></b> &nbsp;` : ''}
    score <b class="vScore"></b> &nbsp;` : ''}
  perspective <b>${PERSP}px</b> &nbsp; FOV <b>72.37&deg;</b>
  ${movable ? `&nbsp; chain levels <b>${BUCKETS * (MOVE_STEPS.length + 1) + TURN_STEPS.length * 2 + 4 + (COLLISION ? PROBE_DEFS.length * 3 + 1 : 0) + (DOORS ? 2 : 0)}</b>` : ''}
  ${DOORS ? `&nbsp; doors <b>${doorLeaves.length}</b>` : ''}
</p>
`;

  const css = `/* ==========================================================================
   WOLFENSTEIN 3D E1M1 — GENERATED: node build/generate.mjs
   Do not edit. ${wallFaces.length} wall faces + ${doorLeaves.length} door leaves,
   ${SUB} panel(s) each = ${panels.length} planes.
   ========================================================================== */
${COMMON_CSS}
${E.n !== 3 ? doorPropsCss() : ''}
${liftPropsCss()}
${DOORS ? doorsCss() : ''}
${ITEMS ? staticsCss() : ''}
${ITEMS || ENEMIES ? statusCss() + '\n' + hudCss() + '\n' + screensCss() : ''}
${debugCss()}
${ENEMIES ? enemiesCss() : ''}
${LIFT ? liftCss() : ''}
${SECRETS ? secretsCss() : ''}
${statesCss()}
${movable ? controlsCss() + (COLLISION ? '\n' + collisionCss() : '') : `.position { translate:calc(var(--px) * -1px) 0 calc(var(--pz) * -1px) }`}

${pos.join('\n')}
${E.n !== 3 ? posDoor.join('\n') : ''}
${posPush.join('\n')}
`;
  // ---- ZAWĘŻENIE DZIEDZICZENIA ------------------------------------------
  // Every registered custom property is emitted as `inherits: true`, because
  // that is what the chain needs — a value written high up has to reach the
  // planes at the bottom. But a good third of them never travel anywhere: they
  // are computed on one element and consumed on that same element, either by
  // another declaration beside them or by a container query whose container IS
  // that element.
  //
  // Those cost real time. An inherited custom property is part of every
  // descendant's computed style, and this page recalculates ~1300 elements per
  // frame, so each one is carried 1300 times over and allocated again whenever
  // the parent's map changes — which is what fills the trace with Oilpan sweeps.
  //
  // Rather than hand-maintain a list that would rot, the stylesheet is analysed
  // after it is assembled: a property is downgraded to `inherits: false` only if
  // every var() that reads it sits in a rule whose selector also declares it,
  // and every container query that tests it names a container established by
  // one of those same selectors. Anything read by a descendant — or queried
  // through a container further down, which is the case for the door states —
  // keeps inheriting.
  writeFileSync(join(OUT, `${file}.html`), html);
  writeFileSync(join(OUT, `${file}.css`), css);
  console.log(`${file}.html ${(html.length / 1024).toFixed(1)} kB` +
              `, css ${(css.length / 1024).toFixed(1)} kB`);
}

console.log(`wall faces ${wallFaces.length}, doors ${doorLeaves.length}, ` +
            `panels ${panels.length}, slabs ${slabs.length}`);
console.log(`controls: ${BUCKETS * MOVE_STEPS.length} forward accumulators + ` +
            `${BUCKETS} backward, ${TURN_STEPS.length * 2} turning`);
console.log(`speeds: walk ${MOVE_RATE[0]} px/s, run ${MOVE_RATE[0] + MOVE_RATE[1]} px/s; ` +
            `turn ${TURN_RATE}..${TURN_RATE * 4} deg/s`);
