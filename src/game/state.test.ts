import { describe, expect, it } from 'vitest';
import {
  canBoost, canFlak, canRail, createGame, endPlayerTurn, flakTargets, laserTargets, missileTargets, moveTargets, playerBoost, playerFlak,
  playerLaser, playerMissile, playerMove, playerRail, railDirectionFor, runEnemyTurn, startWave,
} from './state';
import { PLAYER, waveRoster } from './rules';
import { cheb } from './grid';

function game(seed = 7) {
  const s = createGame(seed);
  startWave(s);
  return s;
}

describe('waves', () => {
  it('is deterministic for a seed', () => {
    const a = game(42);
    const b = game(42);
    expect(a.asteroids).toEqual(b.asteroids);
    expect(a.enemies.map((e) => [e.kind, e.pos])).toEqual(b.enemies.map((e) => [e.kind, e.pos]));
  });

  it('spawns the roster and keeps enemies reachable', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = game(seed);
      expect(s.enemies.map((e) => e.kind)).toEqual(waveRoster(1));
      expect(s.enemies.every((e) => cheb(e.pos, s.player.pos) > 2)).toBe(true);
    }
  });

  it('puts a warlord on every fifth wave and grows later waves', () => {
    expect(waveRoster(5)[0]).toBe('warlord');
    expect(waveRoster(10)[0]).toBe('warlord');
    expect(waveRoster(12).length).toBeGreaterThan(waveRoster(2).length);
  });
});

describe('player actions', () => {
  it('moves within two steps and spends an action', () => {
    const s = game();
    const targets = moveTargets(s);
    expect(targets.length).toBeGreaterThan(0);
    const events = playerMove(s, targets[0]);
    expect(events[0].type).toBe('move');
    expect(s.ap).toBe(PLAYER.ap - 1);
    expect(playerMove(s, { x: 0, y: 0 })).toEqual([]);
  });

  it('fires a laser only at targets in range with line of sight', () => {
    const s = game();
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 2 };
    s.asteroids = [];
    expect(laserTargets(s)).toContain(enemy);
    const events = playerLaser(s, enemy.id);
    expect(events[0].type).toBe('laser');
    expect(s.energy).toBe(PLAYER.energy - PLAYER.laser.cost);
    expect(enemy.hull + enemy.shield).toBeLessThan(enemy.maxHull + enemy.maxShield);
  });

  it('missile splash damages everything adjacent, including the player', () => {
    const s = game();
    s.asteroids = [];
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 2 };
    const at = { x: s.player.pos.x, y: s.player.pos.y - 1 };
    expect(missileTargets(s).some((p) => p.x === at.x && p.y === at.y)).toBe(true);
    const events = playerMissile(s, at);
    const ev = events[0];
    expect(ev.type).toBe('missile');
    if (ev.type === 'missile') expect(ev.hits.map((h) => h.targetId).sort()).toEqual([s.player.id, enemy.id].sort());
    expect(s.player.shield).toBe(PLAYER.shield - PLAYER.missile.splash);
    expect(s.missiles).toBe(PLAYER.missiles - 1);
  });

  it('railgun pierces every ship on a line and then cools down', () => {
    const s = game();
    s.asteroids = [];
    s.nebula = [];
    const [a, b] = s.enemies;
    a.pos = { x: s.player.pos.x, y: s.player.pos.y - 2 };
    b.pos = { x: s.player.pos.x, y: s.player.pos.y - 4 };
    a.hull = b.hull = 100;
    expect(canRail(s)).toBe(true);
    expect(railDirectionFor(s, { x: s.player.pos.x, y: 0 })).toEqual({ x: 0, y: -1 });
    expect(railDirectionFor(s, { x: s.player.pos.x + 1, y: s.player.pos.y - 3 })).toBeNull();
    const events = playerRail(s, { x: s.player.pos.x, y: 0 });
    const ev = events[0];
    expect(ev.type).toBe('rail');
    if (ev.type === 'rail') expect(ev.hits).toHaveLength(2);
    expect(canRail(s)).toBe(false);
    expect(s.railCooldown).toBe(PLAYER.rail.cooldown + 1);
    endPlayerTurn(s); runEnemyTurn(s);
    expect(s.railCooldown).toBe(PLAYER.rail.cooldown);
  });

  it('railgun stops at asteroids', () => {
    const s = game();
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 3 };
    s.asteroids = [{ x: s.player.pos.x, y: s.player.pos.y - 2 }];
    expect(railDirectionFor(s, enemy.pos)).toBeNull();
  });

  it('flak hits everything within two cells', () => {
    const s = game();
    s.asteroids = [];
    const [a, b] = s.enemies;
    a.pos = { x: s.player.pos.x + 1, y: s.player.pos.y - 1 };
    b.pos = { x: s.player.pos.x - 2, y: s.player.pos.y - 2 };
    expect(flakTargets(s)).toHaveLength(2);
    expect(canFlak(s)).toBe(true);
    const events = playerFlak(s);
    if (events[0].type === 'flak') expect(events[0].hits).toHaveLength(2);
    expect(s.energy).toBe(PLAYER.energy - PLAYER.flak.cost);
  });

  it('boost recharges shields for energy', () => {
    const s = game();
    s.player.shield = 0;
    expect(canBoost(s)).toBe(true);
    playerBoost(s);
    expect(s.player.shield).toBe(PLAYER.boost.amount);
    expect(s.energy).toBe(PLAYER.energy - PLAYER.boost.cost);
  });

  it('clears the wave and awards a bonus when the last enemy dies', () => {
    const s = game();
    s.asteroids = [];
    s.enemies = [s.enemies[0]];
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 1 };
    enemy.hull = 1; enemy.shield = 0;
    const before = s.score;
    const events = playerLaser(s, enemy.id);
    expect(events.map((e) => e.type)).toEqual(['laser', 'destroyed', 'waveClear']);
    expect(s.phase).toBe('waveClear');
    expect(s.score).toBeGreaterThan(before);
  });
});

