/**
 * Sudoku Generation Worker (generator.js)
 * Procedural Pipeline Refactoring
 */

import { SudokuBitUtils as Utils, SudokuBitBoard, SudokuDLX, DifficultyEvaluator } from './solver.js';
import { TECHNIQUES, TECHNIQUES_ADVANCED } from './solver-techniques.js';

// Global Engine Setup
SudokuDLX.init();
DifficultyEvaluator.connectDictionary([...TECHNIQUES, ...TECHNIQUES_ADVANCED]);
const evalSandbox = DifficultyEvaluator.createSandbox();

/**
 * Worker Entry Point
 */
self.onmessage = function (e) {
    const { type, taskId, rank, patternType, grid, targetRank } = e.data;
    try {
        if (type === 'GENERATE') {
            const result = SudokuGenerator.generateSinglePattern(rank, patternType);
            if (result) self.postMessage({ type: 'GENERATE_SUCCESS', taskId, result });
            else self.postMessage({ type: 'ERROR', taskId, message: 'Generation failed' });
        } else if (type === 'ENGINE') {
            const result = DifficultyEvaluator.evaluate(grid, targetRank, evalSandbox);
            self.postMessage({ type: 'ENGINE_SUCCESS', taskId, result });
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', taskId, message: err.toString() });
    }
};

/**
 * Generation Strategies for Hints Pruning
 */
const PATTERN_STRATEGIES = {
    SYMMETRY: () => {
        const pairs = []; const used = new Set();
        for (let i = 0; i < 81; i++) {
            if (used.has(i)) continue;
            let partner = 80 - i;
            pairs.push(i === partner ? [i] : [i, partner]);
            used.add(i); used.add(partner);
        }
        return Utils.shuffleArray(pairs).flat();
    },
    MIRROR: () => {
        const pairs = []; const used = new Set();
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                let idx = r * 9 + c; if (used.has(idx)) continue;
                let partner = r * 9 + (8 - c);
                pairs.push(idx === partner ? [idx] : [idx, partner]);
                used.add(idx); used.add(partner);
            }
        }
        return Utils.shuffleArray(pairs).flat();
    },
    CHECKER: () => {
        const even = [], odd = [];
        for (let i = 0; i < 81; i++) {
            let r = Math.floor(i / 9), c = i % 9;
            if ((r + c) % 2 === 0) even.push(i); else odd.push(i);
        }
        const sEven = Utils.shuffleArray(even);
        const sOdd = Utils.shuffleArray(odd);
        return Math.random() > 0.5 ? [...sEven, ...sOdd] : [...sOdd, ...sEven];
    },
    RANDOM: () => {
        const indices = Array.from({ length: 81 }, (_, i) => i);
        return Utils.shuffleArray(indices);
    }
};

/**
 * State Container for a Generation Trial
 */
class GenerationContext {
    constructor(solutionBits) {
        this.solution = new Uint8Array(81);
        for (let i = 0; i < 81; i++) this.solution[i] = Utils.getValue(solutionBits[i]);

        this.grid = new Uint32Array(81);
        this.activeClues = [];
        this.currentHash = 0n;
        this.scratchGrid = new Uint32Array(81);

        for (let i = 0; i < 81; i++) {
            const raw = solutionBits[i];
            const val = this.solution[i];
            const bits = (raw & ~Utils.BIT_SOLUTION_MASK) | (val << Utils.BIT_SOLUTION_SHIFT);
            this.grid[i] = bits;
            this.activeClues.push({ idx: i, bits });
            this.currentHash ^= SudokuDLX.ZOBRIST_TABLE[i * 10 + val];
        }
    }

    fillScratch(clues = this.activeClues) {
        this.scratchGrid.fill(Utils.MASK_CANDIDATES);
        for (const c of clues) {
            const sol = Utils.getSolution(c.bits);
            this.scratchGrid[c.idx] =
                (c.bits & ~Utils.MASK_CANDIDATES) | (1 << (sol - 1)) | Utils.BIT_CONFIRMED;
        }
        return this.scratchGrid;
    }
}

