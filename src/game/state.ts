import { createRng, pick, randInt, shuffle, type Rng } from './rng';
import { angle, cheb, dist, findPath, floodFill, hasLineOfSight, key, same, type GridInfo } from './grid';
import { COLS, ENEMIES, PICKUPS, PLAYER, ROWS, waveRoster } from './rules';
import type { DamageResult, EnemyKind, GameEvent, GameState, Pickup, PickupKind, Ship, Vec } from './types';

/** All randomness goes through here; the seed replays a run. */
const rngs = new WeakMap<GameState, Rng>();
function rngFor(s: GameState): Rng {
  let r = rngs.get(s);
  if (!r) {
    r = createRng(s.seed);
    rngs.set(s, r);
  }
  return r;
}

export function gridInfo(s: GameState): GridInfo {
  return { cols: s.cols, rows: s.rows, blocked: new Set(s.asteroids.map(key)) };
}

/** Grid with asteroids and all living ships blocked (for movement). */
export function moveGrid(s: GameState, mover: Ship): GridInfo {
  const g = gridInfo(s);
  for (const ship of allShips(s)) if (ship.id !== mover.id) g.blocked.add(key(ship.pos));
  return g;
}

export function allShips(s: GameState): Ship[] {
  return [s.player, ...s.enemies];
}

export function shipAt(s: GameState, p: Vec): Ship | undefined {
  return allShips(s).find((e) => same(e.pos, p));
}

export function pickupAt(s: GameState, p: Vec): Pickup | undefined {
  return s.pickups.find((e) => same(e.pos, p));
}

export function isAsteroid(s: GameState, p: Vec): boolean {
  return s.asteroids.some((a) => same(a, p));
}

export function createGame(seed = Date.now() % 1_000_000): GameState {
  const state: GameState = {
    seed,
    wave: 0,
    score: 0,
    kills: 0,
    phase: 'title',
    cols: COLS,
    rows: ROWS,
    asteroids: [],
    player: {
      id: 1, kind: 'player', pos: { x: 3, y: ROWS - 2 }, hull: PLAYER.hull, maxHull: PLAYER.hull,
      shield: PLAYER.shield, maxShield: PLAYER.shield, facing: -Math.PI / 2, missileCooldown: 0,
    },
    energy: PLAYER.energy,
    maxEnergy: PLAYER.energy,
    missiles: PLAYER.missiles,
    maxMissiles: PLAYER.maxMissiles,
    ap: PLAYER.ap,
    maxAp: PLAYER.ap,
    enemies: [],
    pickups: [],
    comboKills: 0,
    railCooldown: 0,
    nextId: 2,
  };
  return state;
}

/** Build the next wave: fresh asteroids, enemies at the top, pickups scattered. */
export function startWave(s: GameState): GameEvent[] {
  const rng = rngFor(s);
  s.wave += 1;
  s.phase = 'player';
  s.ap = s.maxAp;
  s.comboKills = 0;
  s.player.pos = { x: randInt(rng, 2, s.cols - 3), y: s.rows - 2 };
  s.player.facing = -Math.PI / 2;
  if (s.wave > 1) {
    s.player.shield = Math.min(s.player.maxShield, s.player.shield + PLAYER.waveShieldBonus);
    s.player.hull = Math.min(s.player.maxHull, s.player.hull + PLAYER.waveRepair);
    s.missiles = Math.min(s.maxMissiles, s.missiles + 1);
  }
  s.energy = s.maxEnergy;
  s.railCooldown = 0;

  const roster = waveRoster(s.wave);
  for (let attempt = 0; attempt < 50; attempt++) {
    s.asteroids = [];
    s.enemies = [];
    s.pickups = [];
    const taken = new Set<string>([key(s.player.pos)]);
    const count = randInt(rng, 7, 11);
    for (let i = 0; i < count; i++) {
      const p = { x: randInt(rng, 0, s.cols - 1), y: randInt(rng, 3, s.rows - 3) };
      if (taken.has(key(p)) || cheb(p, s.player.pos) < 2) continue;
      taken.add(key(p));
      s.asteroids.push(p);
    }
    const topCells = shuffle(rng, Array.from({ length: s.cols * 3 }, (_, i) => ({ x: i % s.cols, y: Math.floor(i / s.cols) })));
    for (const kind of roster) {
      const p = topCells.find((c) => !taken.has(key(c)));
      if (!p) break;
      taken.add(key(p));
      s.enemies.push(makeEnemy(s, kind, p));
    }
    const pickupCount = s.wave === 1 ? 1 : randInt(rng, 1, 2);
    const kinds: PickupKind[] = ['energy', 'shield', 'missile', 'repair'];
    for (let i = 0; i < pickupCount; i++) {
      const p = { x: randInt(rng, 0, s.cols - 1), y: randInt(rng, 3, s.rows - 3) };
      if (taken.has(key(p))) continue;
      taken.add(key(p));
      const kind = s.player.hull < 50 && i === 0 ? 'repair' : pick(rng, kinds);
      s.pickups.push({ id: s.nextId++, kind, pos: p });
    }
    if (s.enemies.length === roster.length && layoutConnected(s)) break;
  }
  return [{ type: 'turnStart', who: 'player' }];
}

