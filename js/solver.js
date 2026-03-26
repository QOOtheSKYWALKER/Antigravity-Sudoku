/**
 * High-Performance DLX (Dancing Links) Solver.
 */

// Global Constants
if (typeof DIFFICULTY_RANK === 'undefined') {
    globalThis.DIFFICULTY_RANK = { 'basic': 1, 'easy': 2, 'medium': 3, 'hard': 4 };
}

/**
 * Unified Bit Representation Utility for Sudoku Cells.
 * 32-bit layout:
 * - Bit 0-8: Candidate flags for digits 1-9
 * - Bit 9:   Confirmed Flag (0x0200)
 * - Bit 10:  Given Flag (0x0400)
 * - Bit 11:  Sanctuary (Immutable clue flag)
 * - Bit 12-15: Solution digits (0xF000)
 * - Bit 16:  Error Flag (0x00010000)
 * - Bits 17-31: UI status and other flags
 */
class SudokuBitUtils {
    static MASK_CANDIDATES = 0x01FF;
    static BIT_CONFIRMED = 0x0200;
    static BIT_GIVEN = 0x0400;
    static BIT_INF = 0x0800;
    static BIT_SOLUTION_MASK = 0xF000;
    static BIT_SOLUTION_SHIFT = 12;

    static BIT_UI_ERROR = 0x00010000;
    static BIT_UI_SELECTED = 0x00020000;
    static BIT_UI_HIGHLIGHT = 0x00040000;
    static BIT_UI_SAME_DIGIT = 0x00080000;
    static BIT_UI_TARGET_MASK = 0x00F00000;
    static BIT_UI_TARGET_SHIFT = 20;

    static BIT_UI_MASK = 0xFFFF0000;
    static BIT_ERROR = this.BIT_UI_ERROR;

    static isSolved(cell) { return (cell & this.BIT_CONFIRMED) !== 0; }
    static isGiven(cell) { return (cell & this.BIT_GIVEN) !== 0; }

    static getValue(cell) {
        if (!this.isSolved(cell)) return 0;
        const bits = cell & this.MASK_CANDIDATES;
        if (bits === 0) return 0;
        return this.bitToDigit(bits);
    }

    static createSolved(digit, isGiven = false) {
        if (digit < 1 || digit > 9) return 0;
        let cell = (1 << (digit - 1)) | this.BIT_CONFIRMED;
        if (isGiven) cell |= this.BIT_GIVEN;
        cell |= ((digit & 0xF) << this.BIT_SOLUTION_SHIFT);
        return cell;
    }

    static getSolution(cell) {
        return (cell & this.BIT_SOLUTION_MASK) >>> this.BIT_SOLUTION_SHIFT;
    }

    static setSolution(cell, digit) {
        return (cell & ~this.BIT_SOLUTION_MASK) | ((digit & 0xF) << this.BIT_SOLUTION_SHIFT);
    }

    static confirmValue(cell, digit) {
        // Bits 0-8: Candidates, Bit 9: Confirmed, Bit 10: Given, Bit 11: Sanctuary, 12-15: Solution, 16+: Error/UI
        const meta = cell & 0xFFFFFE00; // Preserve bits 9-31
        if (digit < 1 || digit > 9) return meta;
        return (meta | (1 << (digit - 1)) | this.BIT_CONFIRMED) >>> 0;
    }

    static toggleCandidate(cell, digit) {
        if (this.isSolved(cell)) return cell;
        return cell ^ (1 << (digit - 1));
    }

    static fromUint8Array(grid, isGiven = false) {
        SudokuLogicalSolver.init();
        const unified = new Uint32Array(81);
        for (let i = 0; i < 81; i++) {
            if (grid[i] !== 0) unified[i] = this.createSolved(grid[i], isGiven);
        }
        this.updateAllCandidates(unified);
        return unified;
    }

    static updateAllCandidates(unified) {
        SudokuLogicalSolver.init();
        for (let i = 0; i < 81; i++) {
            const cell = unified[i];
            if (!this.isSolved(cell)) {
                let mask = this.MASK_CANDIDATES;
                for (let k = 0; k < 20; k++) {
                    const p = SudokuLogicalSolver.PEERS[i * 20 + k];
                    const v = this.getValue(unified[p]);
                    if (v !== 0) mask &= ~(1 << (v - 1));
                }
                unified[i] = (cell & ~this.MASK_CANDIDATES) | mask;
            }
        }
    }

    static clearUnsolvedCandidates(unified) {
        for (let i = 0; i < 81; i++) {
            if (!this.isSolved(unified[i])) {
                unified[i] &= ~this.MASK_CANDIDATES;
            }
        }
    }

    static popcount(n) {
        let count = 0;
        let v = n >>> 0;
        while (v) { v &= (v - 1); count++; }
        return count;
    }

