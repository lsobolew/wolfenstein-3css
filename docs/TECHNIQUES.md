# Techniques

Reusable patterns this port needed, each with the problem that forced it. They
are written to be liftable into other pure-CSS work, not just this one.

## Arithmetic: read from the parent, write to the child

```css
@property --a  { syntax: '<integer>'; initial-value: 0; inherits: true }
@property --na { syntax: '<integer>'; initial-value: 0; inherits: true }
.compute { --na: mod(calc(var(--a) + 1), 16) }
.commit  { --a: var(--na) }
```

Registration is needed twice over: without `syntax`, `calc()` will not compute
and `style()` will not compare. And a property cannot read its own inherited
value on the element that writes it — that is a cycle, and a registered property
answers a cycle with its **initial value**, silently. Hence two levels per step:
compute, then commit.

Prefer this to enumerating values. It removes the *value* axis from the cost
model — an increment becomes one rule instead of sixteen.

## Style queries compare against literals, so compute the predicate first

`@container style()` cannot express "is A greater than B". Collapse the
comparison into a flag with arithmetic, then query the flag:

```css
--gt: clamp(0, calc(var(--a) - var(--b)), 1);                  /* 1 when A > B */
--eq: calc(1 - clamp(0, abs(calc(var(--a) - var(--b))), 1));   /* 1 when equal */
```

Whenever a query cannot express a predicate, ask whether arithmetic can compute
it instead. That question is worth asking every time; it is the difference
between "impossible" and "one extra declaration".

## Latching: making CSS commit a value of its own

An animation of one millisecond with `fill-mode: forwards`, started paused and
released by a container query, is a write-once memory cell that survives the
condition going away.

```css
@keyframes take { from { --picked: 0 } to { --picked: 1 } }
.latch { --slot: paused;
         animation: take 1ms steps(1, end) forwards var(--slot) }
@container probe style(--tile: 7) { .latch { --slot: running } }
```

Two things to know:

**All the latches on one element share one `animation-name` list.** A second
rule setting `animation-name` replaces the list rather than extending it, so a
category of latches lives as N entries in one list, each with its own
`animation-play-state` slot.

**A re-triggerable cycle needs two names.** The same animation name will not
start a second time. Give the cycle two identical `@keyframes` under different
names and alternate between them — for doors, by whether the door is currently
open; for the weapon, by the parity of the shot count, which changes on every
shot by construction.

## Punishing inaction — the deadline as a permanent fact

Selectors match on what exists, so "the player did nothing" looks unreachable.
Make the *moment* exist:

```css
@keyframes passed { from, to { --passed: 1 } }   /* SAME value on both frames */
.deadline { animation: passed 10ms linear var(--when) 1 forwards }
```

`--passed` is 0 before the deadline and 1 forever after, with no latch and no
scroll container. Do **not** write it as `step-end` over `from { 0 } to { 1 }` —
a `forwards` fill then holds the *start* value and the flag never lights.

## Scroll position as an integrator, and as a clamp

`animation-timeline: scroll()` turns a scroll offset into animation progress.
That is the only user input CSS can read continuously, and it is enough to
integrate a heading and a position.

The dual of that is more useful still: **a scroll range can be shrunk from CSS,
and the browser will clamp the position into it.** That converts "prevent this
movement" from a signal that has to travel upwards into a layout fact. It
applies during a gesture, which snapping does not.

Two things measured the hard way:

- a clamped range only loses its **upper** end — you can always scroll back to
  zero — so each direction needs its own container;
- **a scroll container outside the viewport has no active timeline.** Not
  throttled: inactive. Its consumers revert to registered initial values and
  every rule keyed on them flips back.

## Forcing a re-snap: move the snap target

Chrome sometimes leaves a snapping container between snap points after a
gesture, so the turn axis does not re-centre and the player keeps rotating. The
fix is to make the target itself move, a fraction of a pixel, forever:

```css
@keyframes nudge { from { margin-left: 699.7px; margin-right: 700.3px }
                   to   { margin-left: 700.3px; margin-right: 699.7px } }
.snap-target { animation: nudge .1s steps(1, end) infinite alternate;
               scroll-snap-stop: always; scroll-snap-align: start center }
```

