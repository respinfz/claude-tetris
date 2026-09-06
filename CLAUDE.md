# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A classic Tetris implementation in vanilla JavaScript (ES6+) using the HTML5 Canvas 2D API. No dependencies, no build step, no package.json — three files (`index.html`, `style.css`, `game.js`) that run directly in a browser.

## Running the game

There is no build/lint/test tooling in this repo. Just open or serve `index.html`:

```bash
start index.html        # Windows: open directly, or
npx serve .              # serve locally (recommended for consistent behavior)
```

Then visit `http://localhost:8000` if using a server. Changes to `game.js`/`style.css`/`index.html` only require a browser refresh — no compilation step.

## Architecture

All game logic lives in `game.js` (single file, no modules). Key pieces:

- **Board model**: `board` is a `ROWS × COLS` matrix (20×10) where each cell is `0` (empty) or a color index `1–8` identifying which piece type locked there (the power-ups, `9`/`10`, resolve on lock and never stay on the board).
- **Pieces**: `PIECES` defines the 7 standard tetrominoes, an 8th "challenge" piece — the *nut* (`type` 8), a 3×3 ring with a hollow center (`[[8,8,8],[8,0,8],[8,8,8]]`) — and two 1×1 power-up pieces: the *bomb* (`type` 9, `[[9]]`) and the *rayo* (`type` 10, `[[10]]`). `current` and `next` are piece instances (`{ type, shape, dir, x, y }`, where `dir` is `'h'`/`'v'` for the rayo and `null` otherwise); `randomPiece()` creates a new one centered at the top: it returns the queued power-up when `powerPending` is set (see below), otherwise the nut with probability `NUT_CHANCE` (~1/15), otherwise one of the 7 standard pieces. The nut's shape is symmetric, so `rotateCW()` is a visual no-op for it; its hollow center is a `0` cell, so `collide`/`merge`/`clearLines` need no special-casing — the empty center simply blocks the row from clearing until lower lines clear.
- **Power-ups (bomb & rayo)**: `clearLines()` queues a power-up in `powerPending` once total `lines` reaches `nextPowerLines` (advanced to the next multiple of `POWER_LINES` = 10), then flips `nextPowerType` so the two alternate: bomb, rayo, bomb, … A power-up is guaranteed once per 10 cleared lines and previews one turn ahead in `next`. Position/`dir` are captured in `lockPiece()` before `merge()` (since `spawn()` replaces `current`), and the effect runs between `merge()` and `clearLines()`:
  - *Bomb* → `explode(bx, by)`: clears the 3×3 area centered on the bomb, then `collapseColumn()` compacts each of the (up to 3) affected columns downward, then adds `BOMB_SCORE_PER_BLOCK` (50) × `level` per destroyed cell.
  - *Rayo* → `strike(bx, by, dir)`: `dir === 'h'` splices out row `by` and top-inserts an empty row (blocks above fall one row); `dir === 'v'` empties column `bx` in place. Adds `RAYO_SCORE_PER_BLOCK` (50) × `level` per destroyed cell. It does **not** touch `lines`/`level` (a rayo is not a line clear, and counting it would re-feed the power-up counter). `tryRotate()` reinterprets rotation for the rayo as toggling `dir`.
  Both push a `{x, y, w, h, color, t}` cell-rect entry into `blasts` for the fade-out flash rendered in `draw()`.