    static bitToDigit(bit) {
        return 32 - Math.clz32(bit);
    }

    static maskToDigits(mask) {
        const out = [];
        let m = mask & 0x01FF;
        while (m) {
            const b = m & -m;
            out.push(this.bitToDigit(b));
            m ^= b;
        }
        return out;
    }

    static digitsToMask(digits) {
        let mask = 0;
        for (let i = 0; i < digits.length; i++) {
            mask |= (1 << (digits[i] - 1));
        }
        return mask;
    }

    static canModify(cell) {
        return (cell & this.BIT_GIVEN) === 0;
    }

    static toIntGrid(bitGrid) {
        const g = new Uint8Array(81);
        for (let i = 0; i < 81; i++) {
            g[i] = this.getValue(bitGrid[i]);
        }
        return g;
    }

    static updateErrorFlags(bitGrid) {
        const intGrid = this.toIntGrid(bitGrid);
        for (let i = 0; i < 81; i++) {
            const val = intGrid[i];
            if (val !== 0 && !this.isGiven(bitGrid[i])) {
                let conflict = false;
                const r = (i / 9) | 0, c = i % 9;
                const br = ((r / 3) | 0) * 3, bc = ((c / 3) | 0) * 3;
                for (let k = 0; k < 9; k++) {
                    const pr = r * 9 + k;
                    if (pr !== i && intGrid[pr] === val) { conflict = true; break; }
                    const pc = k * 9 + c;
                    if (pc !== i && intGrid[pc] === val) { conflict = true; break; }
                    const pb = (br + ((k / 3) | 0)) * 9 + (bc + (k % 3));
                    if (pb !== i && intGrid[pb] === val) { conflict = true; break; }
                }
                if (conflict) {
                    bitGrid[i] |= this.BIT_UI_ERROR;
                } else {
                    bitGrid[i] &= ~this.BIT_UI_ERROR;
                }
            } else {
                bitGrid[i] &= ~this.BIT_UI_ERROR;
            }
        }
    }

    static forEachPeer(idx, callback) {
        SudokuLogicalSolver.init();
        for (let p = 0; p < 20; p++) {
            callback(SudokuLogicalSolver.PEERS[idx * 20 + p]);
        }
    }

    static cellConflicts(grid, idx, num) {
        if (num === 0) return false;
        let conflict = false;
        const isBB = grid instanceof SudokuBitBoard;
        const isBit = !isBB && (grid instanceof Uint32Array || grid instanceof Uint16Array);

        this.forEachPeer(idx, (pIdx) => {
            if (isBB) {
                if (grid.has(0, pIdx) && grid.has(num, pIdx)) conflict = true;
            } else {
                const peerVal = isBit ? this.getValue(grid[pIdx]) : grid[pIdx];
                if (peerVal === num) conflict = true;
            }
        });
        return conflict;
    }

    static isValid(grid, idx, num) {
        return !this.cellConflicts(grid, idx, num);
    }
}

// ====================================================================
// SudokuBitBoard — Digit-Centric Candidate Presence Bitboards
// 10 bitboards × 3 Uint32 words = 30 values covering 81 cells (bits 0–80)
//   buf[0..2]  = confirmedMap  (d=0): bit i set → cell i is confirmed
//   buf[d*3..] = candidateMap for digit d (1–9)
// ====================================================================
class SudokuBitBoard {
    constructor() { this.buf = new Uint32Array(30); }

    reset() { this.buf.fill(0); }

    has(d, i) { return (this.buf[d * 3 + (i >> 5)] >>> (i & 31)) & 1; }
    set(d, i) { this.buf[d * 3 + (i >> 5)] |= (1 << (i & 31)); }
    clear(d, i) { this.buf[d * 3 + (i >> 5)] &= ~(1 << (i & 31)); }

    // 9-bit column-presence mask for digit d in row r (bit c set = col c has candidate d)
    rowMask(d, r) {
        const start = r * 9, w = start >>> 5, shift = start & 31, base = d * 3;
        if (shift <= 23) return (this.buf[base + w] >>> shift) & 0x1FF;
        return ((this.buf[base + w] >>> shift) | (this.buf[base + w + 1] << (32 - shift))) & 0x1FF;
    }

    // 9-bit row-presence mask for digit d in column c (bit r set = row r has candidate d)
    colMask(d, c) {
        let mask = 0, base = d * 3;
        for (let r = 0; r < 9; r++) {
            const i = r * 9 + c;
            if ((this.buf[base + (i >> 5)] >>> (i & 31)) & 1) mask |= 1 << r;
        }
        return mask;
    }

    // Count of candidates for digit d within 3-word house mask {h0,h1,h2}
    houseCount(d, h0, h1, h2) {
        const b = d * 3;
        return SudokuBitUtils.popcount(this.buf[b] & h0) +
            SudokuBitUtils.popcount(this.buf[b + 1] & h1) +
            SudokuBitUtils.popcount(this.buf[b + 2] & h2);
    }

