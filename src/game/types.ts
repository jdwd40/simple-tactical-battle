export interface Vec {
  x: number;
  y: number;
}

export type EnemyKind = 'fighter' | 'corvette' | 'cruiser' | 'destroyer' | 'battlecruiser' | 'warlord';
export type PickupKind = 'energy' | 'shield' | 'missile' | 'repair' | 'rail' | 'overdrive' | 'salvage';
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
  /** Cells covered by nebula cloud. Ships inside can only be lasered from an adjacent cell. */
  nebula: Vec[];
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
  /** Turns until the railgun can fire again. */
  railCooldown: number;
  nextId: number;
}

export type ActionMode = 'move' | 'laser' | 'missile' | 'rail' | 'flak' | 'boost';

export interface DamageResult {
  targetId: number;
  shieldDamage: number;
  hullDamage: number;
  crit: boolean;
  destroyed: boolean;
}

export type GameEvent =
  | { type: 'move'; id: number; path: Vec[]; retreat?: boolean }
  | { type: 'laser'; shooterId: number; from: Vec; to: Vec; hit: DamageResult }
  | { type: 'missile'; shooterId: number; from: Vec; to: Vec; hits: DamageResult[] }
  | { type: 'rail'; shooterId: number; from: Vec; to: Vec; hits: DamageResult[] }
  | { type: 'flak'; id: number; pos: Vec; hits: DamageResult[] }
  | { type: 'boost'; id: number; amount: number }
  | { type: 'pickup'; id: number; kind: PickupKind; pos: Vec; amount: number }
  | { type: 'drop'; pickup: Pickup }
  | { type: 'destroyed'; id: number; kind: Ship['kind']; pos: Vec; points: number; combo: number }
  | { type: 'turnStart'; who: 'player' | 'enemy' }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'gameOver'; score: number; wave: number };
