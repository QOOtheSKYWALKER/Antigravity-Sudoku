/**
 * ============================================================================
 * SUDOKU ENGINE - CORE
 * ============================================================================
 * 
 * Optimized Bit-Centric Sudoku Engine for Antigravity.
 * Includes DLX for brute-force and Logical Solver for human-like deduction.
 */

// ============================================================================
// [SECTION 1: BIT UTILITIES]
// Pure bit manipulation logic and unified bit representation layout.
// ============================================================================

export class SudokuBitUtils {
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
        return SudokuLogicalSolver.bitToDigit(bits);
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
                this.forEachPeer(i, (p) => {
                    if (intGrid[p] === val) {
                        conflict = true;
                    }
                });
                if (conflict) bitGrid[i] |= this.BIT_UI_ERROR;
                else bitGrid[i] &= ~this.BIT_UI_ERROR;
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

    static shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

// ============================================================================
// [SECTION 2: BITBOARD STRUCTURE]
// Digit-centric presence masks for rapid deduction.
// ============================================================================

export class SudokuBitBoard {
    static initialized = false;
    static PEERS = new Uint8Array(81 * 20);
    static HOUSES = new Uint8Array(27 * 9);
    static CELL_HOUSES = new Uint8Array(81 * 3);
    static HOUSE_MASKS = new Uint32Array(27 * 3);
    static ADJACENCY_MATRIX = new Uint8Array(81 * 81);

    static init() {
        if (this.initialized) return;
        this.initialized = true;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const idx = r * 9 + c;
                const peers = new Set();
                for (let i = 0; i < 9; i++) { if (i !== c) peers.add(r * 9 + i); if (i !== r) peers.add(i * 9 + c); }
                const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
                for (let i = br; i < br + 3; i++) for (let j = bc; j < bc + 3; j++) if (i !== r || j !== c) peers.add(i * 9 + j);
                const peerArray = Array.from(peers);
                for (let p = 0; p < 20; p++) {
                    const pi = peerArray[p]; this.PEERS[idx * 20 + p] = pi; this.ADJACENCY_MATRIX[idx * 81 + pi] = 1;
                }
            }
        }
        for (let i = 0; i < 9; i++) {
            const br = (i / 3 | 0) * 3, bc = (i % 3) * 3;
            for (let j = 0; j < 9; j++) {
                this.HOUSES[i * 9 + j] = i * 9 + j;
                this.HOUSES[(9 + i) * 9 + j] = j * 9 + i;
                this.HOUSES[(18 + i) * 9 + j] = (br + (j / 3 | 0)) * 9 + (bc + (j % 3));
            }
        }
        for (let i = 0; i < 81; i++) {
            const r = i / 9 | 0, c = i % 9, b = (r / 3 | 0) * 3 + (c / 3 | 0);
            this.CELL_HOUSES[i * 3] = r; this.CELL_HOUSES[i * 3 + 1] = 9 + c; this.CELL_HOUSES[i * 3 + 2] = 18 + b;
        }
        this.HOUSE_MASKS.fill(0);
        for (let h = 0; h < 27; h++) {
            for (let j = 0; j < 9; j++) {
                const ci = this.HOUSES[h * 9 + j];
                this.HOUSE_MASKS[h * 3 + (ci >> 5)] |= 1 << (ci & 31);
            }
        }
    }

    static sees(i, j) { return this.ADJACENCY_MATRIX[i * 81 + j] === 1; }

    constructor() {
        SudokuBitBoard.init();
        this.buf = new Uint32Array(30);
    }

    reset() { this.buf.fill(0); }

    has(d, i) { return (this.buf[d * 3 + (i >> 5)] >>> (i & 31)) & 1; }
    set(d, i) { this.buf[d * 3 + (i >> 5)] |= (1 << (i & 31)); }
    clear(d, i) { this.buf[d * 3 + (i >> 5)] &= ~(1 << (i & 31)); }

    rowMask(d, r) {
        const start = r * 9, w = start >>> 5, shift = start & 31, base = d * 3;
        if (shift <= 23) return (this.buf[base + w] >>> shift) & 0x1FF;
        return ((this.buf[base + w] >>> shift) | (this.buf[base + w + 1] << (32 - shift))) & 0x1FF;
    }

    colMask(d, c) {
        let mask = 0;
        const base = d * 3;
        const colStart = (9 + c) * 9;
        const H = SudokuLogicalSolver.HOUSES;
        for (let r = 0; r < 9; r++) {
            const i = H[colStart + r];
            if ((this.buf[base + (i >> 5)] >>> (i & 31)) & 1) mask |= (1 << r);
        }
        return mask;
    }

    houseCount(d, h0, h1, h2) {
        const b = d * 3;
        return SudokuLogicalSolver.popcount(this.buf[b] & h0) +
            SudokuLogicalSolver.popcount(this.buf[b + 1] & h1) +
            SudokuLogicalSolver.popcount(this.buf[b + 2] & h2);
    }

    houseFirstCell(d, h0, h1, h2) {
        const b = d * 3;
        let w;
        w = this.buf[b] & h0; if (w) return 31 - Math.clz32(w & -w);
        w = this.buf[b + 1] & h1; if (w) return 63 - Math.clz32(w & -w);
        w = this.buf[b + 2] & h2; if (w) return 95 - Math.clz32(w & -w);
        return -1;
    }

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