Every 0.1 s the snap target is somewhere new, so the container re-evaluates and
re-snaps. Invisible at 0.3 px, and it costs one animation.

## Counting across siblings

Computed values propagate downward only — no container query and no `:has()`
lets a parent see what a descendant computed. **Except for counting.**
`counter-increment: hits var(--flag)` aggregates across any number of siblings
at zero nesting cost.

Two rules keep it working:

- **reset the counter high**, on `body` or on a shared ancestor. Resetting it on
  the element that increments it scopes it to that element, its descendants and
  its *siblings* — so a reader elsewhere sees a fresh zero while
  `counter-increment` is working perfectly. This cost an afternoon twice.
- **`display: none` does not increment**, and the incrementing element must
  precede the reader in tree order.

## The abacus: the counting element is not the control

Counters must increment before the reader, but controls belong where the player
clicks. Decouple them — read the state globally with `:has()` and write the
contribution onto a zero-size element parked at the top of the document:

```css
.abacus { display: block; width: 0; height: 0 }   /* not display:none */
.abacus i { counter-increment: score var(--v, 0) }
body:has(#guard7-dead:checked) .abacus .g7 { --v: 100 }
```

## Precompute anything that does not move

The strongest lever in the whole project, and the one that keeps being
overlooked. **When the world is static, a question CSS cannot answer during play
often has an answer computable before play.**

It applied three times here — pushwall directions, whether a blocking static
cuts the level in two, and enemy line of sight — and each time it turned a
feature I had written off as impossible into a bitmask lookup. The tell is
always the same question: *is the thing being asked about actually moving?*

Line of sight is the clearest case. Sampling tiles along a segment is a loop and
each sample would cost a DOM level. But an enemy that never moves, on a map that
never changes, has a *constant* set of tiles it can be seen from. Compute it
with an ordinary ray at build time, restrict the mask to the window the distance
gate already allows so thirteen bits fit in one number, and the runtime cost is
one bit lookup. The result was smaller than the approximation it replaced.

## Read the original before reproducing it

The cheap path is often the authentic one. Wolfenstein's intermission screen
looks like text, so reproducing it looks like a font-extraction job. It is not:
`Write` maps each character to a *picture* and blits it on a 16-pixel grid.
Reading one function turned a font parser into a table of
`background-position`s. The death screen went the same way — it looks like it
needs a message, and the source shows one solid `VW_Bar` in palette colour 4,
with all the information carried by the status bar instead.

## A container style query sees only its own container's style

This decides *where in the tree* a derived flag has to be computed, and the
answer moves in both directions.

The machine-gun pickup latch had to sit **above** the probe whose query consumed
it. The kill threshold had to move **below**, onto the element where its last
input — remaining ammunition — first exists. The rule to apply is not "put state
high" or "put state low" but *put it on the element the query names*, and let
the last-available input decide which element that can be.

## Legality is visibility

Never validate and reject. Make the illegal action non-existent — there is
nothing to click. Free consequences: no error paths, and the tab order becomes
exactly the set of legal actions.

Related: when several rules compete for one click, stack them in `z-index`
rather than nesting `:not()`. A generic fallback underneath, the specific action
on top with its own conditions.

## Mutually exclusive conditions beat specificity tricks

The shooting labels originally used an id-bearing rule to switch off "you can
hit this" once "already hit" applied, because both could match at once. Deriving
a single `--hits` value instead made the conditions disjoint — `--hits: 0` and
`--hits: 1` cannot both hold — and the specificity hack disappeared along with
the class of bugs where the wrong one wins.

## Testing

**Click through `document.elementFromPoint`, never `.click()`.** `.click()`
succeeds on controls the mouse cannot reach and will happily validate broken
gating.

**Have the harness refuse to run when the browser is not painting.** An occluded
window produces no frames, so `document.timeline` never advances and every timed
feature reads its initial value — while `document.hidden` stays false and
`playState` still says `running`. This imitated a real regression six times in
this project. Check that the timeline moves before asserting anything, and
report *that* rather than a page full of failures.

**Screenshot everything you verified numerically.** Several real bugs here
passed their numeric tests and were caught only by looking.

**Counters cannot be read programmatically** — `getComputedStyle` returns the
literal `counter(T)`. Verify them on a screenshot.