    // Cell index of first candidate for digit d within house mask. Returns -1 if none.
    houseFirstCell(d, h0, h1, h2) {
        const b = d * 3;
        let w;
        w = this.buf[b] & h0; if (w) return 31 - Math.clz32(w & -w);
        w = this.buf[b + 1] & h1; if (w) return 63 - Math.clz32(w & -w);
        w = this.buf[b + 2] & h2; if (w) return 95 - Math.clz32(w & -w);
        return -1;
    }

    // 9-bit position mask of candidates for digit d in a house (bit j ↔ j-th cell of house)
    housePosMask(d, houseCells) {
        let mask = 0, base = d * 3;
        for (let j = 0; j < 9; j++) {
            const i = houseCells[j];
            if ((this.buf[base + (i >> 5)] >>> (i & 31)) & 1) mask |= 1 << j;
        }
        return mask;
    }

    getCellMask(i) {
        let mask = 0;
        const w = i >> 5, shift = i & 31;
        for (let d = 1; d <= 9; d++) {
            if ((this.buf[d * 3 + w] >>> shift) & 1) mask |= (1 << (d - 1));
        }
        return mask;
    }
}

class SudokuDLX {
    static MAX_NODES = 1 + 324 + (9 * 9 * 9 * 4);

    static L = null;
    static R = null;
    static U = null;
    static D = null;
    static C = null;
    static S = null;
    static CLEAN_L = null;
    static CLEAN_R = null;
    static CLEAN_U = null;
    static CLEAN_D = null;
    static CLEAN_S = null;
    static RowR = null;
    static RowC = null;
    static RowV = null;
    static ROW_NODES = null;
    static ACTIVE_STATES = null;
    static ZOBRIST_TABLE = null;

    static allocateMemory() {
        if (this.L !== null) return;

        const N = this.MAX_NODES;
        this.L = new Int32Array(N);
        this.R = new Int32Array(N);
        this.U = new Int32Array(N);
        this.D = new Int32Array(N);
        this.C = new Int32Array(N);
        this.S = new Int32Array(325);

        this.CLEAN_L = new Int32Array(325);
        this.CLEAN_R = new Int32Array(325);
        this.CLEAN_U = new Int32Array(N);
        this.CLEAN_D = new Int32Array(N);
        this.CLEAN_S = new Int32Array(325);

        this.RowR = new Uint8Array(N);
        this.RowC = new Uint8Array(N);
        this.RowV = new Uint8Array(N);
        this.ROW_NODES = new Int32Array(81 * 10);
        this.ACTIVE_STATES = new Uint32Array(81);
        this.ZOBRIST_TABLE = new BigUint64Array(81 * 10);
    }

    static COL_MASK = 0x3FF;
    static INF_BIT = 0x400;
    static DIFF_SHIFT = 11;
    static DIFF_MASK = 0x7800;

    static initialized = false;

    static init() {
        this.allocateMemory();
        if (this.initialized && this.ZOBRIST_TABLE[0] !== 0n) return;
        this.initFullMatrix();

        for (let i = 0; i < 81 * 10; i++) {
            this.ZOBRIST_TABLE[i] = (BigUint64Array.from([BigInt(Math.floor(Math.random() * 0xffffffff))])[0] << 32n) |
                BigUint64Array.from([BigInt(Math.floor(Math.random() * 0xffffffff))])[0];
        }
    }

