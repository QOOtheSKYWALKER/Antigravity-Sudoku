import { SudokuBitUtils, SudokuDLX, SudokuLogicalSolver, nameToRank } from './solver.js';
import { t, tTechnique, applyLanguage } from './i18n.js';
import { TECHNIQUES } from './solver-techniques.js';
const Utils = SudokuBitUtils;

let unifiedBoard = new Uint32Array(81);   // Primary board state
let initialSnapshot = new Uint32Array(81); // State to restore on Reset

let memoMode = false;
let lastInputNumber = 0;
let currentTechnique = '';


// Undo/Redo
const MAX_HISTORY = 127;
let undoStack = [];
let redoStack = [];

// Initial memory allocation
SudokuDLX.allocateMemory();
const evalSandbox = SudokuLogicalSolver.createSandbox();

// Render cache
let cells = [];
let cellMemoSpans = [];
let cellStateCache = new Uint32Array(81);
let renderPending = false;

// DOM elements
const boardEl = document.getElementById('board');
const memoToggle = document.getElementById('memo-toggle');
const labelInput = document.getElementById('label-input');
const labelMemo = document.getElementById('label-memo');
const messageEl = document.getElementById('message');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnReset = document.getElementById('btn-reset');
const btnRocket = document.getElementById('btn-rocket');

/**
 * Sudoku Orchestrator (Parallel Worker Management)
 */
class SudokuOrchestrator {
    static targetCount = 4;
    static totalTimeout = 10000;
    static gracePeriod = 100;

    static results = [];
    static allResults = [];
    static activeTaskId = 0;
    static activeDifficulty = '';  // UI表示・localStorage用
    static activeRank = 0;          // worker通信用（数値）
    static resolveCurrent = null;
    static finished = false;
    static graceTimer = null;
    static safetyTimer = null;
    static workers = [];

    static initWorkers() {
        if (this.workers.length > 0) return;
        const maxWorkers = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
        for (let i = 0; i < maxWorkers; i++) {
            const w = new Worker('js/generator.js?v=' + Date.now(), { type: 'module' });
            this.workers.push(w);
        }
    }

    static preGenerate(difficulty) {
        this.resetTaskInternal();

        this.results = [];
        this.allResults = [];
        this.activeDifficulty = difficulty;
        this.activeRank = nameToRank(difficulty);
        this.activeTaskId = Date.now();
        this.finished = false;

        this.initWorkers();

        const numWorkers = this.workers.length;
        for (let i = 0; i < numWorkers; i++) {
            const count = (i < 4) ? 1 : 0;
            if (count > 0 || i === 0) {
                this.workers[i].onmessage = this.onWorkerMessage.bind(this);
                this.workers[i].postMessage({
                    type: 'GENERATE',
                    rank: this.activeRank,
                    taskId: this.activeTaskId,
                    count: Math.max(count, (i === 0 ? 1 : 0)),
                    patternType: -1
                });
            } else {
                this.workers[i].onmessage = this.onWorkerMessage.bind(this);
            }
        }
    }

    static onWorkerMessage(event) {
        if (event.data.taskId !== this.activeTaskId || this.finished) return;

        let results = event.data.puzzles || (event.data.result ? [event.data.result] : []);
        const worker = event.target;

        for (const result of results) {
            if (!result || !result.puzzle) continue;

            // workerはrankを数値で返すため変換不要
            const resRankValue = result.rank || 0;

            this.allResults.push(result);

            if (resRankValue === this.activeRank) {
                this.results.push(result);
                if (this.resolveCurrent && this.results.length >= this.targetCount) {
                    this.finalize();
                    break;
                } else if (this.resolveCurrent && this.results.length === 1 && !this.graceTimer) {
                    this.graceTimer = setTimeout(() => this.finalize(), this.gracePeriod);
                }
            }
        }

        if (!this.finished) {
            worker.postMessage({
                type: 'GENERATE',
                rank: this.activeRank,
                taskId: this.activeTaskId,
                count: 1,
                patternType: -1
            });
        }
    }

