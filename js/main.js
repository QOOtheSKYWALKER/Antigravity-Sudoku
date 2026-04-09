/**
 * Sudoku Application Main Entry (main.js)
 * Architecture: State -> View -> Controller
 */

import { SudokuBitUtils as Utils, DifficultyEvaluator, SudokuUIBridge } from './solver.js';
import { t, tTechnique, applyLanguage, currentLang } from './i18n.js';
import { TECHNIQUES } from './solver-techniques.js';

/**
 * 1. App Settings & Persistence
 */
const AppSettings = {
    getTheme: () => localStorage.getItem('sudoku-theme') || 'dark',
    setTheme: (theme) => {
        localStorage.setItem('sudoku-theme', theme);
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    },
    getDifficulty: () => localStorage.getItem('sudoku-difficulty') || 'easy',
    setDifficulty: (diff) => localStorage.setItem('sudoku-difficulty', diff),
    init() {
        this.setTheme(this.getTheme());
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.getTheme() === 'system') this.setTheme('system');
        });
    }
};

/**
 * 2. Sudoku Game Engine (State & Business Logic)
 */
class SudokuGame {
    constructor() {
        this.board = new Uint32Array(81);
        this.initialSnapshot = new Uint32Array(81);
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 127;
        this.memoMode = false;
        this.lastInputNumber = 0;
        this.currentTechnique = '';
    }

    setBoard(puzzle, technique = '') {
        this.board.set(puzzle);
        this.currentTechnique = technique;
        this.clearHistory();
    }

    captureInitialSnapshot() {
        this.initialSnapshot.set(this.board);
    }

    reset() {
        this.board.set(this.initialSnapshot);
        this.clearHistory();
        Utils.updateErrorFlags(this.board);
    }

    clearHistory() {
        this.undoStack = [];
        this.redoStack = [];
        this.lastInputNumber = 0;
    }

    pushUndo() {
        this.undoStack.push(new Uint32Array(this.board));
        if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length === 0) return false;
        this.redoStack.push(new Uint32Array(this.board));
        this.board.set(this.undoStack.pop());
        Utils.updateErrorFlags(this.board);
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;
        this.undoStack.push(new Uint32Array(this.board));
        this.board.set(this.redoStack.pop());
        Utils.updateErrorFlags(this.board);
        return true;
    }

    applyInput(idx, num) {
        const cell = this.board[idx];
        if (!Utils.canModify(cell)) return false;

        let nextCell = this.memoMode ? Utils.toggleCandidate(cell, num) : Utils.confirmValue(cell, num);
        if (nextCell === cell) return false;

        this.pushUndo();
        this.board[idx] = nextCell;

        if (!this.memoMode) {
            const intGrid = Utils.toIntGrid(this.board);
            if (!Utils.cellConflicts(intGrid, idx, num)) this.clearRelatedMemos(idx, num);
        }

        Utils.updateErrorFlags(this.board);
        this.lastInputNumber = num;
        return true;
    }

    clearCell(idx) {
        const cell = this.board[idx];
        if (!Utils.canModify(cell)) return false;
        if (Utils.getValue(cell) === 0 && (cell & Utils.MASK_CANDIDATES) === 0) return false;

        this.pushUndo();
        this.board[idx] &= 0xFFFF0000;
        Utils.updateErrorFlags(this.board);
        return true;
    }

    clearRelatedMemos(idx, num) {
        const bit = 1 << (num - 1);
        Utils.forEachPeer(idx, (pIdx) => {
            if (!Utils.isSolved(this.board[pIdx])) this.board[pIdx] &= ~bit;
        });
    }

    getSelectedIdx() {
        for (let i = 0; i < 81; i++) if (this.board[i] & Utils.BIT_UI_SELECTED) return i;
        return 0;
    }

    setSelectedIdx(newIdx) {
        for (let i = 0; i < 81; i++) {
            if (i === newIdx) this.board[i] |= Utils.BIT_UI_SELECTED;
            else this.board[i] &= ~Utils.BIT_UI_SELECTED;
        }
    }

    checkWin() {
        for (let i = 0; i < 81; i++) {
            const c = this.board[i];
            if (!(c & Utils.BIT_CONFIRMED) || Utils.getValue(c) !== Utils.getSolution(c) || (c & Utils.BIT_UI_ERROR)) return false;
        }
        return true;
    }
}

/**
 * 3. Board View (DOM & Rendering)
 */
class BoardView {
    constructor(boardEl, messageEl) {
        this.boardEl = boardEl;
        this.messageEl = messageEl;
        this.cells = [];
        this.memoSpans = [];
        this.stateCache = new Uint32Array(81).fill(0xFFFFFFFF);
        this.renderPending = false;
    }

