import type { GameState, PickupKind, Ship, Vec } from '../game/types';
import { key } from '../game/grid';
import { drawShip, shipColor, shipSize } from './ships';
import { Effects } from './effects';

export type HighlightKind = 'move' | 'laser' | 'missile' | 'rail' | 'threat' | 'selected' | 'path';

export interface VShip {
  id: number;
  kind: Ship['kind'];
  x: number;
  y: number;
  facing: number;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  hitFlash: number;
  shieldFlash: number;
  bob: number;
}

export interface VPickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

interface Star { x: number; y: number; z: number; tw: number; }

const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cols = 8;
  private rows = 10;
  cell = 40;
  private dpr = 1;
  private stars: Star[] = [];
  private asteroids: Vec[] = [];
  private asteroidSeeds = new Map<string, number>();
  ships = new Map<number, VShip>();
  pickups: VPickup[] = [];
  highlights = new Map<string, HighlightKind>();
  threats = new Set<string>();
  readonly fx = new Effects();
  private time = 0;
  private last = 0;
  private shakeAmt = 0;
  onCell: ((cell: Vec) => void) | null = null;
  reducedMotion = prefersReducedMotion;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    for (let i = 0; i < 140; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, tw: Math.random() * Math.PI * 2 });
    }
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * this.cols);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * this.rows);
      if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) this.onCell?.({ x, y });
    });
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize(): void {
    const w = this.container.clientWidth - 16;
    const h = this.container.clientHeight - 4;
    if (w <= 0 || h <= 0) return;
    this.cell = Math.floor(Math.min(w / this.cols, h / this.rows));
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = this.cell * this.cols;
    const ch = this.cell * this.rows;
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
  }

  /** Pull static layout and any ships the renderer does not know about yet. */
  syncFromState(s: GameState, removeMissing = true): void {
    this.cols = s.cols;
    this.rows = s.rows;
    if (this.asteroids !== s.asteroids) {
      this.asteroids = s.asteroids;
      this.asteroidSeeds.clear();
      for (const a of s.asteroids) this.asteroidSeeds.set(key(a), Math.random());
      this.resize();
    }
    const seen = new Set<number>();
    for (const ship of [s.player, ...s.enemies]) {
      seen.add(ship.id);
      const v = this.ships.get(ship.id);
      if (v) {
        v.hull = ship.hull; v.maxHull = ship.maxHull; v.shield = ship.shield; v.maxShield = ship.maxShield;
        v.x = ship.pos.x; v.y = ship.pos.y; v.facing = ship.facing;
      } else {
        this.ships.set(ship.id, {
          id: ship.id, kind: ship.kind, x: ship.pos.x, y: ship.pos.y, facing: ship.facing,
          hull: ship.hull, maxHull: ship.maxHull, shield: ship.shield, maxShield: ship.maxShield,
          hitFlash: 0, shieldFlash: 0, bob: Math.random() * Math.PI * 2,
        });
      }
    }
    if (removeMissing) for (const id of [...this.ships.keys()]) if (!seen.has(id)) this.ships.delete(id);
    this.pickups = s.pickups.map((p) => ({ id: p.id, kind: p.kind, x: p.pos.x, y: p.pos.y }));
  }

  centre(p: Vec): Vec {
    return { x: (p.x + 0.5) * this.cell, y: (p.y + 0.5) * this.cell };
  }

  shake(amount: number): void {
    if (this.reducedMotion) return;
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Tween a ship along a path. Resolves when it arrives. */
  animateMove(id: number, path: Vec[], msPerStep = 140): Promise<void> {
    const v = this.ships.get(id);
    if (!v) return Promise.resolve();
    if (this.reducedMotion) {
      const end = path[path.length - 1];
      v.x = end.x; v.y = end.y;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let i = 0;
      const stepTo = () => {
        if (i >= path.length) return resolve();
        const from = { x: v.x, y: v.y };
        const to = path[i++];
        v.facing = Math.atan2(to.y - from.y, to.x - from.x);
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / msPerStep);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          v.x = from.x + (to.x - from.x) * e;
          v.y = from.y + (to.y - from.y) * e;
          const c = this.centre({ x: v.x - 0.5, y: v.y - 0.5 });
          this.fx.engineTrail(c.x, c.y, v.facing, shipColor(v.kind));
          if (t < 1) requestAnimationFrame(tick); else stepTo();
        };
        requestAnimationFrame(tick);
      };
      stepTo();
    });
  }

  private frame(t: number): void {
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0);
    this.last = t;
    this.time += dt;
    this.fx.update(dt, this.cell);
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - dt * 40);
    for (const v of this.ships.values()) {
      v.hitFlash = Math.max(0, v.hitFlash - dt * 4);
      v.shieldFlash = Math.max(0, v.shieldFlash - dt * 2.5);
    }
    this.draw();
    requestAnimationFrame((n) => this.frame(n));
  }

  private draw(): void {
    const { ctx, cell } = this;
    const W = cell * this.cols;
    const H = cell * this.rows;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.shakeAmt > 0) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt);
    }
    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#05070f');
    ctx.fillStyle = bg;
    ctx.fillRect(-10, -10, W + 20, H + 20);
    // Nebula glow
    const neb = ctx.createRadialGradient(W * 0.7, H * 0.25, 0, W * 0.7, H * 0.25, W * 0.9);
    neb.addColorStop(0, 'rgba(120, 60, 200, 0.18)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);
    // Stars
    for (const s of this.stars) {
      const y = ((s.y + this.time * 0.006 * s.z) % 1) * H;
      const x = s.x * W;
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * 2 + s.tw)) * s.z;
      ctx.fillStyle = `rgba(200, 220, 255, ${a.toFixed(2)})`;
      const r = s.z * 1.4;
      ctx.fillRect(x, y, r, r);
    }
    // Grid
    ctx.strokeStyle = 'rgba(100, 150, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.cols; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, H); }
    for (let y = 0; y <= this.rows; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(W, y * cell + 0.5); }
    ctx.stroke();

    // Threat overlay
    for (const k of this.threats) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillStyle = 'rgba(255, 70, 110, 0.07)';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    // Highlights
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    for (const [k, kind] of this.highlights) {
      const [x, y] = k.split(',').map(Number);
      this.drawHighlight(x, y, kind, pulse);
    }

    for (const a of this.asteroids) this.drawAsteroid(a);
    for (const p of this.pickups) this.drawPickup(p);

    this.fx.drawBelow(ctx, cell);
    for (const v of this.ships.values()) this.drawShip(v);
    this.fx.drawAbove(ctx, cell);

    // Vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  private drawHighlight(x: number, y: number, kind: HighlightKind, pulse: number): void {
    const { ctx, cell } = this;
    const px = x * cell, py = y * cell;
    const inset = 3;
    const colors: Record<HighlightKind, string> = {
      move: '64, 224, 255', laser: '255, 79, 163', missile: '255, 198, 74', rail: '157, 240, 255', threat: '255, 70, 110', selected: '255, 255, 255', path: '64, 224, 255',
    };
    const c = colors[kind];
    ctx.fillStyle = `rgba(${c}, ${0.12 + pulse * 0.08})`;
    ctx.strokeStyle = `rgba(${c}, ${0.55 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    this.roundRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2, 6);
    ctx.fill();
    ctx.stroke();
    if (kind === 'laser' || kind === 'missile') {
      // crosshair
      const cx = px + cell / 2, cy = py + cell / 2, r = cell * (0.28 + pulse * 0.04);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(cx + dx * r * 0.6, cy + dy * r * 0.6);
        ctx.lineTo(cx + dx * r * 1.3, cy + dy * r * 1.3);
      }
      ctx.stroke();
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawAsteroid(a: Vec): void {
    const { ctx, cell } = this;
    const seed = this.asteroidSeeds.get(key(a)) ?? 0.5;
    const c = this.centre(a);
    const r = cell * 0.4;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(seed * Math.PI * 2);
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rr = r * (0.78 + 0.22 * Math.sin(seed * 40 + i * 2.3));
      const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#8a8ea3');
    g.addColorStop(0.6, '#4a4e63');
    g.addColorStop(1, '#23263a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 190, 230, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // craters
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 3; i++) {
      const ang = seed * 10 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * r * 0.45, Math.sin(ang) * r * 0.45, r * (0.12 + 0.08 * ((seed * 7 + i) % 1)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPickup(p: VPickup): void {
    const { ctx, cell } = this;
    const c = this.centre({ x: p.x, y: p.y });
    const bob = Math.sin(this.time * 3 + p.id) * cell * 0.04;
    const colors: Record<PickupKind, string> = { energy: '#ffc64a', shield: '#40e0ff', missile: '#ff4fa3', repair: '#5cf29a' };
    const col = colors[p.kind];
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    // glow ring
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.45);
    g.addColorStop(0, col + 'aa');
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(this.time * 1.2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    const r = cell * 0.22;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.rotate(-this.time * 1.2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.font = `bold ${Math.round(cell * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph: Record<PickupKind, string> = { energy: '⚡', shield: '◈', missile: '▲', repair: '+' };
    ctx.fillText(glyph[p.kind], 0, 1);
    ctx.restore();
  }

  private drawShip(v: VShip): void {
    const { ctx, cell } = this;
    const c = this.centre({ x: v.x, y: v.y });
    const bob = this.reducedMotion ? 0 : Math.sin(this.time * 2 + v.bob) * cell * 0.02;
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    // shield bubble
    if (v.shield > 0 || v.shieldFlash > 0) {
      const a = 0.12 + (v.shield / Math.max(1, v.maxShield)) * 0.2 + v.shieldFlash * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, cell * Math.min(0.48, shipSize(v.kind) + 0.1), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(64, 224, 255, ${(a * 0.4).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(120, 235, 255, ${a.toFixed(3)})`;
      ctx.lineWidth = 1.5 + v.shieldFlash * 2;
      ctx.stroke();
    }
    ctx.rotate(v.facing);
    drawShip(ctx, v.kind, cell * shipSize(v.kind), this.time, v.hitFlash);
    ctx.restore();

    // health bar for enemies / low player
    if (v.kind !== 'player') {
      const w = cell * 0.7, h = 4;
      const x = c.x - w / 2, y = c.y + cell * 0.38;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = '#ff5c6c';
      ctx.fillRect(x, y, w * (v.hull / v.maxHull), h);
      if (v.maxShield > 0) {
        ctx.fillStyle = '#40e0ff';
        ctx.fillRect(x, y - 3, w * (v.shield / v.maxShield), 2);
      }
    }
  }
}