// ============================================================================
// [SECTION 3: DLX BRUTE-FORCE SOLVER]
// Exact cover algorithm for counting and obtaining valid solutions.
// ============================================================================

export class SudokuDLX {
    static MAX_NODES = 1 + 324 + (9 * 9 * 9 * 4);

    static L = null; static R = null; static U = null; static D = null; static C = null; static S = null;
    static CLEAN_L = null; static CLEAN_R = null; static CLEAN_U = null; static CLEAN_D = null; static CLEAN_S = null;
    static RowR = null; static RowC = null; static RowV = null; static ROW_NODES = null;
    static ACTIVE_STATES = null; static ZOBRIST_TABLE = null;

    static COL_MASK = 0x3FF;
    static initialized = false;

    static init() {
        if (this.L !== null) return;

        const N = this.MAX_NODES;
        this.L = new Int32Array(N); this.R = new Int32Array(N); this.U = new Int32Array(N); this.D = new Int32Array(N);
        this.C = new Int32Array(N); this.S = new Int32Array(325);

        this.CLEAN_L = new Int32Array(325); this.CLEAN_R = new Int32Array(325);
        this.CLEAN_U = new Int32Array(N); this.CLEAN_D = new Int32Array(N); this.CLEAN_S = new Int32Array(325);

        this.RowR = new Uint8Array(N); this.RowC = new Uint8Array(N); this.RowV = new Uint8Array(N);
        this.ROW_NODES = new Int32Array(81 * 10);
        this.ACTIVE_STATES = new Uint32Array(81);
        this.ZOBRIST_TABLE = new BigUint64Array(81 * 10);

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
            this.L[i] = i - 1; this.R[i] = i + 1; this.U[i] = i; this.D[i] = i; this.C[i] = i; this.S[i] = 0;
        }
        this.L[ROOT] = 324; this.R[324] = ROOT;