function layoutConnected(s: GameState): boolean {
  const fill = floodFill(gridInfo(s), s.player.pos);
  return s.enemies.every((e) => fill.has(key(e.pos))) && s.pickups.every((p) => fill.has(key(p.pos)));
}

function makeEnemy(s: GameState, kind: EnemyKind, pos: Vec): Ship {
  const spec = ENEMIES[kind];
  const scale = 1 + Math.max(0, s.wave - 5) * 0.08;
  return {
    id: s.nextId++, kind, pos, facing: Math.PI / 2,
    hull: Math.round(spec.hull * scale), maxHull: Math.round(spec.hull * scale),
    shield: Math.round(spec.shield * scale), maxShield: Math.round(spec.shield * scale),
    missileCooldown: 1,
  };
}

// ---------- queries used by the UI ----------

export function moveTargets(s: GameState): Vec[] {
  if (s.phase !== 'player' || s.ap < 1) return [];
  const fill = floodFill(moveGrid(s, s.player), s.player.pos, PLAYER.moveRange);
  const out: Vec[] = [];
  for (const [k, v] of fill) {
    if (v.dist === 0) continue;
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y });
  }
  return out;
}

export function canLaser(s: GameState, target: Ship): boolean {
  return dist(s.player.pos, target.pos) <= PLAYER.laser.range + 0.5 && hasLineOfSight(gridInfo(s), s.player.pos, target.pos);
}

export function laserTargets(s: GameState): Ship[] {
  if (s.phase !== 'player' || s.ap < 1 || s.energy < PLAYER.laser.cost) return [];
  return s.enemies.filter((e) => canLaser(s, e));
}

export function missileTargets(s: GameState): Vec[] {
  if (s.phase !== 'player' || s.ap < 1 || s.missiles < 1) return [];
  const out: Vec[] = [];
  for (let y = 0; y < s.rows; y++) {
    for (let x = 0; x < s.cols; x++) {
      const p = { x, y };
      if (same(p, s.player.pos)) continue;
      if (dist(p, s.player.pos) <= PLAYER.missile.range + 0.5 && !isAsteroid(s, p)) out.push(p);
    }
  }
  return out;
}

