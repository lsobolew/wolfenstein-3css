# Architecture

How a stylesheet ends up running a first-person shooter.

## The build pipeline

Nothing here is written by hand. Two Node scripts produce the whole site:

```
your copy of Wolfenstein 3D
        │
        │  build/extract.mjs
        │    Carmack + RLEW decompression of GAMEMAPS
        │    VSWAP column/run sprite decoding
        │    VGAGRAPH Huffman + VGA latch planar decoding
        ▼
   dist/*.png            .cache/map.json
   (five atlases)        (map, statics, enemies, doors, sprite index)
        │                        │
        │                        │  build/generate.mjs
        │                        ▼
        └──────────────►  dist/index.html + dist/index.css
```

The generator is where the interesting work happens, and it does two distinct
jobs. The obvious one is emitting markup and rules. The other one is **moving
computation from run time to build time**: anything that depends only on the
map — which is to say, anything that does not move — is solved in JavaScript
during the build and shipped as a lookup table of bits.

That second job is the reason the port is possible at all. Three features
looked impossible until it was applied:

- **Pushwall directions.** Which way a secret wall slides depends on which side
  has floor behind it. An iterative flood fill answers that once, at build time.
- **Blocking statics.** Whether a barrel cuts the level in two is a reachability
  question. The build runs the flood fill twice — with and without the statics —
  and asserts that no loot and no elevator tile was orphaned.
- **Line of sight.** See below; this was the one that fooled me twice.

## Time is nesting depth

One computation step is one DOM level. A value is written on a parent as a
registered custom property, read on the child, transformed, and written again:

```css
@property --a  { syntax: '<integer>'; initial-value: 0; inherits: true }
@property --na { syntax: '<integer>'; initial-value: 0; inherits: true }

.compute { --na: mod(calc(var(--a) + 1), 16) }   /* reads parent, writes next */
.commit  { --a: var(--na) }                       /* renames it for the next step */
```

Two levels per step, not one: `--a: calc(var(--a) + 1)` on a single element is a
cycle, and a registered property answers a cycle with its *initial value* rather
than an error, so the whole chain silently fills with zeros.

The playable page is **87 levels deep**. The interesting consequence is that
cost scales with the *width* of the computation — how many rules match at each
level — not with the number of steps. A rule indexed by state fires on every
level where that state holds, which removes the step axis from the cost model
entirely.

## Where the camera lives

Nowhere. There is no element holding the player's position.

`animation-timeline: scroll()` maps a scroll container's position onto an
animation's progress. Point two of those at registered `<number>` properties and
you have two integrators, driven directly by the user's gesture:

- the **turn** container feeds the heading,
- the **forward** container feeds distance travelled, split across eight heading
  buckets so that `--px` and `--pz` can be accumulated without trigonometry at
  run time.

Heading and position are therefore *integrals over time*, recomputed every
frame from scroll offsets. The DOM never learns them. This is also why nothing
survives a reload: there is no state to survive.

Backwards movement needs its own container, because a clamped scroll range can
only lose its **upper** end — you can always scroll back to zero. So forward
lives on the outer container (resting at the top, travelling down) and backward
on a nested one (resting at the end, travelling up). A downward gesture, when
the inner container is already at its end, is handed to the outer one by the
browser's own scroll chaining. No JavaScript, and no loop up the tree.

## Collision as layout

The natural design is: notice the wall, then stop the player. That needs the
"wall!" signal to travel from the probe *up* to the movement integrator, and
computed values only ever travel down.

So the port inverts it. Probes hang below the position sum, read the tile in
front of the player out of a bitmask, and set the height of a spacer inside the
scroll container. A wall makes the spacer short; a short spacer means a small
scroll range; the browser clamps the scroll position into that range. Walking
into a wall stops being an event to handle and becomes a thing that cannot be
expressed — like scrolling past the bottom of a page.

Three consequences fell out of it:

- it is exact, and it applies **mid-gesture**, which a snap-based approach does
  not;
- it removed every loop from the design, and with it the whole class of bugs
  where a stop signal arrives one frame late;
- it gave the projection a free win: because the player's radius equals
  `MINDIST`, the camera can never reach a wall face, so wall planes never need
  near-plane clipping and never had to be subdivided.

There is one deliberate escape valve. A probe directly under the player unlocks
movement if you somehow end up *inside* a wall — but only towards floor, and
only for two and a half tiles. Both extremes were measured: with no valve the
player can wedge permanently (1245 frames, zero distance travelled); with an
unlimited valve a single frame hitch tunnels them through wall after wall
(14 232 px travelled, off the edge of the map).