    static async resolvePuzzle(difficulty) {
        if (difficulty !== this.activeDifficulty) {
            this.preGenerate(difficulty);
        }

        return new Promise((resolve) => {
            this.resolveCurrent = resolve;
            if (this.results.length >= this.targetCount) {
                this.finalize();
                return;
            }
            if (this.results.length > 0 && !this.graceTimer) {
                this.graceTimer = setTimeout(() => this.finalize(), this.gracePeriod);
            }
            this.safetyTimer = setTimeout(() => {
                if (!this.finished) this.finalize();
            }, this.totalTimeout);
        });
    }

    static finalize() {
        if (this.finished || !this.resolveCurrent) return;
        this.finished = true;

        clearTimeout(this.safetyTimer);
        clearTimeout(this.graceTimer);
        this.safetyTimer = null;
        this.graceTimer = null;

        const resolve = this.resolveCurrent;
        this.resolveCurrent = null;

        if (this.results.length === 0) {
            resolve(null);
            return;
        }

        const getComplexity = (p) => {
            if (!p.techniqueCounts) return 0;
            return Object.values(p.techniqueCounts).reduce((sum, count) => sum + count, 0);
        };

        this.results.sort((a, b) => {
            if (a.hints !== b.hints) return a.hints - b.hints;
            return getComplexity(b) - getComplexity(a);
        });

        resolve(this.results[0]);
    }

    static cancelCurrentTask() {
        this.resetTaskInternal();
        if (this.workers) {
            this.workers.forEach(w => w.onmessage = null);
        }
    }

    static resetTaskInternal() {
        this.finished = true;
        this.activeTaskId = 0;
        this.resolveCurrent = null;
        if (this.safetyTimer) clearTimeout(this.safetyTimer);
        if (this.graceTimer) clearTimeout(this.graceTimer);
        this.safetyTimer = null;
        this.graceTimer = null;
    }
}

/**
 * UI Functions (script.js legacy)
 */
function clearToolHighlight() {
    btnReset.classList.remove('active');
    btnRocket.classList.remove('active');
}

function showSimpleAlert(message) {
    window.alert(message);
    return Promise.resolve(true);
}

function showSimpleConfirm(message) {
    return Promise.resolve(window.confirm(message));
}

function getSelectedIdx() {
    for (let i = 0; i < 81; i++) {
        if (unifiedBoard[i] & Utils.BIT_UI_SELECTED) return i;
    }
    return 0;
}

function setSelectedIdx(newIdx) {
    for (let i = 0; i < 81; i++) {
        if (i === newIdx) {
            unifiedBoard[i] |= Utils.BIT_UI_SELECTED;
        } else {
            unifiedBoard[i] &= ~Utils.BIT_UI_SELECTED;
        }
    }
}

function clearMemoAndHistory() {
    undoStack = [];
    redoStack = [];
    lastInputNumber = 0;
    updateUndoRedoButtons();
}

function setMemoMode(value) {
    memoMode = value;
    memoToggle.checked = memoMode;
    labelInput.classList.toggle('active', !memoMode);
    labelMemo.classList.toggle('active', memoMode);
    messageEl.textContent = memoMode ? t('modeMemo') : t('modeInput');
}

function toggleMemoMode() {
    setMemoMode(!memoMode);
}

let isGenerating = false;
let currentGenerationId = 0;

async function initGame(difficulty, preGeneratedResult = null) {
    if (isGenerating) return;
    isGenerating = true;
    const myId = ++currentGenerationId;
    messageEl.textContent = t('loading') || 'Generating...';
    localStorage.setItem('sudoku-difficulty', difficulty);

    document.querySelectorAll('.diff-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.level === difficulty);
    });

    try {
        if (!preGeneratedResult) {
            SudokuOrchestrator.preGenerate(difficulty);
        }
        const result = preGeneratedResult || await SudokuOrchestrator.resolvePuzzle(difficulty);

        if (myId !== currentGenerationId) return;
        if (!result) throw new Error("No puzzle generated");

        unifiedBoard.set(result.puzzle);
        cellStateCache.fill(0xFFFFFFFF);
        setSelectedIdx(0);
        SudokuBitUtils.clearUnsolvedCandidates(unifiedBoard);
        Utils.updateErrorFlags(unifiedBoard);
        initialSnapshot.set(unifiedBoard);
        setMemoMode(false);
        clearMemoAndHistory();
        currentTechnique = result.technique || '';
        messageEl.textContent = tTechnique(currentTechnique);
        renderBoard();
    } catch (error) {
        console.error("Generation failed:", error);
        if (myId === currentGenerationId) {
            await showSimpleAlert(t('generatorError'));
            messageEl.textContent = '';
        }
    } finally {
        if (myId === currentGenerationId) isGenerating = false;
    }
}

