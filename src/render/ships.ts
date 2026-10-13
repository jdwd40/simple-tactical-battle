import type { Ship } from '../game/types';

type Pt = [number, number];

export function shipColor(kind: Ship['kind']): string {
  switch (kind) {
    case 'player': return '#40e0ff';
    case 'fighter': return '#ff4fa3';
    case 'corvette': return '#ff6fb0';
    case 'cruiser': return '#ff9a3c';
    case 'destroyer': return '#ff5c6c';
    case 'battlecruiser': return '#ff3d5a';
    case 'warlord': return '#c77dff';
  }
}

/** Half-size of each class as a fraction of a grid cell. */
export function shipSize(kind: Ship['kind']): number {
  switch (kind) {
    case 'player': return 0.44;
    case 'fighter': return 0.24;
    case 'corvette': return 0.3;
    case 'cruiser': return 0.36;
    case 'destroyer': return 0.38;
    case 'battlecruiser': return 0.44;
    case 'warlord': return 0.5;
  }
}

interface Design {
  hull: Pt[];
  /** Secondary plates drawn darker on top of the hull. */
  plates?: Pt[][];
  /** Thin panel lines. */
  lines?: Pt[][];
  /** Engine nozzle positions (x, y) and flame length. */
  engines: { at: Pt; len: number }[];
  bridge?: { at: Pt; rx: number; ry: number };
  /** Small glowing dots (turrets, running lights). */
  lights?: Pt[];
}

const DESIGNS: Record<Ship['kind'], Design> = {
  player: {
    hull: [[1.2, 0], [0.75, 0.18], [0.1, 0.22], [-0.2, 0.75], [-0.75, 0.8], [-0.6, 0.3], [-0.95, 0.28], [-0.95, -0.28], [-0.6, -0.3], [-0.75, -0.8], [-0.2, -0.75], [0.1, -0.22], [0.75, -0.18]],
    plates: [[[0.7, 0], [0.1, 0.12], [-0.55, 0.12], [-0.55, -0.12], [0.1, -0.12]]],
    lines: [[[-0.2, 0.75], [-0.1, 0.22]], [[-0.2, -0.75], [-0.1, -0.22]], [[0.4, 0.17], [0.4, -0.17]]],
    engines: [{ at: [-0.95, 0.17], len: 0.7 }, { at: [-0.95, -0.17], len: 0.7 }],
    bridge: { at: [0.0, 0], rx: 0.22, ry: 0.1 },
    lights: [[0.55, 0.14], [0.55, -0.14], [-0.5, 0.62], [-0.5, -0.62]],
  },
  fighter: {
    hull: [[1, 0], [-0.3, 0.35], [-0.5, 0.9], [-0.8, 0.9], [-0.7, 0.3], [-0.9, 0], [-0.7, -0.3], [-0.8, -0.9], [-0.5, -0.9], [-0.3, -0.35]],
    engines: [{ at: [-0.85, 0], len: 0.9 }],
    bridge: { at: [0.2, 0], rx: 0.28, ry: 0.12 },
  },
  corvette: {
    hull: [[1.05, 0], [0.3, 0.35], [-0.3, 0.4], [-0.5, 0.8], [-0.85, 0.8], [-0.7, 0.35], [-0.9, 0.25], [-0.9, -0.25], [-0.7, -0.35], [-0.85, -0.8], [-0.5, -0.8], [-0.3, -0.4], [0.3, -0.35]],
    lines: [[[0.3, 0.35], [0.3, -0.35]]],
    engines: [{ at: [-0.9, 0], len: 0.8 }],
    bridge: { at: [0.15, 0], rx: 0.25, ry: 0.13 },
    lights: [[-0.55, 0.62], [-0.55, -0.62]],
  },
  cruiser: {
    hull: [[1.1, 0], [0.6, 0.3], [0.1, 0.38], [-0.1, 0.85], [-0.8, 0.95], [-0.95, 0.4], [-0.95, -0.4], [-0.8, -0.95], [-0.1, -0.85], [0.1, -0.38], [0.6, -0.3]],
    plates: [[[0.5, 0], [0.0, 0.2], [-0.7, 0.22], [-0.7, -0.22], [0.0, -0.2]]],
    lines: [[[-0.1, 0.85], [-0.05, 0.38]], [[-0.1, -0.85], [-0.05, -0.38]]],
    engines: [{ at: [-0.95, 0.22], len: 0.7 }, { at: [-0.95, -0.22], len: 0.7 }],
    bridge: { at: [-0.1, 0], rx: 0.2, ry: 0.1 },
    lights: [[0.45, 0.22], [0.45, -0.22]],
  },
  destroyer: {
    hull: [[1.1, 0.25], [1.15, 0.1], [0.4, 0.15], [0.4, 0.55], [-0.2, 0.75], [-0.9, 0.75], [-0.95, 0.35], [-0.95, -0.35], [-0.9, -0.75], [-0.2, -0.75], [0.4, -0.55], [0.4, -0.15], [1.15, -0.1], [1.1, -0.25], [0.6, -0.05], [0.6, 0.05]],
    plates: [[[0.3, 0.45], [-0.8, 0.45], [-0.8, 0.65], [-0.2, 0.65]], [[0.3, -0.45], [-0.8, -0.45], [-0.8, -0.65], [-0.2, -0.65]]],
    lines: [[[0.4, 0.15], [-0.9, 0.15]], [[0.4, -0.15], [-0.9, -0.15]]],
    engines: [{ at: [-0.95, 0.2], len: 0.6 }, { at: [-0.95, -0.2], len: 0.6 }],
    bridge: { at: [-0.2, 0], rx: 0.22, ry: 0.11 },
    lights: [[-0.5, 0.55], [-0.5, -0.55], [0.0, 0.55], [0.0, -0.55]],
  },
  battlecruiser: {
    hull: [[1.25, 0], [0.8, 0.22], [0.3, 0.28], [0.5, 0.85], [-0.1, 0.9], [-0.3, 0.4], [-0.8, 0.45], [-0.95, 0.75], [-1.05, 0.7], [-0.95, 0.2], [-0.95, -0.2], [-1.05, -0.7], [-0.95, -0.75], [-0.8, -0.45], [-0.3, -0.4], [-0.1, -0.9], [0.5, -0.85], [0.3, -0.28], [0.8, -0.22]],
    plates: [[[0.8, 0], [0.2, 0.16], [-0.8, 0.16], [-0.8, -0.16], [0.2, -0.16]]],
    lines: [[[0.5, 0.85], [0.3, 0.28]], [[0.5, -0.85], [0.3, -0.28]], [[-0.3, 0.4], [-0.3, -0.4]]],
    engines: [{ at: [-0.95, 0], len: 0.8 }, { at: [-1.0, 0.45], len: 0.55 }, { at: [-1.0, -0.45], len: 0.55 }],
    bridge: { at: [-0.05, 0], rx: 0.25, ry: 0.11 },
    lights: [[0.6, 0.18], [0.6, -0.18], [0.1, 0.7], [0.1, -0.7]],
  },
  warlord: {
    hull: [[1.2, 0], [0.9, 0.3], [0.5, 0.35], [0.9, 0.8], [0.6, 1.05], [-0.2, 0.95], [-0.5, 0.5], [-0.9, 0.6], [-1.05, 0.95], [-1.15, 0.85], [-0.95, 0.25], [-0.95, -0.25], [-1.15, -0.85], [-1.05, -0.95], [-0.9, -0.6], [-0.5, -0.5], [-0.2, -0.95], [0.6, -1.05], [0.9, -0.8], [0.5, -0.35], [0.9, -0.3]],
    plates: [[[0.85, 0], [0.3, 0.2], [-0.8, 0.2], [-0.8, -0.2], [0.3, -0.2]], [[0.6, 0.45], [0.75, 0.75], [0.0, 0.8], [-0.2, 0.5]], [[0.6, -0.45], [0.75, -0.75], [0.0, -0.8], [-0.2, -0.5]]],
    lines: [[[-0.5, 0.5], [-0.5, -0.5]], [[0.3, 0.35], [0.3, -0.35]]],
    engines: [{ at: [-0.95, 0], len: 0.9 }, { at: [-1.1, 0.55], len: 0.6 }, { at: [-1.1, -0.55], len: 0.6 }],
    bridge: { at: [0.1, 0], rx: 0.3, ry: 0.13 },
    lights: [[0.7, 0.25], [0.7, -0.25], [0.4, 0.75], [0.4, -0.75], [-0.7, 0.55], [-0.7, -0.55]],
  },
};

