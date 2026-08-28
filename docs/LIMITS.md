# Limits

Everything here was measured, not assumed. Where a number appears, it came out
of a run in Chrome 151 or Safari 18 on macOS.

## Engine limits

### A style query on a calc-derived `<integer>` stops matching at 256

Measured at the boundary: 255 matches, 256 never does, while
`getComputedStyle` reports the correct value throughout. The **same number
declared as `<number>` matches fine**.

This killed the first version of item pickup, which packed the player's tile
into one index (`y * 64 + x`) and queried it. Looks cheaper; does not work above
tile 4. The fix is to query the two coordinates separately — two small integers
instead of one large one.

### An animated custom property cannot be substituted into `animation-*`

```css
@property --gun { syntax: '<integer>'; initial-value: 0; inherits: true }
@keyframes take { from { --gun: 0 } to { --gun: 1 } }
.latch { animation: take 1ms steps(1, end) forwards }
.weapon { animation-duration: calc(0.342857s - var(--gun) * 0.085714s) }
```

`animation-duration` computes to **`0s`** — silently. Not the from-value, not
the to-value: the initial value, meaning the declaration was invalid at
computed-value time.

Measured side by side on the same element:

| expression | result |
| --- | --- |
| `calc(0.342857s - 1 * 0.085714s)` | 0.257143s |
| same calc with an **unregistered** `--u: 1` | 0.257143s |
| same calc with a registered `<integer>` that is **not currently animated** | correct |
| same calc with a registered `<integer>` **held by an animation** | **0s** |
| `calc(var(--animated) * 1s)` | **0s** |

Only one thing decides it: whether the property is currently animated. The rule
is sound — an animation property that depends on a value an animation produces
is a cycle — but it surfaces with nothing in the console and looks exactly like
a typo in the `calc()`. Beware `fill-mode: forwards`: it leaves the property
"animated" forever, so a latch poisons the expression long after it stopped
changing.

**Workaround:** select the rule instead of substituting the value. A container
query creates no cycle because it picks a literal.

```css
@container combat style(--gun: 1) { .weapon { animation-duration: 0.257143s } }
```

### `@container` resolves against ancestors of the *styled* element

Not of the element that set the property. This caused three separate bugs here,
one of which looked like proof that a feature did not exist. Before concluding
something is impossible, check that the reading element is a descendant of the
container.

The corollary that actually shapes designs: **a style query sees only its own
container's computed style**, so a derived flag must be computed *on the element
the query names* — which can force it up the tree or down it, depending on where
its last input becomes available.

### Dividing a length by a length: no longer true

This entry used to say it was impossible, and the maximise button was built
around that: a ladder of media queries, one rung per quarter step, each asking
for a viewport large enough to hold the 640x480 screen at that factor.

It is not impossible in current Chrome. `calc()` produces a plain number from
length over length, so "the largest factor that fits" is one expression.
Measured in Chrome 151, a 400px container:

| expression | computed |
| --- | --- |
| `calc(100cqw / 640px)` | `0.625` |
| `tan(atan2(100cqw, 640px))` | `0.625` |
| `clamp(0.2, calc(100cqw / 640px), 1)` | `0.625` |

The `tan(atan2(...))` form is the old workaround — `atan2()` accepts two
lengths and returns an angle, and `tan()` turns it back into a number. It gives
the same answer, so the direct division is the one to write.

The ladder is gone. The page now fits the screen to whatever width it has with
`clamp(.25, calc(100cqw / 640px), 1)`, and maximise takes the smaller of the two
axes: `min(calc(100vw / 640px), calc(100dvh / 480px))`.

**Read the width as `cqw`, not `vw`.** `100vw` includes the scrollbar. On a
platform with classic scrollbars that is fifteen pixels the game does not have,
which is enough to push a horizontal scrollbar onto a narrow window — measured:
5px of overflow at a 591px viewport. A size container on `<body>` gives the
content box instead, and the fit becomes exact: game 571.8x428.9, wrapper
571.8x428.9, horizontal overflow 0.

