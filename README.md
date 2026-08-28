# Wolfenstein 3D in pure CSS

The first level of Wolfenstein 3D — E1M1, the whole thing — rendered and played
in a browser with **no JavaScript on the page**. Not "minimal JavaScript". None.
The `<html>` document contains markup, one stylesheet and five PNG atlases; the
walking, the turning, the wall collision, the doors, the enemies, the shooting
and the level-end screen are all computed by the CSS engine.

### ▶ [Play it](https://lsobolew.github.io/wolfenstein-3css/)

Chrome or Edge. Scroll on the picture to move, click the crosshair to shoot and
to open things, and hit **maximise** to fill the window (then F11 if you want
the whole screen). The screen scales to whatever width the page has, so it fits
a phone as well as a desktop. See [Browser support](#browser-support) before you
file a bug about Firefox.

---

## What is actually happening

A browser's style engine is a pure function: it maps a DOM tree plus a
stylesheet to computed values. Give it a way to carry a value from a parent to a
child and a way to branch on that value, and it is a computer. CSS has both —
custom properties inherit, and `@container style()` queries branch — so the
missing piece is only *time*.

This port supplies time three ways:

**Nesting depth is a clock.** One step of a computation is one DOM level. State
flows down through registered custom properties and is read back with container
style queries. A chain 87 levels deep runs an 87-step program on every frame.

**Scrolling is an integrator.** `animation-timeline: scroll()` turns a scroll
container's position into an animation progress value. Two of those, driven by
the same gesture, integrate into the player's heading and position — so the
camera state exists nowhere in the DOM. Nothing writes it down; it is
recomputed, continuously, from how far a scrollbar has travelled.

**Wall collision is layout, not logic.** The obvious design — detect a wall,
then stop the player — needs a signal to travel *up* the tree, which CSS cannot
do. Instead a probe reads the tile in front of the player and shortens a spacer
inside the scroll container. The container's scroll range shrinks, and the
browser clamps the scroll position to the new range. There is no rule that says
"stop": walking into a wall becomes physically impossible for the same reason
you cannot scroll past the end of a page. It is exact, it costs nothing, and it
works mid-gesture.

The rest of the game is built on the same three ideas. Details, with the
measurements and the blind alleys, are in [`docs/`](#documentation).

## What the level contains

| | |
| --- | --- |
| Geometry | 828 planes, from the original `GAMEMAPS` — 758 wall faces, 22 door leaves, floor and ceiling slabs |
| Projection | `perspective: 437.5px` — that is `0.68359375 × width`, the exact `scale` constant from `WL_MAIN.C:661`, giving the original's 72.37° FOV |
| Movement | 5.6 tiles/s walking, as in the original; running and turning eased down for comfort on a trackpad |
| Doors | 22, with the original 6.114 s cycle (0.914 s open, 4.286 s hold, 0.914 s close) |
| Secrets | 5 pushwalls, direction resolved at build time by flood fill |
| Items | 121 statics: 48 collectable, 34 blocking, 39 decoration — values from `statinfo[]` |
| Enemies | 37, with real line of sight, waking, and distance-dependent lethality |
| Weapons | knife, pistol (24/70 s per shot), machine gun (18/70 s) — rates from `attackinfo[]` |
| HUD | the real `STATUSBARPIC` from `VGAGRAPH`, with face, keys, weapon and latch digits |
| Screens | title, PC-13, "Get Psyched!", death and the intermission — all original artwork |
| Page weight | 79 KB HTML + 448 KB CSS + 249 KB images |
| Frame time | 16.7 ms median in Chrome while turning and walking at once |

## Limitations

Honest ones, all of them measured rather than assumed. The long version with the
numbers is in [`docs/LIMITS.md`](docs/LIMITS.md).

- **It needs a quick machine.** Every frame recomputes the style of about
  thirteen hundred elements, and there is no game loop that could skip work, so
  a slow CPU turns straight into stutter.
- **Enemies never walk.** `SelectChaseDir` needs per-actor memory that survives
  a frame. Nothing in CSS survives a frame except an animation's own progress,
  and an animation cannot be started by a computed value.
- **Dogs do not attack.** They wake and turn towards you, and that is all —
  biting has no frames in the extracted set and no way to charge damage.
- **You survive far longer than in the original.** Damage arrives at a steady
  0.6 points a second instead of in random hits, so a guard needs about three
  minutes to finish you. Aiming by scrolling is harder than aiming with a mouse
  and the port still has rough edges, so the difficulty is turned down
  deliberately.
- **No keyboard.** CSS cannot see a key: scrolling moves, clicking the
  crosshair acts.
- **No strafing and no sliding along walls.** Both need the X and Z axes gated
  independently, and the bit that says "this axis is blocked" is produced
  *below* the sum that produces the position. There are three scroll axes and
  all three are already spent on turning, forward and back.
- **No randomness.** Every original damage roll is replaced by a deterministic
  distance band, so a guard dies in a fixed number of clicks rather than a
  random number of them.
- **Doors block line of sight even when open.** Visibility is precomputed at
  build time, which is the only reason a real ray is affordable at all; doors
  move at runtime, so they are treated as permanently shut. The error is
  conservative — an enemy will not see you through an open door.
- **The machine gun costs the same ammunition as the pistol.** A burst should
  cost three rounds, but the weapon flag applies retroactively to the whole
  shot count, so charging more would make the counter drop when you pick the
  weapon up.
- **Death is final and the lift leads nowhere.** There is one level, no
  respawn, and no extra lives; reloading the page is the only restart.
- **No fizzle fade.** A random 320×160 dissolve mask is pure entropy: twenty
  frames run to hundreds of kilobytes even after deflate, and the tiled version
  that fits in a few kilobytes gives itself away with a repeating pattern.
- **Smaller gaps:** the bonus on the end screen never reaches the score, and the
  key slots in the status bar stay empty because E1M1 has no keys.
- **No sound, no saving, no difficulty levels.**
- **There are bugs.**

## Browser support

| | |
| --- | --- |
| **Chrome / Edge** | fully supported, and the only place the frame time was measured |
| **Safari** | playable; walking backwards is disabled. Its scroll timeline measures a `column-reverse` container from the opposite end to `scrollTop`, so the backward axis would eat the forward gesture. Turning and forward movement work. |
| **Firefox** | not supported. `@container style()` there matches the *base* value of an animated custom property while `calc()` on the same element sees the animated one — which breaks every latch in the game. Scroll-driven animations are also still behind `layout.css.scroll-driven-animations.enabled`. |

## Building it yourself

The build reads your own copy of the game data; none of it is in this
repository. See [`docs/BUILD.md`](docs/BUILD.md).

```sh
cp /path/to/wolf3d/{VSWAP,GAMEMAPS,MAPHEAD,VGAGRAPH,VGAHEAD,VGADICT}.WL6 data/
npm run build     # extract assets, then generate the page into dist/
npm run check     # assert the output contains no JavaScript and no dead links
```

`npm run check` is what CI runs on every push. "No JavaScript" is the entire
point of the project, so it is verified by a machine rather than by good
intentions: the check fails on a single `<script>` tag, an `on*` attribute, a
`javascript:` URL, or a link pointing at a file that is not in `dist/`.

## Documentation

| | |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | how the engine is put together: the chain, the integrators, the collision trick, the build pipeline |
| [`docs/TECHNIQUES.md`](docs/TECHNIQUES.md) | the reusable CSS techniques this port needed, each with the problem it solves |
| [`docs/LIMITS.md`](docs/LIMITS.md) | measured limits, engine bugs worked around, and things that turned out to be impossible |
| [`docs/BUILD.md`](docs/BUILD.md) | supplying the game data and rebuilding |

## Assets and copyright

The code in this repository is MIT-licensed. **The game content is not.**

`dist/` contains PNG atlases built from Wolfenstein 3D's `VSWAP` and `VGAGRAPH`
files — wall textures, sprites, the status bar, the title screen — and the level
geometry read out of `GAMEMAPS`. All of it belongs to id Software. It is
committed here so that GitHub Pages has something to publish, since the data
files the build consumes cannot themselves be redistributed.

If you would rather not host it, delete `dist/` and rebuild from your own copy
of the game; the generator does not care where the data came from.

Wolfenstein 3D is a trademark of id Software LLC. This project is not
affiliated with or endorsed by id Software or ZeniMax.
