# Antigravity Sudoku — Architecture

## 1. System Overview

Antigravity Sudoku is a high-performance Sudoku environment designed for both casual play and theoretical research. It employs a modern, decoupled architecture to ensure that heavy logical computations never block the fluid user experience.

---

## 2. Global Architecture Patterns

### 2.1 SVC (State-View-Controller)
The main application (`main.js`) follows the SVC pattern:
- **State (`SudokuGame`)**: Authoritative source for grid data, history (Undo/Redo), and logic flags.
- **View (`BoardView`)**: Handles DOM lifecycle, diff-based rendering, and keypad styling.
- **Controller (`AppController`)**: Orchestrates game logic, settings, and asynchronous services like OCR and Generation.

### 2.2 Analyzer/Visualizer Pattern
Tools like `heatmap.js` separate analytical calculations from UI projection:
- **Analyzer**: Pure logical routines processing bit-boards and generating reports.
- **Visualizer**: Transforms logical reports into SVG causal links and HSL-based color maps.

---

## 3. Core Engine Layering (`js/solver.js`)

The engine is structured into 6 horizontal layers to ensure strict separation of concerns:

| Layer | Responsibility |
|-------|----------------|
| **1. SudokuBitUtils** | Low-level bitwise math, masking, and coordinate conversion. |
| **2. SudokuBitBoard** | Primitive data structure (Uint32Array) for board memory. |
| **3. SudokuDLX** | Persistent, fixed-memory Dancing Links engine for brute-force. |
| **4. SudokuLogicalSolver** | Collection of human-standard deduction algorithms. |
| **5. DifficultyEvaluator** | Central registry for techniques, ranking, and definitive grading. |
| **6. SudokuUIBridge** | Bridge connecting logical techniques to interactive UI feedback. |

---

## 4. Generation Service (`js/generator.js`)

Generation is handled in background threads using a **Procedural Pipeline**:

1.  **Stage 1 (Solution)**: DLX generates a random valid solution.
2.  **Stage 2 (Smoothing)**: Fast reduction of clues until a minimal skeleton is reached.
3.  **Stage 3 (ReductionExplorer)**: A state-space search algorithm using **Zobrist Hashing** to identify the optimal set of clues to remove to reach exactly the target Difficulty Rank.
4.  **Integration**: Managed by `SudokuOrchestrator` in the main thread with **Cache Busting** and **Task-ID based filtering** for maximum stability.

---

## 5. Dependency Graph

```mermaid
graph TD
    subgraph Controller Layer
        MC[main.js: AppController]
        HC[heatmap.js: Controller]
        OC[ocr.js: Controller]
    end

    subgraph Logic & Engine Layer
        S[solver.js: 6 Layers]
        ST[solver-techniques.js: Records]
        I[i18n.js: Translation]
    end

    subgraph Service Layer (Workers)
        G[generator.js: Pipeline]
        OE[ocr-engine.js: CV]
    end

    MC --> S
    MC --> ST
    MC --> I
    MC --> G
    HC --> S
    HC --> ST
    OC --> S
    OC --> OE
    G --> S
```

---

## 6. Worker Lifecycle & Stability

To avoid stale code and communication deadlocks:
- **Versioning**: Every worker is spawned with a unique timestamp URL (`?v=...`) to bypass browser cache.
- **Task Isolation**: Every message exchange includes a unique `taskId`. Messages from previously cancelled or completed tasks are automatically ignored.
- **Memory Management**: Uses **Transferable Objects** for zero-copy buffer exchange during puzzle delivery.
