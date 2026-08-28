#!/usr/bin/env node
// RELEASE GATE. Runs in CI, needs no game data, and checks the things a
// screenshot cannot show but the project stands or falls on:
//
//   1. NO JAVASCRIPT. That is the whole claim of this work, so let a machine
//      enforce it rather than good intentions: no <script>, no on* attribute,
//      no href="javascript:".
//   2. Every link and every asset resolves.
//   3. The pages, stylesheets and atlases are present, and no atlas is a stub.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(DIST)) {
  console.error('dist/ is missing — run `npm run build` first');
  process.exit(1);
}
const files = readdirSync(DIST);
const present = new Set(files);
const problems = [];
const report = (file, msg) => problems.push(`${file}: ${msg}`);

const REQUIRED = ['index.html', 'index.css',
                  'wolf-atlas.png', 'wolf-sprites.png', 'wolf-statics.png',
                  'wolf-hud.png', 'wolf-screens.png'];
for (const r of REQUIRED) if (!present.has(r)) report(r, 'missing');

// 1. zero JavaScript
const SCRIPTING = [
  [/<script\b/i, 'a <script> tag'],
  [/\son[a-z]+\s*=\s*["']/i, 'an on…= event attribute'],
  [/(?:href|src)\s*=\s*["']\s*javascript:/i, 'a javascript: URL'],
  [/<noscript\b/i, 'a <noscript> element (implies a JS dependency)'],
];
// 2. links
const LINK = /(?:href|src)="([^"#]+)"|url\(([^)]+)\)/g;

let pages = 0, bytes = 0;
for (const f of files) {
  const path = join(DIST, f);
  bytes += statSync(path).size;
  if (!/\.(html|css)$/.test(f)) continue;
  const text = readFileSync(path, 'utf8');
  if (f.endsWith('.html')) pages++;
  for (const [re, what] of SCRIPTING) if (re.test(text)) report(f, `FOUND ${what}`);
  for (const m of text.matchAll(LINK)) {
    const target = (m[1] || m[2] || '').trim().replace(/^['"]|['"]$/g, '');
    if (!target || /^(https?:|data:|mailto:|#)/.test(target)) continue;
    if (!present.has(target)) report(f, `link to nowhere: ${target}`);
  }
}
// 3. every var() resolves.
//
// This one is here because of a bug it would have caught and nothing else did.
// A rename left one consumer reading --swfSolid while the probe emitted
// --swfsolid; an undefined var() makes the whole declaration invalid at
// computed-value time, so --fwdRange silently reverted to its initial value —
// the full stick range — and collision stopped existing. Nothing threw, nothing
// looked wrong in the stylesheet, and a structural diff could not see it,
// because it compares shapes and this was a name.
//
// A var() with a fallback is fine, and so is a name registered with @property,
// which always has an initial value to fall back on.
{
  const css = existsSync(join(DIST, 'index.css'))
    ? readFileSync(join(DIST, 'index.css'), 'utf8') : '';
  const html = existsSync(join(DIST, 'index.html'))
    ? readFileSync(join(DIST, 'index.html'), 'utf8') : '';
  const declared = new Set([...(css + html).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1]));
  const registered = new Set([...css.matchAll(/@property\s+(--[A-Za-z0-9_-]+)/g)].map(m => m[1]));
  const orphans = new Set();
  for (const m of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,?)/g))
    if (!m[2] && !declared.has(m[1]) && !registered.has(m[1])) orphans.add(m[1]);
  for (const o of orphans) report('index.css', `var(${o}) never resolves — no declaration, no @property, no fallback`);
}

// 4. every custom property used in arithmetic is registered.
//
// The declaration check above is not enough, and the gap cost a third bug. A
// property set only by a conditional rule (#c36d:checked ~ …) counts as
// "declared", so the scan was satisfied — but before that rule matches, an
// UNREGISTERED property is guaranteed-invalid, and one guaranteed-invalid var()
// inside a calc() invalidates the whole declaration. The shot counter therefore
// sat at its initial 0 forever: ammunition never dropped and the firing
// animation never triggered, because the parity it switches on never changed.
//
// Registration is what makes the difference: a registered property always has
// an initial value to fall back on. This project registers every property it
// computes with, so the rule can simply be enforced.
{
  const css = existsSync(join(DIST, 'index.css'))
    ? readFileSync(join(DIST, 'index.css'), 'utf8') : '';
  const registered = new Set([...css.matchAll(/@property\s+(--[A-Za-z0-9_-]+)/g)].map(m => m[1]));
  const MATH = /\b(?:calc|clamp|min|max|mod|rem|round|abs|sign|pow|sqrt|hypot|atan2|sin|cos|tan)\(/g;
  const unregistered = new Set();
  for (const m of css.matchAll(MATH)) {
    // read to the end of this math expression, tracking bracket depth
    let depth = 1, i = m.index + m[0].length;
    for (; i < css.length && depth; i++) {
      if (css[i] === '(') depth++;
      else if (css[i] === ')') depth--;
    }
    const expr = css.slice(m.index, i);
    for (const v of expr.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,?)/g))
      if (!v[2] && !registered.has(v[1])) unregistered.add(v[1]);
  }
  for (const u of unregistered)
    report('index.css', `var(${u}) is used in arithmetic but has no @property — ` +
                        'it is guaranteed-invalid until something sets it, which ' +
                        'silently invalidates the whole declaration');
}

// 5. every animation name resolves, in both directions.
//
// Same lesson as the var() check above, and the same origin: a name assembled
// from fragments. The consumer said `cycleA0` while the producer still built
// `cyklA0`, so twenty-two doors carried an animation-name pointing at keyframes
// that did not exist — and an animation-name with no matching @keyframes is not
// an error, it simply does nothing. The doors stopped opening in silence.
//
// Checking BOTH directions is the point. "Referenced but undefined" catches the
// consumer side; "defined but never referenced" catches the producer side, and
// it was the second one that made the diagnosis immediate: 44 orphaned
// @keyframes, all of them doors.
{
  const css = existsSync(join(DIST, 'index.css'))
    ? readFileSync(join(DIST, 'index.css'), 'utf8') : '';
  const KEYWORDS = new Set(['none', 'var', 'linear', 'ease', 'ease-in', 'ease-out',
    'ease-in-out', 'steps', 'infinite', 'alternate', 'alternate-reverse', 'forwards',
    'backwards', 'both', 'running', 'paused', 'end', 'start', 'jump-start', 'jump-end',
    'normal', 'reverse', 'cubic-bezier', 'auto', 'initial', 'inherit', 'unset']);
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)].map(m => m[1]));
  const referenced = new Set();
  for (const m of css.matchAll(/animation(?:-name)?:\s*([^;}]+)/g)) {
    // var(--slot) is an indirection, not a name, and 1ms/0.9s are units — both
    // would otherwise look like keyframes that nobody defined.
    const value = m[1].replace(/var\([^)]*\)/g, ' ')
                      .replace(/(?<![\w-])[\d.]+[a-z%]*/g, ' ');
    for (const t of value.match(/[A-Za-z_][\w-]*/g) || [])
      if (!KEYWORDS.has(t)) referenced.add(t);
  }
  // animation names also travel through custom properties: --doorSlot0: cycleA0
  for (const m of css.matchAll(/--[\w-]+:\s*([A-Za-z_][\w-]*)\s*[;}]/g))
    if (!KEYWORDS.has(m[1])) referenced.add(m[1]);
  for (const r of referenced)
    if (!defined.has(r)) report('index.css', `animation name ${r} has no @keyframes`);
  const unused = [...defined].filter(d => !referenced.has(d));
  if (unused.length)
    report('index.css', `${unused.length} @keyframes nothing references, e.g. ` +
                        unused.slice(0, 3).join(', '));
}