    static initFullMatrix() {
        if (this.initialized) return;
        this.initialized = true;

        const ROOT = 0;
        for (let i = 0; i <= 324; i++) {
            SudokuDLX.L[i] = i - 1;
            SudokuDLX.R[i] = i + 1;
            SudokuDLX.U[i] = i;
            SudokuDLX.D[i] = i;
            SudokuDLX.C[i] = i;
            SudokuDLX.S[i] = 0;
        }
        SudokuDLX.L[ROOT] = 324;
        SudokuDLX.R[324] = ROOT;

        let nodeCount = 324;
        const addRow = (r, c, n) => {
            const b = (r / 3 | 0) * 3 + (c / 3 | 0);
            const constraints = [
                r * 9 + c + 1,
                81 + r * 9 + (n - 1) + 1,
                162 + c * 9 + (n - 1) + 1,
                243 + b * 9 + (n - 1) + 1
            ];

            const rowFirstNode = nodeCount + 1;
            for (let i = 0; i < 4; i++) {
                const node = ++nodeCount;
                const colIdx = constraints[i];
                SudokuDLX.C[node] = colIdx;
                SudokuDLX.RowR[node] = r;
                SudokuDLX.RowC[node] = c;
                SudokuDLX.RowV[node] = n;

                SudokuDLX.U[node] = SudokuDLX.U[colIdx];
                SudokuDLX.D[node] = colIdx;
                SudokuDLX.D[SudokuDLX.U[colIdx]] = node;
                SudokuDLX.U[colIdx] = node;
                SudokuDLX.S[colIdx]++;

                SudokuDLX.L[node] = (i === 0) ? rowFirstNode + 3 : node - 1;
                SudokuDLX.R[node] = (i === 3) ? rowFirstNode : node + 1;
            }
            SudokuDLX.ROW_NODES[(r * 9 + c) * 10 + n] = rowFirstNode;
        };

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                for (let n = 1; n <= 9; n++) addRow(r, c, n);
            }
        }

        SudokuDLX.CLEAN_L.set(SudokuDLX.L.subarray(0, 325));
        SudokuDLX.CLEAN_R.set(SudokuDLX.R.subarray(0, 325));
        SudokuDLX.CLEAN_U.set(SudokuDLX.U);
        SudokuDLX.CLEAN_D.set(SudokuDLX.D);
        SudokuDLX.CLEAN_S.set(SudokuDLX.S);
    }

    static reset() {
        this.initFullMatrix();
        this.L.set(this.CLEAN_L, 0);
        this.R.set(this.CLEAN_R, 0);
        this.U.set(this.CLEAN_U);
        this.D.set(this.CLEAN_D);
        this.S.set(this.CLEAN_S);
        SudokuDLX.ACTIVE_STATES.fill(0);
    }

    static cover(c) {
        SudokuDLX.R[SudokuDLX.L[c]] = SudokuDLX.R[c];
        SudokuDLX.L[SudokuDLX.R[c]] = SudokuDLX.L[c];
        for (let i = SudokuDLX.D[c]; i !== c; i = SudokuDLX.D[i]) {
            for (let j = SudokuDLX.R[i]; j !== i; j = SudokuDLX.R[j]) {
                SudokuDLX.D[SudokuDLX.U[j]] = SudokuDLX.D[j];
                SudokuDLX.U[SudokuDLX.D[j]] = SudokuDLX.U[j];
                SudokuDLX.S[SudokuDLX.C[j] & 0x3FF]--;
            }
        }
    }

    static uncover(c) {
        for (let i = SudokuDLX.U[c]; i !== c; i = SudokuDLX.U[i]) {
            for (let j = SudokuDLX.L[i]; j !== i; j = SudokuDLX.L[j]) {
                SudokuDLX.S[SudokuDLX.C[j] & 0x3FF]++;
                SudokuDLX.D[SudokuDLX.U[j]] = j;
                SudokuDLX.U[SudokuDLX.D[j]] = j;
            }
        }
        SudokuDLX.R[SudokuDLX.L[c]] = c;
        SudokuDLX.L[SudokuDLX.R[c]] = c;
    }

    static selectGiven(rowNode) {
        SudokuDLX.cover(SudokuDLX.C[rowNode] & 0x3FF);
        for (let j = SudokuDLX.R[rowNode]; j !== rowNode; j = SudokuDLX.R[j]) {
            SudokuDLX.cover(SudokuDLX.C[j] & 0x3FF);
        }
    }

    static unselectGiven(rowNode) {
        for (let j = SudokuDLX.L[rowNode]; j !== rowNode; j = SudokuDLX.L[j]) {
            SudokuDLX.uncover(SudokuDLX.C[j] & 0x3FF);
        }
        SudokuDLX.uncover(SudokuDLX.C[rowNode] & 0x3FF);
    }

    static clearMetaBits() {
        SudokuDLX.C[0] &= SudokuDLX.COL_MASK;
    }

    static applyGrid(grid) {
        this.reset();
        const isBit = grid instanceof Uint32Array || grid instanceof Uint16Array;
        for (let i = 0; i < 81; i++) {
            const raw = grid[i];
            if (raw === 0) continue;

            let val = 0;
            if (isBit) {
                val = SudokuBitUtils.getValue(raw);
            } else {
                val = raw;
            }

            if (val < 1 || val > 9) continue;
            const node = SudokuDLX.ROW_NODES[i * 10 + val];
            this.selectGiven(node);
            SudokuDLX.ACTIVE_STATES[i] = isBit ? raw : SudokuBitUtils.createSolved(val, true);
        }
    }

    static search(limit, fillResult = false) {
        let count = 0;
        let solved = false;

        const kernel = (depth) => {
            if (this.R[0] === 0) {
                count++;
                if (count >= limit) {
                    if (fillResult) solved = true;
                    return true;
                }
                return false;
            }
            if (depth > 81) return false;

            let c = this.R[0];
            let minSize = this.S[c];
            for (let n = this.R[c]; n !== 0; n = this.R[n]) {
                const s = this.S[n];
                if (s < minSize) {
                    minSize = s;
                    c = n;
                    if (minSize <= 1) break;
                }
            }

            if (minSize === 0) return false;

            this.cover(c);
            for (let r = this.D[c]; r !== c; r = this.D[r]) {
                const idx = this.RowR[r] * 9 + this.RowC[r];
                const oldVal = this.ACTIVE_STATES[idx];
                this.ACTIVE_STATES[idx] = SudokuBitUtils.createSolved(this.RowV[r], true);
                for (let j = this.R[r]; j !== r; j = this.R[j]) this.cover(this.C[j] & 0x3FF);
                const found = kernel(depth + 1);
                for (let j = this.L[r]; j !== r; j = this.L[j]) this.uncover(this.C[j] & 0x3FF);
                if (found) {
                    this.uncover(c);
                    return true;
                }
                if (!fillResult || !solved) {
                    this.ACTIVE_STATES[idx] = oldVal;
                }
            }
            this.uncover(c);
            return false;
        };

        kernel(0);
        return count;
    }

    static countSolutions(grid) {
        if (grid) this.applyGrid(grid);
        return this.search(2);
    }

    static solveAndFill(grid) {
        if (grid) this.applyGrid(grid);
        const count = this.search(1, true);
        if (count > 0) {
            if (grid instanceof Uint32Array) {
                grid.set(this.ACTIVE_STATES);
            } else {
                for (let i = 0; i < 81; i++) {
                    grid[i] = SudokuBitUtils.getValue(this.ACTIVE_STATES[i]);
                }
            }
            return true;
        }
        return false;
    }
}

