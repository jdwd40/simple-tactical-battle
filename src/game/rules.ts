import type { EnemyKind, PickupKind } from './types';

export const COLS = 8;
export const ROWS = 10;

export const PLAYER = {
  hull: 120,
  shield: 60,
  energy: 80,
  energyRegen: 25,
  missiles: 3,
  maxMissiles: 6,
  ap: 3,
  moveRange: 2,
  laser: { range: 4, cost: 15, damage: 20, critChance: 0.2, critMult: 1.5 },
  missile: { range: 6, damage: 30, splash: 15 },
  /** Railgun: fires along one of eight straight lines, hits every ship until an asteroid. */
  rail: { cost: 25, damage: 35, cooldown: 2 },
  /** Flak: close-range burst that hits every enemy within two cells. */
  flak: { range: 2, cost: 15, damage: 12 },
  boost: { cost: 20, amount: 25 },
  waveShieldBonus: 20,
  waveRepair: 10,
} as const;

export interface EnemySpec {
  name: string;
  /** Rough class, used for sizing and flavour. */
  size: number;
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
  fighter: { name: 'Fighter', size: 0.26, hull: 20, shield: 0, move: 4, laserRange: 2, laserDamage: 8, missileRange: 0, missileDamage: 0, missileSplash: 0, missileCooldown: 0, points: 60, standoff: 1 },
  corvette: { name: 'Corvette', size: 0.31, hull: 35, shield: 10, move: 3, laserRange: 3, laserDamage: 10, missileRange: 0, missileDamage: 0, missileSplash: 0, missileCooldown: 0, points: 120, standoff: 2 },
  cruiser: { name: 'Cruiser', size: 0.37, hull: 60, shield: 25, move: 2, laserRange: 4, laserDamage: 15, missileRange: 0, missileDamage: 0, missileSplash: 0, missileCooldown: 0, points: 220, standoff: 3 },
  destroyer: { name: 'Destroyer', size: 0.38, hull: 70, shield: 30, move: 1, laserRange: 3, laserDamage: 12, missileRange: 6, missileDamage: 25, missileSplash: 12, missileCooldown: 2, points: 380, standoff: 4 },
  battlecruiser: { name: 'Battlecruiser', size: 0.45, hull: 120, shield: 50, move: 1, laserRange: 4, laserDamage: 20, missileRange: 6, missileDamage: 25, missileSplash: 12, missileCooldown: 3, points: 650, standoff: 3 },
  warlord: { name: 'Warlord', size: 0.5, hull: 200, shield: 80, move: 1, laserRange: 5, laserDamage: 22, missileRange: 7, missileDamage: 30, missileSplash: 15, missileCooldown: 2, points: 1200, standoff: 4 },
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
    const escorts: EnemyKind[] = wave >= 15 ? ['battlecruiser', 'fighter', 'fighter'] : wave >= 10 ? ['cruiser', 'fighter', 'fighter'] : ['fighter', 'fighter'];
    return ['warlord', ...escorts];
  }
  const table: EnemyKind[][] = [
    ['fighter', 'fighter'],
    ['fighter', 'fighter', 'fighter'],
    ['corvette', 'fighter', 'fighter'],
    ['cruiser', 'fighter', 'fighter'],
    [],
    ['destroyer', 'corvette', 'fighter'],
    ['cruiser', 'cruiser', 'fighter', 'fighter'],
    ['battlecruiser', 'fighter', 'fighter'],
    ['battlecruiser', 'destroyer', 'fighter', 'fighter'],
    [],
    ['battlecruiser', 'cruiser', 'corvette', 'fighter'],
    ['destroyer', 'destroyer', 'corvette', 'fighter', 'fighter'],
    ['battlecruiser', 'battlecruiser', 'fighter', 'fighter'],
    ['battlecruiser', 'destroyer', 'cruiser', 'fighter', 'fighter'],
  ];
  const base = table[Math.min(wave - 1, table.length - 1)];
  const extra = Math.max(0, Math.floor((wave - table.length) / 3));
  const out = [...base];
  for (let i = 0; i < extra; i++) out.push(i % 2 === 0 ? 'cruiser' : 'fighter');
  return out.slice(0, 7);
}
