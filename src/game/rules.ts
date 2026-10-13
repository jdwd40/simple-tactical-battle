import type { EnemyKind, PickupKind } from './types';

export const COLS = 8;
export const ROWS = 10;

export const PLAYER = {
  hull: 100,
  shield: 50,
  energy: 60,
  energyRegen: 20,
  missiles: 3,
  maxMissiles: 6,
  ap: 2,
  moveRange: 2,
  laser: { range: 4, cost: 15, damage: 20, critChance: 0.2, critMult: 1.5 },
  missile: { range: 6, damage: 30, splash: 15 },
  boost: { cost: 20, amount: 25 },
  waveShieldBonus: 15,
  waveRepair: 10,
} as const;

export interface EnemySpec {
  name: string;
  hull: number;
  shield: number;
  move: number;
  laserRange: number;
  laserDamage: number;
  missileRange: number; // 0 = no missiles
  missileDamage: number;
  missileSplash: number;
  missileCooldown: number;
  points: number;
  /** Prefers to keep this distance when it can already shoot. */
  standoff: number;
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  scout: { name: 'Scout', hull: 30, shield: 0, move: 3, laserRange: 3, laserDamage: 10, missileRange: 0, missileDamage: 0, missileSplash: 0, missileCooldown: 0, points: 100, standoff: 2 },
  frigate: { name: 'Frigate', hull: 50, shield: 20, move: 2, laserRange: 4, laserDamage: 15, missileRange: 0, missileDamage: 0, missileSplash: 0, missileCooldown: 0, points: 200, standoff: 3 },
  dreadnought: { name: 'Dreadnought', hull: 80, shield: 40, move: 1, laserRange: 3, laserDamage: 15, missileRange: 6, missileDamage: 25, missileSplash: 12, missileCooldown: 2, points: 400, standoff: 4 },
  warlord: { name: 'Warlord', hull: 150, shield: 60, move: 1, laserRange: 4, laserDamage: 20, missileRange: 7, missileDamage: 30, missileSplash: 15, missileCooldown: 2, points: 1000, standoff: 4 },
};

export const PICKUPS: Record<PickupKind, { name: string; amount: number }> = {
  energy: { name: 'Energy cell', amount: 30 },
  shield: { name: 'Shield charge', amount: 30 },
  missile: { name: 'Missile crate', amount: 2 },
  repair: { name: 'Repair kit', amount: 25 },
};

/** Which enemies show up on a given wave. */
export function waveRoster(wave: number): EnemyKind[] {
  if (wave % 5 === 0) {
    const escorts: EnemyKind[] = wave >= 10 ? ['frigate', 'scout'] : ['scout'];
    return ['warlord', ...escorts];
  }
  const table: EnemyKind[][] = [
    ['scout'],
    ['scout', 'scout'],
    ['frigate', 'scout'],
    ['frigate', 'scout', 'scout'],
    [],
    ['dreadnought', 'scout'],
    ['frigate', 'frigate', 'scout'],
    ['dreadnought', 'frigate'],
    ['dreadnought', 'frigate', 'scout', 'scout'],
  ];
  const base = table[Math.min(wave - 1, table.length - 1)];
  const extra = Math.max(0, Math.floor((wave - 9) / 3));
  const out = [...base];
  for (let i = 0; i < extra; i++) out.push(i % 2 === 0 ? 'frigate' : 'scout');
  return out.slice(0, 6);
}