class SudokuLogicalSolver {
    static initialized = false;
    static PEERS = new Uint8Array(81 * 20);
    static HOUSES = new Uint8Array(27 * 9);
    static CELL_HOUSES = new Uint8Array(81 * 3);
    static SCRATCH_BIT_GRID = new Uint32Array(81);
    static SCRATCH_INT_GRID = new Uint8Array(81);
    static HOUSE_MASKS = new Uint32Array(27 * 3); // precomputed 3-word bitboard mask per house

    static init() {
        if (this.initialized) return;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const idx = r * 9 + c;
                const peers = new Set();
                for (let i = 0; i < 9; i++) {
                    if (i !== c) peers.add(r * 9 + i);
                    if (i !== r) peers.add(i * 9 + c);
                }
                const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
                for (let i = br; i < br + 3; i++) {
                    for (let j = bc; j < bc + 3; j++) {
                        if (i !== r || j !== c) peers.add(i * 9 + j);
                    }
                }
                const peerArray = Array.from(peers);
                for (let p = 0; p < 20; p++) this.PEERS[idx * 20 + p] = peerArray[p];
            }
        }
        for (let i = 0; i < 9; i++) {
            const br = Math.floor(i / 3) * 3, bc = (i % 3) * 3;
            for (let j = 0; j < 9; j++) {
                this.HOUSES[i * 9 + j] = i * 9 + j;
                this.HOUSES[(9 + i) * 9 + j] = j * 9 + i;
                this.HOUSES[(18 + i) * 9 + j] = (br + Math.floor(j / 3)) * 9 + (bc + (j % 3));
            }
        }
        for (let i = 0; i < 81; i++) {
            const r = Math.floor(i / 9), c = i % 9, b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
            this.CELL_HOUSES[i * 3] = r;
            this.CELL_HOUSES[i * 3 + 1] = 9 + c;
            this.CELL_HOUSES[i * 3 + 2] = 18 + b;
        }
        // Precompute 3-word bitboard house masks for all 27 houses
        this.HOUSE_MASKS.fill(0);
        for (let h = 0; h < 27; h++) {
            for (let j = 0; j < 9; j++) {
                const ci = this.HOUSES[h * 9 + j];
                this.HOUSE_MASKS[h * 3 + (ci >> 5)] |= 1 << (ci & 31);
            }
        }
        this.initialized = true;
    }

    static evaluate(grid, targetRank = 4, sandbox = null) {
        this.init();
        const solver = sandbox || this.getShared();
        solver.reset(grid);
        return solver.solveByRank(targetRank);
    }
    static createSandbox() {
        return new SudokuLogicalSolver(new Uint8Array(81));
    }

    static shared = null;
    static getShared() {
        if (!this.shared) this.shared = this.createSandbox();
        return this.shared;
    }

    constructor(grid, fastMode = true) {
        SudokuLogicalSolver.init();
        this.difficultyLog = [];
        this.fillLog = [];
        this.fastMode = fastMode;
        this.unifiedBoard = fastMode ? null : new Uint32Array(81); // fastModeでは不要
        this.bb = new SudokuBitBoard();
        this.currentTechnique = null;
        this.reset(grid);
    }

    reset(grid) {
        this.difficultyLog.length = 0;
        this.fillLog.length = 0;

        if (this.fastMode) {
            // unifiedBoardを経由せず直接BBを構築
            this._rebuildBBFromGrid(grid);
        } else {
            // ロケットボタン用: unifiedBoardへの同期が必要
            if (grid instanceof Uint32Array || grid instanceof Uint16Array) {
                this.unifiedBoard.set(grid);
                for (let i = 0; i < 81; i++) {
                    const cell = this.unifiedBoard[i];
                    if (SudokuBitUtils.isSolved(cell)) {
                        const sol = (cell & SudokuBitUtils.BIT_SOLUTION_MASK) >>> SudokuBitUtils.BIT_SOLUTION_SHIFT;
                        if (sol > 0) {
                            this.unifiedBoard[i] = (cell & ~SudokuBitUtils.MASK_CANDIDATES) | (1 << (sol - 1));
                        }
                    }
                }
                SudokuBitUtils.updateAllCandidates(this.unifiedBoard);
            } else {
                this._fillUnifiedFromUint8(grid);
            }
            this.rebuildBB();
        }
    }

    // ─────────────────────────────────────────
    // 新設: unifiedBoardを経由せずグリッドから直接BBを構築
    // Uint8Array / Uint32Array どちらも受け取る
    // ─────────────────────────────────────────
    _rebuildBBFromGrid(grid) {
        this.bb.reset();
        const isBit = grid instanceof Uint32Array || grid instanceof Uint16Array;

        // まず確定セルをBBに登録
        for (let i = 0; i < 81; i++) {
            const raw = grid[i];
            if (raw === 0) continue;

            let val = isBit ? SudokuBitUtils.getValue(raw) : raw;
            if (val < 1 || val > 9) continue;

            this.bb.set(0, i); // confirmed
            this.bb.set(val, i);
        }

        // 未確定セルの候補をpeerから計算してBBに登録
        for (let i = 0; i < 81; i++) {
            if (this.bb.has(0, i)) continue; // 確定済みはスキップ

            let mask = SudokuBitUtils.MASK_CANDIDATES; // 全候補(1-9)
            for (let p = 0; p < 20; p++) {
                const peerIdx = SudokuLogicalSolver.PEERS[i * 20 + p];
                if (!this.bb.has(0, peerIdx)) continue;
                // peerの確定値を候補から除外
                for (let d = 1; d <= 9; d++) {
                    if (this.bb.has(d, peerIdx)) {
                        mask &= ~(1 << (d - 1));
                        break;
                    }
                }
            }

            for (let d = 1; d <= 9; d++) {
                if (mask & (1 << (d - 1))) this.bb.set(d, i);
            }
        }
    }

    _fillUnifiedFromUint8(uint8Grid) {
        this.unifiedBoard.fill(0);
        for (let i = 0; i < 81; i++) {
            if (uint8Grid[i] !== 0) {
                this.unifiedBoard[i] = SudokuBitUtils.createSolved(uint8Grid[i], true);
            }
        }
        SudokuBitUtils.updateAllCandidates(this.unifiedBoard);
    }

    rebuildBB() {
        this.bb.reset();
        for (let i = 0; i < 81; i++) {
            const cell = this.unifiedBoard[i];
            if (SudokuBitUtils.isSolved(cell)) {
                this.bb.set(0, i);
                const d = SudokuBitUtils.getValue(cell);
                if (d > 0) this.bb.set(d, i);
            } else {
                let m = cell & SudokuBitUtils.MASK_CANDIDATES;
                while (m) { const b = m & -m; this.bb.set(SudokuBitUtils.bitToDigit(b), i); m ^= b; }
            }
        }
    }

    isSolved() {
        // Confirmed cells are in bb index 0
        return this.bb.buf[0] === 0xFFFFFFFF &&
            this.bb.buf[1] === 0xFFFFFFFF &&
            (this.bb.buf[2] & 0x1FFFF) === 0x1FFFF;
    }
    getSolution(idx) { return SudokuBitUtils.getSolution(this.unifiedBoard[idx]); }

    isValid(idx, d) {
        return SudokuBitUtils.isValid(this.bb, idx, d);
    }

    clearCandidate(idx, d) {
        if (this.bb.has(0, idx)) return;
        if (!this.fastMode) {
            this.unifiedBoard[idx] &= ~(1 << (d - 1));
        }
        this.bb.clear(d, idx);
    }

    clearCandidates(idx, digitMask) {
        if (this.bb.has(0, idx)) return;
        if (!this.fastMode) {
            this.unifiedBoard[idx] &= ~(digitMask & SudokuBitUtils.MASK_CANDIDATES);
        }
        let m = digitMask & SudokuBitUtils.MASK_CANDIDATES;
        while (m) { const b = m & -m; this.bb.clear(SudokuBitUtils.bitToDigit(b), idx); m ^= b; }
    }

    setCellValue(idx, val, technique, silent = false) {
        if (!this.fastMode) {
            this.unifiedBoard[idx] = SudokuBitUtils.confirmValue(this.unifiedBoard[idx], val);
        }

        this.bb.set(0, idx);
        for (let d = 1; d <= 9; d++) {
            if (d !== val) this.bb.clear(d, idx);
        }

        const mask = ~(1 << (val - 1));
        SudokuBitUtils.forEachPeer(idx, (peerIdx) => {
            if (!this.bb.has(0, peerIdx)) {
                if (!this.fastMode) {
                    this.unifiedBoard[peerIdx] &= mask;
                }
                this.bb.clear(val, peerIdx);
            }
        });
        if (!silent) {
            this.difficultyLog.push({ technique: technique, idx: idx, val: val });
        }
        this.fillLog.push(idx);
    }

    // difficultyLog からテクニック使用回数を集計
    // basic (Singles) は除外
    getTechniqueCounts() {
        const counts = {};
        for (const item of this.difficultyLog) {
            if (item.technique === 'Naked Single' || item.technique === 'Hidden Single') continue;
            counts[item.technique] = (counts[item.technique] || 0) + 1;
        }
        return counts;
    }

    solveByRank(maxRank) {
        const finalRank = LogicalRules.analyzeFull(this);
        const solved = this.isSolved();
        const info = this.getDifficultyInfo();
        let difficulty = info.level;
        let technique = info.technique;
        const techniqueCounts = this.getTechniqueCounts();

        if (!solved) {
            difficulty = 'hard';
            technique = 'Extreme';
        }
        return {
            solved,
            difficulty,
            rank: DIFFICULTY_RANK[difficulty] || 1,
            technique,
            techniqueCounts
        };
    }

    getDifficultyInfo() {
        return getDifficultyLevel(this.difficultyLog);
    }

    static forEachPeer(idx, callback) { SudokuBitUtils.forEachPeer(idx, callback); }
    static cellConflicts(grid, idx, num) { return SudokuBitUtils.cellConflicts(grid, idx, num); }
    static isValid(grid, idx, num) { return SudokuBitUtils.isValid(grid, idx, num); }

    static shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