        let nodeCount = 324;
        const addRow = (r, c, n) => {
            const b = (r / 3 | 0) * 3 + (c / 3 | 0);
            const constraints = [r * 9 + c + 1, 81 + r * 9 + (n - 1) + 1, 162 + c * 9 + (n - 1) + 1, 243 + b * 9 + (n - 1) + 1];
            const rowFirstNode = nodeCount + 1;
            for (let i = 0; i < 4; i++) {
                const node = ++nodeCount;
                const colIdx = constraints[i];
                this.C[node] = colIdx; this.RowR[node] = r; this.RowC[node] = c; this.RowV[node] = n;
                this.U[node] = this.U[colIdx]; this.D[node] = colIdx;
                this.D[this.U[colIdx]] = node; this.U[colIdx] = node; this.S[colIdx]++;
                this.L[node] = (i === 0) ? rowFirstNode + 3 : node - 1;
                this.R[node] = (i === 3) ? rowFirstNode : node + 1;
            }
            this.ROW_NODES[(r * 9 + c) * 10 + n] = rowFirstNode;
        };

        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let n = 1; n <= 9; n++) addRow(r, c, n);

        this.CLEAN_L.set(this.L.subarray(0, 325)); this.CLEAN_R.set(this.R.subarray(0, 325));
        this.CLEAN_U.set(this.U); this.CLEAN_D.set(this.D); this.CLEAN_S.set(this.S);
    }

    static reset() {
        this.init();
        this.L.set(this.CLEAN_L, 0); this.R.set(this.CLEAN_R, 0); this.U.set(this.CLEAN_U); this.D.set(this.CLEAN_D);
        this.S.set(this.CLEAN_S); this.ACTIVE_STATES.fill(0);
    }

    static clearMetaBits() {
        this.ACTIVE_STATES.fill(0);
    }

    static cover(c) {
        this.R[this.L[c]] = this.R[c]; this.L[this.R[c]] = this.L[c];
        for (let i = this.D[c]; i !== c; i = this.D[i]) {
            for (let j = this.R[i]; j !== i; j = this.R[j]) {
                this.D[this.U[j]] = this.D[j]; this.U[this.D[j]] = this.U[j];
                this.S[this.C[j]]--;
            }
        }
    }

    static uncover(c) {
        for (let i = this.U[c]; i !== c; i = this.U[i]) {
            for (let j = this.L[i]; j !== i; j = this.L[j]) {
                this.S[this.C[j]]++; this.D[this.U[j]] = j; this.U[this.D[j]] = j;
            }
        }
        this.R[this.L[c]] = c; this.L[this.R[c]] = c;
    }

    static selectGiven(rowNode) {
        this.cover(this.C[rowNode]);
        for (let j = this.R[rowNode]; j !== rowNode; j = this.R[j]) this.cover(this.C[j]);
    }

    static applyGrid(grid) {
        this.reset();
        const isBit = grid instanceof Uint32Array || grid instanceof Uint16Array;
        for (let i = 0; i < 81; i++) {
            const val = isBit ? SudokuBitUtils.getValue(grid[i]) : grid[i];
            if (val < 1 || val > 9) continue;
            const node = this.ROW_NODES[i * 10 + val];
            if (node) {
                this.selectGiven(node);
                this.ACTIVE_STATES[i] = isBit ? grid[i] : SudokuBitUtils.createSolved(val, true);
            }
        }
    }

    static search(limit, fillResult = false) {
        let count = 0; let solved = false;
        const kernel = (depth) => {
            if (this.R[0] === 0) {
                count++;
                if (count >= limit) { if (fillResult) solved = true; return true; }
                return false;
            }
            if (depth > 81) return false;
            let c = this.R[0]; let minSize = this.S[c];
            for (let n = this.R[c]; n !== 0; n = this.R[n]) {
                const s = this.S[n];
                if (s < minSize) { minSize = s; c = n; if (minSize <= 1) break; }
            }
            if (minSize === 0) return false;
            this.cover(c);
            for (let r = this.D[c]; r !== c; r = this.D[r]) {
                const idx = this.RowR[r] * 9 + this.RowC[r];
                const oldVal = this.ACTIVE_STATES[idx];
                this.ACTIVE_STATES[idx] = SudokuBitUtils.createSolved(this.RowV[r], true);
                for (let j = this.R[r]; j !== r; j = this.R[j]) this.cover(this.C[j]);
                const found = kernel(depth + 1);
                for (let j = this.L[r]; j !== r; j = this.L[j]) this.uncover(this.C[j]);
                if (found) { this.uncover(c); return true; }
                if (!fillResult || !solved) this.ACTIVE_STATES[idx] = oldVal;
            }
            this.uncover(c); return false;
        };
        kernel(0); return count;
    }

    static countSolutions(grid) {
        if (grid) this.applyGrid(grid);
        return this.search(2);
    }

    static solveAndFill(grid) {
        if (grid) this.applyGrid(grid);
        const count = this.search(1, true);
        if (count > 0) {
            if (grid instanceof Uint32Array) grid.set(this.ACTIVE_STATES);
            else for (let i = 0; i < 81; i++) grid[i] = SudokuBitUtils.getValue(this.ACTIVE_STATES[i]);
            return true;
        }
        return false;
    }
}

// ============================================================================
// [SECTION 4: LOGICAL SOLVER]
// Simulates human-like deduction steps and manages solver state.
// ============================================================================

export class SudokuLogicalSolver {
    static MASK_CANDIDATES = 0x01FF;

    // Delegate to SudokuBitBoard for metadata and initialization
    static init() { return SudokuBitBoard.init(); }
    static get PEERS() { return SudokuBitBoard.PEERS; }
    static get HOUSES() { return SudokuBitBoard.HOUSES; }
    static get CELL_HOUSES() { return SudokuBitBoard.CELL_HOUSES; }
    static get HOUSE_MASKS() { return SudokuBitBoard.HOUSE_MASKS; }
    static sees(i, j) { return SudokuBitBoard.sees(i, j); }

