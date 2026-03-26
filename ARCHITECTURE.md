# Antigravity Sudoku — Architecture

## Overview

A fully client-side Sudoku game running in the browser.  
No build step or server logic required. All game logic, OCR, and puzzle generation run locally in the browser.

---

## File Map

```
sudoku/
├── index.html            # About page (landing)
├── play.html             # Main game entry point
├── heatmap.html          # Heatmap analysis tool
├── css/                  # Separated style files
│   ├── base.css          # Core variables, themes, and base layout
│   ├── board.css         # Board, cell, and grid styles
│   ├── ui.css            # Buttons, keypad, and general UI controls
│   └── modal.css         # All modal and dialog styles
└── js/                   # All logic scripts
    ├── main.js           # Consolidated UI logic & Worker Orchestrator
    ├── solver.js         # Engine core (DLX, BitUtils, LogicalSolver base)
    ├── solver-techniques.js # Advanced human-like techniques
    ├── generator.js      # Worker entry point & Generation logic
    ├── ocr-engine.js     # OpenCV-based grid detection (GridDetector)
    ├── ocr.js            # OCR pipeline & Image import UI
    ├── heatmap.js        # Heatmap specific logic
    └── i18n.js           # Internationalization (JA / EN)
```

---

## File Roles

### `play.html`
The single HTML game entry point.  
Loads all scripts in dependency order and defines the full DOM structure:
game board, keypad, memo toggle, undo/redo buttons, settings bar, and OCR modal.

### `index.html`
The landing and overview page. Provides an introduction to the project's features and technical background, with a direct link to `play.html`.

**Script load order:**
```
js/solver.js → js/solver-techniques.js → js/i18n.js → js/main.js → js/ocr-engine.js → js/ocr.js
```

---

### `css/ (Separated Style Files)`
All visual styling in vanilla CSS, partitioned for maintainability:
- `base.css`: Implements two themes via CSS custom properties, reset styles, and base layout.
- `board.css`: Covers game board layout, cell states, and memo grid.
- `ui.css`: Handles buttons, keypad, and general UI controls.
- `modal.css`: Manages all modal and dialog components.

---

### `i18n.js`
Internationalization module.  
Defines `translations` object with `ja` and `en` keys.
- `t(key)` — returns the translated string for the current language
- `applyLanguage(lang)` — updates all `data-i18n` elements in the DOM and persists selection to `localStorage`

---

### `solver-techniques.js`
A heavy-duty logical analysis module used solely on the **Main Thread**. It defines the full suite of human-like Sudoku techniques. Workers avoid loading this file to minimize startup overhead and memory usage.

- `TECHNIQUES` — array of technique objects `{ name, rank, checkBitwise, applyLogical }`
- `TECH_BY_RANK` — pre-sorted dictionary for zero-allocation access in tight loops.
- `LogicalRules.analyzeFull(solver)` — authoritative "Waterfall Reset" evaluator used by Main Thread and Orchestrator.

**Must be loaded AFTER `solver.js` (uses shared `DIFFICULTY_RANK` and engine definitions).**

---

### `solver.js`
The engine core containing three high-performance modules.

#### 1. `SudokuDLX` (Backtracking & Uniqueness)
Uses **TypedArrays** (Int32Array/Uint8Array) to implement the Dancing Links (DLX) algorithm with a **pointer-less, fixed-memory architecture**. This zero-allocation design allows for extreme speed during deep searches.
- `applyGrid(grid)` — Resets and applies a 1D grid to the internal constraint matrix.
- `countSolutions(grid, limit)` — Fast unique solution check. **Optimized with Dirty Return (Short-circuiting)**: if the limit is reached, it skips the expensive `uncover` stack and returns immediately, relying on the caller to reset state via `applyGrid`.
- `solveAndFill(grid)` — Fills a 1D grid with a valid solution.

#### 2. `SudokuBitLogicalSolver` (Ultra-Fast Evaluation)
A bit-parallel logical engine using bitwise operations and optimized `popcount`.
- `evaluate(grid, targetRank)` — **Waterfall Reset Simulation**: instead of a simple probe, it simulates the entire solve until completion or impasse to verify the puzzle is solvable within the target rank.
- `fillSinglesInternal()` — core bitwise routine for rapid Singles elimination.

