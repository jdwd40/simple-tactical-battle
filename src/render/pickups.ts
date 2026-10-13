import type { PickupKind } from '../game/types';

export const PICKUP_COLORS: Record<PickupKind, string> = {
  energy: '#ffc64a', shield: '#40e0ff', missile: '#ff4fa3', repair: '#5cf29a', rail: '#9df0ff', overdrive: '#ffffff', salvage: '#ffd700',
};

export const PICKUP_GLYPHS: Record<PickupKind, string> = {
  energy: '⚡', shield: '◈', missile: '▲', repair: '+', rail: '⇒', overdrive: '★', salvage: '$',
};

export const PICKUP_LABELS: Record<PickupKind, (amount: number) => string> = {
  energy: (a) => `+${a} ENERGY`, shield: (a) => `+${a} SHIELD`, missile: (a) => `+${a} MISSILES`, repair: (a) => `+${a} HULL`,
  rail: () => 'RAIL READY', overdrive: () => '+1 ACTION', salvage: (a) => `+${a} SALVAGE`,
};
