import { Hud } from './ui/hud';
import { Renderer } from './render/renderer';
import { Sfx } from './audio/sfx';
import { shipColor } from './render/ships';
import {
  canBoost, canFlak, canRail, createGame, endPlayerTurn, flakTargets, laserTargets, missileTargets, moveTargets, playerBoost,
  playerFlak, playerLaser, playerMissile, playerMove, playerRail, railDirectionFor, railLine, railTargets, runEnemyTurn, startWave, threatCells,
} from './game/state';
import { ENEMIES, PICKUPS, PLAYER } from './game/rules';
import { key, same } from './game/grid';
import type { ActionMode, DamageResult, EnemyKind, GameEvent, GameState, Vec } from './game/types';

const BEST_KEY = 'stb.best';
const NONE = { move: false, laser: false, missile: false, rail: false, flak: false, boost: false };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class App {
  private hud: Hud;
  private renderer: Renderer;
  private sfx = new Sfx();
  private state: GameState;
  private mode: ActionMode | null = null;
  private busy = false;
  private best = 0;

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.renderer = new Renderer(this.hud.field);
    try { this.best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0; } catch { /* ignore */ }
    const seedParam = new URLSearchParams(location.search).get('seed');
    this.state = createGame(seedParam ? Number(seedParam) : undefined);
    this.renderer.syncFromState(this.state);
    this.hud.setSound(this.sfx.muted);
    this.hud.onSound = () => {
      this.sfx.unlock();
      this.sfx.setMuted(!this.sfx.muted);
      this.hud.setSound(this.sfx.muted);
      this.sfx.play('click');
    };
    this.hud.onAction = (mode) => this.onAction(mode);
    this.renderer.onCell = (cell) => this.onCell(cell);
    document.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.refresh();
    this.showTitle();
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) this.exposeDebug();
  }

  /** Tiny hook for automated playtests: `window.__stb`. */
  private exposeDebug(): void {
    const s = () => this.state;
    const nearest = (cells: Vec[]): Vec | null => {
      const target = s().enemies[0]?.pos;
      if (!cells.length) return null;
      if (!target) return cells[0];
      return cells.reduce((a, b) => (Math.hypot(a.x - target.x, a.y - target.y) <= Math.hypot(b.x - target.x, b.y - target.y) ? a : b));
    };
    (window as unknown as { __stb: unknown }).__stb = {
      state: s,
      laserTarget: () => laserTargets(s())[0]?.pos ?? null,
      missileTarget: () => nearest(missileTargets(s())),
      moveTarget: () => nearest(moveTargets(s())),
      railTarget: () => s().enemies.map((e) => e.pos).find((p) => railDirectionFor(s(), p)) ?? null,
      railLine: (d: Vec) => railLine(s(), d),
      canFlak: () => canFlak(s()),
      info: () => ({ wave: s().wave, phase: s().phase, hull: s().player.hull, shield: s().player.shield, energy: s().energy, score: s().score, enemies: s().enemies.length }),
    };
  }

  // ---------- screens ----------

  private showTitle(): void {
    const overlay = this.hud.overlay(`
      <h1>Simple Tactical Battle</h1>
      <p>Command the battlecruiser Shadow-Dancer against the Federation fleet.</p>
      <ul class="howto">
        <li><span class="dot" style="color:#40e0ff"></span><span>Your battlecruiser gets <b>3 actions</b> per turn. Tap a glowing cell to move.</span></li>
        <li><span class="dot" style="color:#ff4fa3"></span><span><b>Laser</b> needs line of sight. <b>Railgun</b> pierces a whole line, then cools down.</span></li>
        <li><span class="dot" style="color:#ffc64a"></span><span><b>Flak</b> shreds every fighter nearby. <b>Missiles</b> arc over rocks and splash 3×3.</span></li>
        <li><span class="dot" style="color:#5cf29a"></span><span>Grab pickups, chain kills for combos, survive the Warlord every 5th wave.</span></li>
      </ul>
      ${this.best ? `<p class="best">Best score ${this.best.toLocaleString()}</p>` : ''}
      <button class="btn">Launch</button>
    `);
    overlay.querySelector('.btn')!.addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.play('click');
      overlay.remove();
      void this.nextWave();
    });
  }

  private showGameOver(): void {
    const s = this.state;
    const isBest = s.score > this.best;
    if (isBest) {
      this.best = s.score;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* ignore */ }
    }
    const overlay = this.hud.overlay(`
      <h2>Ship lost</h2>
      <p>${isBest ? '<span class="best">New best score!</span>' : `Best ${this.best.toLocaleString()}`}</p>
      <div class="stats">
        <div class="stat"><b>${s.score.toLocaleString()}</b><span>Score</span></div>
        <div class="stat"><b>${s.wave}</b><span>Wave</span></div>
        <div class="stat"><b>${s.kills}</b><span>Kills</span></div>
      </div>
      <button class="btn">Play again</button>
      <button class="btn ghost">Replay this seed</button>
    `);
    const restart = (seed?: number) => {
      this.sfx.play('click');
      overlay.remove();
      this.state = createGame(seed);
      this.renderer.ships.clear();
      this.renderer.syncFromState(this.state);
      void this.nextWave();
    };
    overlay.querySelector('.btn')!.addEventListener('click', () => restart());
    overlay.querySelector('.btn.ghost')!.addEventListener('click', () => restart(s.seed));
  }

  private async nextWave(): Promise<void> {
    this.busy = true;
    const events = startWave(this.state);
    this.renderer.syncFromState(this.state);
    this.mode = null;
    this.refresh();
    const boss = this.state.wave % 5 === 0;
    this.sfx.play(boss ? 'warning' : 'waveStart');
    this.hud.banner(`Wave ${this.state.wave}`, boss ? 'Warlord detected' : `${this.state.enemies.length} hostile${this.state.enemies.length === 1 ? '' : 's'}`, boss ? 'danger' : 'normal');
    await sleep(900);
    await this.play(events);
    this.busy = false;
    this.refresh();
  }

  // ---------- input ----------

  private onKey(e: KeyboardEvent): void {
    const map: Record<string, ActionMode | 'end'> = { '1': 'laser', '2': 'rail', '3': 'flak', '4': 'missile', '5': 'move', '6': 'boost', Enter: 'end', ' ': 'end' };
    const m = map[e.key];
    if (m) { e.preventDefault(); this.onAction(m); }
    if (e.key === 'Escape') { this.mode = null; this.refresh(); }
  }

  private onAction(mode: ActionMode | 'end'): void {
    if (this.busy || this.state.phase !== 'player') return;
    if (mode === 'end') { void this.endTurn(); return; }
    if (mode === 'boost') {
      if (!canBoost(this.state)) return;
      this.mode = null;
      void this.act(playerBoost(this.state));
      return;
    }
    if (mode === 'flak') {
      if (!canFlak(this.state)) return;
      this.mode = null;
      void this.act(playerFlak(this.state));
      return;
    }
    this.mode = this.mode === mode ? null : mode;
    this.sfx.play(this.mode ? 'select' : 'click');
    this.refresh();
  }

  private onCell(cell: Vec): void {
    if (this.busy || this.state.phase !== 'player') return;
    const s = this.state;
    const enemy = s.enemies.find((e) => same(e.pos, cell));
    const mode = this.mode;
    if (mode === 'laser' || (mode === null && enemy && laserTargets(s).includes(enemy))) {
      if (enemy && laserTargets(s).includes(enemy)) { void this.act(playerLaser(s, enemy.id)); return; }
    }
    if (mode === 'missile') {
      if (missileTargets(s).some((p) => same(p, cell))) { void this.act(playerMissile(s, cell)); return; }
    }
    if (mode === 'rail') {
      if (canRail(s) && railDirectionFor(s, cell)) { void this.act(playerRail(s, cell)); return; }
    }
    if (mode === 'move' || mode === null) {
      if (moveTargets(s).some((p) => same(p, cell))) { void this.act(playerMove(s, cell)); return; }
    }
    if (enemy) {
      const spec = ENEMIES[enemy.kind as EnemyKind];
      const wpn = spec.missileRange ? `laser ${spec.laserRange} · missile ${spec.missileRange}` : `laser range ${spec.laserRange}`;
      this.hud.hint(`${spec.name}: hull ${enemy.hull}${enemy.maxShield ? ` · shield ${enemy.shield}` : ''} · ${wpn} · moves ${spec.move}`, 'enemy');
      this.sfx.play('click');
      return;
    }
    if (same(cell, s.player.pos)) {
      this.hud.hint(`Shadow-Dancer: laser ${PLAYER.laser.damage} · rail ${PLAYER.rail.damage} · flak ${PLAYER.flak.damage}×all · missile ${PLAYER.missile.damage}`);
      return;
    }
    this.sfx.play('click');
    this.refresh(mode ? 'Not a valid target' : '');
  }

  private async act(events: GameEvent[]): Promise<void> {
    if (!events.length) return;
    this.busy = true;
    if (this.mode === 'boost' || this.mode === 'move' || this.state.ap === 0) this.mode = null;
    this.renderer.highlights.clear();
    this.refresh();
    await this.play(events);
    this.busy = false;
    if (this.state.phase === 'player' && this.mode && !this.modeHasTargets(this.mode)) this.mode = null;
    this.refresh();
    await this.afterAction();
  }

  private async endTurn(): Promise<void> {
    this.busy = true;
    this.mode = null;
    this.renderer.highlights.clear();
    this.renderer.threats.clear();
    this.sfx.play('click');
    await this.play(endPlayerTurn(this.state));
    await this.play(runEnemyTurn(this.state));
    this.busy = false;
    this.refresh();
    await this.afterAction();
  }

  private async afterAction(): Promise<void> {
    const s = this.state;
    if (s.phase === 'waveClear') {
      this.busy = true;
      await sleep(1500);
      await this.nextWave();
    } else if (s.phase === 'gameOver') {
      await sleep(700);
      this.showGameOver();
    }
  }

  private modeHasTargets(mode: ActionMode): boolean {
    const s = this.state;
    if (mode === 'move') return moveTargets(s).length > 0;
    if (mode === 'laser') return laserTargets(s).length > 0;
    if (mode === 'missile') return missileTargets(s).length > 0;
    if (mode === 'rail') return railTargets(s).length > 0;
    if (mode === 'flak') return canFlak(s);
    return canBoost(s);
  }

  // ---------- presentation ----------

  private refresh(hintOverride?: string): void {
    const s = this.state;
    const r = this.renderer;
    r.highlights.clear();
    r.threats.clear();
    const enabled = {
      move: moveTargets(s).length > 0,
      laser: laserTargets(s).length > 0,
      missile: missileTargets(s).length > 0,
      rail: railTargets(s).length > 0,
      flak: canFlak(s),
      boost: canBoost(s),
    };
    let hint = '';
    if (s.phase === 'player' && !this.busy) {
      for (const k of threatCells(s)) r.threats.add(k);
      if (this.mode === 'move') { for (const p of moveTargets(s)) r.highlights.set(key(p), 'move'); hint = 'Tap a cell to move. Red cells are in enemy reach.'; }
      else if (this.mode === 'laser') { for (const e of laserTargets(s)) r.highlights.set(key(e.pos), 'laser'); hint = 'Tap a target to fire the laser.'; }
      else if (this.mode === 'missile') { for (const p of missileTargets(s)) r.highlights.set(key(p), 'missile'); hint = 'Tap where the missile should land. Splash hits a 3×3 area, including you.'; }
      else if (this.mode === 'rail') {
        for (const p of railTargets(s)) r.highlights.set(key(p), 'rail');
        for (const e of s.enemies) if (railDirectionFor(s, e.pos)) r.highlights.set(key(e.pos), 'laser');
        hint = 'Tap a line. The slug pierces every ship along it until an asteroid.';
      }
      else {
        for (const p of moveTargets(s)) r.highlights.set(key(p), 'move');
        for (const e of laserTargets(s)) r.highlights.set(key(e.pos), 'laser');
        hint = s.ap > 0 ? `${s.ap} action${s.ap === 1 ? '' : 's'} left. Tap a cell to move or an enemy to fire.` : 'No actions left. End your turn.';
        if (s.ap > 0 && flakTargets(s).length >= 2 && canFlak(s)) hint = `${flakTargets(s).length} ships in flak range!`;
        if (s.ap > 0 && s.energy < PLAYER.flak.cost) hint = 'Low energy! End the turn to recharge or grab a cell.';
      }
    }
    this.hud.update(s, this.best, this.mode, enabled);
    this.hud.hint(hintOverride ?? hint);
  }

  private async play(events: GameEvent[]): Promise<void> {
    const s = this.state;
    const r = this.renderer;
    for (const ev of events) {
      switch (ev.type) {
        case 'turnStart': {
          if (ev.who === 'enemy') { this.hud.hint('Enemy turn', 'enemy'); await sleep(350); }
          else { this.hud.hint('Your turn'); }
          break;
        }
        case 'move': {
          this.sfx.play('move');
          await r.animateMove(ev.id, ev.path, ev.id === s.player.id ? 150 : 120);
          await sleep(60);
          break;
        }
        case 'pickup': {
          const c = r.centre(ev.pos);
          r.pickups = r.pickups.filter((p) => p.id !== ev.id);
          this.sfx.play('pickup');
          const colors = { energy: '#ffc64a', shield: '#40e0ff', missile: '#ff4fa3', repair: '#5cf29a' };
          r.fx.burst(c.x, c.y, 24, colors[ev.kind], 140, 3, 0.7);
          r.fx.ring(c.x, c.y, r.cell * 1.2, colors[ev.kind]);
          r.fx.text(c.x, c.y - r.cell * 0.3, `+${ev.amount} ${PICKUPS[ev.kind].name.split(' ')[0].toUpperCase()}`, colors[ev.kind], Math.max(12, r.cell * 0.32));
          this.hud.update(s, this.best, this.mode, NONE);
          await sleep(300);
          break;
        }
        case 'laser': {
          const shooter = r.ships.get(ev.shooterId);
          const target = r.ships.get(ev.hit.targetId);
          const from = shooter ? r.centre({ x: shooter.x, y: shooter.y }) : r.centre(ev.from);
          const to = target ? r.centre({ x: target.x, y: target.y }) : r.centre(ev.to);
          if (shooter) shooter.facing = Math.atan2(to.y - from.y, to.x - from.x);
          const isPlayer = ev.shooterId === s.player.id;
          this.sfx.play(isPlayer ? 'laser' : 'enemyLaser');
          r.fx.beam(from.x, from.y, to.x, to.y, isPlayer ? '#40e0ff' : '#ff4fa3', isPlayer ? 3 : 2.5);
          await sleep(120);
          this.showDamage(ev.hit, isPlayer ? 'laser' : 'enemyLaser');
          await sleep(380);
          break;
        }
        case 'missile': {
          const shooter = r.ships.get(ev.shooterId);
          const from = shooter ? r.centre({ x: shooter.x, y: shooter.y }) : r.centre(ev.from);
          const to = r.centre(ev.to);
          if (shooter) shooter.facing = Math.atan2(to.y - from.y, to.x - from.x);
          this.sfx.play('missileLaunch');
          const isPlayer = ev.shooterId === s.player.id;
          await r.fx.projectile(from, to, isPlayer ? '#ffc64a' : '#ff4fa3', Math.min(0.9, 0.35 + Math.hypot(to.x - from.x, to.y - from.y) / 600));
          r.fx.explosion(to.x, to.y, false);
          r.shake(10);
          this.sfx.play('explosion');
          if (!ev.hits.length) r.fx.text(to.x, to.y - r.cell * 0.3, 'MISS', '#8ea2c9', Math.max(12, r.cell * 0.3));
          for (const hit of ev.hits) this.showDamage(hit, 'missile');
          await sleep(500);
          break;
        }
        case 'rail': {
          const shooter = r.ships.get(ev.shooterId);
          const from = shooter ? r.centre({ x: shooter.x, y: shooter.y }) : r.centre(ev.from);
          const to = r.centre(ev.to);
          if (shooter) shooter.facing = Math.atan2(to.y - from.y, to.x - from.x);
          // extend the beam half a cell past the last cell so it reads as a full-length shot
          const ang = Math.atan2(to.y - from.y, to.x - from.x);
          const end = { x: to.x + Math.cos(ang) * r.cell * 0.5, y: to.y + Math.sin(ang) * r.cell * 0.5 };
          this.sfx.play('rail');
          r.fx.beam(from.x, from.y, end.x, end.y, '#ffffff', 7, 0.5);
          r.fx.beam(from.x, from.y, end.x, end.y, '#9df0ff', 14, 0.35);
          r.fx.ring(from.x, from.y, r.cell * 0.9, '#9df0ff', 0.4, 3);
          r.shake(14);
          await sleep(140);
          for (const hit of ev.hits) this.showDamage(hit, 'laser');
          if (!ev.hits.length) r.fx.text(end.x, end.y, 'MISS', '#8ea2c9', Math.max(12, r.cell * 0.3));
          await sleep(420);
          break;
        }
        case 'flak': {
          const v = r.ships.get(ev.id);
          const c = v ? r.centre({ x: v.x, y: v.y }) : r.centre(ev.pos);
          this.sfx.play('flak');
          r.fx.ring(c.x, c.y, r.cell * 2.6, '#ffc64a', 0.5, 5);
          r.fx.ring(c.x, c.y, r.cell * 2.0, '#ffffff', 0.35, 2);
          r.fx.burst(c.x, c.y, 70, '#ffd27a', r.cell * 7, 2.5, 0.45);
          r.fx.burst(c.x, c.y, 30, '#ffffff', r.cell * 5, 1.8, 0.3);
          r.shake(8);
          await sleep(160);
          for (const hit of ev.hits) this.showDamage(hit, 'laser');
          await sleep(400);
          break;
        }
        case 'boost': {
          const v = r.ships.get(ev.id);
          if (v) {
            v.shield += ev.amount;
            v.shieldFlash = 1;
            const c = r.centre({ x: v.x, y: v.y });
            r.fx.ring(c.x, c.y, r.cell * 1.1, '#40e0ff', 0.6, 4);
            r.fx.burst(c.x, c.y, 16, '#9df0ff', 90, 2.5, 0.6);
            r.fx.text(c.x, c.y - r.cell * 0.4, `+${ev.amount} SHIELD`, '#40e0ff', Math.max(12, r.cell * 0.3));
          }
          this.sfx.play('boost');
          await sleep(350);
          break;
        }
        case 'destroyed': {
          const v = r.ships.get(ev.id);
          const c = v ? r.centre({ x: v.x, y: v.y }) : r.centre(ev.pos);
          const big = ev.kind === 'warlord' || ev.kind === 'battlecruiser' || ev.kind === 'destroyer';
          r.ships.delete(ev.id);
          r.fx.explosion(c.x, c.y, big);
          r.shake(big ? 18 : 10);
          this.sfx.play(big ? 'bigExplosion' : 'explosion');
          try { navigator.vibrate?.(big ? 80 : 40); } catch { /* ignore */ }
          r.fx.text(c.x, c.y - r.cell * 0.2, `+${ev.points}`, '#ffc64a', Math.max(14, r.cell * 0.4));
          if (ev.combo > 1) this.hud.banner(`Combo ×${ev.combo}`, 'bonus points', 'gold');
          this.hud.update(s, this.best, this.mode, NONE);
          await sleep(big ? 650 : 420);
          break;
        }
        case 'waveClear': {
          this.sfx.play('waveClear');
          this.hud.banner('Wave clear!', `+${ev.bonus.toLocaleString()} bonus`, 'gold');
          this.hud.hint('');
          this.hud.update(s, this.best, null, NONE);
          break;
        }
        case 'gameOver': {
          this.sfx.play('gameOver');
          const v = r.ships.get(s.player.id);
          const c = v ? r.centre({ x: v.x, y: v.y }) : r.centre(s.player.pos);
          r.ships.delete(s.player.id);
          r.fx.explosion(c.x, c.y, true);
          r.shake(24);
          this.hud.flash();
          this.hud.hint('');
          this.hud.update(s, this.best, null, NONE);
          break;
        }
      }
    }
    if (s.phase !== 'gameOver') r.syncFromState(s);
  }

  private showDamage(hit: DamageResult, source: 'laser' | 'enemyLaser' | 'missile'): void {
    const s = this.state;
    const r = this.renderer;
    const v = r.ships.get(hit.targetId);
    if (!v) return;
    const total = hit.shieldDamage + hit.hullDamage;
    v.shield = Math.max(0, v.shield - hit.shieldDamage);
    v.hull = Math.max(0, v.hull - hit.hullDamage);
    v.hitFlash = 1;
    if (hit.shieldDamage > 0) v.shieldFlash = 1;
    const c = r.centre({ x: v.x, y: v.y });
    const isPlayerHit = hit.targetId === s.player.id;
    const color = hit.crit ? '#ffc64a' : isPlayerHit ? '#ff5c6c' : '#ffffff';
    r.fx.text(c.x, c.y - r.cell * 0.35, `${hit.crit ? 'CRIT ' : ''}-${total}`, color, Math.max(13, r.cell * (hit.crit ? 0.42 : 0.34)));
    r.fx.burst(c.x, c.y, hit.crit ? 24 : 10, isPlayerHit ? '#ff5c6c' : shipColor(v.kind), 120, 2.5, 0.5);
    if (hit.crit) this.sfx.play('crit');
    if (isPlayerHit) {
      this.hud.flash();
      r.shake(hit.hullDamage > 0 ? 12 : 6);
      this.sfx.play(hit.hullDamage > 0 ? 'hullHit' : 'shieldHit');
      try { navigator.vibrate?.(hit.hullDamage > 0 ? 60 : 25); } catch { /* ignore */ }
      this.hud.update(s, this.best, this.mode, NONE);
    } else if (source !== 'missile') {
      r.shake(4);
    }
  }
}
