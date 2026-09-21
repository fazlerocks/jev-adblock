/**
 * "Snap" dissolve: the element turns to ash, crumbles from one corner and blows away as dust,
 * then the space it occupied closes smoothly.
 *
 * Everything here is compositor-friendly and works on cross-site ad iframes (which ignore SVG
 * reference filters and whose pixels cannot be read):
 *   - phase 1 (ash):      grayscale/brightness filters desaturate and darken the element
 *   - phase 2 (crumble):  a feathered multi-octave noise mask erodes it from bottom-left to
 *                         top-right; dust is emitted exactly from the cells that die each frame
 *   - phase 3 (collapse): height and vertical spacing animate to zero so content slides up
 * A single full-viewport canvas draws all particles for the page with a shared wind field.
 */

const DURATION_MS = 1400;
const ASH_END = 0.22; // fraction of duration spent turning to ash before the crumble starts
const CRUMBLE_END = 0.92;
const COLLAPSE_MS = 260;
const MASK_FRAMES = 28;
const CELL_PX = 4;
const MAX_MASK_COLS = 200;
const MAX_MASK_ROWS = 150;
const GLOBAL_PARTICLE_BUDGET = 1200;
const PER_ELEMENT_PARTICLES = 480;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------------------------

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a lattice; `freq` lattice cells across the width. */
class ValueNoise {
  private readonly grid: Float32Array;
  constructor(
    private readonly gw: number,
    private readonly gh: number,
    seed: number,
  ) {
    const rnd = mulberry(seed);
    this.grid = new Float32Array(gw * gh);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rnd();
  }
  /** u, v in 0..1 */
  at(u: number, v: number): number {
    const x = u * (this.gw - 1);
    const y = v * (this.gh - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(this.gw - 1, x0 + 1);
    const y1 = Math.min(this.gh - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = this.grid;
    const a = g[y0 * this.gw + x0]!;
    const b = g[y0 * this.gw + x1]!;
    const c = g[y1 * this.gw + x0]!;
    const d = g[y1 * this.gw + x1]!;
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
}

/** Multi-octave noise grid biased so the bottom-left corner dissolves first, normalised to 0..1. */
function erosionField(cols: number, rows: number, seed: number): Float32Array {
  const aspect = cols / rows;
  const o1 = new ValueNoise(Math.max(3, Math.round(6 * aspect)), 6, seed);
  const o2 = new ValueNoise(Math.max(4, Math.round(14 * aspect)), 14, seed + 1);
  const o3 = new ValueNoise(Math.max(6, Math.round(34 * aspect)), 34, seed + 2);
  const out = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < rows; y++) {
    const v = y / (rows - 1 || 1);
    for (let x = 0; x < cols; x++) {
      const u = x / (cols - 1 || 1);
      const n = 0.55 * o1.at(u, v) + 0.3 * o2.at(u, v) + 0.15 * o3.at(u, v);
      // diagonal sweep: small u and large v (bottom-left) go first
      const bias = u * 0.32 + (1 - v) * 0.18;
      const val = n * 0.6 + bias;
      out[y * cols + x] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  const span = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - min) / span;
  return out;
}

interface MaskSet {
  cols: number;
  rows: number;
  field: Float32Array;
  frames: string[]; // data URLs
  thresholds: number[];
}

function buildMasks(cols: number, rows: number, seed: number): MaskSet {
  const field = erosionField(cols, rows, seed);
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d");
  const frames: string[] = [];
  const thresholds: number[] = [];
  if (!ctx) return { cols, rows, field, frames, thresholds };
  const img = ctx.createImageData(cols, rows);
  const feather = 0.07;
  for (let f = 0; f < MASK_FRAMES; f++) {
    const th = (f / (MASK_FRAMES - 1)) * (1 + feather * 1.5);
    thresholds.push(th);
    for (let i = 0; i < field.length; i++) {
      const a = clamp01((field[i]! - th) / feather); // soft, burnt-looking edge
      const o = i * 4;
      img.data[o] = 0;
      img.data[o + 1] = 0;
      img.data[o + 2] = 0;
      img.data[o + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    frames.push(c.toDataURL("image/png"));
  }
  return { cols, rows, field, frames, thresholds };
}

// ---------------------------------------------------------------------------------------------
// Shared particle overlay
// ---------------------------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  age: number;
  life: number;
  flake: boolean;
  color: string;
}

class Overlay {
  private static instance: Overlay | undefined;
  static get(): Overlay {
    return (Overlay.instance ??= new Overlay());
  }

  private canvas: HTMLCanvasElement | undefined;
  private ctx: CanvasRenderingContext2D | undefined;
  private particles: Particle[] = [];
  private raf = 0;
  private last = 0;
  private active = 0; // elements currently snapping
  readonly wind: { x: number; y: number };
  private readonly curl: ValueNoise;
  private readonly t0 = performance.now();

  private constructor() {
    // One wind direction per page load, blowing up and to the right at a random angle.
    const angle = (-20 - Math.random() * 50) * (Math.PI / 180);
    const speed = 55 + Math.random() * 30;
    this.wind = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
    this.curl = new ValueNoise(9, 9, Math.floor(Math.random() * 1e9));
  }

  acquire(): void {
    this.active++;
    this.ensureCanvas();
  }
  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  private ensureCanvas(): void {
    if (this.canvas && this.canvas.isConnected) return;
    const c = document.createElement("canvas");
    c.setAttribute("data-jb-snap-canvas", "");
    c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;";
    document.documentElement.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext("2d") ?? undefined;
    this.fit();
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private fit(): void {
    if (!this.canvas || !this.ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.ceil(window.innerWidth * dpr);
    const h = Math.ceil(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** Curl of the noise field: a divergence-free swirl so dust eddies instead of streaming. */
  private swirl(x: number, y: number, t: number): { x: number; y: number } {
    const s = 1 / 420; // spatial scale in px
    const u = ((x * s + t * 0.05) % 1 + 1) % 1;
    const v = ((y * s + t * 0.03) % 1 + 1) % 1;
    const e = 0.004;
    const dndx = (this.curl.at((u + e) % 1, v) - this.curl.at((u - e + 1) % 1, v)) / (2 * e);
    const dndy = (this.curl.at(u, (v + e) % 1) - this.curl.at(u, (v - e + 1) % 1)) / (2 * e);
    return { x: dndy * 40, y: -dndx * 40 };
  }

  emit(x: number, y: number, colors: string[], flakeChance: number): void {
    if (this.particles.length >= GLOBAL_PARTICLE_BUDGET) return;
    const flake = Math.random() < flakeChance;
    this.particles.push({
      x: x + (Math.random() - 0.5) * CELL_PX,
      y: y + (Math.random() - 0.5) * CELL_PX,
      vx: this.wind.x * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 20,
      vy: this.wind.y * (0.3 + Math.random() * 0.4) - Math.random() * 25,
      size: flake ? 2.4 + Math.random() * 3.2 : 0.9 + Math.random() * 1.6,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 6,
      age: 0,
      life: 0.7 + Math.random() * 0.8,
      flake,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    });
  }

  private tick = (now: number) => {
    this.raf = 0;
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    this.fit();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Fade previous frame instead of clearing: cheap motion trails.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalCompositeOperation = "source-over";

    const drag = Math.pow(0.86, dt * 60);
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = p.age / p.life;
      const sw = this.swirl(p.x, p.y, t);
      p.vx = (p.vx + (this.wind.x * 0.9 + sw.x) * dt * 2.2) * drag;
      p.vy = (p.vy + (this.wind.y * 0.9 + sw.y - 12) * dt * 2.2) * drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (p.x < -20 || p.x > vw + 20 || p.y < -20 || p.y > vh + 20) continue;
      const alpha = (1 - k) * (p.flake ? 0.95 : 0.8);
      const size = p.size * (1 - k * 0.55);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.flake) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-size / 2, -size / 3, size, size * 0.66);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      alive.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = alive;

    if (alive.length || this.active > 0) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      canvas.remove();
      this.canvas = undefined;
      this.ctx = undefined;
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Colour sampling
// ---------------------------------------------------------------------------------------------

const ASH = ["rgba(96,92,88,0.95)", "rgba(128,122,116,0.95)", "rgba(160,154,148,0.9)", "rgba(70,66,62,0.9)", "rgba(190,184,176,0.85)"];

function rgbOf(c: string): [number, number, number] | undefined {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}
function toAsh(c: string, keep = 0.45): string | undefined {
  const rgb = rgbOf(c);
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (v: number) => Math.round(v * keep + l * 0.8 * (1 - keep));
  return `rgba(${mix(r)},${mix(g)},${mix(b)},0.92)`;
}

function queryAllDeep(el: Element, sel: string): Element[] {
  const out = Array.from(el.querySelectorAll(sel));
  if (el.shadowRoot) out.push(...Array.from(el.shadowRoot.querySelectorAll(sel)));
  return out;
}

/** Palette for an element: ash greys plus real pixel colours where we are allowed to read them. */
function palette(el: Element): string[] {
  const out: string[] = [];
  const view = el.ownerDocument.defaultView;
  if (view) {
    const cssColours: string[] = [];
    const sample = (node: Element | null) => {
      if (!node) return;
      const cs = view.getComputedStyle(node);
      for (const c of [cs.backgroundColor, cs.color, cs.borderTopColor]) {
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") cssColours.push(c);
      }
    };
    sample(el);
    sample(el.firstElementChild);
    for (const c of cssColours) {
      const a = toAsh(c);
      if (a) out.push(a);
    }
  }
  // Same-origin / CORS images: sample a 12x12 thumbnail. Tainted canvases throw and are skipped.
  for (const img of queryAllDeep(el, "img").slice(0, 3) as HTMLImageElement[]) {
    if (!img.complete || !img.naturalWidth) continue;
    try {
      const c = document.createElement("canvas");
      c.width = 12;
      c.height = 12;
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, 12, 12);
      const d = ctx.getImageData(0, 0, 12, 12).data;
      for (let i = 0; i < d.length; i += 4 * 7) {
        if (d[i + 3]! < 128) continue;
        const a = toAsh(`rgb(${d[i]},${d[i + 1]},${d[i + 2]})`, 0.6);
        if (a) out.push(a);
      }
    } catch {
      /* cross-origin image: cannot read pixels */
    }
  }
  return out.length ? [...out, ...ASH] : ASH;
}

// ---------------------------------------------------------------------------------------------
// Main effect
// ---------------------------------------------------------------------------------------------

const PROPS = [
  "mask-image",
  "-webkit-mask-image",
  "mask-size",
  "-webkit-mask-size",
  "mask-repeat",
  "-webkit-mask-repeat",
  "filter",
  "opacity",
  "transform",
  "transform-origin",
  "will-change",
  "transition",
  "pointer-events",
  "height",
  "min-height",
  "max-height",
  "margin-top",
  "margin-bottom",
  "padding-top",
  "padding-bottom",
  "overflow",
  "box-sizing",
] as const;

export interface SnapOptions {
  onCancel?: (cancel: () => void) => void;
  /** Animate the box's height to zero at the end so surrounding content slides up. */
  collapse?: boolean;
}

/** Play the snap effect on `el`, resolving when it is fully gone. Resolves immediately when the element is not visible. */
export function snapOut(el: Element, opts: SnapOptions = {}): Promise<void> {
  const h = el as HTMLElement;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = rect.width >= 24 && rect.height >= 24 && rect.bottom > -50 && rect.top < vh + 50 && rect.right > 0 && rect.left < vw;
  if (!visible || prefersReducedMotion()) return Promise.resolve();

  const prev: Record<string, [string, string]> = {};
  for (const p of PROPS) prev[p] = [h.style.getPropertyValue(p), h.style.getPropertyPriority(p)];
  const set = (k: string, v: string) => h.style.setProperty(k, v, "important");

  const cols = Math.max(12, Math.min(MAX_MASK_COLS, Math.round(rect.width / CELL_PX)));
  const rows = Math.max(8, Math.min(MAX_MASK_ROWS, Math.round(rect.height / CELL_PX)));
  const masks = buildMasks(cols, rows, Math.floor(Math.random() * 1e9));
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  // Emission probability per dying cell so each element sheds roughly PER_ELEMENT_PARTICLES.
  const emitP = Math.min(1, PER_ELEMENT_PARTICLES / (cols * rows));
  const colors = palette(el);
  const overlay = Overlay.get();
  overlay.acquire();

  set("transition", "none");
  set("pointer-events", "none");
  set("will-change", "mask-image, filter, opacity, transform");
  set("mask-size", "100% 100%");
  set("-webkit-mask-size", "100% 100%");
  set("mask-repeat", "no-repeat");
  set("-webkit-mask-repeat", "no-repeat");
  set("transform-origin", "50% 60%");
  el.setAttribute("data-jb-snapping", "");

  const alive = new Uint8Array(cols * rows).fill(1);
  let lastFrame = -1;
  let raf = 0;
  let done = false;
  let collapsing = false;
  let collapseTimer: number | undefined;
  const start = performance.now();
  const windDir = Math.atan2(overlay.wind.y, overlay.wind.x);
  const tiltX = -5 - Math.random() * 3;
  const tiltY = (Math.cos(windDir) > 0 ? 1 : -1) * (3 + Math.random() * 3);

  return new Promise<void>((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      if (collapseTimer) clearTimeout(collapseTimer);
      overlay.release();
      el.removeAttribute("data-jb-snapping");
      for (const p of PROPS) {
        const [v, prio] = prev[p]!;
        if (v) h.style.setProperty(p, v, prio);
        else h.style.removeProperty(p);
      }
      resolve();
    };
    opts.onCancel?.(finish);

    const beginCollapse = () => {
      collapsing = true;
      if (!opts.collapse) {
        finish();
        return;
      }
      // The element is fully masked/transparent now; shrink the box so the page reflows smoothly.
      const cs = getComputedStyle(h);
      const curH = h.getBoundingClientRect().height;
      set("box-sizing", "border-box");
      set("overflow", "hidden");
      set("height", `${curH}px`);
      set("min-height", "0");
      set("max-height", `${curH}px`);
      set("margin-top", cs.marginTop);
      set("margin-bottom", cs.marginBottom);
      set("padding-top", cs.paddingTop);
      set("padding-bottom", cs.paddingBottom);
      void h.offsetHeight; // commit the starting values
      set("transition", `height ${COLLAPSE_MS}ms ease, max-height ${COLLAPSE_MS}ms ease, margin ${COLLAPSE_MS}ms ease, padding ${COLLAPSE_MS}ms ease`);
      set("height", "0px");
      set("max-height", "0px");
      set("margin-top", "0px");
      set("margin-bottom", "0px");
      set("padding-top", "0px");
      set("padding-bottom", "0px");
      collapseTimer = window.setTimeout(finish, COLLAPSE_MS + 30);
    };

    const frame = (now: number) => {
      if (collapsing) return;
      const t = Math.min(1, (now - start) / DURATION_MS);

      // Phase 1: ash. Desaturate and darken, tiny settle.
      const ash = clamp01(t / ASH_END);
      const gray = easeOut(ash) * 0.85;
      const dark = 1 - easeOut(ash) * 0.22;

      // Phase 2: crumble. Mask sweep with feathered edges; lift, tilt and drift with the wind.
      const c = clamp01((t - ASH_END * 0.6) / (CRUMBLE_END - ASH_END * 0.6));
      const e = easeInOut(c);
      const fi = Math.min(masks.frames.length - 1, Math.floor(e * masks.frames.length));
      if (fi !== lastFrame && masks.frames[fi]) {
        // Emit dust from the cells that died since the last applied frame.
        const th = masks.thresholds[fi]!;
        for (let i = 0; i < alive.length; i++) {
          if (!alive[i]) continue;
          if (masks.field[i]! > th) continue;
          alive[i] = 0;
          if (Math.random() > emitP) continue;
          const x = i % cols;
          const y = (i / cols) | 0;
          overlay.emit(rect.left + (x + 0.5) * cellW, rect.top + (y + 0.5) * cellH, colors, 0.24);
        }
        lastFrame = fi;
        set("mask-image", `url("${masks.frames[fi]}")`);
        set("-webkit-mask-image", `url("${masks.frames[fi]}")`);
      }
      const blur = e * 1.2;
      set("filter", `grayscale(${gray.toFixed(3)}) brightness(${dark.toFixed(3)}) blur(${blur.toFixed(2)}px)`);
      const dx = Math.cos(windDir) * 18 * e;
      const dy = Math.sin(windDir) * 18 * e - 6 * e;
      set(
        "transform",
        `perspective(900px) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotateX(${(tiltX * e).toFixed(2)}deg) rotateY(${(tiltY * e).toFixed(2)}deg) scale(${(1 + 0.02 * e).toFixed(3)})`,
      );
      set("opacity", String(1 - clamp01((t - 0.8) / 0.2)));

      if (t >= 1) beginCollapse();
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