    static DIMENSIONS = [
        { name: 'row', mask: (bb, d, i) => bb.rowMask(d, i), toIdx: (i, pos) => i * 9 + pos },
        { name: 'col', mask: (bb, d, i) => bb.colMask(d, i), toIdx: (i, pos) => pos * 9 + i }
    ];

    static popcount(n) {
        let count = 0;
        let v = n >>> 0;
        while (v) { v &= (v - 1); count++; }
        return count;
    }

    static bitToDigit(bit) {
        return (Math.log2(bit & 0x1FF) + 1) | 0;
    }

    static forEachBit(mask, callback) {
        let m = mask & 0x01FF;
        while (m) {
            const bit = m & -m;
            m ^= bit;
            callback(this.bitToDigit(bit) - 1);
        }
    }

    static isValidBB(bb, idx, digit) {
        const pBase = idx * 20;
        for (let i = 0; i < 20; i++) {
            const pi = this.PEERS[pBase + i];
            if (bb.has(0, pi) && bb.has(digit, pi)) return false;
        }
        return true;
    }

    constructor(grid, fastMode = true) {
        SudokuLogicalSolver.init();
        this.difficultyLog = [];
        this.fillLog = [];
        this.fastMode = fastMode;
        this.unifiedBoard = fastMode ? null : new Uint32Array(81);
        this.bb = new SudokuBitBoard();
        this.biCells = [];
        this.metadataDirty = true;
        this.currentTechnique = null;
        this.reset(grid);
    }

    reset(grid) {
        this.difficultyLog.length = 0;
        this.fillLog.length = 0;
        if (this.fastMode) {
            this._rebuildBBFromGrid(grid);
        } else {
            if (grid instanceof Uint32Array || grid instanceof Uint16Array) {
                this.unifiedBoard.set(grid);
                for (let i = 0; i < 81; i++) {
                    const cell = this.unifiedBoard[i];
                    if (SudokuBitUtils.isSolved(cell)) {
                        const sol = SudokuBitUtils.getSolution(cell);
                        if (sol > 0) this.unifiedBoard[i] = (cell & ~SudokuBitUtils.MASK_CANDIDATES) | (1 << (sol - 1));
                    }
                }
                SudokuBitUtils.updateAllCandidates(this.unifiedBoard);
            } else {
                this._fillUnifiedFromUint8(grid);
            }
            this.rebuildBB();
        }
        this.updateMetadata();
    }

    getBiCells() {
        if (this.metadataDirty) this.updateMetadata();
        return this.biCells;
    }

    updateMetadata() {
        this.biCells = [];
        for (let i = 0; i < 81; i++) {
            if (!this.bb.has(0, i) && SudokuLogicalSolver.popcount(this.bb.getCellMask(i)) === 2) this.biCells.push(i);
        }
        this.metadataDirty = false;
    }

    _rebuildBBFromGrid(grid) {
        this.bb.reset();
        const isBit = grid instanceof Uint32Array || grid instanceof Uint16Array;
        for (let i = 0; i < 81; i++) {
            const val = isBit ? SudokuBitUtils.getValue(grid[i]) : grid[i];
            if (val > 0 && val <= 9) { this.bb.set(0, i); this.bb.set(val, i); }
        }
        for (let i = 0; i < 81; i++) {
            if (this.bb.has(0, i)) continue;
            let mask = SudokuBitUtils.MASK_CANDIDATES;
            for (let p = 0; p < 20; p++) {
                const pi = SudokuLogicalSolver.PEERS[i * 20 + p];
                if (!this.bb.has(0, pi)) continue;
                for (let d = 1; d <= 9; d++) { if (this.bb.has(d, pi)) { mask &= ~(1 << (d - 1)); break; } }
            }
            for (let d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) this.bb.set(d, i);
        }
    }

