# Antigravity Sudoku: Technical Specification

Antigravity Sudoku is a high-performance, web-based Sudoku application that features a sophisticated logical solver, technique-based puzzle generation, and a computer vision pipeline for importing puzzles from images.

---

## 1. System Architecture & Tech Stack

### 1.1 Technology Stack
- **Frontend Core**: Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Modern UI Architecture**: Uses **SVC (State-View-Controller)** pattern.
- **Core Engine**: `solver.js` (Unified 6-layer engine).
- **Parallel Processing**: **Persistent Module Worker Pool** (`js/generator.js`) with cache-busting.
- **High-Performance DLX**: Pointer-less, fixed-memory architecture using **TypedArrays**.
- **Bitwise Evaluation**: Ultra-fast logical simulation using bit-parallel operations.
- **Computer Vision**: **OpenCV.js** (Grid detection) + **Tesseract.js** (OCR).

### 1.2 Modular File Structure

```
sudoku/
├── play.html             # Main game entry point
├── heatmap.html          # Structural analysis tool
├── css/                  # Layered CSS (@layer)
└── js/                   # Modern Logic Scripts
    ├── main.js           # SVC Controller & UI Bridge
    ├── solver.js         # Core Engine (6-layered architecture)
    ├── solver-techniques.js # Strategy Definitions
    ├── generator.js      # Procedural Generation Pipeline
    ├── heatmap.js        # Analyzer/Visualizer Logic
    ├── ocr.js            # Image Import Orchestration
    └── i18n.js           # Internationalization (JA/EN)
```

---

## 2. Unified 6-Layer Engine Architecture

The Sudoku engine (`solver.js`) is organized into six distinct layers of responsibility:

1.  **SudokuBitUtils**: Pure, stateless bit-manipulation and coordinate mapping.
2.  **SudokuBitBoard**: Memory-efficient representation using `Uint32Array`.
3.  **SudokuDLX**: High-speed brute-force engine for uniqueness validation.
4.  **SudokuLogicalSolver**: Human-like deduction core (Singles, Pairs, Chains).
5.  **DifficultyEvaluator**: Orchestration of techniques and authoritative difficulty grading.
6.  **SudokuUIBridge**: Integration layer for UI-level operations (Rocket/Hint logic).

---

## 3. Procedural Generation Pipeline

The puzzle generator (`generator.js`) implements a deterministic 5-stage pipeline for surgery-like difficulty control:

1.  **Full Solution Generation**: Creates a valid base grid using DLX.
2.  **Smoothing (Structural Reduction)**: Rapidly removes non-critical clues ("fat thinning").
3.  **Phase 1 Pruning**: Iteratively removes clues while ensuring constant logical solvability.
4.  **ReductionExplorer (Zobrist Search)**: Uses a state-space search algorithm with Zobrist hashing to find the exact configuration meeting the target difficulty with minimum hints.
5.  **Finalization**: Validates uniqueness and packages the puzzle metadata.

---

## 4. Heatmap & Causality Analysis

The Heatmap tool (`heatmap.js`) provides deep structural insights into Sudoku puzzles:

- **Analyzer/Visualizer Separation**: Logic-heavy calculations are separated from DOM rendering.
- **Causality Tracking**: 
    - **Blue Lines**: Standard structural dependencies between hints.
    - **Red Lines**: "Persistent Causality" — visualizes hints that were critical for maintaining the uniqueness of specific cells before they were removed.
- **Chunked Calculation**: Heavy analytical tasks are processed in chunks to keep the UI responsive.

---

## 5. Computer Vision (OCR) Pipeline

- **Adaptive Grid Detection**: Uses OpenCV.js to handle rotation, perspective, and lighting artifacts.
- **Glyph Deduplication**: Identical digits are grouped via template matching to minimize Tesseract calls by ~80%.
- **Self-Learning Cache**: Corrected OCR results are stored locally, allowing the system to learn and adapt to new fonts over time.

---

## 6. Performance & UX Optimization

- **Zero-Copy Serialization**: Uses Transferable Objects for high-speed Worker communication.
- **Worker Cache Busting**: Appends versioning to Worker URLs to ensure latest code execution.
- **Identity-based Diffing**: Renders board updates only for cells that have mathematically changed state.
- **Dynamic I18n**: Instant language switching (Japanese/English) without state loss.
