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

- **Board model**: `board` is a `ROWS × COLS` matrix (20×10) where each cell is `0` (empty) or a color index `1–7` identifying which piece type locked there.
- **Pieces**: `PIECES` defines the 7 tetrominoes as square matrices. `current` and `next` are piece instances (`{ type, shape, x, y }`); `randomPiece()` creates a new one centered at the top.
- **Rotation**: `rotateCW()` transposes + reverses rows of the shape matrix. `tryRotate()` wraps it with basic wall kicks — it retries the rotation at x-offsets `[0, -1, 1, -2, 2]` and keeps the first that doesn't collide.
- **Collision**: `collide(shape, ox, oy)` is the single source of truth for whether a shape at a given offset is out of bounds or overlaps locked blocks. Movement, rotation, ghost-piece projection, and spawn-collision (game over) all route through it.
- **Game loop**: `loop(ts)` runs via `requestAnimationFrame`, accumulating elapsed time in `dropAccum` and advancing the piece down one row (or locking it) once `dropAccum >= dropInterval`.
- **Locking a piece**: `lockPiece()` → `merge()` (writes the piece into `board`) → `clearLines()` (removes full rows, top-inserts empty ones, updates score/level/dropInterval) → `spawn()` (promotes `next` to `current`, generates a new `next`, and calls `endGame()` if the new piece immediately collides).
- **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by `level`; hard drop adds 2 points/row dropped, soft drop adds 1 point/row. Level increases every 10 lines; `dropInterval = max(100, 1000 - (level-1) * 90)` ms.
- **Rendering**: `draw()` clears and redraws the grid, locked board, ghost piece (`ghostY()` projects `current` straight down via `collide`, drawn at `globalAlpha = 0.2`), and the current piece, in that order. `drawNext()` renders the preview canvas the same way via the shared `drawBlock()` helper.
- **Input**: a single `keydown` listener dispatches by `e.code` (arrows + `KeyX` for rotate, `Space` for hard drop, `KeyP` for pause) and is gated by `paused`/`gameOver`.

If you change `COLS`, `ROWS`, or `BLOCK` in `game.js`, also update the `<canvas id="board">` `width`/`height` in `index.html` to match (`COLS × BLOCK`, `ROWS × BLOCK`).

## Conventions

- Comments and UI strings (labels, README) are in Spanish; keep new user-facing text consistent with that.
- No semicolon-less style — existing code uses semicolons and `'use strict'`; match it.
