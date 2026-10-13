# Shadow-Dancer playtest guide

A short guide for human playtests of the first playable duel. Everything runs locally in the
browser; there is no backend.

## Run

```sh
npm ci
npm run dev             # http://127.0.0.1:5173/ (add -- --port <n> if 5173 is taken)
# or a production build:
npm run build && npm run preview
```

Open the page, read the briefing, and choose **Begin mission**. Add `?seed=<number>` to the URL to
play a specific encounter, for example `/?seed=17`.

## Controls

- **Planning** never runs out of time. Set movement, sensor, cloak and one weapon order, then
  **Commit turn N**. Both ships then act at once for 10 seconds.
- **Movement:** click a cell on the plot, or type a column and row and press Enter. **Hold position**
  stops.
- **Sensor:** Passive, or one Active pulse on the turn's first tick (costs energy, exposes you).
- **Cloak:** On or Off. It costs energy each second, and firing or pulsing breaks it for the turn.
- **Weapon:** Hold fire, Laser at a known contact (needs a current lock in range), or Missile.
  Choose Missile, then **Aim on plot** and click a cell (Escape cancels), or enter an aim column
  and row.
- **Playback:** Play/Pause, Back/Forward one tick, Skip to end, speed 0.5×–4×, and the position
  slider. After a turn, **Replay turn N** shows it again as recorded; nothing is re-simulated.
- **Keyboard:** Tab moves through every control in planning order; arrow keys change the
  sensor, cloak and weapon choices; "Skip to orders" jumps straight to the orders.
- **Briefing** reopens the introduction at any time without changing the encounter.
- **Phones:** the plot sits under a compact energy/shields/hull strip, with playback below it.
  The **Orders**, **Ship** and **Log** tabs switch the panel underneath, and **Commit turn N** stays
  pinned at the bottom. Tap the plot to set a course; everything else is a tap on a control.
  Landscape puts the plot on the left and the panels on the right.

## Reading combat

- **Your laser:** an amber beam to the target. **Hit: contact-N** (a starburst) appears only when
  your ship observed the impact on that contact. "No impact observed" means exactly that; it
  does not claim a miss.
- **Missiles:** an explosion that names no ship is shown as **Impact: damage unconfirmed**, for
  example when one hits an asteroid.
- **Hits on you:** a sea-glass flare for shields and a jagged coral burst for hull, with the exact
  loss beside your ship, in the banner over the plot and on the resource bars. The attacker is
  named only if you saw it fire.
- **After each turn,** whether played or skipped, the assessment opens with a combat summary:
  your fire and what was observed of it, the damage you took, and why an order did not fire.
  Seeking back in playback removes anything that had not happened yet.

## Seeds and reproduction

The header shows the current **Seed**. **Copy seed link** copies a link that starts the same
encounter again. **Restart** replays the same seed from turn 1; **New encounter** (after an
ending or abandoning) draws a new seed. The same seed and the same orders always play out the
same way, so a seed plus the orders you gave is a complete bug report.

Reference run, used by the automated tests: seed 17. Turns 1–2 go to column 10, row 9 with cloak
off, firing the laser on turn 2. Turns 3–7 cloak and withdraw to column 2, row 17. Turns 8–9
hold with cloak off and fire the laser. The frigate hits you on turn 2, then loses you. It
investigates and searches, finds you again and destroys you on turn 9: defeat.

## What to look for

- Can you explain your orders and their consequences before committing?
- Does choosing between scanning and staying hidden matter?
- Does predicting the frigate help you attack or escape?
- Is the uncertainty of a last-known contact intriguing rather than confusing?
- After a loss, can you explain it from what your ship saw?

Please note the seed, what you expected, and what happened.

## Known limitations

- The patrol AI is deliberately simple. In current tuning it usually wins; balance is later work.
- The game is checked in Chromium only.
- `tests/harness` and `tests/fixtures` pages exist only for automated tests with scripted
  opponents or fixed frames. They are not part of the game or the production build.
