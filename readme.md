# Technical Specification: Antigravity Sudoku

Antigravity Sudoku is a high-performance, web-based Sudoku application that features a sophisticated logical solver, technique-based puzzle generation, and a computer vision pipeline for importing puzzles from images. This document provides a detailed technical breakdown of the internal mechanics, algorithms, and architectural decisions.

---

## 1. System Architecture & Tech Stack

### 1.1 Technology Stack
- **Frontend Core**: HTML5, CSS3, Vanilla JavaScript (ES6+). No build step or server required.
- **Core Logic**: `solver-techniques.js` (technique definitions) + `solver.js` (Sudoku engine).
- **Parallel Processing**: **Persistent Web Worker Pool** (`js/generator.js`). Puzzles are generated in the background. Script parsing overhead is eliminated by keeping workers "warm" across multiple game sessions.
- **Communication layer**: Uses **Transferable Objects** (`ArrayBuffer` transfer) between Main and Worker threads, ensuring zero-copy data transfer and sub-millisecond overhead.
- **High-Performance DLX**: `SudokuDLX` uses **TypedArrays** (Int32Array/Uint8Array) for a circular 4-way linked list. Optimized with a **Dirty Return (Short-circuiting)** mechanism.
- **Bitwise Evaluation**: `SudokuBitUtils` and `LogicalRules` (in `js/solver.js` and `js/solver-techniques.js`) provide ultra-fast logical evaluation using bit-parallel operations and optimized `popcount`.
- **Zero-Allocation Loops**: Performance is optimized by pre-sorting all techniques into `TECH_BY_RANK` dictionaries.
- **Computer Vision**:
    - **OpenCV.js**: Grid detection, image preprocessing, template matching for cell grouping.
    - **Tesseract.js**: Optical Character Recognition (OCR) for digit extraction.
- **Persistence**: `localStorage` (language, theme, manual correction cache).

### 1.2 File Structure

```
sudoku/
├── index.html            # About page (landing)
├── play.html             # Main game entry point
├── heatmap.html          # Heatmap tool
├── css/                  # Layout, board, and UI styles
└── js/                   # All logic scripts
    ├── main.js           # Consolidated UI & Orchestrator
    ├── solver.js         # Core Engine (DLX, BitUtils)
    ├── solver-techniques.js # Advanced Logic
    ├── generator.js      # Worker script
    ├── ocr.js            # OCR UI & Main logic
    ├── ocr-engine.js     # OpenCV Grid detection
    ├── heatmap.js        # Heatmap specific logic
    └── i18n.js           # Internationalization
├── technical_specification.md # This document
└── ARCHITECTURE.md       # Architectural overview
```

---

## 2. Sudoku Logical Solver Engine

### 2.1 Internal Data Structures
- **Grid Representation**: A 2D array (`9x9`) of integers (0 for empty, 1-9 for digits).
- **Candidate Management**: For each cell, the solver maintains a `candidates[r][c]` `Set`.
- **Technique Priority**: Techniques are applied in order of complexity. If a simpler technique finds a move, the solver restarts from the simplest technique.
- **Difficulty Log**: Each candidate elimination or cell placement is recorded to enable accurate post-solve difficulty reporting.

### 2.2 Implemented Techniques
| Level | Techniques |
|-------|------------|
| `basic` | Naked Single, Hidden Single |
| `easy` | Locked Candidates (Pointing & Claiming) |
| `medium` | Naked Pair, Hidden Pair, Naked Triple, Hidden Triple |
| `hard` | X-Wing, Y-Wing, Skyscraper, (further advanced techniques labeled as Extreme) |

---

## 3. Advanced Puzzle Generation: Revolutionary Two-Phase Engine

Antigravity Sudoku employs a **Revolutionary Two-Phase** engine that leverages "Inference-Locked" (INF) metrics to produce minimalist puzzles (typically 22–26 hints) with surgical difficulty control.