function createSnapshot() {
    return new Uint32Array(unifiedBoard);
}

function pushUndo() {
    undoStack.push(createSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
}

function updateHighlight() {
    const idx = getSelectedIdx();
    const val = Utils.getValue(unifiedBoard[idx]);
    lastInputNumber = val !== 0 ? val : 0;
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(createSnapshot());
    const snap = undoStack.pop();
    unifiedBoard.set(snap);
    Utils.updateErrorFlags(unifiedBoard);
    clearToolHighlight();
    updateUndoRedoButtons();
    updateHighlight();
    scheduleRender();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(createSnapshot());
    const snap = redoStack.pop();
    unifiedBoard.set(snap);
    Utils.updateErrorFlags(unifiedBoard);
    clearToolHighlight();
    updateUndoRedoButtons();
    updateHighlight();
    scheduleRender();
}

function clearCell() {
    const idx = getSelectedIdx();
    const cell = unifiedBoard[idx];
    if (!Utils.canModify(cell)) return;
    if (Utils.getValue(cell) === 0 && (cell & Utils.MASK_CANDIDATES) === 0) return;

    pushUndo();
    unifiedBoard[idx] = (unifiedBoard[idx] & 0xFFFF0000);
    Utils.updateErrorFlags(unifiedBoard);
    clearToolHighlight();
    updateHighlight();
    scheduleRender();
}

function moveCell(direction) {
    const idx = getSelectedIdx();
    let row = (idx / 9) | 0;
    let col = idx % 9;

    if (direction === 'right') {
        col++; if (col > 8) { col = 0; row++; } if (row > 8) row = 0;
    } else if (direction === 'left') {
        col--; if (col < 0) { col = 8; row--; } if (row < 0) row = 8;
    } else if (direction === 'down') {
        row++; if (row > 8) { row = 0; col++; } if (col > 8) col = 0;
    } else if (direction === 'up') {
        row--; if (row < 0) { row = 8; col--; } if (col < 0) col = 8;
    }

    setSelectedIdx(row * 9 + col);
    updateHighlight();
    scheduleRender();
}

function updateUndoRedoButtons() {
    btnUndo.disabled = undoStack.length === 0;
    btnRedo.disabled = redoStack.length === 0;
}

function resetBoard() {
    unifiedBoard.set(initialSnapshot);
    Utils.updateErrorFlags(unifiedBoard);
    clearMemoAndHistory();
    messageEl.textContent = tTechnique(currentTechnique);
    renderBoard();
}

function scheduleRender() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(() => {
            renderPending = false;
            renderBoard();
        });
    }
}

function buildBoard() {
    boardEl.innerHTML = '';
    cells = [];
    cellMemoSpans = [];
    cellStateCache.fill(0xFFFFFFFF);

    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
            const idx = row * 9 + col;
            const cell = document.createElement('div');
            cell.className = 'cell';
            const memoGrid = document.createElement('div');
            memoGrid.className = 'memo-grid';
            const spans = [];
            for (let n = 1; n <= 9; n++) {
                const span = document.createElement('span');
                memoGrid.appendChild(span);
                spans.push(span);
            }
            cell.appendChild(memoGrid);
            cellMemoSpans[idx] = spans;
            cell.addEventListener('click', () => {
                setSelectedIdx(idx);
                updateHighlight();
                scheduleRender();
            });
            cells[idx] = cell;
            boardEl.appendChild(cell);
        }
    }
}