#### 3. `SudokuLogicalSolver` (Production & Advanced Metrics)
The high-level coordinator used in the Web Worker to generate and shape puzzles.
- `generateSinglePattern(difficulty)` — Implements the **Revolutionary Two-Phase** engine:
    - **Phase 1: Smoothing (地ならし)**: Rapid structural reduction by removing cells that have an **INF Level of 0 or 1** (cells whose removal doesn't break uniqueness or only creates simple mutual dependency pairs). This "thins out the fat" while preserving the "logical skeleton".
    - **Phase 2: Exploration (探索)**: A wide search across the smoothed skeleton to find the minimal configuration that triggers the target difficulty.
    - **Efficiency**: Gauges difficulty (BitSolver) only once per candidate node; utilizes DLX for final uniqueness validation.
- `solveByRank(targetRank)` — Uses the traditional technique-based approach for precise difficulty classification.
- `SudokuOrchestrator` — **Stateful Pre-generation & replenishment**:
    - Starts generating puzzles as soon as a difficulty button is clicked (leveraging user intent time).
    - Maintains a **Target Count (4)** of "Verified Logic" puzzles.
    - Implements a **Replenish Model**: Worker finishes 1 puzzle → Orchestrator checks quality → immediately requests 1 more until the pool is full.
    - **No Compromise**: Only puzzles that pass the "Waterfall Reset" verification are accepted.
- `worker.js` — **Loop-based Parallel Processing**:
    - Executes generation in continuous loops based on a `count` parameter to minimize communication overhead.
    - Uses **Transferable Objects** for zero-copy data exchange.

---

### `worker.js`
A lightweight background process that purely runs the `solver.js` engine. It does **not** load technique definitions, focusing instead on rapid bit-parallel reduction. It uses `taskId` to manage state across multiple generation requests within the persistent pool.

---

### `js/main.js`
Game UI logic, Worker Orchestration, state management, and application initialization.
Merged from `script.js` and `orchestrator.js`.

**Key features:**
- Owns `unifiedBoard` (32-bit state)
- Manages `SudokuOrchestrator` for parallel worker pooling.
- Handles all UI event listeners and DOM rendering.
- Implements Rocket Button (🚀) state machine.

---

### `js/generator.js`
Worker entry point for asynchronous puzzle generation.
- Acts as the `worker.js` script.
- Contains `SudokuGenerator` class with smoothing and exploration algorithms.
- Dynamically loads `js/solver.js` and `js/solver-techniques.js` via `importScripts`.

---

### `js/ocr-engine.js` (Renamed from grid-detector.js)
OpenCV.js-based image analysis. Extracts cell images from a sudoku photo.

**Class: `GridDetector`**
Method: `detect(canvas, onProgress)` — crop grid → split → binarize → group similar cells.

**Depends on:** OpenCV.js (Dynamic loading)

---

### `js/ocr.js`
OCR pipeline using Tesseract.js.
- Orchestrates `GridDetector` and Tesseract workers.
- Implements manual correction cache & validation logic.
- Uses `SudokuLogicalSolver.evaluate` from the main memory sandbox.

**Depends on:** `js/solver.js`, `js/ocr-engine.js`

---

## Dependency Graph

```
[CDN] opencv.js ────────────────────────┐
[CDN] tesseract.js ─────────────────────┤
                                        ▼
solver-techniques.js ──► solver.js ◄── worker.js
                          │
                          ▼
              i18n.js ──► script.js ◄── grid-detector.js ──► ocr.js
```

---

## Data Flow (Normal Game)

```
initGame(difficulty)
  → generatePuzzle()                    # P-Core Optimized Orchestrator (in main.js)
      → js/generator.js: generateSinglePattern()
          → Phase 1 (Smoothing): Remove INF0/INF1 clues to expose logical "bones".
          → Phase 2 (Exploration): Search for the target rank within the skeleton.
          → Engine-Direct: Calls BitUtils/DLX directly to eliminate `probe` call overhead.
      → On-Demand Selection: Min-hints & Max-complexity score
  → renderBoard()
```

## Data Flow (OCR Import)

```
Image upload
  → GridDetector.detect()     # OpenCV: crop, split, binarize, group
  → Tesseract per group       # OCR each unique digit group
  → countSolutions(limit=2)   # DLX uniqueness check
  → applyGridToBoard()
```