### 3.1 Managed Memory DLX Foundation
The generator is powered by a high-speed **Dancing Links (DLX)** implementation using TypedArrays. This pointer-less, fixed-memory architecture allows for solution uniqueness checks in microseconds, enabling thousands of deep search iterations per second without GC overhead.

### 3.2 INF-Based Two-Phase Workflow

1.  **Phase 1: Smoothing (地ならし - Structural Reduction)**:
    -   Starts from a full valid grid. Evaluates each cell in a random sequence.
    -   **Constraint**: A hint is removed if:
        1.  The solution remains **unique**.
        2.  The cell's **INF Level is 0 or 1**. 
            - **INF0**: Removing the cell doesn't trigger any immediate logical dependency (stable).
            - **INF1**: Removing the cell creates a single mutual dependency pair (Minimal Unavoidable Set).
    -   **Result**: Produces a stable, logic-dense skeleton (~28–32 hints) by "thinning the fat" and letting the essential logical "bones" emerge.

2.  **Phase 2: Exploration (探索 - Target Rank Search)**:
    -   A wide search (BFS/DFS hybrid) across the smoothed skeleton mapping difficulty jumps.
    -   **Strategy**: It identifies cells where removal causes a sudden jump to the target difficulty (e.g., revealing a Hidden Triple or XY-Chain).
    -   **Optimization**: Bit-parallel evaluation (`SudokuBitSolver`) is used for microsecond-level rank checking, allowing the engine to "snipe" the exact configuration that satisfies the target difficulty with minimum hints.

### 3.3 Stateful Pre-generation & Replenish Logic
- **Intent-based Pre-generation**: Generation begins the moment a user clicks a difficulty button, utilizing the thinking time during the confirmation dialog.
- **Replenish Model**: Workers run in persistent loops (`count` parameter). Every time a worker submits a result, the orchestrator evaluates it and immediately assigns a new "replenish" task to that worker until 4 high-quality puzzles are secured.
- **Verified Logic Guarantee**: The engine refuses to compromise on quality. Puzzles that fail the full "Waterfall Reset" simulation are discarded, ensuring every delivered puzzle is logically consistent and solvable at the claimed difficulty.
- **Zero-Copy Serialization**: Transferable Object support is extended across loops, ensuring buffers are moved, not copied, even during continuous background generation.

---

## 4. OCR Reading Pipeline (Computer Vision)

### 4.1 Grid Detection & Preprocessing
Uses OpenCV.js to detect the grid via Adaptive Thresholding and contour analysis. It normalizes cell orientation and applies bit-inversion for dark-mode boards to handle any source material.

### 4.2 Noise Cleaning & Normalization
Connected components analysis removes "edge noise" (grid lines) and isolated small artifacts. Digits are normalized to a 128x128 centered grid, improving Tesseract's recognition rate.

### 4.3 Glyph Grouping & Self-Learning Cache
-   **Glyph Grouping**: Instead of 81 separate OCR calls, identical digits are grouped via template matching. Only one OCR call is made per unique digit group, reducing load by ~85%.
-   **Correction Cache**: User corrections are stored in `localStorage`. If the OCR fails or a similar "unknown" font is encountered, the system checks the correction cache first. This allows the app to "learn" new fonts and achieve 100% accuracy over time.

---

## 5. UI/UX & Visualization Features

-   **Interactive Heatmap**: A dedicated analysis tool that visualizes the "solving rate" and difficulty impact of every cell.
-   **Dependency Network Visualization**: 
    -   **Blue Lines**: Real-time visualization of cell dependencies (Cell A's removal makes Cell B an INF). 
    -   **Red Lines**: Persistent dependency trails that help users understand the logical structure they have uncovered by removing clues.
-   **Batch DOM Rendering**: Uses an "Identity-based Diffing" signature to skip re-rendering cells that haven't changed.
-   **Rocket Button (Solve Assist)**: A multi-phase assist that fills logical singles and prunes candidate memos.
-   **Dynamic I18n**: Real-time switching between Japanese and English without page reloads.