function updateUIFlags() {
    const selectedIdx = getSelectedIdx();
    const selectedCell = unifiedBoard[selectedIdx];
    const selectedVal = Utils.getValue(selectedCell);
    const targetNumber = selectedVal !== 0 ? selectedVal : lastInputNumber;

    const selectedRow = (selectedIdx / 9) | 0;
    const selectedCol = selectedIdx % 9;
    const selBoxRow = (selectedRow / 3) | 0;
    const selBoxCol = (selectedCol / 3) | 0;

    const volatileMask = Utils.BIT_UI_HIGHLIGHT | Utils.BIT_UI_SAME_DIGIT | Utils.BIT_UI_TARGET_MASK;
    const targetBits = (targetNumber & 0xF) << Utils.BIT_UI_TARGET_SHIFT;

    for (let i = 0; i < 81; i++) {
        let flags = 0;
        const r = (i / 9) | 0;
        const c = i % 9;

        if (i === selectedIdx) {
            flags |= Utils.BIT_UI_SELECTED;
        }

        if (r === selectedRow || c === selectedCol || ((r / 3 | 0) === selBoxRow && (c / 3 | 0) === selBoxCol)) {
            flags |= Utils.BIT_UI_HIGHLIGHT;
        }

        if (targetNumber !== 0 && Utils.getValue(unifiedBoard[i]) === targetNumber) {
            flags |= Utils.BIT_UI_SAME_DIGIT;
        }

        unifiedBoard[i] = (unifiedBoard[i] & ~volatileMask) | flags | targetBits;
    }
}

function renderBoard() {
    updateUIFlags();
    for (let idx = 0; idx < 81; idx++) {
        const raw = unifiedBoard[idx];
        if (cellStateCache[idx] === raw) continue;
        cellStateCache[idx] = raw;

        const cell = cells[idx];
        const value = Utils.getValue(raw);
        const memoFlags = raw & Utils.MASK_CANDIDATES;

        cell.classList.toggle('given', !!(raw & Utils.BIT_GIVEN));
        cell.classList.toggle('selected', !!(raw & Utils.BIT_UI_SELECTED));
        cell.classList.toggle('highlighted', !!(raw & Utils.BIT_UI_HIGHLIGHT));
        cell.classList.toggle('same-number', !!(raw & Utils.BIT_UI_SAME_DIGIT));
        cell.classList.toggle('error', !!(raw & Utils.BIT_UI_ERROR));

        const currentTarget = (raw & Utils.BIT_UI_TARGET_MASK) >>> Utils.BIT_UI_TARGET_SHIFT;
        if (currentTarget > 0) cell.dataset.highlight = currentTarget;
        else delete cell.dataset.highlight;

        const spans = cellMemoSpans[idx];
        if (value !== 0) {
            cell.dataset.val = value;
            for (let n = 0; n < 9; n++) spans[n].textContent = '';
        } else if (memoFlags !== 0) {
            delete cell.dataset.val;
            for (let n = 0; n < 9; n++) {
                const bit = 1 << n;
                spans[n].textContent = (memoFlags & bit) ? String(n + 1) : '';
            }
        } else {
            delete cell.dataset.val;
            for (let n = 0; n < 9; n++) spans[n].textContent = '';
        }
    }
    updateKeypadStatus();
}

function updateKeypadStatus() {
    const counts = new Uint8Array(10);
    for (let i = 0; i < 81; i++) {
        const cell = unifiedBoard[i];
        if (cell & Utils.BIT_CONFIRMED) {
            counts[Utils.getValue(cell)]++;
        }
    }
    document.querySelectorAll('.key-btn[data-num]').forEach(btn => {
        const num = parseInt(btn.dataset.num, 10);
        btn.classList.toggle('completed', counts[num] >= 9);
    });
}

function checkWin() {
    for (let i = 0; i < 81; i++) {
        const cell = unifiedBoard[i];
        if (!(cell & Utils.BIT_CONFIRMED)) return false;
        if (Utils.getValue(cell) !== Utils.getSolution(cell)) return false;
        if (cell & Utils.BIT_UI_ERROR) return false;
    }
    return true;
}

function inputNumber(num) {
    const idx = getSelectedIdx();
    const cell = unifiedBoard[idx];
    if (!Utils.canModify(cell)) return;

    let nextCell;
    if (memoMode) {
        nextCell = Utils.toggleCandidate(cell, num);
    } else {
        nextCell = Utils.confirmValue(cell, num);
    }

    if (nextCell === cell) return;

    pushUndo();
    unifiedBoard[idx] = nextCell;
    if (!memoMode) {
        const intGrid = Utils.toIntGrid(unifiedBoard);
        if (!Utils.cellConflicts(intGrid, idx, num)) {
            clearRelatedMemos(idx, num);
        }
    }

    Utils.updateErrorFlags(unifiedBoard);
    lastInputNumber = num;
    clearToolHighlight();
    scheduleRender();

    if (!memoMode && checkWin()) messageEl.textContent = t('clear');
}