    init(onCellClick) {
        this.boardEl.innerHTML = '';
        for (let i = 0; i < 81; i++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const memoGrid = document.createElement('div');
            memoGrid.className = 'memo-grid';
            const spans = [];
            for (let n = 1; n <= 9; n++) {
                const s = document.createElement('span');
                memoGrid.appendChild(s); spans.push(s);
            }
            cell.appendChild(memoGrid);
            cell.addEventListener('click', () => onCellClick(i));
            this.cells[i] = cell;
            this.memoSpans[i] = spans;
            this.boardEl.appendChild(cell);
        }
    }

    scheduleRender(game) {
        if (this.renderPending) return;
        this.renderPending = true;
        requestAnimationFrame(() => {
            this.renderPending = false;
            this.render(game);
        });
    }

    render(game) {
        this.updateUIFlags(game);
        for (let i = 0; i < 81; i++) {
            const raw = game.board[i];
            if (this.stateCache[i] === raw) continue;
            this.stateCache[i] = raw;

            const el = this.cells[i];
            const val = Utils.getValue(raw);
            const memos = raw & Utils.MASK_CANDIDATES;

            el.classList.toggle('given', !!(raw & Utils.BIT_GIVEN));
            el.classList.toggle('selected', !!(raw & Utils.BIT_UI_SELECTED));
            el.classList.toggle('highlighted', !!(raw & Utils.BIT_UI_HIGHLIGHT));
            el.classList.toggle('same-number', !!(raw & Utils.BIT_UI_SAME_DIGIT));
            el.classList.toggle('error', !!(raw & Utils.BIT_UI_ERROR));

            const target = (raw & Utils.BIT_UI_TARGET_MASK) >>> Utils.BIT_UI_TARGET_SHIFT;
            if (target > 0) el.dataset.highlight = target; else delete el.dataset.highlight;

            const spans = this.memoSpans[i];
            if (val !== 0) {
                el.dataset.val = val;
                for (let n = 0; n < 9; n++) spans[n].textContent = '';
            } else {
                delete el.dataset.val;
                for (let n = 0; n < 9; n++) spans[n].textContent = (memos & (1 << n)) ? String(n + 1) : '';
            }
        }
        this.updateKeypad(game);
        this.updateUndoRedo(game);
    }

    updateUIFlags(game) {
        const selIdx = game.getSelectedIdx();
        const selVal = Utils.getValue(game.board[selIdx]);
        const target = selVal !== 0 ? selVal : game.lastInputNumber;

        const selR = (selIdx / 9) | 0, selC = selIdx % 9;
        const selBoxR = (selR / 3 | 0), selBoxC = (selC / 3 | 0);

        const volatile = Utils.BIT_UI_HIGHLIGHT | Utils.BIT_UI_SAME_DIGIT | Utils.BIT_UI_TARGET_MASK;
        const targetBits = (target & 0xF) << Utils.BIT_UI_TARGET_SHIFT;

        for (let i = 0; i < 81; i++) {
            let f = (i === selIdx) ? Utils.BIT_UI_SELECTED : 0;
            const r = (i / 9) | 0, c = i % 9;
            if (r === selR || c === selC || ((r / 3 | 0) === selBoxR && (c / 3 | 0) === selBoxC)) f |= Utils.BIT_UI_HIGHLIGHT;
            if (target !== 0 && Utils.getValue(game.board[i]) === target) f |= Utils.BIT_UI_SAME_DIGIT;
            game.board[i] = (game.board[i] & ~volatile) | f | targetBits;
        }
    }

    updateKeypad(game) {
        const counts = new Uint8Array(10);
        for (let i = 0; i < 81; i++) {
            const c = game.board[i];
            if (c & Utils.BIT_CONFIRMED) counts[Utils.getValue(c)]++;
        }
        document.querySelectorAll('.key-btn[data-num]').forEach(btn => {
            const num = parseInt(btn.dataset.num, 10);
            btn.classList.toggle('completed', counts[num] >= 9);
        });
    }

    updateUndoRedo(game) {
        const btnU = document.getElementById('btn-undo'), btnR = document.getElementById('btn-redo');
        if (btnU) btnU.disabled = game.undoStack.length === 0;
        if (btnR) btnR.disabled = game.redoStack.length === 0;
    }

    setMessage(msg) { this.messageEl.textContent = msg; }
}

/**
 * 4. Async Orchestrator (Worker Coordination)
 */
class SudokuOrchestrator {
    constructor() {
        this.workers = [];
        this.activeTaskId = 0;
        this.activeDifficulty = '';
        this.results = [];
        this.resolveCurrent = null;
        this.finished = false;
        this.timers = { grace: null, safety: null };
    }