That container has one cost. `container-type` implies `contain: layout`, which
makes the element a containing block for fixed-position descendants — and
maximise pins the screen to the viewport with `position: fixed`. So the
container is dropped for exactly as long as that lasts:

```css
body { container: page / inline-size }
body:has(#big:checked) { container-type: normal }
```

The style containment that comes with it crosses no counter scope, because
every counter the game keeps is created and read inside `<body>`. Verified on
the scaled page: the status bar still reads FLOOR 1, SCORE 0, LIVES 3,
HEALTH 100%, AMMO 8.

### Scaling is a transform, and the layout box has to be reserved separately

The scaling is a **transform**, not a resize, and that is deliberate. The whole
engine is calibrated in pixels — the projection distance, every plane's
position, and the stick's scroll ranges — and a transform leaves layout
untouched. Measured with the game at 1.75x: `scrollWidth` 1400 and `clientWidth`
636, identical to the unscaled page, and `elementFromPoint` at the visual
crosshair still returns the right label. The same two numbers came back from the
scaled-down page, 1400 and 636.

The corollary is that a transform does **not** shrink the layout box, so a
screen scaled to 0.58 would trail the other 42% of its 480 pixels as empty page
below it. The wrapper reserves the right space itself, from the same factor:

```css
.hudRead    { width:100%; max-width:640px; height:calc(480px * var(--fit)) }
.gameScreen { width:640px; height:480px; transform-origin:0 0; scale:var(--fit) }
```

`aspect-ratio: 640 / 480` on the wrapper looks like the tidier way to write that
and does not work: the box came back 571.8 wide and 480 tall, the ratio ignored,
because the unscaled 480px content sets the height. The explicit height does not
have that problem.

Hit-testing survives the transform intact. Measured on nine labels inside the
frame, at scale 1 and at scale 0.6 in the same game state: the same nine
elements, and `elementFromPoint` at each of their centres returned the same
element in both.

### `scrollbar-color` disables every `::-webkit-scrollbar` rule

Set `scrollbar-color` and the width you asked for in `::-webkit-scrollbar` is
ignored — a test rule painting the track bright red never appeared either. The
lever that works is `scrollbar-width`.

### A scroll container outside the viewport has no active timeline

Not throttled — inactive. Consumers revert to registered initial values and any
rule keyed on them flips back. Keep scroll-driven content above the fold.

### Firefox reads the base value of an animated property through `style()`

`@container style()` matches the *base* value while `calc()` on the same element
sees the animated one. Every latch in this project depends on the opposite, so
the game does not run there. Scroll-driven animations are also still behind
`layout.css.scroll-driven-animations.enabled`.

### Safari: `mod()` returns the divisor at negative exact multiples

Measured: `mod(-9, 8) = 7` and `mod(-7, 8) = 1` are correct, but
`mod(-8, 8) = 8` and `mod(-5, 5) = 5`. The angle to the player is sometimes
exactly `-8`, so the sprite rotation frame came out as 8 of 8 available (0..7)
and the billboard showed a column from the next row.

Workaround: add a multiple of the divisor before taking the modulus, so the
argument never goes negative. `+ 800` costs nothing in Chrome and fixes Safari.

### Safari measures a `column-reverse` scroll timeline from the wrong end

The timeline reports progress from the opposite end to `scrollTop`. The backward
movement axis is built on `column-reverse`, so in Safari it would consume the
forward gesture. Backward walking is disabled there; this is a genuine blocker,
not a workaround gap.

### Safari does not round animated registered `<integer>`s

It yields values like `8.000001`, which defeats `clamp()` equality and
invalidates `counter-reset: n var(--x)`. Read every number through
`round(nearest, var(--x), 1)` computed on a descendant.

## Design limits of this port

### No strafing, and no sliding along a wall

Both need the X and Z axes gated independently. The bit that says "this axis is
blocked" is produced *below* the sum that produces the position, and there are
three scroll axes — turn, forward, back — all already spent. This is the one
limitation that is structural rather than a matter of effort.

### Enemies do not walk

