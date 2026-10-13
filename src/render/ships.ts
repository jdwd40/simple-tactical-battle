import type { Ship } from '../game/types';

export function shipColor(kind: Ship['kind']): string {
  switch (kind) {
    case 'player': return '#40e0ff';
    case 'scout': return '#ff4fa3';
    case 'frigate': return '#ff9a3c';
    case 'dreadnought': return '#ff5c6c';
    case 'warlord': return '#c77dff';
  }
}

/** Draw a ship pointing along +x, centred at the origin. `r` is the half-size. */
export function drawShip(ctx: CanvasRenderingContext2D, kind: Ship['kind'], r: number, time: number, hitFlash: number): void {
  const col = shipColor(kind);
  const path = () => {
    ctx.beginPath();
    switch (kind) {
      case 'player':
        ctx.moveTo(r * 1.1, 0);
        ctx.lineTo(-r * 0.6, r * 0.75);
        ctx.lineTo(-r * 0.3, r * 0.25);
        ctx.lineTo(-r * 0.9, r * 0.2);
        ctx.lineTo(-r * 0.9, -r * 0.2);
        ctx.lineTo(-r * 0.3, -r * 0.25);
        ctx.lineTo(-r * 0.6, -r * 0.75);
        break;
      case 'scout':
        ctx.moveTo(r * 0.9, 0);
        ctx.lineTo(-r * 0.7, r * 0.55);
        ctx.lineTo(-r * 0.4, 0);
        ctx.lineTo(-r * 0.7, -r * 0.55);
        break;
      case 'frigate':
        ctx.moveTo(r, 0);
        ctx.lineTo(r * 0.2, r * 0.45);
        ctx.lineTo(-r * 0.8, r * 0.8);
        ctx.lineTo(-r * 0.6, 0);
        ctx.lineTo(-r * 0.8, -r * 0.8);
        ctx.lineTo(r * 0.2, -r * 0.45);
        break;
      case 'dreadnought':
        ctx.moveTo(r * 0.9, r * 0.3);
        ctx.lineTo(r * 1.1, 0);
        ctx.lineTo(r * 0.9, -r * 0.3);
        ctx.lineTo(r * 0.2, -r * 0.9);
        ctx.lineTo(-r * 0.9, -r * 0.9);
        ctx.lineTo(-r * 0.7, 0);
        ctx.lineTo(-r * 0.9, r * 0.9);
        ctx.lineTo(r * 0.2, r * 0.9);
        break;
      case 'warlord':
        ctx.moveTo(r * 1.2, 0);
        ctx.lineTo(r * 0.4, r * 0.5);
        ctx.lineTo(r * 0.1, r * 1.05);
        ctx.lineTo(-r * 0.9, r * 1.05);
        ctx.lineTo(-r * 0.5, r * 0.35);
        ctx.lineTo(-r * 1.0, 0);
        ctx.lineTo(-r * 0.5, -r * 0.35);
        ctx.lineTo(-r * 0.9, -r * 1.05);
        ctx.lineTo(r * 0.1, -r * 1.05);
        ctx.lineTo(r * 0.4, -r * 0.5);
        break;
    }
    ctx.closePath();
  };

  // Engine glow behind
  const flicker = 0.7 + 0.3 * Math.sin(time * 30);
  const eg = ctx.createRadialGradient(-r * 0.9, 0, 0, -r * 0.9, 0, r * 0.9 * flicker);
  eg.addColorStop(0, col + 'cc');
  eg.addColorStop(1, col + '00');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(-r * 0.9, 0, r * 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.shadowColor = col;
  ctx.shadowBlur = 14;
  path();
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  g.addColorStop(0, '#111a2e');
  g.addColorStop(1, '#263a5e');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Cockpit / core
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(r * 0.25, 0, r * 0.25, r * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (hitFlash > 0) {
    path();
    ctx.fillStyle = `rgba(255,255,255,${hitFlash.toFixed(2)})`;
    ctx.fill();
  }
}