const LINES: Vec[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

/** Cells along a straight line from the player until the edge or an asteroid. */
export function railLine(s: GameState, dir: Vec): Vec[] {
  const g = gridInfo(s);
  const out: Vec[] = [];
  let p = { x: s.player.pos.x + dir.x, y: s.player.pos.y + dir.y };
  while (p.x >= 0 && p.y >= 0 && p.x < s.cols && p.y < s.rows && !g.blocked.has(key(p))) {
    out.push(p);
    p = { x: p.x + dir.x, y: p.y + dir.y };
  }
  return out;
}

export function canRail(s: GameState): boolean {
  return s.phase === 'player' && s.ap >= 1 && s.energy >= PLAYER.rail.cost && s.railCooldown === 0;
}

/** Every cell the railgun could pass through, keyed by direction. */
export function railTargets(s: GameState): Vec[] {
  if (!canRail(s)) return [];
  return LINES.flatMap((d) => railLine(s, d));
}

export function railDirectionFor(s: GameState, cell: Vec): Vec | null {
  const dx = Math.sign(cell.x - s.player.pos.x), dy = Math.sign(cell.y - s.player.pos.y);
  if (dx === 0 && dy === 0) return null;
  const ax = Math.abs(cell.x - s.player.pos.x), ay = Math.abs(cell.y - s.player.pos.y);
  if (!(ax === 0 || ay === 0 || ax === ay)) return null;
  const dir = { x: dx, y: dy };
  return railLine(s, dir).some((p) => same(p, cell)) ? dir : null;
}

export function flakTargets(s: GameState): Ship[] {
  const g = gridInfo(s);
  return s.enemies.filter((e) => cheb(e.pos, s.player.pos) <= PLAYER.flak.range && hasLineOfSight(g, s.player.pos, e.pos));
}

export function canFlak(s: GameState): boolean {
  return s.phase === 'player' && s.ap >= 1 && s.energy >= PLAYER.flak.cost && flakTargets(s).length > 0;
}

export function canBoost(s: GameState): boolean {
  return s.phase === 'player' && s.ap >= 1 && s.energy >= PLAYER.boost.cost && s.player.shield < s.player.maxShield;
}

/** Cells the player would be shot in next enemy turn (for the danger overlay). */
export function threatCells(s: GameState): Set<string> {
  const g = gridInfo(s);
  const out = new Set<string>();
  for (const e of s.enemies) {
    const spec = ENEMIES[e.kind as EnemyKind];
    const reachable = floodFill(moveGrid(s, e), e.pos, spec.move);
    for (const k of reachable.keys()) {
      const [fx, fy] = k.split(',').map(Number);
      const from = { x: fx, y: fy };
      for (let y = 0; y < s.rows; y++) {
        for (let x = 0; x < s.cols; x++) {
          const p = { x, y };
          const pk = key(p);
          if (out.has(pk) || g.blocked.has(pk)) continue;
          if (dist(p, from) <= spec.laserRange + 0.5 && hasLineOfSight(g, from, p)) out.add(pk);
        }
      }
    }
  }
  return out;
}

// ---------- damage ----------

function applyDamage(target: Ship, raw: number, crit: boolean): DamageResult {
  const amount = crit ? Math.round(raw * PLAYER.laser.critMult) : raw;
  const shieldDamage = Math.min(target.shield, amount);
  target.shield -= shieldDamage;
  const hullDamage = Math.min(target.hull, amount - shieldDamage);
  target.hull -= hullDamage;
  return { targetId: target.id, shieldDamage, hullDamage, crit, destroyed: target.hull <= 0 };
}

function resolveDeaths(s: GameState, events: GameEvent[]): void {
  const dead = s.enemies.filter((e) => e.hull <= 0);
  for (const e of dead) {
    const spec = ENEMIES[e.kind as EnemyKind];
    s.comboKills += 1;
    const combo = s.comboKills;
    const points = Math.round(spec.points * (1 + (s.wave - 1) * 0.1) * (1 + (combo - 1) * 0.5));
    s.score += points;
    s.kills += 1;
    events.push({ type: 'destroyed', id: e.id, kind: e.kind, pos: e.pos, points, combo });
  }
  s.enemies = s.enemies.filter((e) => e.hull > 0);
  if (s.player.hull <= 0 && s.phase !== 'gameOver') {
    s.phase = 'gameOver';
    events.push({ type: 'gameOver', score: s.score, wave: s.wave });
  }
}

function checkWaveClear(s: GameState, events: GameEvent[]): void {
  if (s.phase === 'player' && s.enemies.length === 0) {
    const bonus = 250 * s.wave + s.player.hull * 2;
    s.score += bonus;
    s.phase = 'waveClear';
    events.push({ type: 'waveClear', wave: s.wave, bonus });
  }
}

// ---------- player actions ----------

export function playerMove(s: GameState, to: Vec): GameEvent[] {
  const events: GameEvent[] = [];
  if (!moveTargets(s).some((p) => same(p, to))) return events;
  const path = findPath(moveGrid(s, s.player), s.player.pos, to, PLAYER.moveRange);
  if (!path) return events;
  s.ap -= 1;
  const from = s.player.pos;
  s.player.pos = to;
  s.player.facing = angle(path.length > 1 ? path[path.length - 2] : from, to);
  events.push({ type: 'move', id: s.player.id, path });
  const pickup = pickupAt(s, to);
  if (pickup) {
    s.pickups = s.pickups.filter((p) => p.id !== pickup.id);
    const amount = PICKUPS[pickup.kind].amount;
    if (pickup.kind === 'energy') s.energy = Math.min(s.maxEnergy, s.energy + amount);
    if (pickup.kind === 'shield') s.player.shield = Math.min(s.player.maxShield, s.player.shield + amount);
    if (pickup.kind === 'missile') s.missiles = Math.min(s.maxMissiles, s.missiles + amount);
    if (pickup.kind === 'repair') s.player.hull = Math.min(s.player.maxHull, s.player.hull + amount);
    s.score += 50;
    events.push({ type: 'pickup', id: pickup.id, kind: pickup.kind, pos: to, amount });
  }
  return events;
}

export function playerLaser(s: GameState, targetId: number): GameEvent[] {
  const events: GameEvent[] = [];
  const target = s.enemies.find((e) => e.id === targetId);
  if (!target || !laserTargets(s).includes(target)) return events;
  s.ap -= 1;
  s.energy -= PLAYER.laser.cost;
  s.player.facing = angle(s.player.pos, target.pos);
  const crit = rngFor(s)() < PLAYER.laser.critChance;
  const hit = applyDamage(target, PLAYER.laser.damage, crit);
  events.push({ type: 'laser', shooterId: s.player.id, from: { ...s.player.pos }, to: { ...target.pos }, hit });
  resolveDeaths(s, events);
  checkWaveClear(s, events);
  return events;
}

export function playerMissile(s: GameState, to: Vec): GameEvent[] {
  const events: GameEvent[] = [];
  if (!missileTargets(s).some((p) => same(p, to))) return events;
  s.ap -= 1;
  s.missiles -= 1;
  s.player.facing = angle(s.player.pos, to);
  const hits = missileBlast(s, to, PLAYER.missile.damage, PLAYER.missile.splash);
  events.push({ type: 'missile', shooterId: s.player.id, from: { ...s.player.pos }, to, hits });
  resolveDeaths(s, events);
  checkWaveClear(s, events);
  return events;
}

function missileBlast(s: GameState, at: Vec, damage: number, splash: number): DamageResult[] {
  const hits: DamageResult[] = [];
  for (const ship of allShips(s)) {
    const d = cheb(ship.pos, at);
    if (d > 1) continue;
    if (d === 1 && !hasLineOfSight(gridInfo(s), at, ship.pos)) continue;
    hits.push(applyDamage(ship, d === 0 ? damage : splash, false));
  }
  return hits;
}

export function playerRail(s: GameState, cell: Vec): GameEvent[] {
  const events: GameEvent[] = [];
  const dir = canRail(s) ? railDirectionFor(s, cell) : null;
  if (!dir) return events;
  s.ap -= 1;
  s.energy -= PLAYER.rail.cost;
  s.railCooldown = PLAYER.rail.cooldown + 1;
  s.player.facing = Math.atan2(dir.y, dir.x);
  const line = railLine(s, dir);
  const hits: DamageResult[] = [];
  for (const p of line) {
    const target = s.enemies.find((e) => same(e.pos, p));
    if (target) hits.push(applyDamage(target, PLAYER.rail.damage, false));
  }
  const end = line[line.length - 1] ?? { ...s.player.pos };
  events.push({ type: 'rail', shooterId: s.player.id, from: { ...s.player.pos }, to: end, hits });
  resolveDeaths(s, events);
  checkWaveClear(s, events);
  return events;
}

export function playerFlak(s: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  if (!canFlak(s)) return events;
  s.ap -= 1;
  s.energy -= PLAYER.flak.cost;
  const hits = flakTargets(s).map((e) => applyDamage(e, PLAYER.flak.damage, false));
  events.push({ type: 'flak', id: s.player.id, pos: { ...s.player.pos }, hits });
  resolveDeaths(s, events);
  checkWaveClear(s, events);
  return events;
}

export function playerBoost(s: GameState): GameEvent[] {
  if (!canBoost(s)) return [];
  s.ap -= 1;
  s.energy -= PLAYER.boost.cost;
  const before = s.player.shield;
  s.player.shield = Math.min(s.player.maxShield, s.player.shield + PLAYER.boost.amount);
  return [{ type: 'boost', id: s.player.id, amount: s.player.shield - before }];
}

export function endPlayerTurn(s: GameState): GameEvent[] {
  if (s.phase !== 'player') return [];
  s.phase = 'enemy';
  s.comboKills = 0;
  return [{ type: 'turnStart', who: 'enemy' }];
}

// ---------- enemy turn ----------

/** Resolve every enemy's turn. Each enemy moves, then fires once if it can. */
export function runEnemyTurn(s: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase !== 'enemy') return events;
  const rng = rngFor(s);
  for (const e of [...s.enemies]) {
    if (s.player.hull <= 0) break;
    const spec = ENEMIES[e.kind as EnemyKind];
    if (e.missileCooldown > 0) e.missileCooldown -= 1;

    const g = gridInfo(s);
    const canShoot = (): boolean => dist(e.pos, s.player.pos) <= spec.laserRange + 0.5 && hasLineOfSight(g, e.pos, s.player.pos);

    // Movement: approach if it cannot shoot; otherwise sidestep sometimes to feel alive.
    if (!canShoot() || (dist(e.pos, s.player.pos) < spec.standoff - 0.5 && rng() < 0.6)) {
      const mg = moveGrid(s, e);
      const fill = floodFill(mg, e.pos, spec.move);
      let best: Vec | null = null;
      let bestScore = scoreCell(s, e, e.pos);
      for (const [k] of fill) {
        const [x, y] = k.split(',').map(Number);
        const p = { x, y };
        if (same(p, e.pos)) continue;
        const sc = scoreCell(s, e, p) + rng() * 0.3;
        if (sc > bestScore) { bestScore = sc; best = p; }
      }
      if (best) {
        const path = findPath(mg, e.pos, best, spec.move);
        if (path) {
          e.facing = angle(path.length > 1 ? path[path.length - 2] : e.pos, best);
          e.pos = best;
          events.push({ type: 'move', id: e.id, path });
        }
      }
    }

    // Attack.
    const d = dist(e.pos, s.player.pos);
    if (spec.missileRange > 0 && e.missileCooldown === 0 && d <= spec.missileRange + 0.5 && d > 1.5) {
      e.missileCooldown = spec.missileCooldown;
      e.facing = angle(e.pos, s.player.pos);
      const at = { ...s.player.pos };
      const hits = missileBlast(s, at, spec.missileDamage, spec.missileSplash);
      events.push({ type: 'missile', shooterId: e.id, from: { ...e.pos }, to: at, hits });
    } else if (canShoot()) {
      e.facing = angle(e.pos, s.player.pos);
      const hit = applyDamage(s.player, spec.laserDamage, false);
      events.push({ type: 'laser', shooterId: e.id, from: { ...e.pos }, to: { ...s.player.pos }, hit });
    }
    resolveDeaths(s, events);
  }
  if (s.phase === 'enemy') {
    s.phase = 'player';
    s.ap = s.maxAp;
    s.energy = Math.min(s.maxEnergy, s.energy + PLAYER.energyRegen);
    s.railCooldown = Math.max(0, s.railCooldown - 1);
    s.comboKills = 0;
    events.push({ type: 'turnStart', who: 'player' });
  }
  return events;
}

/** How attractive a cell is for an enemy: in range with sight is best, closer is good. */
function scoreCell(s: GameState, e: Ship, p: Vec): number {
  const spec = ENEMIES[e.kind as EnemyKind];
  const g = gridInfo(s);
  const d = dist(p, s.player.pos);
  let score = -d;
  const los = hasLineOfSight(g, p, s.player.pos);
  if (d <= spec.laserRange + 0.5 && los) score += 10;
  if (d < spec.standoff - 0.5) score -= 3;
  if (spec.missileRange > 0 && d <= spec.missileRange + 0.5 && d > 1.5) score += 4;
  return score;
}