    _fillUnifiedFromUint8(grid) {
        this.unifiedBoard.fill(0);
        for (let i = 0; i < 81; i++) if (grid[i] !== 0) this.unifiedBoard[i] = SudokuBitUtils.createSolved(grid[i], true);
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
                while (m) { const b = m & -m; this.bb.set(SudokuLogicalSolver.bitToDigit(b), i); m ^= b; }
            }
        }
    }

    isSolved() {
        return this.bb.buf[0] === 0xFFFFFFFF && this.bb.buf[1] === 0xFFFFFFFF && (this.bb.buf[2] & 0x1FFFF) === 0x1FFFF;
    }

    clearCandidate(idx, d) {
        if (this.bb.has(0, idx)) return;
        if (!this.fastMode) this.unifiedBoard[idx] &= ~(1 << (d - 1));
        this.bb.clear(d, idx);
        this.metadataDirty = true;
    }

    clearCandidates(idx, mask) {
        if (this.bb.has(0, idx)) return;
        if (!this.fastMode) this.unifiedBoard[idx] &= ~(mask & SudokuBitUtils.MASK_CANDIDATES);
        let m = mask & SudokuBitUtils.MASK_CANDIDATES;
        while (m) { const b = m & -m; this.bb.clear(SudokuLogicalSolver.bitToDigit(b), idx); m ^= b; }
        this.metadataDirty = true;
    }

    setCellValue(idx, val, technique, silent = false) {
        if (!this.fastMode) this.unifiedBoard[idx] = SudokuBitUtils.confirmValue(this.unifiedBoard[idx], val);
        this.bb.set(0, idx);
        for (let d = 1; d <= 9; d++) if (d !== val) this.bb.clear(d, idx);
        const mask = ~(1 << (val - 1));
        SudokuBitUtils.forEachPeer(idx, (p) => {
            if (!this.bb.has(0, p)) {
                if (!this.fastMode) this.unifiedBoard[p] &= mask;
                this.bb.clear(val, p);
            }
        });
        if (!silent) this.difficultyLog.push({ technique, idx, val });
        this.fillLog.push(idx);
        this.metadataDirty = true;
    }

}

// ============================================================================
// [SECTION 5: STRATEGY & ORCHESTRATION]
// Evaluation strategies, logical rules, and difficulty assessment.
// ============================================================================

let TECH_BY_RANK = null;
let TECHNIQUE_LEVELS = null;

export const DifficultyEvaluator = {
    RANK_NAMES: ['basic', 'easy', 'medium', 'hard'],

    evaluate(grid, targetRank = 4, sandbox = null) {
        SudokuLogicalSolver.init();
        const solver = sandbox || DifficultyEvaluator.createSandbox();
        solver.reset(grid);
        return DifficultyEvaluator.solveByRank(solver, targetRank);
    },

    createSandbox() { return new SudokuLogicalSolver(new Uint8Array(81)); },

    shared: null,
    getShared() {
        if (!this.shared) this.shared = this.createSandbox();
        return this.shared;
    },

    solveByRank(solver, maxRank) {
        SudokuLogicalSolver.init();
        const finalRank = LogicalRules.analyzeFull(solver, maxRank);
        const solved = solver.isSolved();
        const info = this.getDifficultyInfo(solver.difficultyLog);
        const techniqueCounts = {};
        for (const it of solver.difficultyLog) techniqueCounts[it.technique] = (techniqueCounts[it.technique] || 0) + 1;

        // Ensure rank is at least 1 if solved, or 4 if not logically solved
        let rank = Math.max(1, info.rank);
        let technique = (info.technique === 'N/A' || !info.technique) && solved ? 'Naked Single' : info.technique;

        if (!solved) { rank = 4; technique = 'Extreme'; }

        return { solved, difficulty: this.rankToName(rank), rank, technique, techniqueCounts };
    },

    getDifficultyInfo(log) {
        let maxRank = -1, bestItem = null;
        for (const item of log) {
            const r = (TECHNIQUE_LEVELS && TECHNIQUE_LEVELS[item.technique]) || 1;
            if (r > maxRank) { maxRank = r; bestItem = item; }
        }
        return { rank: maxRank, technique: bestItem ? bestItem.technique : 'N/A' };
    },

    nameToRank(name) {
        const idx = this.RANK_NAMES.indexOf(name?.toLowerCase());
        return idx === -1 ? 0 : idx + 1;
    },

    rankToName(rank) {
        return this.RANK_NAMES[rank - 1] || 'basic';
    },

    connectDictionary(techniques) {
        TECH_BY_RANK = {
            1: techniques.filter(t => t.rank === 1),
            2: techniques.filter(t => t.rank === 2),
            3: techniques.filter(t => t.rank === 3),
            4: techniques.filter(t => t.rank === 4)
        };
        TECHNIQUE_LEVELS = {};
        for (const t of techniques) {
            TECHNIQUE_LEVELS[t.name] = t.rank;
            SudokuLogicalSolver.prototype[t.id] = function () { return t.applyLogical(this); };
        }
    }
};