function clearRelatedMemos(idx, num) {
    const bit = 1 << (num - 1);
    Utils.forEachPeer(idx, (peerIdx) => {
        if (!Utils.isSolved(unifiedBoard[peerIdx])) {
            unifiedBoard[peerIdx] &= ~bit;
        }
    });
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCell('up'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveCell('down'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveCell('left'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveCell('right'); }
    else if (e.key >= '1' && e.key <= '9') { inputNumber(parseInt(e.key)); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearCell(); }
    else if (e.code === 'Space' || e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMemoMode(); }
});

document.querySelectorAll('.diff-btn[data-level]').forEach(btn => {
    btn.addEventListener('click', async () => {
        const level = btn.dataset.level;
        if (!level || isGenerating) return;
        SudokuOrchestrator.preGenerate(level);
        const originalMessage = messageEl.textContent;
        messageEl.textContent = t('loading') || 'Generating...';
        const confirmed = await showSimpleConfirm(t('confirmChangeDifficulty'));
        if (confirmed) {
            const result = await SudokuOrchestrator.resolvePuzzle(level);
            await initGame(level, result);
        } else {
            SudokuOrchestrator.cancelCurrentTask();
            messageEl.textContent = originalMessage;
            isGenerating = false;
        }
    });
});

document.getElementById('btn-reset').addEventListener('click', async () => {
    if (await showSimpleConfirm(t('confirmReset'))) {
        resetBoard();
        btnReset.classList.add('active');
    }
});

function handleRocket() {
    btnRocket.classList.add('active');
    const beforeState = createSnapshot();
    const result = SudokuLogicalSolver.solveStep(unifiedBoard, false, evalSandbox);
    if (result) {
        undoStack.push(beforeState);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();

        SudokuBitUtils.updateErrorFlags(unifiedBoard);
        updateHighlight();
        renderBoard();
        if (checkWin()) messageEl.textContent = t('clear');
        else if (result.feedbackKey) messageEl.textContent = t(result.feedbackKey);
    }
}

btnRocket.addEventListener('click', () => {
    handleRocket();
    btnRocket.blur();
});

memoToggle.addEventListener('change', () => setMemoMode(memoToggle.checked));
labelInput.addEventListener('click', () => { if (memoMode) setMemoMode(false); });
labelMemo.addEventListener('click', () => { if (!memoMode) setMemoMode(true); });

document.querySelectorAll('.key-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const num = btn.dataset.num;
        if (num) inputNumber(parseInt(num));
        else if (btn.id === 'key-delete') clearCell();
        btn.blur();
    });
});

btnUndo.addEventListener('click', () => undo());
btnRedo.addEventListener('click', () => redo());

function applyTheme(theme) {
    localStorage.setItem('sudoku-theme', theme);
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('sudoku-theme') === 'system') applyTheme('system');
});

(function init() {
    const themeSelect = document.getElementById('theme-select');
    const langSelect = document.getElementById('lang-select');
    const savedTheme = localStorage.getItem('sudoku-theme') || 'dark';
    const savedLang = localStorage.getItem('sudoku-lang') || 'ja';
    if (themeSelect) themeSelect.value = savedTheme;
    if (langSelect) langSelect.value = savedLang;
    applyTheme(savedTheme);
    applyLanguage(savedLang);
    SudokuLogicalSolver.connectDictionary(TECHNIQUES);
    themeSelect?.addEventListener('change', (e) => applyTheme(e.target.value));
    langSelect?.addEventListener('change', (e) => applyLanguage(e.target.value));
    buildBoard();
    initGame(localStorage.getItem('sudoku-difficulty') || 'easy');
    document.querySelectorAll('dialog').forEach(dialog => {
        dialog.addEventListener('click', (e) => {
            if (window.getComputedStyle(dialog).pointerEvents === 'none') return;
            if (e.target === dialog) dialog.close();
        });
    });

    // OCR解析完了イベントを受け取り、UI処理を実行する
    // ocr.jsは盤面データのみを返し、画面操作はここで行う
    document.addEventListener('ocr:complete', async (e) => {
        const { puzzle, technique } = e.detail;
        const ocrModal = document.getElementById('ocr-main-modal');
        ocrModal?.close();
        await initGame('custom', { puzzle, technique });
        updateUndoRedoButtons();
        await showSimpleAlert(t('ocrImportComplete'));
    });
})();