// 6. nothing is written that nobody reads.
//
// The fifth bug, and the one that finally suggested the right invariant. Item
// pickup releases a paused animation by setting a per-item slot to `running`.
// The rule that sets it was renamed to --takeSlot0; the animation-play-state
// list that reads it is assembled in JavaScript from the fragment 'pp', which
// was not. Both sides stayed internally consistent, so every earlier check
// passed — the slot simply stayed paused and no item could ever be collected.
//
// In this generator every custom property exists to be read by something, so a
// write with no reader is always a mistake. Measured on a healthy build: zero.
// A reader counts as a var() anywhere (the intermission reads some from inline
// styles) or a container style() query, which is how the heading bucket and the
// door states are consumed.
{
  const css = existsSync(join(DIST, 'index.css'))
    ? readFileSync(join(DIST, 'index.css'), 'utf8') : '';
  const html = existsSync(join(DIST, 'index.html'))
    ? readFileSync(join(DIST, 'index.html'), 'utf8') : '';
  const written = new Set([
    ...[...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1]),
    ...[...css.matchAll(/@property\s+(--[A-Za-z0-9_-]+)/g)].map(m => m[1]),
  ]);
  const read = new Set([
    ...[...(css + html).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map(m => m[1]),
    ...[...css.matchAll(/style\(\s*(--[A-Za-z0-9_-]+)/g)].map(m => m[1]),
  ]);
  const unread = [...written].filter(w => !read.has(w));
  if (unread.length)
    report('index.css', `${unread.length} custom properties are written but never ` +
                        `read, e.g. ${unread.slice(0, 3).join(', ')}`);
}

// 7. every class a selector names actually exists in the markup.
//
// The fourth bug of the same family, and the only one none of the checks above
// could see: the markup emitted class="… goal36 …" while the rule that hides a
// dead enemy's labels selected .target36. Both sides were valid CSS and valid
// HTML; they simply never met.
//
// Only this direction is worth failing on. A class in the markup with no rule
// is ordinary — plenty of them are there for structure — but a selector naming
// a class that appears nowhere is either a typo or a rename that went half way.
{
  const css = existsSync(join(DIST, 'index.css'))
    ? readFileSync(join(DIST, 'index.css'), 'utf8') : '';
  const html = existsSync(join(DIST, 'index.html'))
    ? readFileSync(join(DIST, 'index.html'), 'utf8') : '';
  const inMarkup = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g))
    for (const c of m[1].split(/\s+/)) if (c) inMarkup.add(c);
  // strip comments, then rule bodies, so only selector text is left
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{[^{}]*\}/g, ' ');
  const orphans = new Set();
  for (const m of selectors.matchAll(/\.([A-Za-z_][\w-]*)/g))
    if (!inMarkup.has(m[1])) orphans.add(m[1]);
  for (const o of orphans)
    report('index.css', `selector .${o} matches nothing — no element carries that class`);
}

// 8. atlases are not placeholders
for (const png of files.filter(f => f.endsWith('.png')))
  if (statSync(join(DIST, png)).size < 200) report(png, 'suspiciously small for an atlas');

console.log(`dist/: ${files.length} files, ${pages} page(s), ${(bytes / 1048576).toFixed(1)} MB`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('no JavaScript, no dead links — OK');
