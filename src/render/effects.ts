/** Lightweight particle / beam / projectile / text effects drawn on the battlefield canvas. */

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; drag: number; }
interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; max: number; color: string; width: number; }
interface Ring { x: number; y: number; r: number; max: number; life: number; color: string; width: number; }
interface Projectile { x: number; y: number; from: { x: number; y: number }; to: { x: number; y: number }; t: number; dur: number; color: string; done: () => void; }
interface FloatText { x: number; y: number; text: string; color: string; life: number; max: number; size: number; vy: number; }

export class Effects {
  private particles: Particle[] = [];
  private beams: Beam[] = [];
  private rings: Ring[] = [];
  private projectiles: Projectile[] = [];
  private texts: FloatText[] = [];
  private trailAcc = 0;

  engineTrail(x: number, y: number, facing: number, color: string): void {
    this.trailAcc += 1;
    if (this.trailAcc % 2 !== 0) return;
    const bx = x - Math.cos(facing) * 10, by = y - Math.sin(facing) * 10;
    this.particles.push({ x: bx, y: by, vx: -Math.cos(facing) * 40 + (Math.random() - 0.5) * 20, vy: -Math.sin(facing) * 40 + (Math.random() - 0.5) * 20, life: 0.35, max: 0.35, size: 3, color, drag: 0.9 });
  }

  burst(x: number, y: number, count: number, color: string, speed = 160, size = 3, life = 0.6): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.5 + Math.random()), color, drag: 0.94 });
    }
  }

  explosion(x: number, y: number, big: boolean): void {
    const scale = big ? 1.8 : 1;
    this.burst(x, y, big ? 60 : 28, '#ffd27a', 220 * scale, 3.5, 0.8);
    this.burst(x, y, big ? 40 : 18, '#ff6a3c', 160 * scale, 4.5, 0.9);
    this.burst(x, y, big ? 30 : 12, '#ffffff', 300 * scale, 2, 0.4);
    this.burst(x, y, big ? 24 : 10, '#3a3f55', 60 * scale, 6, 1.4);
    this.rings.push({ x, y, r: 0, max: 60 * scale, life: 0.5, color: '#ffd27a', width: 4 });
    this.rings.push({ x, y, r: 0, max: 90 * scale, life: 0.7, color: '#ff6a3c', width: 2 });
  }

  beam(x1: number, y1: number, x2: number, y2: number, color: string, width = 3, life = 0.28): void {
    this.beams.push({ x1, y1, x2, y2, life, max: life, color, width });
    this.burst(x2, y2, 12, color, 120, 2.5, 0.4);
    this.burst(x1, y1, 5, color, 60, 2, 0.25);
  }

  ring(x: number, y: number, max: number, color: string, life = 0.5, width = 3): void {
    this.rings.push({ x, y, r: 0, max, life, color, width });
  }

  projectile(from: { x: number; y: number }, to: { x: number; y: number }, color: string, dur: number): Promise<void> {
    return new Promise((resolve) => {
      this.projectiles.push({ x: from.x, y: from.y, from, to, t: 0, dur, color, done: resolve });
    });
  }

  text(x: number, y: number, text: string, color: string, size = 16): void {
    this.texts.push({ x, y, text, color, life: 1.1, max: 1.1, size, vy: -36 });
  }

  update(dt: number, _cell: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= p.drag; p.vy *= p.drag;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const r of this.rings) { r.life -= dt; r.r += (r.max / 0.5) * dt; }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= 0.95; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const pr of this.projectiles) {
      pr.t += dt;
      const u = Math.min(1, pr.t / pr.dur);
      const arc = Math.sin(u * Math.PI) * 30;
      pr.x = pr.from.x + (pr.to.x - pr.from.x) * u;
      pr.y = pr.from.y + (pr.to.y - pr.from.y) * u - arc;
      this.particles.push({ x: pr.x, y: pr.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30 + 20, life: 0.4, max: 0.4, size: 3, color: '#ffffff', drag: 0.9 });
      if (u >= 1) pr.done();
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);
  }

  drawBelow(ctx: CanvasRenderingContext2D, _cell: number): void {
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life / 0.5);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawAbove(ctx: CanvasRenderingContext2D, _cell: number): void {
    for (const b of this.beams) {
      const a = b.life / b.max;
      ctx.globalAlpha = a;
      ctx.lineCap = 'round';
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width * (0.5 + a);
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.width * 0.35;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const pr of this.projectiles) {
      const ang = Math.atan2(pr.to.y - pr.from.y, pr.to.x - pr.from.x);
      ctx.save();
      ctx.translate(pr.x, pr.y);
      ctx.rotate(ang);
      ctx.shadowColor = pr.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, 4); ctx.lineTo(-4, 0); ctx.lineTo(-6, -4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const t of this.texts) {
      const a = Math.min(1, t.life / 0.4);
      const pop = t.life > t.max - 0.15 ? 1 + (t.life - (t.max - 0.15)) * 4 : 1;
      ctx.globalAlpha = a;
      ctx.font = `900 ${Math.round(t.size * pop)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