/**
 * Sudoku Generator - Pipeline Orchestrator
 */
class SudokuGenerator {
    static generateSinglePattern(targetRank, patternType = 0) {
        SudokuBitBoard.init();
        SudokuDLX.init();
        let bestResult = null;

        for (let trial = 0; trial < 50; trial++) {
            // Pipeline Step 1: Create Full Solution
            const solutionBits = this.createFullSolution();
            if (!solutionBits) continue;

            const context = new GenerationContext(solutionBits);

            // Pipeline Step 2: Determine Pruning Sequence
            const sequence = this.getPruningSequence(patternType, trial);

            // Pipeline Step 3: Phase 1 - Coarse Pruning & BIT_INF identification
            this.performPhase1Pruning(context, sequence);

            // Pipeline Step 4: Phase 2 - Fine-grained Zobrist Reduction
            const explorer = new ReductionExplorer(context, targetRank);
            const reducedClues = explorer.performSearch(2000);

            // Pipeline Step 5: Finalize and Evaluate
            const result = this.finalizePuzzle(reducedClues, context, sequence.type);

            if (result.rank === targetRank) return result;

            if (!bestResult || Math.abs(result.rank - targetRank) < Math.abs(bestResult.rank - targetRank)) {
                bestResult = result;
            } else if (result.rank === bestResult.rank && result.hints < bestResult.hints) {
                bestResult = result;
            }
        }
        return bestResult;
    }

    static createFullSolution() {
        const solutionBits = new Uint32Array(81);
        let seeds = 0;
        while (seeds < 5) {
            const idx = Math.floor(Math.random() * 81);
            const val = Math.floor(Math.random() * 9) + 1;
            if (Utils.isValid(solutionBits, idx, val)) {
                solutionBits[idx] = Utils.createSolved(val, true);
                seeds++;
            }
        }
        return SudokuDLX.solveAndFill(solutionBits) > 0 ? solutionBits : null;
    }

    static getPruningSequence(patternType, trial) {
        const type = (patternType === -1) ? (trial % 4) : patternType;
        const strategy = [
            PATTERN_STRATEGIES.SYMMETRY,
            PATTERN_STRATEGIES.MIRROR,
            PATTERN_STRATEGIES.CHECKER,
            PATTERN_STRATEGIES.RANDOM
        ][type] || PATTERN_STRATEGIES.RANDOM;
        return { indices: strategy(), type };
    }

    static performPhase1Pruning(context, sequence) {
        SudokuDLX.clearMetaBits();
        const removedFlags = new Uint8Array(81);

        for (const idx of sequence.indices) {
            const clue = context.activeClues.find(c => c.idx === idx);
            if (!clue || (context.grid[idx] & Utils.BIT_INF)) continue;

            const val = Utils.getSolution(clue.bits);
            const impact = this.checkImpactOfRemoval(context.grid, idx);

            if (impact.canRemove) {
                removedFlags[idx] = 1;
                context.grid[idx] &= ~(Utils.BIT_CONFIRMED | Utils.BIT_GIVEN);
                context.currentHash ^= SudokuDLX.ZOBRIST_TABLE[idx * 10 + val];
                for (const infIdx of impact.newlyEssential) context.grid[infIdx] |= Utils.BIT_INF;
            }
        }
        context.activeClues = context.activeClues.filter(c => !removedFlags[c.idx]);
    }

    static checkImpactOfRemoval(grid, targetIdx) {
        const savedTarget = grid[targetIdx];
        grid[targetIdx] &= ~(Utils.BIT_CONFIRMED | Utils.BIT_GIVEN);
        let essentialHitCount = 0;
        let newlyEssential = [];

        for (let i = 0; i < 81; i++) {
            const cell = grid[i];
            if (!Utils.isSolved(cell) || (cell & Utils.BIT_INF)) continue;
            const savedCell = grid[i];
            grid[i] &= ~(Utils.BIT_CONFIRMED | Utils.BIT_GIVEN);
            if (SudokuDLX.countSolutions(grid) > 1) {
                essentialHitCount++;
                newlyEssential.push(i);
            }
            grid[i] = savedCell;
            if (essentialHitCount > 1) break;
        }

        const canRemove = essentialHitCount <= 1;
        if (!canRemove) grid[targetIdx] = savedTarget;
        return { canRemove, newlyEssential };
    }