function poly(ctx: CanvasRenderingContext2D, pts: Pt[], r: number): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * r, y * r) : ctx.lineTo(x * r, y * r)));
  ctx.closePath();
}

/** Draw a ship pointing along +x, centred at the origin. `r` is the half-size in pixels. */
export function drawShip(ctx: CanvasRenderingContext2D, kind: Ship['kind'], r: number, time: number, hitFlash: number): void {
  const col = shipColor(kind);
  const d = DESIGNS[kind];
  const flicker = 0.75 + 0.25 * Math.sin(time * 31 + r);

  // Engine flames
  for (const e of d.engines) {
    const [ex, ey] = e.at;
    const len = e.len * r * flicker;
    const g = ctx.createLinearGradient(ex * r, 0, ex * r - len, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, col);
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ex * r, ey * r - r * 0.12);
    ctx.lineTo(ex * r - len, ey * r);
    ctx.lineTo(ex * r, ey * r + r * 0.12);
    ctx.closePath();
    ctx.fill();
  }

  // Hull with glow
  ctx.shadowColor = col;
  ctx.shadowBlur = Math.max(8, r * 0.6);
  poly(ctx, d.hull, r);
  const body = ctx.createLinearGradient(0, -r, 0, r);
  body.addColorStop(0, '#2b3d63');
  body.addColorStop(0.5, '#15203a');
  body.addColorStop(1, '#0c1326');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.strokeStyle = col;
  ctx.stroke();

  // Armour plates
  if (d.plates) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.strokeStyle = col + '88';
    ctx.lineWidth = 1;
    for (const p of d.plates) { poly(ctx, p, r); ctx.fill(); ctx.stroke(); }
  }
  // Panel lines
  if (d.lines) {
    ctx.strokeStyle = col + '66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const l of d.lines) { ctx.moveTo(l[0][0] * r, l[0][1] * r); ctx.lineTo(l[1][0] * r, l[1][1] * r); }
    ctx.stroke();
  }
  // Bridge / cockpit
  if (d.bridge) {
    const [bx, by] = d.bridge.at;
    const bg = ctx.createRadialGradient(bx * r, by * r, 0, bx * r, by * r, d.bridge.rx * r);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.5, col);
    bg.addColorStop(1, col + '55');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(bx * r, by * r, d.bridge.rx * r, d.bridge.ry * r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Running lights
  if (d.lights) {
    const blink = 0.6 + 0.4 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(255,255,255,${blink.toFixed(2)})`;
    for (const [lx, ly] of d.lights) {
      ctx.beginPath();
      ctx.arc(lx * r, ly * r, Math.max(1, r * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (hitFlash > 0) {
    poly(ctx, d.hull, r);
    ctx.fillStyle = `rgba(255,255,255,${hitFlash.toFixed(2)})`;
    ctx.fill();
  }
}