    initWorkers() {
        if (this.workers.length > 0) return;
        const count = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
        for (let i = 0; i < count; i++) this.workers.push(new Worker('js/generator.js?v=' + Date.now(), { type: 'module' }));
    }

    preGenerate(difficulty) {
        this.resetTask();
        this.activeDifficulty = difficulty;
        this.activeTaskId = Date.now();
        this.results = [];
        this.finished = false;
        this.initWorkers();

        this.workers.forEach((w, i) => {
            w.onmessage = (e) => this.onMessage(e);
            w.postMessage({ type: 'GENERATE', rank: DifficultyEvaluator.nameToRank(difficulty), taskId: this.activeTaskId, count: (i < 4 ? 1 : 0), patternType: -1 });
        });
    }

    onMessage(e) {
        if (e.data.taskId !== this.activeTaskId || this.finished) return;
        const res = e.data.puzzles || (e.data.result ? [e.data.result] : []);
        for (const r of res) {
            if (r?.puzzle) this.results.push(r);
        }
        if (this.results.length >= 1 && this.resolveCurrent && !this.timers.grace) {
            this.timers.grace = setTimeout(() => this.finalize(), 100);
        }
    }

    async resolvePuzzle(difficulty) {
        if (difficulty !== this.activeDifficulty) this.preGenerate(difficulty);
        return new Promise(resolve => {
            this.resolveCurrent = resolve;
            if (this.results.length >= 4) return this.finalize();
            if (this.results.length >= 1 && !this.timers.grace) this.timers.grace = setTimeout(() => this.finalize(), 100);
            this.timers.safety = setTimeout(() => this.finalize(), 10000);
        });
    }

    finalize() {
        if (this.finished || !this.resolveCurrent) return;
        this.finished = true;
        Object.values(this.timers).forEach(t => clearTimeout(t));
        const resolve = this.resolveCurrent; this.resolveCurrent = null;

        if (this.results.length === 0) return resolve(null);
        const rank1Names = new Set(TECHNIQUES.map(t => t.name));
        this.results.sort((a, b) => {
            if (a.hints !== b.hints) return a.hints - b.hints;
            const score = p => Object.entries(p.techniqueCounts || {}).filter(([n]) => !rank1Names.has(n)).reduce((s, [, c]) => s + c, 0);
            return score(b) - score(a);
        });
        resolve(this.results[0]);
    }

    resetTask() {
        this.finished = true;
        Object.values(this.timers).forEach(t => clearTimeout(t));
        this.timers = { grace: null, safety: null };
        this.resolveCurrent = null;
    }

    cancel() { this.resetTask(); this.workers.forEach(w => w.onmessage = null); }
}

/**
 * 5. Main Controller
 */
class AppController {
    constructor() {
        this.game = new SudokuGame();
        this.ui = new BoardView(document.getElementById('board'), document.getElementById('message'));
        this.orchestrator = new SudokuOrchestrator();
        this.sandbox = DifficultyEvaluator.createSandbox();
        this.genId = 0;
        this.isGenerating = false;
    }

    async init() {
        AppSettings.init();
        applyLanguage(currentLang);
        DifficultyEvaluator.connectDictionary(TECHNIQUES);
        this.ui.init((idx) => this.handleCellClick(idx));
        this.initEventListeners();
        await this.loadGame(AppSettings.getDifficulty());
    }

