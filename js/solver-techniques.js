import { SudokuLogicalSolver, SudokuBitUtils } from './solver.js';

/**
 * Sudoku Solver Techniques Definition
 *
 * Flat static memory model:
 *   solver.unifiedBoard -> Uint32Array(81), index = r*9+c (Single Source of Truth)
 *   solver.setCellValue(idx, val, technique)
 *   solver.difficultyLog.push({ technique, idx, val })
 *
 * House indices: 0-8 rows, 9-17 cols, 18-26 boxes (via SudokuLogicalSolver.HOUSES)
 */

// ===== Bit helpers (via SudokuBitUtils) =====

/**
 * Returns true if two cells share a house.
 * Uses pre-computed CELL_HOUSES for O(1) lookup.
 */
function sees(i, j) {
    if (i === j) return false;
    const ri = (i / 9) | 0, ci = i % 9;
    const rj = (j / 9) | 0, cj = j % 9;
    if (ri === rj || ci === cj) return true;
    return (((ri / 3) | 0) === ((rj / 3) | 0) && ((ci / 3) | 0) === ((cj / 3) | 0));
}

// ===== Technique Definitions =====

export const TECHNIQUES = [

    // ----- BASIC -----

    {
        id: 'nakedSingle',
        name: 'Naked Single',
        rank: 1,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            for (let i = 0; i < 81; i++) {

                if (!bb.has(0, i) && SudokuBitUtils.popcount(bb.getCellMask(i)) === 1) return true;
            }
            return false;
        },
        applyLogical: function (solver, silent = false) {
            let changed = false;
            const bb = solver.bb;
            for (let i = 0; i < 81; i++) {
                if (bb.has(0, i)) continue;
                const mask = bb.getCellMask(i);
                if (SudokuBitUtils.popcount(mask) === 1) {
                    const digit = SudokuBitUtils.bitToDigit(mask);
                    // Critical for silent mode: check validity before filling to avoid duplicates
                    if (SudokuBitUtils.isValid(bb, i, digit)) {
                        solver.setCellValue(i, digit, 'Naked Single', silent);
                        changed = true;
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'hiddenSingle',
        name: 'Hidden Single',
        rank: 1,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const HM = SudokuLogicalSolver.HOUSE_MASKS;
            for (let h = 0; h < 27; h++) {
                const h0 = HM[h * 3], h1 = HM[h * 3 + 1], h2 = HM[h * 3 + 2];
                for (let d = 1; d <= 9; d++) {
                    if (bb.houseCount(d, h0, h1, h2) === 1) {
                        const idx = bb.houseFirstCell(d, h0, h1, h2);
                        if (idx >= 0 && !bb.has(0, idx)) return true;
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver, silent = false) {
            let changed = false;
            const bb = solver.bb;
            const HM = SudokuLogicalSolver.HOUSE_MASKS;

            for (let h = 0; h < 27; h++) {
                const h0 = HM[h * 3], h1 = HM[h * 3 + 1], h2 = HM[h * 3 + 2];
                for (let d = 1; d <= 9; d++) {
                    if (bb.houseCount(d, h0, h1, h2) !== 1) continue;
                    const idx = bb.houseFirstCell(d, h0, h1, h2);
                    if (idx < 0 || bb.has(0, idx)) continue;
                    if (SudokuBitUtils.isValid(bb, idx, d)) {
                        solver.setCellValue(idx, d, 'Hidden Single', silent);
                        changed = true;
                    }
                }
            }
            return changed;
        }
    },

    // ----- EASY -----

    {
        id: 'lockedCandidates',
        name: 'Locked Candidates',
        rank: 2,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            // Pointing
            for (let box = 0; box < 9; box++) {
                for (let d = 1; d <= 9; d++) {
                    const bit = 1 << (d - 1);
                    const boxBase = (18 + box) * 9;
                    const HOUSES = SudokuLogicalSolver.HOUSES;
                    let rowMask = 0, colMask = 0, count = 0;
                    for (let j = 0; j < 9; j++) {
                        const idx = HOUSES[boxBase + j];
                        if (!bb.has(0, idx) && (bb.getCellMask(idx) & bit)) {
                            rowMask |= 1 << ((idx / 9) | 0);
                            colMask |= 1 << (idx % 9);
                            count++;
                        }
                    }
                    if (count < 2 || count > 3) continue;
                    if (SudokuBitUtils.popcount(rowMask) === 1) {
                        const r = SudokuBitUtils.bitToDigit(rowMask) - 1;
                        const rColMask = bb.rowMask(d, r);
                        let cm = rColMask;
                        while (cm) {
                            const cb = cm & -cm; cm ^= cb;
                            const c = SudokuBitUtils.bitToDigit(cb) - 1;
                            if (((r / 3 | 0) * 3 + (c / 3 | 0)) !== box) return true;
                        }
                    }
                    if (SudokuBitUtils.popcount(colMask) === 1) {
                        const c = SudokuBitUtils.bitToDigit(colMask) - 1;
                        const cRowMask = bb.colMask(d, c);
                        let rm = cRowMask;
                        while (rm) {
                            const rb = rm & -rb; rm ^= rb;
                            const r = SudokuBitUtils.bitToDigit(rb) - 1;
                            if (((r / 3 | 0) * 3 + (c / 3 | 0)) !== box) return true;
                        }
                    }
                }
            }
            // Claiming
            for (let d = 1; d <= 9; d++) {
                for (let r = 0; r < 9; r++) {
                    const rMask = bb.rowMask(d, r);
                    if (SudokuBitUtils.popcount(rMask) < 2 || SudokuBitUtils.popcount(rMask) > 3) continue;
                    const boxColBit = (1 << ((SudokuBitUtils.bitToDigit(rMask & -rMask) - 1) / 3 | 0));
                    let allSameBox = true;
                    let cm = rMask;
                    while (cm) { const cb = cm & -cm; cm ^= cb; if ((1 << ((SudokuBitUtils.bitToDigit(cb) - 1) / 3 | 0)) !== boxColBit) { allSameBox = false; break; } }
                    if (!allSameBox) continue;
                    const boxIdx = (r / 3 | 0) * 3 + (SudokuBitUtils.bitToDigit(boxColBit) - 1);
                    const HOUSES = SudokuLogicalSolver.HOUSES;
                    const hb = (18 + boxIdx) * 9;
                    for (let j = 0; j < 9; j++) {
                        const idx = HOUSES[hb + j];
                        if ((idx / 9 | 0) !== r && !bb.has(0, idx) && (bb.getCellMask(idx) & (1 << (d - 1)))) return true;
                    }
                }
                for (let c = 0; c < 9; c++) {
                    const cMask = bb.colMask(d, c);
                    if (SudokuBitUtils.popcount(cMask) < 2 || SudokuBitUtils.popcount(cMask) > 3) continue;
                    const boxRowBit = (1 << ((SudokuBitUtils.bitToDigit(cMask & -cMask) - 1) / 3 | 0));
                    let allSameBox = true;
                    let rm = cMask;
                    while (rm) { const rb = rm & -rb; rm ^= rb; if ((1 << ((SudokuBitUtils.bitToDigit(rb) - 1) / 3 | 0)) !== boxRowBit) { allSameBox = false; break; } }
                    if (!allSameBox) continue;
                    const boxIdx = (SudokuBitUtils.bitToDigit(boxRowBit) - 1) * 3 + (c / 3 | 0);
                    const HOUSES = SudokuLogicalSolver.HOUSES;
                    const hb = (18 + boxIdx) * 9;
                    for (let j = 0; j < 9; j++) {
                        const idx = HOUSES[hb + j];
                        if (idx % 9 !== c && !bb.has(0, idx) && (bb.getCellMask(idx) & (1 << (d - 1)))) return true;
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            // 1. Pointing: box -> row/col
            for (let box = 0; box < 9; box++) {
                for (let d = 1; d <= 9; d++) {
                    const bit = 1 << (d - 1);
                    const rm = bb.rowMask(d, Math.floor(box / 3) * 3);  // dummy — use box scan
                    // Gather row/col coverage of digit d within this box
                    const boxBase = (18 + box) * 9;
                    const HOUSES = SudokuLogicalSolver.HOUSES;
                    let rowMask = 0, colMask = 0, count = 0;
                    for (let j = 0; j < 9; j++) {
                        const idx = HOUSES[boxBase + j];
                        if (!bb.has(0, idx) && (bb.getCellMask(idx) & bit)) {
                            rowMask |= 1 << ((idx / 9) | 0);
                            colMask |= 1 << (idx % 9);
                            count++;
                        }
                    }
                    if (count < 2 || count > 3) continue;

                    if (SudokuBitUtils.popcount(rowMask) === 1) {
                        const r = SudokuBitUtils.bitToDigit(rowMask) - 1;
                        const rColMask = bb.rowMask(d, r);
                        let cm = rColMask;
                        while (cm) {
                            const cb = cm & -cm; cm ^= cb;
                            const c = SudokuBitUtils.bitToDigit(cb) - 1;
                            if (((r / 3 | 0) * 3 + (c / 3 | 0)) !== box) {
                                const idx = r * 9 + c;
                                solver.clearCandidate(idx, d);
                                solver.difficultyLog.push({ technique: 'Locked Candidates (Pointing)', idx, val: d });
                                changed = true;
                            }
                        }
                    }
                    if (SudokuBitUtils.popcount(colMask) === 1) {
                        const c = SudokuBitUtils.bitToDigit(colMask) - 1;
                        const cRowMask = bb.colMask(d, c);
                        let rm2 = cRowMask;
                        while (rm2) {
                            const rb = rm2 & -rm2; rm2 ^= rb;
                            const r = SudokuBitUtils.bitToDigit(rb) - 1;
                            if (((r / 3 | 0) * 3 + (c / 3 | 0)) !== box) {
                                const idx = r * 9 + c;
                                solver.clearCandidate(idx, d);
                                solver.difficultyLog.push({ technique: 'Locked Candidates (Pointing)', idx, val: d });
                                changed = true;
                            }
                        }
                    }
                }
            }

            // 2. Claiming: row/col -> box
            for (let d = 1; d <= 9; d++) {
                // Row claiming
                for (let r = 0; r < 9; r++) {
                    const rMask = bb.rowMask(d, r);
                    if (!rMask) continue;
                    const cnt = SudokuBitUtils.popcount(rMask);
                    if (cnt < 2 || cnt > 3) continue;
                    // Check if all candidates are in one box-column
                    const boxColBit = (1 << ((SudokuBitUtils.bitToDigit(rMask & -rMask) - 1) / 3 | 0));
                    let allSameBox = true;
                    let cm2 = rMask;
                    while (cm2) { const cb = cm2 & -cm2; cm2 ^= cb; if ((1 << ((SudokuBitUtils.bitToDigit(cb) - 1) / 3 | 0)) !== boxColBit) { allSameBox = false; break; } }
                    if (!allSameBox) continue;
                    const boxIdx = (r / 3 | 0) * 3 + (SudokuBitUtils.bitToDigit(boxColBit) - 1);
                    const HOUSES = SudokuLogicalSolver.HOUSES;
                    const hb = (18 + boxIdx) * 9;
                    for (let j = 0; j < 9; j++) {
                        const idx = HOUSES[hb + j];
                        if ((idx / 9 | 0) !== r && !bb.has(0, idx) && (bb.getCellMask(idx) & (1 << (d - 1)))) {
                            solver.clearCandidate(idx, d);
                            solver.difficultyLog.push({ technique: 'Locked Candidates (Claiming)', idx, val: d });
                            changed = true;
                        }
                    }
                }
                // Col claiming
                for (let c = 0; c < 9; c++) {
                    const cMask = bb.colMask(d, c);
                    if (!cMask) continue;
                    const cnt = SudokuBitUtils.popcount(cMask);
                    if (cnt < 2 || cnt > 3) continue;
                    const boxRowBit = (1 << ((SudokuBitUtils.bitToDigit(cMask & -cMask) - 1) / 3 | 0));
                    let allSameBox = true;
                    let rm3 = cMask;
                    while (rm3) { const rb = rm3 & -rm3; rm3 ^= rb; if ((1 << ((SudokuBitUtils.bitToDigit(rb) - 1) / 3 | 0)) !== boxRowBit) { allSameBox = false; break; } }
                    if (!allSameBox) continue;
                    const boxIdx2 = (SudokuBitUtils.bitToDigit(boxRowBit) - 1) * 3 + (c / 3 | 0);
                    const HOUSES = SudokuLogicalSolver.HOUSES;
                    const hb2 = (18 + boxIdx2) * 9;
                    for (let j = 0; j < 9; j++) {
                        const idx = HOUSES[hb2 + j];
                        if (idx % 9 !== c && !bb.has(0, idx) && (bb.getCellMask(idx) & (1 << (d - 1)))) {
                            solver.clearCandidate(idx, d);
                            solver.difficultyLog.push({ technique: 'Locked Candidates (Claiming)', idx, val: d });
                            changed = true;
                        }
                    }
                }
            }
            return changed;
        }
    },

    // ----- MEDIUM -----

    {
        id: 'nakedPair',
        name: 'Naked Pair',
        rank: 3,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;
            for (let h = 0; h < 27; h++) {
                const hBase = h * 9;
                for (let i = 0; i < 9; i++) {
                    const idx1 = HOUSES[hBase + i];
                    const c1 = bb.getCellMask(idx1);
                    if (bb.has(0, idx1) || SudokuBitUtils.popcount(c1) !== 2) continue;
                    for (let j = i + 1; j < 9; j++) {
                        const idx2 = HOUSES[hBase + j];

                        if (!bb.has(0, idx2) && (bb.getCellMask(idx2) & SudokuBitUtils.MASK_CANDIDATES) === c1) {
                            for (let k = 0; k < 9; k++) {
                                if (k === i || k === j) continue;
                                const targetIdx = HOUSES[hBase + k];

                                if (!bb.has(0, targetIdx) && (bb.getCellMask(targetIdx) & c1)) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                for (let i = 0; i < 9; i++) {
                    const idx1 = HOUSES[houseBase + i];
                    const c1 = bb.getCellMask(idx1);
                    if (bb.has(0, idx1) || SudokuBitUtils.popcount(c1) !== 2) continue;

                    for (let j = i + 1; j < 9; j++) {
                        const idx2 = HOUSES[houseBase + j];

                        if (!bb.has(0, idx2) && (bb.getCellMask(idx2) & SudokuBitUtils.MASK_CANDIDATES) === c1) {
                            const nc = ~c1;
                            for (let k = 0; k < 9; k++) {
                                if (k === i || k === j) continue;
                                const idxElim = HOUSES[houseBase + k];
                                if (!bb.has(0, idxElim) && (bb.getCellMask(idxElim) & c1)) {
                                    solver.clearCandidates(idxElim, c1);
                                    solver.difficultyLog.push({ technique: 'Naked Pair', idx: idxElim, val: 0 });
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'hiddenPair',
        name: 'Hidden Pair',
        rank: 3,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;
            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);
                for (let d1 = 1; d1 <= 8; d1++) {
                    const p1 = bb.housePosMask(d1, houseCells);
                    if (SudokuBitUtils.popcount(p1) !== 2) continue;
                    for (let d2 = d1 + 1; d2 <= 9; d2++) {
                        if (bb.housePosMask(d2, houseCells) !== p1) continue;
                        const pairMask = (1 << (d1 - 1)) | (1 << (d2 - 1));
                        let pm = p1;
                        while (pm) {
                            const bitPos = pm & -pm; pm ^= bitPos;
                            const idx = HOUSES[houseBase + SudokuBitUtils.bitToDigit(bitPos) - 1];
                            if (bb.getCellMask(idx) & ~pairMask & SudokuBitUtils.MASK_CANDIDATES) return true;
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);

                for (let d1 = 1; d1 <= 8; d1++) {
                    const p1 = bb.housePosMask(d1, houseCells);
                    if (SudokuBitUtils.popcount(p1) !== 2) continue;
                    for (let d2 = d1 + 1; d2 <= 9; d2++) {
                        if (bb.housePosMask(d2, houseCells) !== p1) continue;
                        const keepMask = (1 << (d1 - 1)) | (1 << (d2 - 1));
                        let pm = p1;
                        while (pm) {
                            const bitPos = pm & -pm; pm ^= bitPos;
                            const idx = HOUSES[houseBase + SudokuBitUtils.bitToDigit(bitPos) - 1];
                            if (bb.getCellMask(idx) & ~keepMask & SudokuBitUtils.MASK_CANDIDATES) {
                                solver.clearCandidates(idx, ~keepMask & SudokuBitUtils.MASK_CANDIDATES);
                                solver.difficultyLog.push({ technique: 'Hidden Pair', idx, val: 0 });
                                changed = true;
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'nakedTriple',
        name: 'Naked Triple',
        rank: 3,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;
            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);
                const cells = [];
                for (let j = 0; j < 9; j++) {
                    const idx = houseCells[j];
                    const c = bb.getCellMask(idx);

                    if (!bb.has(0, idx) && SudokuBitUtils.popcount(c) >= 2 && SudokuBitUtils.popcount(c) <= 3) {
                        cells.push({ idx, mask: c });
                    }
                }
                if (cells.length < 3) continue;
                for (let i = 0; i < cells.length; i++) {
                    for (let j = i + 1; j < cells.length; j++) {
                        for (let k = j + 1; k < cells.length; k++) {
                            const union = cells[i].mask | cells[j].mask | cells[k].mask;
                            if (SudokuBitUtils.popcount(union) === 3) {
                                for (let j2 = 0; j2 < 9; j2++) {
                                    const targetIdx = houseCells[j2];
                                    if (targetIdx === cells[i].idx || targetIdx === cells[j].idx || targetIdx === cells[k].idx) continue;
                                    if (!bb.has(0, targetIdx) && (bb.getCellMask(targetIdx) & union)) return true;
                                }
                            }
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const cells = [];
                for (let j = 0; j < 9; j++) {
                    const idx = HOUSES[houseBase + j];
                    const mask = bb.getCellMask(idx);
                    const cnt = SudokuBitUtils.popcount(mask);
                    if (!bb.has(0, idx) && cnt >= 2 && cnt <= 3) {
                        cells.push({ idx, mask });
                    }
                }
                if (cells.length < 3) continue;

                for (let i = 0; i < cells.length; i++) {
                    for (let j = i + 1; j < cells.length; j++) {
                        for (let k = j + 1; k < cells.length; k++) {
                            const union = cells[i].mask | cells[j].mask | cells[k].mask;
                            if (SudokuBitUtils.popcount(union) === 3) {
                                for (let l = 0; l < 9; l++) {
                                    const idx = HOUSES[houseBase + l];
                                    if (idx === cells[i].idx || idx === cells[j].idx || idx === cells[k].idx) continue;
                                    if (!bb.has(0, idx) && (bb.getCellMask(idx) & union)) {
                                        solver.clearCandidates(idx, union);
                                        solver.difficultyLog.push({ technique: 'Naked Triple', idx, val: 0 });
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'hiddenTriple',
        name: 'Hidden Triple',
        rank: 3,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;
            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);
                const cands = [];
                for (let d = 1; d <= 9; d++) {
                    const p = bb.housePosMask(d, houseCells);
                    if (p && SudokuBitUtils.popcount(p) >= 2 && SudokuBitUtils.popcount(p) <= 3) cands.push({ d, p });
                }
                if (cands.length < 3) continue;
                for (let i = 0; i < cands.length; i++) {
                    for (let j = i + 1; j < cands.length; j++) {
                        for (let k = j + 1; k < cands.length; k++) {
                            const uPos = cands[i].p | cands[j].p | cands[k].p;
                            if (SudokuBitUtils.popcount(uPos) !== 3) continue;
                            const keepMask = (1 << (cands[i].d - 1)) | (1 << (cands[j].d - 1)) | (1 << (cands[k].d - 1));
                            let pm = uPos;
                            while (pm) {
                                const bitPos = pm & -pm; pm ^= bitPos;
                                const idx = HOUSES[houseBase + SudokuBitUtils.bitToDigit(bitPos) - 1];
                                if (bb.getCellMask(idx) & ~keepMask & SudokuBitUtils.MASK_CANDIDATES) return true;
                            }
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuLogicalSolver.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);

                const cands = [];
                for (let d = 1; d <= 9; d++) {
                    const p = bb.housePosMask(d, houseCells);
                    if (p && SudokuBitUtils.popcount(p) >= 2 && SudokuBitUtils.popcount(p) <= 3) cands.push({ d, p });
                }
                if (cands.length < 3) continue;

                for (let i = 0; i < cands.length; i++) {
                    for (let j = i + 1; j < cands.length; j++) {
                        for (let k = j + 1; k < cands.length; k++) {
                            const uPos = cands[i].p | cands[j].p | cands[k].p;
                            if (SudokuBitUtils.popcount(uPos) !== 3) continue;
                            const keepMask = (1 << (cands[i].d - 1)) | (1 << (cands[j].d - 1)) | (1 << (cands[k].d - 1));
                            let pm = uPos;
                            while (pm) {
                                const bitPos = pm & -pm; pm ^= bitPos;
                                const idx = HOUSES[houseBase + SudokuBitUtils.bitToDigit(bitPos) - 1];
                                if (bb.getCellMask(idx) & ~keepMask & SudokuBitUtils.MASK_CANDIDATES) {
                                    solver.clearCandidates(idx, ~keepMask & SudokuBitUtils.MASK_CANDIDATES);
                                    solver.difficultyLog.push({ technique: 'Hidden Triple', idx, val: 0 });
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    // ----- HARD -----

    {
        id: 'xWing',
        name: 'X-Wing',
        rank: 4,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            for (let d = 1; d <= 9; d++) {
                // Row-based
                for (let r1 = 0; r1 < 8; r1++) {
                    const m1 = bb.rowMask(d, r1);
                    if (SudokuBitUtils.popcount(m1) !== 2) continue;
                    for (let r2 = r1 + 1; r2 < 9; r2++) {
                        if (bb.rowMask(d, r2) !== m1) continue;
                        let cm = m1;
                        while (cm) {
                            const cb = cm & -cm; cm ^= cb;
                            const c = SudokuBitUtils.bitToDigit(cb) - 1;
                            const colRowMask = bb.colMask(d, c);
                            if (SudokuBitUtils.popcount(colRowMask & ~(1 << r1 | 1 << r2)) > 0) return true;
                        }
                    }
                }
                // Col-based
                for (let c1 = 0; c1 < 8; c1++) {
                    const m1 = bb.colMask(d, c1);
                    if (SudokuBitUtils.popcount(m1) !== 2) continue;
                    for (let c2 = c1 + 1; c2 < 9; c2++) {
                        if (bb.colMask(d, c2) !== m1) continue;
                        let rm = m1;
                        while (rm) {
                            const rb = rm & -rm; rm ^= rb;
                            const r = SudokuBitUtils.bitToDigit(rb) - 1;
                            const rowColMask = bb.rowMask(d, r);
                            if (SudokuBitUtils.popcount(rowColMask & ~(1 << c1 | 1 << c2)) > 0) return true;
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let d = 1; d <= 9; d++) {
                // Row-based X-Wing: rowMask(d,r) gives 9-bit column presence
                for (let r1 = 0; r1 < 8; r1++) {
                    const m1 = bb.rowMask(d, r1);
                    if (SudokuBitUtils.popcount(m1) !== 2) continue;
                    for (let r2 = r1 + 1; r2 < 9; r2++) {
                        if (bb.rowMask(d, r2) !== m1) continue;
                        let cm = m1;
                        while (cm) {
                            const cb = cm & -cm; cm ^= cb;
                            const c = SudokuBitUtils.bitToDigit(cb) - 1;
                            for (let r = 0; r < 9; r++) {
                                if (r === r1 || r === r2) continue;
                                const idx = r * 9 + c;
                                if (!bb.has(0, idx) && bb.has(d, idx)) {
                                    solver.clearCandidate(idx, d);
                                    solver.difficultyLog.push({ technique: 'X-Wing', idx, val: d });
                                    changed = true;
                                }
                            }
                        }
                    }
                }
                // Col-based X-Wing
                for (let c1 = 0; c1 < 8; c1++) {
                    const m1 = bb.colMask(d, c1);
                    if (SudokuBitUtils.popcount(m1) !== 2) continue;
                    for (let c2 = c1 + 1; c2 < 9; c2++) {
                        if (bb.colMask(d, c2) !== m1) continue;
                        let rm = m1;
                        while (rm) {
                            const rb = rm & -rm; rm ^= rb;
                            const r = SudokuBitUtils.bitToDigit(rb) - 1;
                            for (let c = 0; c < 9; c++) {
                                if (c === c1 || c === c2) continue;
                                const idx = r * 9 + c;
                                if (!bb.has(0, idx) && bb.has(d, idx)) {
                                    solver.clearCandidate(idx, d);
                                    solver.difficultyLog.push({ technique: 'X-Wing', idx, val: d });
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'swordfish',
        name: 'Swordfish',
        rank: 4,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            for (let d = 1; d <= 9; d++) {
                const rowMasks = new Uint32Array(9);
                const colMasks = new Uint32Array(9);
                for (let i = 0; i < 9; i++) {
                    rowMasks[i] = bb.rowMask(d, i);
                    colMasks[i] = bb.colMask(d, i);
                }
                for (let r1 = 0; r1 < 7; r1++) {
                    if (SudokuBitUtils.popcount(rowMasks[r1]) < 2 || SudokuBitUtils.popcount(rowMasks[r1]) > 3) continue;
                    for (let r2 = r1 + 1; r2 < 8; r2++) {
                        if (SudokuBitUtils.popcount(rowMasks[r2]) < 2 || SudokuBitUtils.popcount(rowMasks[r1] | rowMasks[r2]) > 3) continue;
                        for (let r3 = r2 + 1; r3 < 9; r3++) {
                            const union = rowMasks[r1] | rowMasks[r2] | rowMasks[r3];
                            if (SudokuBitUtils.popcount(union) === 3) {
                                let cm = union;
                                while (cm) {
                                    const cb = cm & -cm; cm ^= cb;
                                    const c = SudokuBitUtils.bitToDigit(cb) - 1;
                                    for (let r = 0; r < 9; r++) {
                                        if (r !== r1 && r !== r2 && r !== r3 && !bb.has(0, r * 9 + c) && bb.has(d, r * 9 + c)) return true;
                                    }
                                }
                            }
                        }
                    }
                }
                for (let c1 = 0; c1 < 7; c1++) {
                    if (SudokuBitUtils.popcount(colMasks[c1]) < 2 || SudokuBitUtils.popcount(colMasks[c1]) > 3) continue;
                    for (let c2 = c1 + 1; c2 < 8; c2++) {
                        if (SudokuBitUtils.popcount(colMasks[c2]) < 2 || SudokuBitUtils.popcount(colMasks[c1] | colMasks[c2]) > 3) continue;
                        for (let c3 = c2 + 1; c3 < 9; c3++) {
                            const union = colMasks[c1] | colMasks[c2] | colMasks[c3];
                            if (SudokuBitUtils.popcount(union) === 3) {
                                let rm = union;
                                while (rm) {
                                    const rb = rm & -rb; rm ^= rb;
                                    const r = SudokuBitUtils.bitToDigit(rb) - 1;
                                    for (let c = 0; c < 9; c++) {
                                        if (c !== c1 && c !== c2 && c !== c3 && !bb.has(0, r * 9 + c) && bb.has(d, r * 9 + c)) return true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let d = 1; d <= 9; d++) {
                // Build row/col masks via bb (no 81-cell scan)
                const rowMasks = new Uint32Array(9);
                const colMasks = new Uint32Array(9);
                for (let r = 0; r < 9; r++) rowMasks[r] = bb.rowMask(d, r);
                for (let c = 0; c < 9; c++) colMasks[c] = bb.colMask(d, c);

                // Row Swordfish
                for (let r1 = 0; r1 < 7; r1++) {
                    if (!rowMasks[r1] || SudokuBitUtils.popcount(rowMasks[r1]) > 3) continue;
                    for (let r2 = r1 + 1; r2 < 8; r2++) {
                        if (!rowMasks[r2] || SudokuBitUtils.popcount(rowMasks[r1] | rowMasks[r2]) > 3) continue;
                        for (let r3 = r2 + 1; r3 < 9; r3++) {
                            const union = rowMasks[r1] | rowMasks[r2] | rowMasks[r3];
                            if (SudokuBitUtils.popcount(union) !== 3) continue;
                            if (SudokuBitUtils.popcount(rowMasks[r1]) < 2 || SudokuBitUtils.popcount(rowMasks[r2]) < 2 || SudokuBitUtils.popcount(rowMasks[r3]) < 2) continue;
                            let cm = union;
                            while (cm) {
                                const cb = cm & -cm; cm ^= cb;
                                const c = SudokuBitUtils.bitToDigit(cb) - 1;
                                for (let r = 0; r < 9; r++) {
                                    if (r === r1 || r === r2 || r === r3) continue;
                                    const idx = r * 9 + c;
                                    if (!bb.has(0, idx) && bb.has(d, idx)) {
                                        solver.clearCandidate(idx, d);
                                        solver.difficultyLog.push({ technique: 'Swordfish', idx, val: d });
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }

                // Col Swordfish
                for (let c1 = 0; c1 < 7; c1++) {
                    if (!colMasks[c1] || SudokuBitUtils.popcount(colMasks[c1]) > 3) continue;
                    for (let c2 = c1 + 1; c2 < 8; c2++) {
                        if (!colMasks[c2] || SudokuBitUtils.popcount(colMasks[c1] | colMasks[c2]) > 3) continue;
                        for (let c3 = c2 + 1; c3 < 9; c3++) {
                            const union = colMasks[c1] | colMasks[c2] | colMasks[c3];
                            if (SudokuBitUtils.popcount(union) !== 3) continue;
                            if (SudokuBitUtils.popcount(colMasks[c1]) < 2 || SudokuBitUtils.popcount(colMasks[c2]) < 2 || SudokuBitUtils.popcount(colMasks[c3]) < 2) continue;
                            let rm = union;
                            while (rm) {
                                const rb = rm & -rm; rm ^= rb;
                                const r = SudokuBitUtils.bitToDigit(rb) - 1;
                                for (let c = 0; c < 9; c++) {
                                    if (c === c1 || c === c2 || c === c3) continue;
                                    const idx = r * 9 + c;
                                    if (!bb.has(0, idx) && bb.has(d, idx)) {
                                        solver.clearCandidate(idx, d);
                                        solver.difficultyLog.push({ technique: 'Swordfish', idx, val: d });
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'yWing',
        name: 'Y-Wing',
        rank: 4,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const biCells = [];
            for (let i = 0; i < 81; i++) {
                const c = bb.getCellMask(i);
                if (!bb.has(0, i) && SudokuBitUtils.popcount(c) === 2) biCells.push({ idx: i, mask: c });
            }
            for (let i = 0; i < biCells.length; i++) {
                const p = biCells[i];
                for (let j = 0; j < biCells.length; j++) {
                    if (i === j) continue;
                    const w1 = biCells[j];
                    if (!sees(p.idx, w1.idx)) continue;
                    for (let k = j + 1; k < biCells.length; k++) {
                        if (k === i) continue;
                        const w2 = biCells[k];
                        if (!sees(p.idx, w2.idx)) continue;
                        const union = p.mask | w1.mask | w2.mask;
                        if (SudokuBitUtils.popcount(union) === 3) {
                            if (SudokuBitUtils.popcount(p.mask & w1.mask) === 1 &&
                                SudokuBitUtils.popcount(p.mask & w2.mask) === 1 &&
                                SudokuBitUtils.popcount(w1.mask & w2.mask) === 1) {
                                const zBit = w1.mask & w2.mask;
                                for (let target = 0; target < 81; target++) {
                                    if (target !== w1.idx && target !== w2.idx && target !== p.idx && !bb.has(0, target) && (bb.getCellMask(target) & zBit) && sees(target, w1.idx) && sees(target, w2.idx)) return true;
                                }
                            }
                        }
                    }
                }
            }
            return false;
        },
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            const biCells = [];
            for (let i = 0; i < 81; i++) {
                const c = bb.getCellMask(i);
                if (!bb.has(0, i) && SudokuBitUtils.popcount(c) === 2) {
                    biCells.push({ idx: i, mask: c });
                }
            }

            for (let i = 0; i < biCells.length; i++) {
                const p = biCells[i];
                for (let j = 0; j < biCells.length; j++) {
                    if (i === j) continue;
                    const w1 = biCells[j];
                    if (!sees(p.idx, w1.idx)) continue;

                    for (let k = j + 1; k < biCells.length; k++) {
                        if (k === i) continue;
                        const w2 = biCells[k];
                        if (!sees(p.idx, w2.idx)) continue;

                        // Bit-Native XY-Wing Logic: Pivot XY, Wings XZ, YZ -> Union XYZ (popcount 3)
                        const union = p.mask | w1.mask | w2.mask;
                        if (SudokuBitUtils.popcount(union) === 3) {
                            // Ensure each wing shares exactly one digit with pivot and one with other wing
                            if (SudokuBitUtils.popcount(p.mask & w1.mask) === 1 &&
                                SudokuBitUtils.popcount(p.mask & w2.mask) === 1 &&
                                SudokuBitUtils.popcount(w1.mask & w2.mask) === 1) {

                                const zBit = w1.mask & w2.mask;
                                const dZ = SudokuBitUtils.bitToDigit(zBit);

                                for (let target = 0; target < 81; target++) {
                                    if (target === w1.idx || target === w2.idx || target === p.idx) continue;
                                    if (bb.has(0, target)) continue;
                                    if (!(bb.getCellMask(target) & zBit)) continue;

                                    if (sees(target, w1.idx) && sees(target, w2.idx)) {
                                        solver.clearCandidate(target, dZ);
                                        solver.difficultyLog.push({ technique: 'Y-Wing', idx: target, val: dZ });
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'skyscraper',
        name: 'Skyscraper',
        rank: 4,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            for (let d = 1; d <= 9; d++) {
                // Column-based Skyscraper
                const colPairs = [];
                for (let c = 0; c < 9; c++) {
                    const rowMask = bb.colMask(d, c);
                    if (SudokuBitUtils.popcount(rowMask) === 2) colPairs.push({ c, rowMask });
                }
                for (let i = 0; i < colPairs.length; i++) {
                    for (let j = i + 1; j < colPairs.length; j++) {
                        const shared = colPairs[i].rowMask & colPairs[j].rowMask;
                        if (SudokuBitUtils.popcount(shared) !== 1) continue;
                        const uniqueA = colPairs[i].rowMask ^ shared;
                        const uniqueB = colPairs[j].rowMask ^ shared;
                        const rA = SudokuBitUtils.bitToDigit(uniqueA) - 1;
                        const rB = SudokuBitUtils.bitToDigit(uniqueB) - 1;
                        const cA = colPairs[i].c, cB = colPairs[j].c;
                        for (let k = 0; k < 81; k++) {
                            if (bb.has(0, k) || !bb.has(d, k)) continue;
                            if (k === rA * 9 + cA || k === rB * 9 + cB) continue;
                            if (sees(k, rA * 9 + cA) && sees(k, rB * 9 + cB)) return true;
                        }
                    }
                }
                // Row-based Skyscraper
                const rowPairs = [];
                for (let r = 0; r < 9; r++) {
                    const colMask = bb.rowMask(d, r);
                    if (SudokuBitUtils.popcount(colMask) === 2) rowPairs.push({ r, colMask });
                }
                for (let i = 0; i < rowPairs.length; i++) {
                    for (let j = i + 1; j < rowPairs.length; j++) {
                        const shared = rowPairs[i].colMask & rowPairs[j].colMask;
                        if (SudokuBitUtils.popcount(shared) !== 1) continue;
                        const uniqueA = rowPairs[i].colMask ^ shared;
                        const uniqueB = rowPairs[j].colMask ^ shared;
                        const cA = SudokuBitUtils.bitToDigit(uniqueA) - 1;
                        const cB = SudokuBitUtils.bitToDigit(uniqueB) - 1;
                        const rA = rowPairs[i].r, rB = rowPairs[j].r;
                        for (let k = 0; k < 81; k++) {
                            if (bb.has(0, k) || !bb.has(d, k)) continue;
                            if (k === rA * 9 + cA || k === rB * 9 + cB) continue;
                            if (sees(k, rA * 9 + cA) && sees(k, rB * 9 + cB)) return true;
                        }
                    }
                }
            }
            return false;
        },

        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            for (let d = 1; d <= 9; d++) {
                // Column-based Skyscraper
                const colPairs = [];
                for (let c = 0; c < 9; c++) {
                    const rowMask = bb.colMask(d, c);
                    if (SudokuBitUtils.popcount(rowMask) === 2) colPairs.push({ c, rowMask });
                }
                for (let i = 0; i < colPairs.length; i++) {
                    for (let j = i + 1; j < colPairs.length; j++) {
                        const shared = colPairs[i].rowMask & colPairs[j].rowMask;
                        if (SudokuBitUtils.popcount(shared) !== 1) continue;
                        const uniqueA = colPairs[i].rowMask ^ shared;
                        const uniqueB = colPairs[j].rowMask ^ shared;
                        const rA = SudokuBitUtils.bitToDigit(uniqueA) - 1;
                        const rB = SudokuBitUtils.bitToDigit(uniqueB) - 1;
                        const cA = colPairs[i].c, cB = colPairs[j].c;
                        for (let k = 0; k < 81; k++) {
                            if (bb.has(0, k) || !bb.has(d, k)) continue;
                            if (k === rA * 9 + cA || k === rB * 9 + cB) continue;
                            if (sees(k, rA * 9 + cA) && sees(k, rB * 9 + cB)) {
                                solver.clearCandidate(k, d);
                                solver.difficultyLog.push({ technique: 'Skyscraper', idx: k, val: d });
                                changed = true;
                            }
                        }
                    }
                }

                // Row-based Skyscraper
                const rowPairs = [];
                for (let r = 0; r < 9; r++) {
                    const colMask = bb.rowMask(d, r);
                    if (SudokuBitUtils.popcount(colMask) === 2) rowPairs.push({ r, colMask });
                }
                for (let i = 0; i < rowPairs.length; i++) {
                    for (let j = i + 1; j < rowPairs.length; j++) {
                        const shared = rowPairs[i].colMask & rowPairs[j].colMask;
                        if (SudokuBitUtils.popcount(shared) !== 1) continue;
                        const uniqueA = rowPairs[i].colMask ^ shared;
                        const uniqueB = rowPairs[j].colMask ^ shared;
                        const cA = SudokuBitUtils.bitToDigit(uniqueA) - 1;
                        const cB = SudokuBitUtils.bitToDigit(uniqueB) - 1;
                        const rA = rowPairs[i].r, rB = rowPairs[j].r;
                        for (let k = 0; k < 81; k++) {
                            if (bb.has(0, k) || !bb.has(d, k)) continue;
                            if (k === rA * 9 + cA || k === rB * 9 + cB) continue;
                            if (sees(k, rA * 9 + cA) && sees(k, rB * 9 + cB)) {
                                solver.clearCandidate(k, d);
                                solver.difficultyLog.push({ technique: 'Skyscraper', idx: k, val: d });
                                changed = true;
                            }
                        }
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'uniqueRectangleType1',
        name: 'Unique Rectangle (Type 1)',
        rank: 4,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            for (let r1 = 0; r1 < 8; r1++) {
                for (let r2 = r1 + 1; r2 < 9; r2++) {
                    for (let c1 = 0; c1 < 8; c1++) {
                        for (let c2 = c1 + 1; c2 < 9; c2++) {
                            if ((Math.floor(r1 / 3) === Math.floor(r2 / 3)) === (Math.floor(c1 / 3) === Math.floor(c2 / 3))) continue;
                            const i1 = r1 * 9 + c1, i2 = r1 * 9 + c2;
                            const i3 = r2 * 9 + c1, i4 = r2 * 9 + c2;
                            if (bb.has(0, i1) || bb.has(0, i2) || bb.has(0, i3) || bb.has(0, i4)) continue;
                            const cells = [i1, i2, i3, i4];
                            const biCells = cells.filter(idx => SudokuBitUtils.popcount(bb.getCellMask(idx)) === 2);
                            if (biCells.length !== 3) continue;
                            const sharedMask = bb.getCellMask(biCells[0]);
                            if ((bb.getCellMask(biCells[1])) !== sharedMask) continue;
                            if ((bb.getCellMask(biCells[2])) !== sharedMask) continue;
                            const target = cells.find(idx => !biCells.includes(idx));
                            if (bb.getCellMask(target) & sharedMask) return true;
                        }
                    }
                }
            }
            return false;
        },

        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let r1 = 0; r1 < 8; r1++) {
                for (let r2 = r1 + 1; r2 < 9; r2++) {
                    for (let c1 = 0; c1 < 8; c1++) {
                        for (let c2 = c1 + 1; c2 < 9; c2++) {
                            if ((Math.floor(r1 / 3) === Math.floor(r2 / 3)) ===
                                (Math.floor(c1 / 3) === Math.floor(c2 / 3))) continue;

                            const i1 = r1 * 9 + c1, i2 = r1 * 9 + c2;
                            const i3 = r2 * 9 + c1, i4 = r2 * 9 + c2;

                            if (bb.has(0, i1) || bb.has(0, i2) ||
                                bb.has(0, i3) || bb.has(0, i4)) continue;

                            const cells = [i1, i2, i3, i4];
                            const biCells = cells.filter(idx => SudokuBitUtils.popcount(bb.getCellMask(idx)) === 2);
                            if (biCells.length !== 3) continue;

                            const sharedMask = bb.getCellMask(biCells[0]);
                            if ((bb.getCellMask(biCells[1])) !== sharedMask) continue;
                            if ((bb.getCellMask(biCells[2])) !== sharedMask) continue;

                            const target = cells.find(idx => !biCells.includes(idx));
                            if (!(bb.getCellMask(target) & sharedMask)) continue;

                            solver.clearCandidates(target, sharedMask);
                            solver.difficultyLog.push({ technique: 'Unique Rectangle (Type 1)', idx: target, val: 0 });
                            changed = true;
                        }
                    }
                }
            }
            return changed;
        }
    },


    {
        id: 'xyChain',
        name: 'XY-Chain',
        rank: 4,
        checkBitwise: (solver) => {
            const bb = solver.bb;
            const biCells = [];
            for (let i = 0; i < 81; i++) {
                if (!bb.has(0, i) && SudokuBitUtils.popcount(bb.getCellMask(i)) === 2) biCells.push(i);
            }
            if (biCells.length < 3) return false;
            const inPath = new Uint8Array(81);
            function checkDfs(cur, enterBit, startBit, startCell, depth) {
                const leaveBit = (bb.getCellMask(cur)) ^ enterBit;
                for (const next of biCells) {
                    if (inPath[next]) continue;
                    if (!sees(cur, next)) continue;
                    const nextMask = bb.getCellMask(next);
                    if (!(nextMask & leaveBit)) continue;
                    if (depth >= 1 && (nextMask & startBit)) {
                        const dStart = SudokuBitUtils.bitToDigit(startBit);
                        for (let i = 0; i < 81; i++) {
                            if (i === startCell || i === next || bb.has(0, i)) continue;
                            if (solver.bb.has(dStart, i) && sees(i, startCell) && sees(i, next)) return true;
                        }
                    }
                    inPath[next] = 1;
                    if (checkDfs(next, leaveBit, startBit, startCell, depth + 1)) return true;
                    inPath[next] = 0;
                }
                return false;
            }
            for (const start of biCells) {
                const sm = bb.getCellMask(start);
                const bA = sm & -sm;
                const bB = sm ^ bA;
                inPath[start] = 1;
                if (checkDfs(start, bA, bA, start, 0)) return true;
                if (checkDfs(start, bB, bB, start, 0)) return true;
                inPath[start] = 0;
            }
            return false;
        },

        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            const biCells = [];
            for (let i = 0; i < 81; i++) {

                if (!bb.has(0, i) && SudokuBitUtils.popcount(bb.getCellMask(i)) === 2) {
                    biCells.push(i);
                }
            }
            if (biCells.length < 3) return false;

            const path = [];
            const inPath = new Uint8Array(81);

            function dfs(cur, enterBit, startBit) {
                const leaveBit = (bb.getCellMask(cur)) ^ enterBit;

                for (const next of biCells) {
                    if (inPath[next]) continue;
                    if (!sees(cur, next)) continue;
                    const nextMask = bb.getCellMask(next);
                    if (!(nextMask & leaveBit)) continue;

                    if (path.length >= 2 && (nextMask & startBit)) {
                        const startCell = path[0];
                        const dStart = SudokuBitUtils.bitToDigit(startBit);

                        let found = false;
                        for (let i = 0; i < 81; i++) {
                            if (i === startCell || i === next) continue;
                            if (bb.has(0, i)) continue;
                            if (solver.bb.has(dStart, i) && sees(i, startCell) && sees(i, next)) {
                                solver.clearCandidate(i, dStart);
                                solver.difficultyLog.push({ technique: 'XY-Chain', idx: i, val: dStart });
                                changed = true;
                                found = true;
                            }
                        }
                        if (found) return true;
                    }

                    path.push(next);
                    inPath[next] = 1;
                    if (dfs(next, leaveBit, startBit)) return true;
                    path.pop();
                    inPath[next] = 0;
                }
                return false;
            }
            for (const start of biCells) {
                if (changed) break;
                const sm = bb.getCellMask(start);
                const bA = sm & -sm;
                const bB = sm ^ bA;

                path.push(start);
                inPath[start] = 1;

                if (!dfs(start, bA, bA)) dfs(start, bB, bB);

                path.pop();
                inPath[start] = 0;
            }

            return changed;
        }
    }

];


// Connect this dictionary to the logical engine
// SudokuLogicalSolver.connectDictionary(TECHNIQUES);