/* --- Engine Execution Manifesto --- */

let TECH_BY_RANK = null;
let TECHNIQUE_LEVELS = null;

/**
 * LogicalRules: Antigravity の全エンジンが遵守すべき「掟」
 */
const LogicalRules = {
    // 人間系Basic埋め立て（Naked -> Hidden -> Reset to Naked）
    applyBasicProtocol(solver, silent = false) {
        let changed = false;
        let loop = true;
        while (loop) {
            loop = false;
            if (typeof TECHNIQUES !== 'undefined') {
                solver.currentTechnique = TECHNIQUES[0].name; // Naked Single
                if (TECHNIQUES[0].applyLogical(solver, silent)) {
                    changed = loop = true;
                    continue;
                }
                solver.currentTechnique = TECHNIQUES[1].name; // Hidden Single
                if (TECHNIQUES[1].applyLogical(solver, silent)) {
                    changed = loop = true;
                }
            }
        }
        solver.currentTechnique = null;
        return changed;
    },

    // 人間系・滝登り型フル鑑定（オーケストレーター / OCR用）
    analyzeFull(solver) {
        let maxRank = 1;
        let isProgressing = true;

        while (isProgressing) {
            isProgressing = false;

            // 1. Basicを出し尽くす
            if (this.applyBasicProtocol(solver)) {
                isProgressing = true;
                continue;
            }

            // 2. Rank 2 -> 3 -> 4 の順に1つだけ手筋を適用
            if (TECH_BY_RANK) {
                for (let r = 2; r <= 4; r++) {
                    const techs = TECH_BY_RANK[r];
                    let found = false;
                    for (const tech of techs) {
                        solver.currentTechnique = tech.name;
                        if (tech.applyLogical(solver)) {
                            maxRank = Math.max(maxRank, r);
                            found = true;
                            break;
                        }
                    }
                    if (found) {
                        isProgressing = true;
                        break;
                    }
                }
            }
        }
        solver.currentTechnique = null;
        return maxRank;
    }
};