    async loadGame(diff, preRes = null) {
        if (this.isGenerating) return;
        this.isGenerating = true;
        const id = ++this.genId;
        this.ui.setMessage(t('loading'));
        AppSettings.setDifficulty(diff);
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b.dataset.level === diff));

        try {
            const res = preRes || await this.orchestrator.resolvePuzzle(diff);
            if (id !== this.genId) return;
            if (!res) throw new Error("Fail");

            this.game.setBoard(res.puzzle, res.technique);
            this.game.setSelectedIdx(0);
            Utils.clearUnsolvedCandidates(this.game.board);
            Utils.updateErrorFlags(this.game.board);
            this.game.captureInitialSnapshot(); // Capture clean start state
            this.setMemoMode(false);
            this.ui.setMessage(tTechnique(this.game.currentTechnique));
            this.ui.scheduleRender(this.game);
        } catch (e) {
            if (id === this.genId) { alert(t('generatorError')); this.ui.setMessage(''); }
        } finally { if (id === this.genId) this.isGenerating = false; }
    }

    handleCellClick(idx) {
        this.game.setSelectedIdx(idx);
        this.ui.scheduleRender(this.game);
    }

    handleInput(num) {
        if (this.game.applyInput(this.game.getSelectedIdx(), num)) {
            this.ui.scheduleRender(this.game);
            if (!this.game.memoMode && this.game.checkWin()) this.ui.setMessage(t('clear'));
        }
    }

    setMemoMode(val) {
        this.game.memoMode = val;
        const toggle = document.getElementById('memo-toggle');
        if (toggle) toggle.checked = val;
        document.getElementById('label-input').classList.toggle('active', !val);
        document.getElementById('label-memo').classList.toggle('active', val);
        this.ui.setMessage(val ? t('modeMemo') : t('modeInput'));
    }

    moveCursor(dir) {
        const idx = this.game.getSelectedIdx();
        let r = (idx / 9) | 0, c = idx % 9;
        if (dir === 'right') { c++; if (c > 8) { c = 0; r++; } if (r > 8) r = 0; }
        else if (dir === 'left') { c--; if (c < 0) { c = 8; r--; } if (r < 0) r = 8; }
        else if (dir === 'down') { r++; if (r > 8) { r = 0; c++; } if (c > 8) c = 0; }
        else if (dir === 'up') { r--; if (r < 0) { r = 8; c--; } if (c < 0) c = 8; }
        this.game.setSelectedIdx(r * 9 + c);
        this.ui.scheduleRender(this.game);
    }

    initEventListeners() {
        document.addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); if (this.game.undo()) this.ui.scheduleRender(this.game); }
            else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); if (this.game.redo()) this.ui.scheduleRender(this.game); }
            else if (e.key.startsWith('Arrow')) { e.preventDefault(); this.moveCursor(e.key.slice(5).toLowerCase()); }
            else if (e.key >= '1' && e.key <= '9') this.handleInput(parseInt(e.key));
            else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (this.game.clearCell(this.game.getSelectedIdx())) this.ui.scheduleRender(this.game); }
            else if (e.code === 'Space' || e.key.toLowerCase() === 'm') { e.preventDefault(); this.setMemoMode(!this.game.memoMode); }
        });

        document.querySelectorAll('.diff-btn[data-level]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const diff = btn.dataset.level;
                if (!diff || this.isGenerating) return;
                this.orchestrator.preGenerate(diff);
                if (await window.confirm(t('confirmChangeDifficulty'))) {
                    const res = await this.orchestrator.resolvePuzzle(diff);
                    await this.loadGame(diff, res);
                } else { this.orchestrator.cancel(); this.ui.setMessage(tTechnique(this.game.currentTechnique)); this.isGenerating = false; }
            });
        });

        document.getElementById('btn-reset')?.addEventListener('click', async () => {
            if (await window.confirm(t('confirmReset'))) { this.game.reset(); this.ui.scheduleRender(this.game); }
        });

        document.getElementById('btn-rocket')?.addEventListener('click', () => {
            const before = new Uint32Array(this.game.board);
            const result = SudokuUIBridge.solveStep(this.game.board, false, this.sandbox);
            if (result) {
                this.game.undoStack.push(before);
                Utils.updateErrorFlags(this.game.board);
                this.ui.scheduleRender(this.game);
                if (this.game.checkWin()) this.ui.setMessage(t('clear'));
                else if (result.feedbackKey) this.ui.setMessage(t(result.feedbackKey));
            }
        });

        document.getElementById('memo-toggle')?.addEventListener('change', (e) => this.setMemoMode(e.target.checked));
        document.getElementById('label-input')?.addEventListener('click', () => this.setMemoMode(false));
        document.getElementById('label-memo')?.addEventListener('click', () => this.setMemoMode(true));

        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const n = btn.dataset.num;
                if (n) this.handleInput(parseInt(n));
                else if (btn.id === 'key-delete') if (this.game.clearCell(this.game.getSelectedIdx())) this.ui.scheduleRender(this.game);
                btn.blur();
            });
        });

        document.getElementById('btn-undo')?.addEventListener('click', () => { if (this.game.undo()) this.ui.scheduleRender(this.game); });
        document.getElementById('btn-redo')?.addEventListener('click', () => { if (this.game.redo()) this.ui.scheduleRender(this.game); });

        // App Settings wiring
        const ts = document.getElementById('theme-select'), ls = document.getElementById('lang-select');
        ts?.addEventListener('change', (e) => AppSettings.setTheme(e.target.value));
        ls?.addEventListener('change', (e) => {
            applyLanguage(e.target.value);
            this.ui.setMessage(tTechnique(this.game.currentTechnique) || (this.game.memoMode ? t('modeMemo') : t('modeInput')));
            this.ui.scheduleRender(this.game);
        });

        // Event from ocr.js
        document.addEventListener('ocr:complete', async (e) => {
            document.getElementById('ocr-main-modal')?.close();
            await this.loadGame('custom', e.detail);
            alert(t('ocrImportComplete'));
        });

        // Dialog close logic
        document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    }
}

// Global Boot
(async () => {
    const app = new AppController();
    await app.init();
})();