const LogicalRules = {
    analyzeFull(solver) {
        let maxRank = 1;
        let rank = 1;

        while (rank <= 4) {
            let found = false;
            const techs = TECH_BY_RANK?.[rank] ?? [];

            for (const tech of techs) {
                solver.currentTechnique = tech.name;
                if (tech.applyLogical(solver)) {
                    maxRank = Math.max(maxRank, rank);
                    found = true;
                    break;
                }
            }

            if (found) {
                rank = 1;
            } else {
                rank++;
            }
        }
        solver.currentTechnique = null;
        return maxRank;
    }
};

// ============================================================================
// [SECTION 6: UI INTEGRATION BRIDGE]
// Logic for UI-specific tasks, such as the "Rocket" step button.
// ============================================================================

export const SudokuUIBridge = {
    /**
     * Rocket Button Logic: Fills logical singles or prunes memos.
     */
    solveStep: function (unifiedBoard, _unused, sandbox = null) {
        const solver = sandbox || new SudokuLogicalSolver(unifiedBoard, false);
        if (sandbox) {
            if (solver.fastMode) { solver.fastMode = false; solver.unifiedBoard = new Uint32Array(81); }
            solver.reset(unifiedBoard);
        }

        // 1. Try Rank 1 (Naked/Hidden Singles)
        let anyProgress = false;
        let loop = true;
        while (loop) {
            loop = false;
            for (const tech of TECH_BY_RANK?.[1] ?? []) {
                if (tech.applyLogical(solver, true)) {
                    anyProgress = true;
                    loop = true;
                    break;
                }
            }
        }

        if (anyProgress) {
            let fillChanged = false;
            for (let i = 0; i < 81; i++) {
                const bCell = solver.unifiedBoard[i];
                if (SudokuBitUtils.isSolved(bCell) && !SudokuBitUtils.isSolved(unifiedBoard[i])) {
                    unifiedBoard[i] = (unifiedBoard[i] & 0xFFFF0000) | (bCell & 0xFFFF);
                    fillChanged = true;
                }
            }
            if (fillChanged) {
                SudokuBitUtils.updateErrorFlags(unifiedBoard);
                return { type: 'fill', feedbackKey: 'rocketFilled' };
            }
        }

        // 2. Try Rank 2 (Locked Candidates / Pruning)
        // Check if dashboard has manual blanks with no candidates
        let hasBlank = false;
        for (let i = 0; i < 81; i++) {
            if (!SudokuBitUtils.isSolved(unifiedBoard[i]) && (unifiedBoard[i] & SudokuBitUtils.MASK_CANDIDATES) === 0) {
                hasBlank = true; break;
            }
        }

        const tempBoard = new Uint32Array(unifiedBoard);
        SudokuBitUtils.clearUnsolvedCandidates(tempBoard);
        SudokuBitUtils.updateAllCandidates(tempBoard);

        const pruningSolver = new SudokuLogicalSolver(tempBoard, false);
        let pruned = true;
        while (pruned) {
            pruned = false;
            for (const tech of (TECH_BY_RANK?.[2] ?? [])) {
                if (tech.applyLogical(pruningSolver)) {
                    pruned = true;
                    break;
                }
            }
        }

        let finalChanged = false;
        for (let i = 0; i < 81; i++) {
            if (SudokuBitUtils.isSolved(unifiedBoard[i])) continue;
            const uiMemo = unifiedBoard[i] & SudokuBitUtils.MASK_CANDIDATES;
            const resMemo = pruningSolver.bb.getCellMask(i);
            let newMemo = hasBlank ? resMemo : (uiMemo & resMemo);
            if (newMemo !== uiMemo) {
                unifiedBoard[i] = (unifiedBoard[i] & ~SudokuBitUtils.MASK_CANDIDATES) | newMemo;
                finalChanged = true;
            }
        }

        if (finalChanged) {
            SudokuBitUtils.updateErrorFlags(unifiedBoard);
            return { type: 'memo', feedbackKey: hasBlank ? 'memoDone' : 'memoPruned' };
        }

        return null;
    }
};
