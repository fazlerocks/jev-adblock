/**
 * "Snap" dissolve: the element disintegrates into dust before it is removed.
 *
 * Two layers, no dependencies and no rasterisation of page content:
 *  1. A dissolve mask on the element itself. A coarse noise grid is thresholded frame by frame
 *     (sweeping left → right) and applied with `mask-image`, so blocks of the element break away.
 *     Masks, blur, transforms and opacity are compositor effects that Chromium also applies to
 *     cross-site iframes, unlike SVG reference filters, so ad iframes dissolve too.
 *  2. A canvas overlay of dust particles that lift off the vanishing area and fade.
 */

const DURATION_MS = 1100;
const MASK_FRAMES = 22;
const MAX_PARTICLES = 220;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Cheap value noise on a small grid with a horizontal bias so the sweep starts on the left. */
function noiseGrid(cols: number, rows: number, seed: number): Float32Array {
  const g = new Float32Array(cols * rows);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // base white noise
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  // one smoothing pass so holes cluster into flakes instead of single pixels
  const out = new Float32Array(g.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          sum += g[yy * cols + xx]!;
          n++;
        }
      }
      const smooth = sum / n;
      const mixed = 0.55 * smooth + 0.45 * g[y * cols + x]!;
      // bias: cells on the left dissolve first
      out[y * cols + x] = mixed * 0.7 + (x / cols) * 0.3;
    }
  }
  // Normalise to 0..1 so the threshold sweep uses the whole duration instead of a narrow band.
  let min = Infinity;
  let max = -Infinity;
  for (const v of out) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - min) / span;
  return out;
}

/** Pre-render the mask frames as tiny PNG data URLs (cols×rows pixels, scaled by CSS). */
function maskFrames(cols: number, rows: number, seed: number): string[] {
  const grid = noiseGrid(cols, rows, seed);
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d");
  if (!ctx) return [];
  const frames: string[] = [];
  const img = ctx.createImageData(cols, rows);
  for (let f = 0; f < MASK_FRAMES; f++) {
    const th = (f / (MASK_FRAMES - 1)) * 1.02; // sweep just past 1 so everything is gone at the end
    for (let i = 0; i < grid.length; i++) {
      const alive = grid[i]! > th;
      img.data[i * 4] = 0;
      img.data[i * 4 + 1] = 0;
      img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = alive ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    frames.push(c.toDataURL("image/png"));
  }
  return frames;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  delay: number;
  life: number;
  color: string;
  spin: number;
}

function pickColors(el: Element): string[] {
  const out: string[] = [];
  const view = el.ownerDocument.defaultView;
  if (view) {
    const sample = (node: Element | null) => {
      if (!node) return;
      const cs = view.getComputedStyle(node);
      for (const c of [cs.backgroundColor, cs.color, cs.borderTopColor]) {
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") out.push(c);
      }
    };
    sample(el);
    sample(el.firstElementChild);
    sample(el.querySelector("img, h1, h2, h3, p, span, a"));
  }
  out.push("rgba(120,120,128,0.9)", "rgba(180,180,188,0.9)", "rgba(90,90,96,0.85)");
  return out;
}

const PROPS = ["mask-image", "-webkit-mask-image", "mask-size", "-webkit-mask-size", "mask-repeat", "-webkit-mask-repeat", "filter", "opacity", "transform", "will-change", "transition", "pointer-events"] as const;

/** Play the snap effect on `el`, resolving when it is fully gone. Resolves immediately when the element is not visible. */
export function snapOut(el: Element, opts: { onCancel?: (cancel: () => void) => void } = {}): Promise<void> {
  const h = el as HTMLElement;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = rect.width >= 24 && rect.height >= 24 && rect.bottom > -50 && rect.top < vh + 50 && rect.right > 0 && rect.left < vw;
  if (!visible || prefersReducedMotion()) return Promise.resolve();

  const prev: Record<string, [string, string]> = {};
  for (const p of PROPS) prev[p] = [h.style.getPropertyValue(p), h.style.getPropertyPriority(p)];

  // Mask resolution: ~14px cells, capped so big elements stay cheap.
  const cols = Math.max(12, Math.min(96, Math.round(rect.width / 14)));
  const rows = Math.max(8, Math.min(72, Math.round(rect.height / 14)));
  const frames = maskFrames(cols, rows, Math.floor(Math.random() * 1e9));

  const set = (k: string, v: string) => h.style.setProperty(k, v, "important");
  set("transition", "none");
  set("pointer-events", "none");
  set("will-change", "mask-image, filter, opacity, transform");
  set("mask-size", "100% 100%");
  set("-webkit-mask-size", "100% 100%");
  set("mask-repeat", "no-repeat");
  set("-webkit-mask-repeat", "no-repeat");
  el.setAttribute("data-jb-snapping", "");

  // Particle overlay
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pad = 70;
  const cw = rect.width + pad * 2;
  const ch = rect.height + pad * 2;
  canvas.width = Math.ceil(cw * dpr);
  canvas.height = Math.ceil(ch * dpr);
  canvas.style.cssText = `position:fixed;left:${rect.left - pad}px;top:${rect.top - pad}px;width:${cw}px;height:${ch}px;pointer-events:none;z-index:2147483647;`;
  canvas.setAttribute("data-jb-snap-canvas", "");
  document.documentElement.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.scale(dpr, dpr);

  const colors = pickColors(el);
  const count = Math.min(MAX_PARTICLES, Math.max(40, Math.round((rect.width * rect.height) / 900)));
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * rect.width;
    const y = Math.random() * rect.height;
    particles.push({
      x: pad + x,
      y: pad + y,
      vx: 25 + Math.random() * 80,
      vy: -(30 + Math.random() * 100),
      r: 0.9 + Math.random() * 2.4,
      delay: (x / rect.width) * 0.55 + Math.random() * 0.12, // matches the left→right mask sweep
      life: 0.45 + Math.random() * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      spin: (Math.random() - 0.5) * 2,
    });
  }

  let raf = 0;
  let done = false;
  let lastFrame = -1;
  const start = performance.now();

  return new Promise<void>((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      canvas.remove();
      el.removeAttribute("data-jb-snapping");
      for (const p of PROPS) {
        const [v, prio] = prev[p]!;
        if (v) h.style.setProperty(p, v, prio);
        else h.style.removeProperty(p);
      }
      resolve();
    };
    opts.onCancel?.(finish);

    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const e = ease(t);

      // Element: flakes break away, slight blur, drift up-right, fade at the very end.
      const fi = Math.min(frames.length - 1, Math.floor(e * frames.length));
      if (fi !== lastFrame && frames[fi]) {
        lastFrame = fi;
        set("mask-image", `url("${frames[fi]}")`);
        set("-webkit-mask-image", `url("${frames[fi]}")`);
      }
      set("filter", `blur(${(e * 3).toFixed(2)}px)`);
      set("opacity", String(1 - Math.max(0, (t - 0.7) / 0.3)));
      set("transform", `translate(${(e * 12).toFixed(1)}px, ${(-e * 18).toFixed(1)}px)`);

      // Dust
      if (ctx) {
        ctx.clearRect(0, 0, cw, ch);
        for (const p of particles) {
          const lt = (t - p.delay) / p.life;
          if (lt <= 0 || lt >= 1) continue;
          const k = ease(lt);
          const x = p.x + p.vx * k + Math.sin((k + p.spin) * 6) * 3;
          const y = p.y + p.vy * k - 40 * k * k;
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(x, y, p.r * (1 - k * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (t >= 1) finish();
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