    static finalizePuzzle(reducedClues, context, patternType) {
        const puzzle = new Uint32Array(81);
        puzzle.fill(Utils.MASK_CANDIDATES);
        reducedClues.forEach(c => {
            const b = c.bits | Utils.BIT_CONFIRMED | Utils.BIT_GIVEN;
            puzzle[c.idx] = (c.bits & Utils.BIT_INF) ? (b | Utils.BIT_INF) : b;
        });

        for (let i = 0; i < 81; i++) puzzle[i] = Utils.setSolution(puzzle[i], context.solution[i]);
        SudokuBitBoard.updateAllCandidates(puzzle);

        const finalEval = DifficultyEvaluator.evaluate(puzzle, 4);
        const patternNames = ['Symmetry', 'Mirror', 'Checker', 'Random'];

        return {
            puzzle,
            hints: reducedClues.length,
            difficulty: finalEval.difficulty,
            rank: finalEval.rank,
            technique: finalEval.technique,
            techniqueCounts: finalEval.techniqueCounts,
            patternName: patternNames[patternType] || 'Random'
        };
    }
}

/**
 * Search Explorer for Phase 2 Reduction
 */
class ReductionExplorer {
    constructor(context, targetRank) {
        this.context = context;
        this.targetRank = targetRank;
    }

    performSearch(iterLimit) {
        let currentClues = this.context.activeClues.map(c => {
            const sol = Utils.getSolution(c.bits);
            let bits = (1 << (sol - 1)) | Utils.BIT_CONFIRMED | Utils.BIT_GIVEN;
            bits |= (sol << Utils.BIT_SOLUTION_SHIFT);
            if (c.bits & Utils.BIT_INF) bits |= Utils.BIT_INF;
            return { idx: c.idx, bits };
        });

        let bestClues = currentClues;
        const getRank = (clues) => DifficultyEvaluator.evaluate(this.context.fillScratch(clues), this.targetRank).rank ?? 1;

        if (getRank(currentClues) === this.targetRank) bestClues = currentClues;

        const visited = new Set([this.context.currentHash]);
        const queue = [{ clues: [...currentClues], hash: this.context.currentHash }];
        let loop = 0;

        while (queue.length > 0 && loop < iterLimit) {
            const state = queue.pop();
            const indices = Utils.shuffleArray(state.clues.map((_, i) => i));

            for (let i of indices) {
                if (++loop >= iterLimit) break;
                const clue = state.clues[i];
                if (clue.bits & Utils.BIT_INF) continue;

                const testGrid = this.context.fillScratch(state.clues);
                const originalVal = testGrid[clue.idx];
                testGrid[clue.idx] = Utils.MASK_CANDIDATES;
                const isUnique = SudokuDLX.countSolutions(testGrid) === 1;
                testGrid[clue.idx] = originalVal;

                if (!isUnique) {
                    clue.bits |= Utils.BIT_INF;
                    continue;
                }

                const sol = Utils.getSolution(clue.bits);
                const nextHash = state.hash ^ SudokuDLX.ZOBRIST_TABLE[clue.idx * 10 + sol];
                if (visited.has(nextHash)) continue;
                visited.add(nextHash);

                const nextClues = state.clues.filter((_, idx) => idx !== i);
                const rank = getRank(nextClues);

                if (rank === this.targetRank) {
                    if (nextClues.length < bestClues.length || getRank(bestClues) < this.targetRank) {
                        bestClues = [...nextClues];
                    }
                }
                if (rank <= this.targetRank) queue.push({ clues: nextClues, hash: nextHash });
            }
        }
        return bestClues;
    }
}