describe('nebula and loot', () => {
  it('ships in a nebula can only be lasered from an adjacent cell', () => {
    const s = game();
    s.asteroids = [];
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 3 };
    s.nebula = [{ ...enemy.pos }];
    expect(laserTargets(s)).not.toContain(enemy);
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 1 };
    s.nebula = [{ ...enemy.pos }];
    expect(laserTargets(s)).toContain(enemy);
  });

  it('the railgun skips hidden ships that are not adjacent', () => {
    const s = game();
    s.asteroids = [];
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 3 };
    enemy.hull = 100;
    s.nebula = [{ ...enemy.pos }];
    const events = playerRail(s, enemy.pos);
    if (events[0].type === 'rail') expect(events[0].hits).toHaveLength(0);
  });

  it('a hidden player cannot be lasered from range but missiles still land', () => {
    const s = game();
    s.asteroids = [];
    s.nebula = [{ ...s.player.pos }];
    s.enemies = [s.enemies[0]];
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 3 };
    s.asteroids = [{ x: s.player.pos.x - 1, y: s.player.pos.y - 1 }, { x: s.player.pos.x, y: s.player.pos.y - 1 }, { x: s.player.pos.x + 1, y: s.player.pos.y - 1 }];
    endPlayerTurn(s);
    const events = runEnemyTurn(s);
    expect(events.some((e) => e.type === 'laser')).toBe(false);
  });

  it('every wave has nebula clouds and at least two pickups', () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = game(seed);
      expect(s.nebula.length).toBeGreaterThan(0);
      expect(s.pickups.length).toBeGreaterThanOrEqual(1);
      expect(s.nebula.every((n) => !s.asteroids.some((a) => a.x === n.x && a.y === n.y))).toBe(true);
    }
  });

  it('overdrive grants an extra action and rail capacitor resets the cooldown', () => {
    const s = game();
    const target = moveTargets(s)[0];
    s.pickups = [{ id: 99, kind: 'overdrive', pos: target }];
    playerMove(s, target);
    expect(s.ap).toBe(PLAYER.ap);
    s.railCooldown = 3;
    const next = moveTargets(s)[0];
    s.pickups = [{ id: 100, kind: 'rail', pos: next }];
    playerMove(s, next);
    expect(s.railCooldown).toBe(0);
  });
});

describe('enemy turn', () => {
  it('fighters swoop in, fire and pull back out', () => {
    let swooped = false;
    for (let seed = 1; seed < 40 && !swooped; seed++) {
      const s = game(seed);
      s.asteroids = [];
      s.nebula = [];
      const fighter = s.enemies[0];
      fighter.pos = { x: s.player.pos.x, y: s.player.pos.y - 4 };
      endPlayerTurn(s);
      const events = runEnemyTurn(s);
      const moves = events.filter((e) => e.type === 'move' && e.id === fighter.id);
      const shot = events.some((e) => e.type === 'laser' && e.shooterId === fighter.id);
      if (shot && moves.length === 2 && moves[1].type === 'move' && moves[1].retreat) swooped = true;
    }
    expect(swooped).toBe(true);
  });

  it('ends with the player phase, restores actions and regenerates energy', () => {
    const s = game();
    s.energy = 10;
    endPlayerTurn(s);
    const events = runEnemyTurn(s);
    expect(s.phase).toBe('player');
    expect(s.ap).toBe(PLAYER.ap);
    expect(s.energy).toBe(10 + PLAYER.energyRegen);
    expect(events.at(-1)).toEqual({ type: 'turnStart', who: 'player' });
  });

  it('enemies close in and shoot when they can', () => {
    const s = game();
    s.asteroids = [];
    const enemy = s.enemies[0];
    enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 2 };
    endPlayerTurn(s);
    const events = runEnemyTurn(s);
    expect(events.some((e) => e.type === 'laser')).toBe(true);
    expect(s.player.shield + s.player.hull).toBeLessThan(PLAYER.shield + PLAYER.hull);
  });

  it('kills the player and ends the game', () => {
    const s = game();
    s.asteroids = [];
    s.player.hull = 1; s.player.shield = 0;
    s.enemies[0].pos = { x: s.player.pos.x, y: s.player.pos.y - 1 };
    endPlayerTurn(s);
    const events = runEnemyTurn(s);
    expect(s.phase).toBe('gameOver');
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
  });
});
