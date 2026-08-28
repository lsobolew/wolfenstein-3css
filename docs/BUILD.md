# Building from your own copy of the game

## Why you need to supply data

The generator reads Wolfenstein 3D's original data files. They are id Software's
property and are not in this repository, so a fresh clone cannot build until you
point it at your own copy.

The published site under `dist/` is committed for exactly this reason: CI has no
data to build from, so it verifies and publishes the committed output instead of
regenerating it.

## What is needed

Six files, from any complete installation of the game:

| file | what the build takes from it |
| --- | --- |
| `GAMEMAPS` | level geometry, doors, pushwalls, enemy and item placement |
| `MAPHEAD` | the level index and the RLEW tag |
| `VSWAP` | wall textures, sprites, weapon frames |
| `VGAGRAPH` | status bar, faces, digits, title and intermission artwork |
| `VGAHEAD` | chunk offsets for `VGAGRAPH` |
| `VGADICT` | the Huffman dictionary for `VGAGRAPH` |

Registered (`.WL6`) is what the port was developed against and is what the
graphics chunk numbers assume. Shareware (`.WL1`) is detected automatically for
the map and sprite data, but `VGAGRAPH` chunk numbering differs between the two
releases, so the HUD and the screens would need the shareware table before a
`.WL1` build is correct.

## Building

```sh
mkdir -p data
cp /path/to/wolf3d/{GAMEMAPS,MAPHEAD,VSWAP,VGAGRAPH,VGAHEAD,VGADICT}.WL6 data/

npm run build     # extract, then generate
npm run check     # verify the output
```

`data/` is git-ignored, as are `*.WL1` and `*.WL6` anywhere in the tree.

To keep the data somewhere else:

```sh
WOLF3D_DATA=~/games/wolf3d npm run build
```

The two steps can be run separately. `npm run extract` rebuilds the PNG atlases
and `.cache/map.json`; `npm run pages` rebuilds only `index.html` and
`index.css` from that cache, which is what you want while editing the generator.

## About the palette

The game's 256-colour palette lives in `GAMEPAL.OBJ`, part of id Software's
source release — a separate download from the game data. Requiring both for
every build was not worth it, so the extracted table is committed as
`build/gamepal.json`.

If you do have the source release, point at it and the table is read from the
original instead:

```sh
WOLF3D_SRC=/path/to/WOLFSRC npm run extract
```

## What the build produces

```
dist/
  index.html          the game
  index.css           the engine
  wolf-atlas.png      106 wall texture pages
  wolf-sprites.png    guards, dogs, weapon frames
  wolf-statics.png    static objects
  wolf-hud.png        status bar, faces, digits, keys, weapon icons
  wolf-screens.png    title, PC-13, Get Psyched, BJ, intermission letters
  wolf-minimap.png    the debug minimap
.cache/
  map.json            map description handed from the extractor to the generator
  palette.json        the palette as extracted, for inspection
```

Both scripts print what they found. It is worth reading the first run: the
number of wall pages, doors, statics, enemies and pushwalls should match the
level, and a mismatch there is much easier to diagnose than the same mismatch
three steps later on screen.

## The release gate

`npm run check` walks `dist/` and fails on:

- any `<script>` tag, `on*=` attribute, `javascript:` URL or `<noscript>`;
- any `href`, `src` or `url()` pointing at a file that is not in `dist/`;
- **any `var()` that cannot resolve** — no declaration, no `@property`, no
  fallback;
- **any `var()` used inside arithmetic that has no `@property`**;
- **any animation name with no `@keyframes`, and any `@keyframes` nothing
  references**;
- **any selector naming a class that appears on no element**;
- a missing page, stylesheet or atlas;
- a PNG small enough to be a placeholder.

The first of those is the point of the whole project. The four in the middle
exist because of four bugs they would have caught and nothing else did.

All four had the same shape: **a name assembled from fragments, renamed on one
side only.**

| symptom | cause |
| --- | --- |
| walked through every wall and door | a probe emitted `--swfsolid`, a consumer read `--swfSolid` |
| doors would not open | `animation-name: cycleA0`, producer still building `cyklA0` |
| no firing animation, ammunition never dropped | `@property --cd36` registered, setter and reader using `--gunKill36` |
| dead enemies kept their click targets | markup said `goal36`, the selector said `.target36` |

None of them is an error in CSS. An unresolvable `var()` invalidates its whole
declaration at computed-value time; an unregistered property is
guaranteed-invalid until something sets it, which does the same thing from the
first frame; an `animation-name` with no `@keyframes` simply does nothing; a
selector that matches nothing simply matches nothing. Every one failed in
silence, and a structural diff of the output could see none of them, because it
compares shapes and these were all names.

Two of the checks run in **both** directions on purpose. For keyframes,
"referenced but undefined" catches the consumer side while "defined but never
referenced" catches the producer side — and it was the second that made the
diagnosis immediate, reporting 44 orphaned `@keyframes`, all of them doors.

## Adding to the generator

Feature gates in `build/generate.mjs` have the form `E.n >= 6`, numbered by the
development stage that introduced them. The published page carries stage number
10, which opens every gate — so a new feature written behind a gate appears in
the build without being registered anywhere else.

Two hazards worth knowing before you edit:

**Backticks inside a CSS template literal break the generator.** The CSS is
emitted from JavaScript template literals, so a backtick inside a CSS comment —
the obvious way to quote a property name in prose — terminates the string. This
has happened eight times in this project. Use quotation marks in CSS comments.

**Register every custom property you intend to query.** Without
`@property … syntax`, `calc()` will not compute it and `@container style()` will
never match it, and neither failure says anything. Three separate bugs here were
one missing `@property`.
