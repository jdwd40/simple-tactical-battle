export interface Vec {
  x: number;
  y: number;
}

export type EnemyKind = 'scout' | 'frigate' | 'dreadnought' | 'warlord';
export type PickupKind = 'energy' | 'shield' | 'missile' | 'repair';
export type Facing = number; // radians

export interface Ship {
  id: number;
  kind: 'player' | EnemyKind;
  pos: Vec;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  facing: Facing;
  /** Enemy only: turns until missile is ready again. */
  missileCooldown: number;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec;
}

export type Phase = 'title' | 'player' | 'enemy' | 'waveClear' | 'gameOver';

export interface GameState {
  seed: number;
  wave: number;
  score: number;
  kills: number;
  phase: Phase;
  cols: number;
  rows: number;
  asteroids: Vec[];
  player: Ship;
  energy: number;
  maxEnergy: number;
  missiles: number;
  maxMissiles: number;
  ap: number;
  maxAp: number;
  enemies: Ship[];
  pickups: Pickup[];
  /** Kills made this player turn, for combo scoring. */
  comboKills: number;
  nextId: number;
}

export type ActionMode = 'move' | 'laser' | 'missile' | 'boost';

export interface DamageResult {
  targetId: number;
  shieldDamage: number;
  hullDamage: number;
  crit: boolean;
  destroyed: boolean;
}

export type GameEvent =
  | { type: 'move'; id: number; path: Vec[] }
  | { type: 'laser'; shooterId: number; from: Vec; to: Vec; hit: DamageResult }
  | { type: 'missile'; shooterId: number; from: Vec; to: Vec; hits: DamageResult[] }
  | { type: 'boost'; id: number; amount: number }
  | { type: 'pickup'; id: number; kind: PickupKind; pos: Vec; amount: number }
  | { type: 'destroyed'; id: number; kind: Ship['kind']; pos: Vec; points: number; combo: number }
  | { type: 'turnStart'; who: 'player' | 'enemy' }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'gameOver'; score: number; wave: number };
