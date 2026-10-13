import type { ActionMode, GameState } from '../game/types';
import { PLAYER } from '../game/rules';

const ICONS = {
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  laser: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  missile: '<svg viewBox="0 0 24 24"><path d="M14 4l6 6-9 9-3 3-3-3 3-3 6-12z"/><path d="M5 19l-2 2M9 15l6-6"/></svg>',
  rail: '<svg viewBox="0 0 24 24"><path d="M3 12h13"/><path d="M16 8l5 4-5 4"/><path d="M3 8h4M3 16h4"/></svg>',
  flak: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  boost: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  end: '<svg viewBox="0 0 24 24"><path d="M5 4l14 8-14 8z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8a5 5 0 010 8M19 5a9 9 0 010 14"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
};

export class Hud {
  readonly root: HTMLElement;
  readonly field: HTMLElement;
  private waveEl: HTMLElement;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private hull: { fill: HTMLElement; label: HTMLElement; bar: HTMLElement };
  private shield: { fill: HTMLElement; label: HTMLElement };
  private energy: { fill: HTMLElement; label: HTMLElement };
  private missilesEl: HTMLElement;
  private pipsEl: HTMLElement;
  private buttons: Record<ActionMode | 'end', HTMLButtonElement>;
  private hintEl: HTMLElement;
  private soundBtn: HTMLButtonElement;
  private flashEl: HTMLElement;
  onAction: ((mode: ActionMode | 'end') => void) | null = null;
  onSound: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    parent.innerHTML = `
      <header class="topbar">
        <div class="wave">Wave 1</div>
        <div class="score">0<small>best 0</small></div>
        <button class="iconbtn sound" aria-label="Toggle sound">${ICONS.sound}</button>
      </header>
      <div class="field"><div class="board"></div><div class="hint hidden"></div></div>
      <div class="side">
        <section class="status">
          <div class="bar hull"><label><span>Hull</span><span class="v"></span></label><div class="track"><div class="fill"></div></div></div>
          <div class="bar shield"><label><span>Shield</span><span class="v"></span></label><div class="track"><div class="fill"></div></div></div>
          <div class="bar energy"><label><span>Energy</span><span class="v"></span></label><div class="track"><div class="fill"></div></div></div>
          <div class="counter"><span>Missiles</span><b class="missiles">0</b></div>
          <div class="counter"><span>Actions</span><div class="pips"></div></div>
        </section>
        <nav class="actions">
          <button class="action" data-mode="laser">${ICONS.laser}<span class="label">Laser</span><span class="cost">${PLAYER.laser.cost} ⚡</span></button>
          <button class="action" data-mode="rail">${ICONS.rail}<span class="label">Railgun</span><span class="cost">${PLAYER.rail.cost} ⚡</span><span class="badge cool hidden">0</span></button>
          <button class="action" data-mode="flak">${ICONS.flak}<span class="label">Flak</span><span class="cost">${PLAYER.flak.cost} ⚡</span></button>
          <button class="action" data-mode="missile">${ICONS.missile}<span class="label">Missile</span><span class="cost">1 ▲</span><span class="badge">0</span></button>
          <button class="action" data-mode="move">${ICONS.move}<span class="label">Move</span><span class="cost">1 AP</span></button>
          <button class="action" data-mode="boost">${ICONS.boost}<span class="label">Shield</span><span class="cost">${PLAYER.boost.cost} ⚡</span></button>
          <button class="action end" data-mode="end">${ICONS.end}<span class="label">End turn</span><span class="cost">enemy moves</span></button>
        </nav>
      </div>
      <div class="flash"></div>
    `;
    this.root = parent;
    const q = <T extends Element>(sel: string): T => parent.querySelector(sel) as T;
    this.field = q('.board');
    this.waveEl = q('.wave');
    this.scoreEl = q('.score');
    this.bestEl = q('.score small');
    this.hull = { fill: q('.bar.hull .fill'), label: q('.bar.hull .v'), bar: q('.bar.hull') };
    this.shield = { fill: q('.bar.shield .fill'), label: q('.bar.shield .v') };
    this.energy = { fill: q('.bar.energy .fill'), label: q('.bar.energy .v') };
    this.missilesEl = q('.missiles');
    this.pipsEl = q('.pips');
    this.hintEl = q('.hint');
    this.soundBtn = q('.sound');
    this.flashEl = q('.flash');
    this.buttons = {
      move: q('[data-mode=move]'), laser: q('[data-mode=laser]'), missile: q('[data-mode=missile]'), rail: q('[data-mode=rail]'), flak: q('[data-mode=flak]'), boost: q('[data-mode=boost]'), end: q('[data-mode=end]'),
    };
    for (const [mode, btn] of Object.entries(this.buttons)) {
      btn.addEventListener('click', () => this.onAction?.(mode as ActionMode | 'end'));
    }
    this.soundBtn.addEventListener('click', () => this.onSound?.());
  }

  setSound(muted: boolean): void {
    this.soundBtn.innerHTML = muted ? ICONS.muted : ICONS.sound;
  }

  update(s: GameState, best: number, mode: ActionMode | null, enabled: Record<ActionMode, boolean>): void {
    this.waveEl.textContent = `Wave ${s.wave}`;
    this.scoreEl.firstChild!.textContent = s.score.toLocaleString();
    this.bestEl.textContent = `best ${Math.max(best, s.score).toLocaleString()}`;
    const p = s.player;
    this.hull.fill.style.transform = `scaleX(${p.hull / p.maxHull})`;
    this.hull.label.textContent = `${p.hull}`;
    this.hull.bar.classList.toggle('low', p.hull <= 30);
    this.shield.fill.style.transform = `scaleX(${p.shield / p.maxShield})`;
    this.shield.label.textContent = `${p.shield}`;
    this.energy.fill.style.transform = `scaleX(${s.energy / s.maxEnergy})`;
    this.energy.label.textContent = `${s.energy}`;
    this.missilesEl.textContent = `${s.missiles}`;
    this.buttons.missile.querySelector('.badge')!.textContent = `${s.missiles}`;
    const cool = this.buttons.rail.querySelector('.badge') as HTMLElement;
    cool.textContent = `${s.railCooldown}`;
    cool.classList.toggle('hidden', s.railCooldown === 0);
    this.pipsEl.innerHTML = Array.from({ length: s.maxAp }, (_, i) => `<span class="pip ${i < s.ap ? 'on' : ''}"></span>`).join('');
    const playing = s.phase === 'player';
    for (const m of ['move', 'laser', 'missile', 'rail', 'flak', 'boost'] as ActionMode[]) {
      this.buttons[m].disabled = !playing || !enabled[m];
      this.buttons[m].classList.toggle('on', mode === m);
    }
    this.buttons.end.disabled = !playing;
    this.buttons.end.classList.toggle('pulse', playing && s.ap === 0);
  }

  hint(text: string, kind: 'normal' | 'enemy' = 'normal'): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('hidden', !text);
    this.hintEl.classList.toggle('enemy', kind === 'enemy');
  }

  banner(text: string, sub = '', style: 'normal' | 'danger' | 'gold' = 'normal'): void {
    const el = document.createElement('div');
    el.className = `banner ${style === 'normal' ? '' : style}`;
    el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 2000);
  }

  flash(): void {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  overlay(html: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="card">${html}</div>`;
    document.body.appendChild(el);
    return el;
  }
}
