/**
 * Sudoku Generation Worker (generator.js)
 * Integrates heavy generation algorithms and worker entry point.
 */

import { SudokuBitUtils, SudokuDLX, SudokuLogicalSolver } from './solver.js';
import { TECHNIQUES } from './solver-techniques.js';

// Initialize memory for the worker context
SudokuDLX.allocateMemory();
SudokuLogicalSolver.connectDictionary(TECHNIQUES);
const evalSandbox = SudokuLogicalSolver.createSandbox();

/**
 * Worker Entry Point
 */
self.onmessage = function (e) {
    const { type, taskId, rank, patternType, grid, targetRank } = e.data;

    try {
        if (type === 'GENERATE') {
            const result = SudokuGenerator.generateSinglePattern(rank, patternType);
            if (result) {
                self.postMessage({ type: 'GENERATE_SUCCESS', taskId, result });
            } else {
                self.postMessage({ type: 'ERROR', taskId, message: 'Generation failed' });
            }
        } else if (type === 'ENGINE') {
            const result = SudokuLogicalSolver.evaluate(grid, targetRank, evalSandbox);
            self.postMessage({ type: 'ENGINE_SUCCESS', taskId, result });
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', taskId, message: err.toString() });
    }
};

/**
 * Sudoku Generation Logic (Moved from solver.js)
 */
class SudokuGenerator {
    static generateSinglePattern(targetRank, patternType = 0) {
        SudokuLogicalSolver.init();
        SudokuDLX.init();
        let bestResult = null;

        for (let trial = 0; trial < 50; trial++) {
            const solutionBits = new Uint32Array(81);

            let seeds = 0;
            while (seeds < 5) {
                const idx = Math.floor(Math.random() * 81);
                const val = Math.floor(Math.random() * 9) + 1;
                // 置いても矛盾しない場合のみ採用
                if (SudokuBitUtils.isValid(solutionBits, idx, val)) {
                    solutionBits[idx] = SudokuBitUtils.createSolved(val, true);
                    seeds++;
                }
            }
            SudokuDLX.solveAndFill(solutionBits);
            const solution = new Uint8Array(81);
            for (let i = 0; i < 81; i++) solution[i] = SudokuBitUtils.getValue(solutionBits[i]);

            let activeClues = [];
            let initialHash = 0n;
            for (let i = 0; i < 81; i++) {
                const raw = solutionBits[i];
                const val = SudokuBitUtils.getValue(raw);
                const rawWithSol = (raw & ~SudokuBitUtils.BIT_SOLUTION_MASK) | (val << SudokuBitUtils.BIT_SOLUTION_SHIFT);
                activeClues.push({ idx: i, bits: rawWithSol });
                initialHash ^= SudokuDLX.ZOBRIST_TABLE[i * 10 + val];
            }

            const fillScratchBitGrid = (clues) => {
                SudokuLogicalSolver.SCRATCH_BIT_GRID.fill(SudokuBitUtils.MASK_CANDIDATES);
                for (let i = 0, len = clues.length; i < len; i++) {
                    const c = clues[i];
                    const bits = c.bits;
                    const sol = (bits & SudokuBitUtils.BIT_SOLUTION_MASK) >>> SudokuBitUtils.BIT_SOLUTION_SHIFT;
                    SudokuLogicalSolver.SCRATCH_BIT_GRID[c.idx] =
                        (bits & ~SudokuBitUtils.MASK_CANDIDATES) |
                        (1 << (sol - 1)) |
                        SudokuBitUtils.BIT_CONFIRMED;
                }
                return SudokuLogicalSolver.SCRATCH_BIT_GRID;
            };

            SudokuDLX.clearMetaBits();
            let currentGrid = new Uint32Array(81);
            for (let c of activeClues) currentGrid[c.idx] = c.bits;
            const phase1Removed = new Uint8Array(81);

            let effectivePattern = (patternType === -1) ? (trial % 4) : patternType;
            let phase1Indices = [];
            switch (effectivePattern) {
                case 0: // Symmetry
                    const pairs0 = [];
                    const used0 = new Set();
                    for (let i = 0; i < 81; i++) {
                        if (used0.has(i)) continue;
                        let partner = 80 - i;
                        pairs0.push(i === partner ? [i] : [i, partner]);
                        used0.add(i); used0.add(partner);
                    }
                    phase1Indices = SudokuLogicalSolver.shuffleArray(pairs0).flat();
                    break;
                case 1: // Mirror
                    const pairs1 = [];
                    const used1 = new Set();
                    for (let r = 0; r < 9; r++) {
                        for (let c = 0; c < 9; c++) {
                            let idx = r * 9 + c;
                            if (used1.has(idx)) continue;
                            let partner = r * 9 + (8 - c);
                            pairs1.push(idx === partner ? [idx] : [idx, partner]);
                            used1.add(idx); used1.add(partner);
                        }
                    }
                    phase1Indices = SudokuLogicalSolver.shuffleArray(pairs1).flat();
                    break;
                case 2: // Checker
                    const even = [], odd = [];
                    for (let i = 0; i < 81; i++) {
                        let r = Math.floor(i / 9), c = i % 9;
                        if ((r + c) % 2 === 0) even.push(i); else odd.push(i);
                    }
                    const sEven = SudokuLogicalSolver.shuffleArray(even);
                    const sOdd = SudokuLogicalSolver.shuffleArray(odd);
                    phase1Indices = Math.random() > 0.5 ? [...sEven, ...sOdd] : [...sOdd, ...sEven];
                    break;
                case 3: // Random
                default:
                    phase1Indices = Array.from({ length: 81 }, (_, i) => i);
                    phase1Indices = SudokuLogicalSolver.shuffleArray(phase1Indices);
            }

            for (const origIdx of phase1Indices) {
                const clue = activeClues[origIdx] || { idx: origIdx, bits: currentGrid[origIdx] };
                if (currentGrid[clue.idx] & SudokuBitUtils.BIT_INF) continue;
                const val = (clue.bits & SudokuBitUtils.BIT_SOLUTION_MASK) >>> SudokuBitUtils.BIT_SOLUTION_SHIFT;

                const savedClue = currentGrid[clue.idx];
                currentGrid[clue.idx] &= ~(SudokuBitUtils.BIT_CONFIRMED | SudokuBitUtils.BIT_GIVEN);

                let deltaInf = 0;
                let newlyInfIndices = [];
                for (let j = 0; j < 81; j++) {
                    const cj = currentGrid[j];
                    if (!SudokuBitUtils.isSolved(cj) || (cj & SudokuBitUtils.BIT_INF)) continue;
                    const savedJ = currentGrid[j];
                    currentGrid[j] &= ~(SudokuBitUtils.BIT_CONFIRMED | SudokuBitUtils.BIT_GIVEN);
                    if (SudokuDLX.countSolutions(currentGrid) > 1) {
                        deltaInf++;
                        newlyInfIndices.push(j);
                    }
                    currentGrid[j] = savedJ;
                    if (deltaInf > 1) break;
                }

                if (deltaInf <= 1) {
                    phase1Removed[clue.idx] = 1;
                    initialHash ^= SudokuDLX.ZOBRIST_TABLE[clue.idx * 10 + val];
                    for (const infIdx of newlyInfIndices) currentGrid[infIdx] |= SudokuBitUtils.BIT_INF;
                } else {
                    currentGrid[clue.idx] = savedClue;
                }
            }
            activeClues = activeClues.filter(c => !phase1Removed[c.idx]);

            activeClues = activeClues.map(c => {
                const bits = currentGrid[c.idx];
                const sol = SudokuBitUtils.getSolution(bits);
                let clean = (1 << (sol - 1)) | SudokuBitUtils.BIT_CONFIRMED | SudokuBitUtils.BIT_GIVEN;
                clean |= (sol << SudokuBitUtils.BIT_SOLUTION_SHIFT);
                if (bits & SudokuBitUtils.BIT_INF) clean |= SudokuBitUtils.BIT_INF;
                return { idx: c.idx, bits: clean };
            });

            const maxIterLimit = 2000;
            let resultClues = this._runReduction(activeClues, initialHash, targetRank, maxIterLimit, fillScratchBitGrid);

            const resultPuzzle = new Uint32Array(81);
            resultPuzzle.fill(SudokuBitUtils.MASK_CANDIDATES);
            resultClues.forEach(c => {
                const b = c.bits | SudokuBitUtils.BIT_CONFIRMED | SudokuBitUtils.BIT_GIVEN;
                resultPuzzle[c.idx] = (c.bits & SudokuBitUtils.BIT_INF) ? (b | SudokuBitUtils.BIT_INF) : b;
            });

            for (let i = 0; i < 81; i++) resultPuzzle[i] = SudokuBitUtils.setSolution(resultPuzzle[i], solution[i]);
            SudokuBitUtils.updateAllCandidates(resultPuzzle);
            const finalEval = SudokuLogicalSolver.evaluate(resultPuzzle, 4);

            const result = {
                puzzle: resultPuzzle,
                hints: resultClues.length,
                difficulty: finalEval.difficulty,
                rank: finalEval.rank,
                technique: finalEval.technique,
                techniqueCounts: finalEval.techniqueCounts,
                patternName: ['Symmetry', 'Mirror', 'Checker', 'Random'][effectivePattern] || 'Random'
            };

            if (result.rank === targetRank) return result;
            if (!bestResult || Math.abs(result.rank - targetRank) < Math.abs(bestResult.rank - targetRank)) {
                bestResult = result;
            } else if (result.rank === bestResult.rank && result.hints < bestResult.hints) {
                bestResult = result;
            }
        }
        return bestResult;
    }

    static _runReduction(initialClues, initialHash, targetRank, iterLimit, fillScratchBitGrid) {
        let bestClues = initialClues;
        const currentRank = (clues) => SudokuLogicalSolver.evaluate(fillScratchBitGrid(clues), targetRank).rank ?? 1;

        if (currentRank(initialClues) === targetRank) bestClues = initialClues;

        const visited = new Set([initialHash]);
        const queue = [{ clues: [...initialClues], hash: initialHash, depth: 0 }];
        let loopCount = 0;

        while (queue.length > 0 && loopCount < iterLimit) {
            const state = queue.pop();
            const indices = state.clues.map((_, i) => i);
            SudokuLogicalSolver.shuffleArray(indices);

            for (let i of indices) {
                if (loopCount >= iterLimit) break;
                loopCount++;

                const clue = state.clues[i];
                if (clue.bits & SudokuBitUtils.BIT_INF) continue;

                const gb = fillScratchBitGrid(state.clues);
                const originalVal = gb[clue.idx];
                gb[clue.idx] = SudokuBitUtils.MASK_CANDIDATES;
                const isUnique = SudokuDLX.countSolutions(gb) === 1;
                gb[clue.idx] = originalVal;

                if (!isUnique) {
                    clue.bits |= SudokuBitUtils.BIT_INF;
                    continue;
                }

                const val = (clue.bits & SudokuBitUtils.BIT_SOLUTION_MASK) >>> SudokuBitUtils.BIT_SOLUTION_SHIFT;
                const nextHash = state.hash ^ SudokuDLX.ZOBRIST_TABLE[clue.idx * 10 + val];
                if (visited.has(nextHash)) continue;
                visited.add(nextHash);

                const nextClues = state.clues.filter((_, idx) => idx !== i);
                const rank = currentRank(nextClues);

                if (rank === targetRank) {
                    if (nextClues.length < bestClues.length || currentRank(bestClues) < targetRank) {
                        bestClues = [...nextClues];
                    }
                }
                if (rank <= targetRank) {
                    queue.push({ clues: nextClues, hash: nextHash, depth: state.depth + 1 });
                }
            }
        }
        return bestClues;
    }
}