`SelectChaseDir` needs per-actor state that survives a frame and is updated by a
computed value. An animation's progress is the only thing that survives a frame,
and an animation cannot be *started* by a computed value — only released from
pause, once, in one direction.

### The damage accumulator must outrun every medkit on the level

Health is `100 - damage + healing`, and damage is a single animation with
`fill-mode: forwards`. Once it reaches the end of its range it stops and holds —
so the range is a hard ceiling on how much damage the player can ever take.

Sized to exactly 100, that ceiling collides with healing: collect 25 points of
medkits and health floors at `100 - 100 + 25 = 25`, where nothing can push it
lower and death never triggers. Measured before the fix: healing 25, `--dmg`
pinned at 100, health stuck at 25, the death screen never shown — the player
simply becomes immortal.

The range has to cover 100 **plus all the healing lying on the map** (283 on
E1M1), with the duration scaled to match so the rate per second is unchanged.
Measured after: at 25 points of healing the player dies at 125 points of damage,
exactly as the arithmetic says.

The general shape: **an accumulator with a fill has a ceiling, and any term that
offsets it raises the floor by the same amount.** It is easy to size such a
range against the quantity it represents and forget the quantity working against
it.

### No randomness

There is no source of entropy, and no way for one shot to remember its own roll.
Every damage roll is replaced by a deterministic distance band: a guard dies in
one click up close, two at medium range, three far away, mirroring the original's
`rnd/4`, `rnd/6` and its miss chance beyond four tiles.

### Line of sight treats doors as walls even when open

Visibility must be precomputed for the mask to be static, and doors move during
play. The error is conservative: an enemy will not notice you through an open
door, and will not shoot through a closed one.

### The machine gun costs the same ammunition as the pistol

A burst should cost three rounds. The weapon flag applies retroactively to the
whole shot count, so charging more would make a guard killed with the pistol
*before* the pickup re-price itself afterwards and the ammunition counter drop
without cause. The smaller visible inaccuracy was chosen over the larger one.

The knife avoids the same trap only by having **its own checkboxes**: ammunition
is `start + collected − clicks`, and a knife swing costs nothing, so if swings
shared the gun's checkboxes the counter would overshoot downwards and a clip
picked up later would go on paying off the debt instead of into the weapon.

That separation had a consequence I missed for a long time. The same shot count
also drove the *parity* that re-triggers the firing animation — and since knife
strikes deliberately stay out of it, **the knife never animated**. The fix is to
stop overloading one number: `--shots` counts ammunition and only ever sees the
gun, while `--attacks` counts every blow, gun and knife alike, and it is
`--attacks` that the animation switches on. Measured after the split: a knife
strike moves `--attacks` 8 → 9, flips the parity, swaps `rateA, framesA` for
`rateB, framesB`, and leaves `--shots` and the ammunition counter untouched at 8
and 0.

The general shape is worth keeping in mind: **when one counter serves two
purposes, a change made for one of them silently breaks the other.**

### No fizzle fade

A random 320×160 dissolve mask is pure entropy — twenty frames run to hundreds
of kilobytes even after deflate, and the tiled version that fits in a few
kilobytes gives itself away with a repeating pattern across ten tiles of width.
Skipped deliberately.

## Things that were tried and rejected

### `@scope` does not help here

Considered and measured against. `@scope` limits the *matching* scope of a
selector, and matching is not the cost: the chain's elements carry unique
classes, so the browser indexes on the rightmost compound and tests a few dozen
rules per element. Container rules are already scoped by `@container`. The cost
sits in projecting planes and in long `calc()` chains dragged through 87
inherited levels, and `@scope` touches neither.

### `content-visibility` cannot be used to cull geometry

It is a containment property, and containment flattens the 3D context. Every
plane inside would paint at one depth.

### Gating the sprite-rotation `atan2` by region

Would cut 37 `atan2` calls to two or three, but enemies visible through an open
door would freeze mid-turn — a visible bug in exchange for a saving that the
plane-count reduction made unnecessary.

## Performance, as measured

Chrome 151, median of 150 frames while changing heading and position at the same
time, window in the foreground.