- **Combo**: `combo` counts consecutive locks that cleared ≥1 line; `comboMult()` = `clamp(combo, 1, COMBO_MAX_MULT=5)`. `clearLines(isPowerUp)` takes a flag from `lockPiece()` (`type` is bomb/rayo): a clear increments `combo` and multiplies the line score by `comboMult()` (also updating `comboMax` for the game-over overlay); a lock with no clear resets `combo` to 0 **unless** `isPowerUp` (bomb/rayo freeze the chain rather than break it). `combo >= 2` also pushes a `{text, color, t}` entry into `popups` (rendered by `drawPopups()` as a rising, fading "COMBO x3" over the board plus a colored inner border) and plays `sfxCombo`. HUD shows `x{mult}` in `#combo`, recoloured via `COMBO_COLORS` and pulsed (CSS `.combo-pulse`, reflow-restarted) only when the multiplier rises (`hudMult`).
- **Audio**: WebAudio synthesised on the fly, no files. `audio()` lazily creates/resumes a single `AudioContext` (also nudged from the `keydown` listener so the first sound follows a user gesture) and returns `null` when muted or unsupported; `tone()`/`noise()`/`sweep()` are the primitives, wrapped by `sfxRotate/sfxLock/sfxLine/sfxCombo/sfxBlast/sfxGameOver`. All calls are no-ops when `soundOn` is false. `#sound-toggle` flips `soundOn`, updates 🔊/🔇 + `aria-pressed`, and persists `SOUND_KEY` in `localStorage` (same `try/catch` pattern as the theme toggle).
- **Rotation**: `rotateCW()` transposes + reverses rows of the shape matrix. `tryRotate()` wraps it with basic wall kicks — it retries the rotation at x-offsets `[0, -1, 1, -2, 2]` and keeps the first that doesn't collide. For the rayo it short-circuits before the matrix rotation and just flips `current.dir`.
- **Collision**: `collide(shape, ox, oy)` is the single source of truth for whether a shape at a given offset is out of bounds or overlaps locked blocks. Movement, rotation, ghost-piece projection, and spawn-collision (game over) all route through it.
- **Game loop**: `loop(ts)` runs via `requestAnimationFrame`, accumulating elapsed time in `dropAccum` and advancing the piece down one row (or locking it) once `dropAccum >= dropInterval`.
- **Locking a piece**: `lockPiece()` → `merge()` (writes the piece into `board`) + `sfxLock()` → `explode()`/`strike()` if the locked piece was a bomb/rayo → `clearLines(isPowerUp)` (removes full rows, top-inserts empty ones, updates score/level/dropInterval, advances the combo, and arms the next power-up) → `spawn()` (promotes `next` to `current`, generates a new `next`, and calls `endGame()` if the new piece immediately collides).
- **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by `level` **and by `comboMult()`**; hard drop adds 2 points/row dropped, soft drop adds 1 point/row. Level increases every 10 lines; `dropInterval = max(100, 1000 - (level-1) * 90)` ms. Bomb/rayo add 50 × `level` per destroyed cell (not combo-multiplied).
- **Rendering**: `draw()` clears and redraws the grid, locked board, active `blasts` (a shrinking-alpha flash over the `{x, y, w, h, color}` cell rect — 3×3 for the bomb, a full row/column for the rayo — expired entries filtered out here), then — only when not `gameOver` — the ghost piece (`ghostY()` projects `current` straight down via `collide`, drawn at `globalAlpha = 0.2`) and the current piece, and finally `drawPopups()` (combo text + border, always on top). `drawBlock(context, x, y, colorIndex, size, alpha, dir)` paints a fuse-and-body icon on `BOMB_TYPE` cells and a lightning-bolt + orientation bar (`dir`) on `RAYO_TYPE` cells, so both are marked on the board and the `drawNext()` preview via the shared helper.
- **Input**: a single `keydown` listener dispatches by `e.code` (arrows + `KeyX` for rotate, `Space` for hard drop, `KeyP` for pause) and is gated by `paused`/`gameOver`; it also calls `audio()` first so the `AudioContext` starts on the initial key press.

If you change `COLS`, `ROWS`, or `BLOCK` in `game.js`, also update the `<canvas id="board">` `width`/`height` in `index.html` to match (`COLS × BLOCK`, `ROWS × BLOCK`).

## Conventions

- Comments and UI strings (labels, README) are in Spanish; keep new user-facing text consistent with that.
- No semicolon-less style — existing code uses semicolons and `'use strict'`; match it.