## Latching: how CSS remembers

CSS can read state but cannot write it — nothing can tick a checkbox. It can,
however, **commit a value of its own**: an animation that runs for one
millisecond with `animation-fill-mode: forwards` moves a registered property
from 0 to 1 and holds it there forever. Start it paused, and release it with a
container query:

```css
@property --picked { syntax: '<integer>'; initial-value: 0; inherits: true }
@keyframes take { from { --picked: 0 } to { --picked: 1 } }

.latches { --slot: paused; animation: take 1ms steps(1, end) forwards var(--slot) }
@container probe style(--tile-x: 19) and style(--tile-y: 16) {
  .latches { --slot: running }
}
```

Walk onto the tile, the query matches, the animation is released, and the item
stays picked up after you leave. This one pattern carries item pickup, enemy
waking, opened doors, pushed secrets and the machine gun.

All the latches for one category share a single element, because
`animation-name` is *one list* — a second rule on the same element replaces the
list rather than adding to it. So 48 items are 48 entries in one
`animation-name`, each with its own `animation-play-state` slot.

## Enemies, and the thing I was wrong about twice

Thirty-seven guards and dogs are billboards: sprites rotated to face the camera,
with the rotation frame chosen by `atan2` between the player's position and the
enemy's fixed one.

Waking used to be gated by an approximation — the level was partitioned into
regions at build time, and an enemy woke if the player was in its region. It was
cheap and it stopped enemies shooting through walls, but it also meant a guard
around a corner *of the same room* could see you. I wrote twice that a real ray
was impossible: sampling tiles along a segment is a loop, and each sample would
cost a DOM level, which thirty-seven enemies cannot afford.

That was wrong, and the reason it was wrong is the whole lesson of this project:
**the enemy does not move, and the map does not change.** The set of tiles an
enemy can be seen from is therefore *constant*. It is computed once, at build
time, with an ordinary supersampled ray, and emitted as per-row bitmasks. At run
time CSS reads one bit — the same machinery as the collision masks.

Restricting each mask to the 13×13 window the distance gate already allows makes
thirteen bits fit in one number, so a map row costs about eight declarations
instead of a hundred and fifty. The result was **smaller** than the region
approximation it replaced: 376 KB against 384 KB.

On E1M1 there are 104 tiles where the old gate woke an enemy that could not
possibly have seen the player.

## Rendering

Wall faces are `<div>`s in a `transform-style: preserve-3d` scene, positioned by
`translate` and rotated by `rotate: y`. The camera is `perspective: 437.5px` on
an ancestor — `0.68359375 × 640`, which is the original's `scale` constant, so
the field of view comes out at the original 72.37° and a wall one tile high at
distance *d* is `437.5/d` pixels tall, exactly as `CalcHeight` computes it.

The view is 320×160 native, scaled ×2 horizontally and ×2.4 vertically, because
the 320×200 mode was displayed on a 4:3 monitor. The status bar is the remaining
40 rows. Together they are exactly 320×200, which is why the title screen can
cover both.

Plane count went from 2218 to **828** in one pass of the same question — *is
this ever visible?*

- 512 wall faces pointed outside the map and were deleted;
- wall subdivision (two 32 px panels per face) turned out to be unnecessary,
  because collision keeps the camera off every face, so `SUB` went to 1;
- floor and ceiling slabs went from 8×8 tiles to 16×16.

Sprites and the weapon are flat elements with `background-position` picked
arithmetically from an atlas, so one rule serves all eight rotation frames.

## The status bar and the screens

Both are the original artwork, decoded out of `VGAGRAPH` — Huffman with the
dictionary in `VGADICT`, three-byte offsets in `VGAHEAD`, and images stored in
VGA *latch planar* layout, where plane *p* holds the pixels with `x & 3 === p`.

Numbers are drawn the way `LatchNumber` draws them: one element per digit
position, glyph chosen by arithmetic, with a blank glyph at index 0 so that
leading-zero suppression is a multiplication.

The intermission screen looks like it needs a font. It does not — `Write`
(`WL_INTER.C:331`) maps each character to a *picture*, `L_APIC` through
`L_ZPIC`, and blits it on a 16-pixel grid. Reading that one function turned a
font parser into a table of `background-position`s computed at build time.

## Source layout

```
build/extract.mjs    game data → PNG atlases + .cache/map.json
build/generate.mjs   map description → dist/index.html + dist/index.css
build/check.mjs      release gate: no JavaScript, no dead links
build/gamepal.json   the 256-colour palette, so the build does not also
                     require id Software's source release
dist/                the published site (committed; see README)
```