| | |
| --- | --- |
| frame time, full game | **16.7 ms** (p90 17.6 ms) |
| planes in the scene | 828, down from 2218 |
| stylesheet | 446 KB |
| chain depth | 87 levels |

A DevTools trace over 2.8 s of play gave the numbers that mattered: 1683 ms in
`UpdateLayoutTree` across 146 recalculations, 193,831 `StyleResolver::ResolveStyle`
calls, and a median of **1314 elements recalculated per frame** out of 1853 in
the document. The invalidation reason was `Animation` every time. The long
frames — one of 118 ms — sit exactly on top of Oilpan marking bursts, so the
garbage collection is a *consequence* of allocating that many ComputedStyle
objects, not an independent problem.

### What worked: fewer rules, not fewer properties

**Selector matching is 280 ms of the 1683 ms** — 17%, which is why `@scope` was
never going to help here. But half of *that* was two rule families:
`#c{n}d:checked ~ .stateAnim .target{n}` and its knife twin, 74 rules hiding a
dead enemy's click targets, 150 ms between them, because each one walks the whole
subtree under `.stateAnim` looking for a class. The same fact was already in the
container as `--slain{n}`, so folding `and style(--slain{n}: 0)` into the six
container queries that already gate each enemy's labels replaced a descendant
search with a plain class match. This one is a pure win: it removes work from
*every* frame and changes nothing about how the work is distributed.

### What did not work, twice, and why the second failure was worse

**Narrowing inheritance.** The stylesheet can be analysed to prove that 242 of
1105 registered properties never leave the element that computes them. Switching
those to `inherits: false` measured 12.6 → 12.4 ms — noise — while adding a real
failure mode. Removed.

**Freezing the static subtree.** 756 wall faces and 28 floor slabs have constant
`translate` and constant backgrounds; their computed style never changes, yet
they are recalculated every frame because they inherit properties that do.
Removing them from the document dropped a forced recalculation from 11.8 to
7.4 ms, so they really were 37% of the cost. The fix looked obvious: put them
under one element that resets every inherited custom property, so the value
there stops changing and the engine has no reason to descend.

Measured on a forced recalculation it looked like a triumph: 12.6 → 7.0 ms. A
trace of real play said otherwise, and **the player noticed before the numbers
did** — the game went from occasionally hitching to hitching constantly.

| | before | after |
| --- | --- | --- |
| `UpdateLayoutTree` per second | 592 ms | 201 ms |
| median recalculation | 9.5 ms | **0.2 ms** |
| recalculations over 20 ms | 4 | **35** |
| time inside those | 200 ms | **889 ms of 995** |

Total cost fell by two thirds and the experience got worse, because the cost
stopped being spread out. Every recalculation over 20 ms coincided exactly with
a scroll gesture — `elementCount` 1378, the whole tree including the frozen part.

The mechanism: when one custom property changes, Blink invalidates only the
elements that reference it, and the frozen node is never visited — hence the
0.2 ms median on animation ticks. When a *gesture* changes many variables at
once it falls back to a full subtree walk, and then the frozen node has to
resolve 1293 declarations and hand its 784 children a rebuilt variable map. On
exactly the frames where the player is moving, the optimisation was a tax.
Reverted.

**Two lessons.** A micro-benchmark has to exercise the same code path as the
thing it stands for: setting `--px` from script took Blink's targeted path,
while a real scroll takes the full one, so the benchmark reported a 44% win on a
change that was a loss. And jank is governed by the worst frames, not the mean —
trading a steady 9.5 ms for a mixture of 0.2 ms and 60 ms is a bad trade even
though the average improves.

The reduction from 2218 planes came from asking *is this ever visible?* — 512
wall faces pointed outside the map, wall subdivision turned out to be
unnecessary because collision keeps the camera off every face, and floor slabs
went from 8×8 tiles to 16×16.

**A warning about measuring any of this.** An occluded browser window produces
no frames, so `document.timeline` never advances and every timed feature reads
its initial value — while `document.hidden` stays false and `playState` still
says `running`. That imitated a real regression six times during development.
Check that the timeline is moving before believing a measurement.