/**
 * Summarize human-readable difficulty from a difficultyLog
 */
function getDifficultyLevel(log) {
    if (!log || log.length === 0) return { level: 'basic', technique: 'Naked Single' };

    let maxRank = -1;
    let bestItem = null;

    for (const item of log) {
        const tech = (typeof TECHNIQUES !== 'undefined') ?
            (TECHNIQUES.find(t => t.name === item.technique)
                || (item.technique.startsWith('Locked Candidates') ? TECHNIQUES.find(t => t.id === 'lockedCandidates') : null))
            : null;
        const rank = tech ? tech.rank : 1;

        if (rank > maxRank) {
            maxRank = rank;
            bestItem = item;
        }
    }

    const finalLevel = Object.keys(DIFFICULTY_RANK).find(key => DIFFICULTY_RANK[key] === maxRank) || 'basic';
    return {
        level: finalLevel,
        technique: bestItem ? bestItem.technique : 'Naked Single'
    };
}

/**
 * Perform a logical step directly on the unified bit board.
 * Stage 1: Fill confirmed cells only (silent, no memos show).
 * Stage 2: Sync and prune logical memos using advanced techniques.
 */
SudokuLogicalSolver.solveStep = function (unifiedBoard, _unused, sandbox = null) {
    const solver = sandbox || new SudokuLogicalSolver(unifiedBoard, false);
    if (sandbox) {
        if (solver.fastMode) {
            solver.fastMode = false;
            solver.unifiedBoard = new Uint32Array(81);
        }
        solver.reset(unifiedBoard);
    }

    // 1. Singles 判定 (Naked/Hidden)
    if (LogicalRules.applyBasicProtocol(solver, true)) {
        let changed = false;
        for (let i = 0; i < 81; i++) {
            const brainCell = solver.unifiedBoard[i];
            if (SudokuBitUtils.isSolved(brainCell) && !SudokuBitUtils.isSolved(unifiedBoard[i])) {
                unifiedBoard[i] = (unifiedBoard[i] & 0xFFFF0000) | (brainCell & 0xFFFF);
                changed = true;
            }
        }
        if (changed) {
            SudokuBitUtils.updateErrorFlags(unifiedBoard);
            return { type: 'fill', feedbackKey: 'rocketFilled' };
        }
    }

    // 2. 空白マスの判定 (確定もメモもないマスが1マスでもあるか)
    let hasBlankCell = false;
    for (let i = 0; i < 81; i++) {
        if (!SudokuBitUtils.isSolved(unifiedBoard[i])) {
            if ((unifiedBoard[i] & SudokuBitUtils.MASK_CANDIDATES) === 0) {
                hasBlankCell = true;
                break;
            }
        }
    }

    // 3. メモ剪定の準備 (全てのケースで実行)
    // BB のメモを現在の確定状況から一度全埋めし、剪定を行う
    const tempBoard = new Uint32Array(unifiedBoard);
    SudokuBitUtils.clearUnsolvedCandidates(tempBoard); // 既存メモを無視して確定値だけ残す
    SudokuBitUtils.updateAllCandidates(tempBoard);      // 確定値から全メモを再展開 (Standard Pruning 含む)
    
    const pruningSolver = new SudokuLogicalSolver(tempBoard, false);
    if (typeof pruningSolver.lockedCandidates === 'function') {
        pruningSolver.lockedCandidates(); // Locked Candidates による剪定
    }

    // 4. UI メモとの比較・適用
    // hasBlankCell が真なら「ユーザーのメモに関係なく全上書き」
    // 偽なら「ユーザーが消したメモは維持しつつ（論理積）剪定」
    let finalChanged = false;
    for (let i = 0; i < 81; i++) {
        if (SudokuBitUtils.isSolved(unifiedBoard[i])) continue;

        const uiMemo = unifiedBoard[i] & SudokuBitUtils.MASK_CANDIDATES;
        const prunedMemo = pruningSolver.bb.getCellMask(i);
        
        let newMemo = hasBlankCell ? prunedMemo : (uiMemo & prunedMemo);

        if (newMemo !== uiMemo) {
            unifiedBoard[i] = (unifiedBoard[i] & ~SudokuBitUtils.MASK_CANDIDATES) | newMemo;
            finalChanged = true;
        }
    }

    if (finalChanged) {
        SudokuBitUtils.updateErrorFlags(unifiedBoard);
        // feedbackKey を状況に合わせて出し分け
        return { 
            type: 'memo', 
            feedbackKey: hasBlankCell ? 'memoDone' : 'memoPruned' 
        };
    }


    return null;
};


/**
 * Connect the logical engine to a specific dictionary of techniques.
 */
SudokuLogicalSolver.connectDictionary = function (techniques) {
    TECH_BY_RANK = {
        1: techniques.filter(t => t.rank === 1),
        2: techniques.filter(t => t.rank === 2),
        3: techniques.filter(t => t.rank === 3),
        4: techniques.filter(t => t.rank === 4)
    };

    TECHNIQUE_LEVELS = {};
    for (const tech of techniques) {
        const level = Object.keys(DIFFICULTY_RANK).find(key => DIFFICULTY_RANK[key] === tech.rank) || 'basic';
        TECHNIQUE_LEVELS[tech.name] = level;
    }
    TECHNIQUE_LEVELS['Locked Candidates (Pointing)'] = 'easy';
    TECHNIQUE_LEVELS['Locked Candidates (Claiming)'] = 'easy';

    for (const tech of techniques) {
        SudokuLogicalSolver.prototype[tech.id] = function () {
            return tech.applyLogical(this);
        };
    }
};
