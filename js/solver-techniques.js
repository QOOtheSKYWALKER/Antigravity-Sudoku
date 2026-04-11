import { SudokuBitBoard, SudokuLogicalSolver as solver } from './solver.js';

/**
 * Sudoku Solver Techniques Definition
 *
 * Flat static memory model:
 *   solver.unifiedBoard -> Uint32Array(81), index = r*9+c (Single Source of Truth)
 *   solver.setCellValue(idx, val, technique)
 *
 * House indices: 0-8 rows, 9-17 cols, 18-26 boxes (via SudokuBitBoard.HOUSES)
 */

// ===== Constants & Abstractions =====

// ===== Technique Definitions =====

export const TECHNIQUES = [

    // ----- BASIC -----

    {
        id: 'nakedSingle',
        name: 'Naked Single',
        rank: 1,
        /**
         * @param {boolean} silent
         */
        applyLogical: function (solver, silent = false) {
            let changed = false;
            const bb = solver.bb;
            for (let i = 0; i < 81; i++) {
                if (bb.has(0, i)) continue;
                const mask = bb.getCellMask(i);
                if (SudokuBitBoard.popcount(mask) === 1) {
                    const digit = SudokuBitBoard.bitToDigit(mask);
                    if (SudokuBitBoard.isValidBB(bb, i, digit)) {
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
        /**
         * @param {boolean} silent
         */
        applyLogical: function (solver, silent = false) {
            let changed = false;
            const bb = solver.bb;
            const HM = SudokuBitBoard.HOUSE_MASKS;

            for (let h = 0; h < 27; h++) {
                const h0 = HM[h * 3], h1 = HM[h * 3 + 1], h2 = HM[h * 3 + 2];
                for (let d = 1; d <= 9; d++) {
                    if (bb.houseCount(d, h0, h1, h2) !== 1) continue;
                    const idx = bb.houseFirstCell(d, h0, h1, h2);
                    if (idx < 0 || bb.has(0, idx)) continue;
                    if (SudokuBitBoard.isValidBB(bb, idx, d)) {
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
        id: 'lockedCandidatesPointing',
        name: 'Locked Candidates (Pointing)',
        rank: 2,
        /**
         * Pointing: All candidates of a digit in a box are restricted to a single row/column.
         */
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let box = 0; box < 9; box++) {
                const hb = (18 + box) * 9;
                for (let d = 1; d <= 9; d++) {
                    const bit = 1 << (d - 1);
                    let rowMask = 0, colMask = 0, count = 0;

                    for (let j = 0; j < 9; j++) {
                        const idx = SudokuBitBoard.HOUSES[hb + j];
                        if (!bb.has(0, idx) && (bb.getCellMask(idx) & bit)) {
                            rowMask |= 1 << ((idx / 9) | 0);
                            colMask |= 1 << (idx % 9);
                            count++;
                        }
                    }
                    if (count < 2 || count > 3) continue;

                    // Pointing Row
                    if (SudokuBitBoard.popcount(rowMask) === 1) {
                        const r = SudokuBitBoard.bitToDigit(rowMask) - 1;
                        SudokuBitBoard.forEachBit(bb.rowMask(d, r), (c) => {
                            if (((r / 3 | 0) * 3 + (c / 3 | 0)) !== box) {
                                const idx = r * 9 + c;
                                solver.clearCandidate(idx, d);
                                changed = true;
                            }
                        });
                    }
                    // Pointing Col
                    if (SudokuBitBoard.popcount(colMask) === 1) {
                        const c = SudokuBitBoard.bitToDigit(colMask) - 1;
                        SudokuBitBoard.forEachBit(bb.colMask(d, c), (r) => {
                            if (((r / 3 | 0) * 3 + (c / 3 | 0)) !== box) {
                                const idx = r * 9 + c;
                                solver.clearCandidate(idx, d);
                                changed = true;
                            }
                        });
                    }
                }
            }
            return changed;
        }
    },

    {
        id: 'lockedCandidatesClaiming',
        name: 'Locked Candidates (Claiming)',
        rank: 2,
        /**
         * Claiming: All candidates of a digit in a row/column are restricted to a single box.
         */
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let d = 1; d <= 9; d++) {
                // Dim abstraction could be used here too, but Claiming is already split.
                // We apply DIMENSIONS for unification.
                for (const dim of SudokuBitBoard.DIMENSIONS) {
                    for (let i = 0; i < 9; i++) {
                        const mask = dim.name === 'row' ? bb.rowMask(d, i) : bb.colMask(d, i);
                        if (!mask || SudokuBitBoard.popcount(mask) < 2 || SudokuBitBoard.popcount(mask) > 3) continue;

                        let boxIdx = -1;
                        let allInSameBox = true;

                        SudokuBitBoard.forEachBit(mask, (pos) => {
                            const idx = dim.toIdx(i, pos);
                            const b = ((idx / 9 | 0) / 3 | 0) * 3 + (idx % 9 / 3 | 0);
                            if (boxIdx === -1) boxIdx = b;
                            else if (boxIdx !== b) allInSameBox = false;
                        });

                        if (allInSameBox && boxIdx !== -1) {
                            const hb = (18 + boxIdx) * 9;
                            for (let j = 0; j < 9; j++) {
                                const idx = SudokuBitBoard.HOUSES[hb + j];
                                const isOriginalUnit = (dim.name === 'row') ? ((idx / 9 | 0) === i) : ((idx % 9) === i);
                                if (!isOriginalUnit && !bb.has(0, idx) && (bb.getCellMask(idx) & (1 << (d - 1)))) {
                                    solver.clearCandidate(idx, d);
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
];

export const TECHNIQUES_ADVANCED = [
    // ----- MEDIUM -----
    {
        id: 'nakedPair',
        name: 'Naked Pair',
        rank: 3,
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuBitBoard.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                for (let i = 0; i < 9; i++) {
                    const idx1 = HOUSES[houseBase + i];
                    const c1 = bb.getCellMask(idx1);
                    if (bb.has(0, idx1) || SudokuBitBoard.popcount(c1) !== 2) continue;

                    for (let j = i + 1; j < 9; j++) {
                        const idx2 = HOUSES[houseBase + j];

                        if (!bb.has(0, idx2) && (bb.getCellMask(idx2) & SudokuBitBoard.MASK_CANDIDATES) === c1) {
                            const nc = ~c1;
                            for (let k = 0; k < 9; k++) {
                                if (k === i || k === j) continue;
                                const idxElim = HOUSES[houseBase + k];
                                if (!bb.has(0, idxElim) && (bb.getCellMask(idxElim) & c1)) {
                                    solver.clearCandidates(idxElim, c1);
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuBitBoard.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);

                for (let d1 = 1; d1 <= 8; d1++) {
                    const p1 = bb.housePosMask(d1, houseCells);
                    if (SudokuBitBoard.popcount(p1) !== 2) continue;
                    for (let d2 = d1 + 1; d2 <= 9; d2++) {
                        if (bb.housePosMask(d2, houseCells) !== p1) continue;
                        const keepMask = (1 << (d1 - 1)) | (1 << (d2 - 1));

                        SudokuBitBoard.forEachBit(p1, (pos) => {
                            const idx = houseCells[pos];
                            const cellMask = bb.getCellMask(idx);
                            if (cellMask & ~keepMask & SudokuBitBoard.MASK_CANDIDATES) {
                                solver.clearCandidates(idx, ~keepMask & SudokuBitBoard.MASK_CANDIDATES);
                                changed = true;
                            }
                        });
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuBitBoard.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const cells = [];
                for (let j = 0; j < 9; j++) {
                    const idx = HOUSES[houseBase + j];
                    const mask = bb.getCellMask(idx);
                    const cnt = SudokuBitBoard.popcount(mask);
                    if (!bb.has(0, idx) && cnt >= 2 && cnt <= 3) {
                        cells.push({ idx, mask });
                    }
                }
                if (cells.length < 3) continue;

                for (let i = 0; i < cells.length; i++) {
                    for (let j = i + 1; j < cells.length; j++) {
                        for (let k = j + 1; k < cells.length; k++) {
                            const union = cells[i].mask | cells[j].mask | cells[k].mask;
                            if (SudokuBitBoard.popcount(union) === 3) {
                                for (let l = 0; l < 9; l++) {
                                    const idx = HOUSES[houseBase + l];
                                    if (idx === cells[i].idx || idx === cells[j].idx || idx === cells[k].idx) continue;
                                    if (!bb.has(0, idx) && (bb.getCellMask(idx) & union)) {
                                        solver.clearCandidates(idx, union);
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const HOUSES = SudokuBitBoard.HOUSES;

            for (let h = 0; h < 27; h++) {
                const houseBase = h * 9;
                const houseCells = HOUSES.subarray(houseBase, houseBase + 9);

                const cands = [];
                for (let d = 1; d <= 9; d++) {
                    const p = bb.housePosMask(d, houseCells);
                    if (p && SudokuBitBoard.popcount(p) >= 2 && SudokuBitBoard.popcount(p) <= 3) cands.push({ d, p });
                }
                if (cands.length < 3) continue;

                for (let i = 0; i < cands.length; i++) {
                    for (let j = i + 1; j < cands.length; j++) {
                        for (let k = j + 1; k < cands.length; k++) {
                            const uPos = cands[i].p | cands[j].p | cands[k].p;
                            if (SudokuBitBoard.popcount(uPos) !== 3) continue;
                            const keepMask = (1 << (cands[i].d - 1)) | (1 << (cands[j].d - 1)) | (1 << (cands[k].d - 1));
                            let pm = uPos;
                            while (pm) {
                                const bitPos = pm & -pm; pm ^= bitPos;
                                const idx = HOUSES[houseBase + SudokuBitBoard.bitToDigit(bitPos) - 1];
                                if (bb.getCellMask(idx) & ~keepMask & SudokuBitBoard.MASK_CANDIDATES) {
                                    solver.clearCandidates(idx, ~keepMask & SudokuBitBoard.MASK_CANDIDATES);
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let d = 1; d <= 9; d++) {
                for (const dim of SudokuBitBoard.DIMENSIONS) {
                    const units = [];
                    for (let i = 0; i < 9; i++) {
                        const mask = dim.mask(bb, d, i);
                        if (SudokuBitBoard.popcount(mask) === 2) units.push({ i, mask });
                    }

                    for (let a = 0; a < units.length; a++) {
                        for (let b = a + 1; b < units.length; b++) {
                            if (units[a].mask === units[b].mask) {
                                let m = units[a].mask;
                                SudokuBitBoard.forEachBit(m, (pos) => {
                                    const otherDim = (dim.name === 'row') ? SudokuBitBoard.DIMENSIONS[1] : SudokuBitBoard.DIMENSIONS[0];
                                    SudokuBitBoard.forEachBit(otherDim.mask(bb, d, pos), (unitIdx) => {
                                        if (unitIdx !== units[a].i && unitIdx !== units[b].i) {
                                            const idx = otherDim.toIdx(pos, unitIdx);
                                            solver.clearCandidate(idx, d);
                                            changed = true;
                                        }
                                    });
                                });
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let d = 1; d <= 9; d++) {
                for (const dim of SudokuBitBoard.DIMENSIONS) {
                    const masks = new Uint32Array(9);
                    for (let i = 0; i < 9; i++) masks[i] = dim.mask(bb, d, i);

                    for (let i1 = 0; i1 < 7; i1++) {
                        const m1 = masks[i1];
                        if (!m1 || SudokuBitBoard.popcount(m1) > 3) continue;
                        for (let i2 = i1 + 1; i2 < 8; i2++) {
                            const m2 = masks[i2];
                            if (!m2 || SudokuBitBoard.popcount(m1 | m2) > 3) continue;
                            for (let i3 = i2 + 1; i3 < 9; i3++) {
                                const m3 = masks[i3];
                                const union = m1 | m2 | m3;
                                if (!m3 || SudokuBitBoard.popcount(union) !== 3) continue;
                                if (SudokuBitBoard.popcount(m1) < 2 || SudokuBitBoard.popcount(m2) < 2 || SudokuBitBoard.popcount(m3) < 2) continue;

                                SudokuBitBoard.forEachBit(union, (pos) => {
                                    const otherDim = (dim.name === 'row') ? SudokuBitBoard.DIMENSIONS[1] : SudokuBitBoard.DIMENSIONS[0];
                                    SudokuBitBoard.forEachBit(otherDim.mask(bb, d, pos), (unitIdx) => {
                                        if (unitIdx !== i1 && unitIdx !== i2 && unitIdx !== i3) {
                                            const idx = otherDim.toIdx(pos, unitIdx);
                                            solver.clearCandidate(idx, d);
                                            changed = true;
                                        }
                                    });
                                });
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const biCells = solver.getBiCells();

            if (biCells.length < 3) return false;

            for (let i = 0; i < biCells.length; i++) {
                const pivotIdx = biCells[i];
                const pMask = bb.getCellMask(pivotIdx);

                for (let j = 0; j < biCells.length; j++) {
                    if (i === j) continue;
                    const w1Idx = biCells[j];
                    if (!SudokuBitBoard.sees(pivotIdx, w1Idx)) continue;
                    const w1Mask = bb.getCellMask(w1Idx);

                    for (let k = j + 1; k < biCells.length; k++) {
                        if (k === i) continue;
                        const w2Idx = biCells[k];
                        if (!SudokuBitBoard.sees(pivotIdx, w2Idx)) continue;
                        const w2Mask = bb.getCellMask(w2Idx);

                        // Bit-Native XY-Wing Logic: Pivot XY, Wings XZ, YZ -> Union XYZ (popcount 3)
                        const union = pMask | w1Mask | w2Mask;
                        if (SudokuBitBoard.popcount(union) === 3) {
                            if (SudokuBitBoard.popcount(pMask & w1Mask) === 1 &&
                                SudokuBitBoard.popcount(pMask & w2Mask) === 1 &&
                                SudokuBitBoard.popcount(w1Mask & w2Mask) === 1) {

                                const zBit = w1Mask & w2Mask;
                                const dZ = SudokuBitBoard.bitToDigit(zBit);

                                for (let target = 0; target < 81; target++) {
                                    if (target === w1Idx || target === w2Idx || target === pivotIdx) continue;
                                    if (!bb.has(0, target) && bb.has(dZ, target)) {
                                        if (SudokuBitBoard.sees(target, w1Idx) && SudokuBitBoard.sees(target, w2Idx)) {
                                            solver.clearCandidate(target, dZ);
                                            changed = true;
                                        }
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let d = 1; d <= 9; d++) {
                for (const dim of SudokuBitBoard.DIMENSIONS) {
                    const bases = [];
                    for (let i = 0; i < 9; i++) {
                        const mask = dim.mask(bb, d, i);
                        if (SudokuBitBoard.popcount(mask) === 2) bases.push({ i, mask });
                    }

                    for (let i = 0; i < bases.length; i++) {
                        for (let j = i + 1; j < bases.length; j++) {
                            const shared = bases[i].mask & bases[j].mask;
                            if (SudokuBitBoard.popcount(shared) !== 1) continue;

                            const uniqueI = bases[i].mask ^ shared;
                            const uniqueJ = bases[j].mask ^ shared;
                            const posI = SudokuBitBoard.bitToDigit(uniqueI) - 1;
                            const posJ = SudokuBitBoard.bitToDigit(uniqueJ) - 1;

                            const otherDim = (dim.name === 'row') ? SudokuBitBoard.DIMENSIONS[1] : SudokuBitBoard.DIMENSIONS[0];
                            const cellI = otherDim.toIdx(posI, bases[i].i);
                            const cellJ = otherDim.toIdx(posJ, bases[j].i);

                            for (let k = 0; k < 81; k++) {
                                if (bb.has(0, k) || !bb.has(d, k)) continue;
                                if (k === cellI || k === cellJ) continue;
                                if (SudokuBitBoard.sees(k, cellI) && SudokuBitBoard.sees(k, cellJ)) {
                                    solver.clearCandidate(k, d);
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
        id: 'uniqueRectangleType1',
        name: 'Unique Rectangle (Type 1)',
        rank: 4,
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;

            for (let r1 = 0; r1 < 8; r1++) {
                for (let r2 = r1 + 1; r2 < 9; r2++) {
                    for (let c1 = 0; c1 < 8; c1++) {
                        for (let c2 = c1 + 1; c2 < 9; c2++) {
                            // Ensure the 4 cells span exactly 2 boxes (Standard UR condition)
                            if ((Math.floor(r1 / 3) === Math.floor(r2 / 3)) ===
                                (Math.floor(c1 / 3) === Math.floor(c2 / 3))) continue;

                            const cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
                            if (cells.some(idx => bb.has(0, idx))) continue;

                            const biCells = cells.filter(idx => SudokuBitBoard.popcount(bb.getCellMask(idx)) === 2);
                            if (biCells.length !== 3) continue;

                            const sharedMask = bb.getCellMask(biCells[0]);
                            if (bb.getCellMask(biCells[1]) !== sharedMask || bb.getCellMask(biCells[2]) !== sharedMask) continue;

                            const target = cells.find(idx => !biCells.includes(idx));
                            if (!(bb.getCellMask(target) & sharedMask)) continue;

                            solver.clearCandidates(target, sharedMask);
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
        applyLogical: function (solver) {
            let changed = false;
            const bb = solver.bb;
            const biCells = solver.getBiCells();

            if (biCells.length < 2) return false;

            const path = [];
            const inPath = new Uint8Array(81);

            function dfs(cur, enterBit, startBit, startIdx) {
                const leaveBit = (bb.getCellMask(cur)) ^ enterBit;

                for (const next of biCells) {
                    if (inPath[next]) continue;
                    if (!SudokuBitBoard.sees(cur, next)) continue;
                    const nextMask = bb.getCellMask(next);
                    if (!(nextMask & leaveBit)) continue;

                    // If we found a chain (at least link 2: start-end)
                    if (path.length >= 1 && (nextMask & startBit)) {
                        const dStart = SudokuBitBoard.bitToDigit(startBit);
                        let found = false;
                        for (let i = 0; i < 81; i++) {
                            if (i === startIdx || i === next || bb.has(0, i) || !bb.has(dStart, i)) continue;
                            if (SudokuBitBoard.sees(i, startIdx) && SudokuBitBoard.sees(i, next)) {
                                solver.clearCandidate(i, dStart);
                                changed = true;
                                found = true;
                            }
                        }
                        if (found) return true;
                    }

                    path.push(next);
                    inPath[next] = 1;
                    if (dfs(next, leaveBit, startBit, startIdx)) return true;
                    path.pop();
                    inPath[next] = 0;
                }
                return false;
            }

            for (const start of biCells) {
                const sm = bb.getCellMask(start);
                SudokuBitBoard.forEachBit(sm, (bitIdx) => {
                    if (changed) return;
                    const bit = 1 << bitIdx;

                    path.push(start);
                    inPath[start] = 1;
                    dfs(start, bit, bit, start);
                    path.pop();
                    inPath[start] = 0;
                });
                if (changed) break;
            }

            return changed;
        }
    }

];
