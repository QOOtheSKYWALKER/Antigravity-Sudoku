// ============================================================================
// OCR Module - Image Recognition & Board Import (Refactored)
// ============================================================================
import { SudokuBitUtils, SudokuDLX, DifficultyEvaluator } from './solver.js';
import { t, applyLanguage, currentLang } from './i18n.js';
import { GridDetector } from './ocr-engine.js';
import { TECHNIQUES, TECHNIQUES_ADVANCED } from './solver-techniques.js';

// --- Constants & Configuration ---
const CONFIG = {
    CACHE: {
        STORAGE_KEY: 'sudoku-ocr-correction-cache',
        MAX_SIZE: 100,
        MATCH_THRESHOLD: 0.90,  // Cache lookup similarity
        DEDUPE_THRESHOLD: 0.95  // Cache addition similarity
    },
    OCR: {
        LANG: 'eng',
        WHITELIST: '123456789',
        PSM: 10 // SINGLE_CHAR (Note: Tesseract.PSM.SINGLE_CHAR typically 10)
    },
    UI: {
        MODAL_STATES: {
            UPLOAD: 'upload',
            ANALYZING: 'analyzing',
            CORRECTION: 'correction',
            PREVIEW: 'preview'
        }
    }
};

// --- DOM Elements ---
const DOM = {
    btnOcrOpen: document.getElementById('btn-ocr-open'),
    ocrModal: document.getElementById('ocr-main-modal'),
    ocrCorrectionModal: document.getElementById('ocr-correction-modal'),
    ocrStatus: document.getElementById('ocr-status'),
    uploadZone: document.getElementById('upload-zone'),
    unifiedDropZone: document.getElementById('ocr-unified-drop-zone'),
    fileInput: document.getElementById('file-input'),
    mainCanvas: document.getElementById('main-canvas'),
    progressFill: document.getElementById('ocr-progress-fill'),
    parsedPreview: document.getElementById('ocr-parsed-preview'),
    manualGrid: document.getElementById('ocr-manual-grid'),
    correctionList: document.getElementById('ocr-correction-list'),
    btnCorrectionSubmit: document.getElementById('modal-btn-submit'),
    btnManualPlay: document.getElementById('btn-manual-play'),
    btnReRecognize: document.getElementById('btn-re-recognize'),
    btnPaste: document.getElementById('btn-paste'),
    btnUnifiedPaste: document.getElementById('btn-unified-paste'),
    previewLabel: document.getElementById('ocr-preview-label')
};

// --- Utilities ---
const InputUtils = {
    /**
     * Set up common behavior for Sudoku digit inputs (1-9)
     */
    setupNumericInput(input, onValidSubmit = null) {
        input.type = 'text';
        input.inputMode = 'numeric';
        input.maxLength = 1;

        input.addEventListener('input', () => {
            input.value = input.value.replace(/[^1-9]/g, '').slice(-1);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onValidSubmit?.();
            }
        });

        input.addEventListener('focus', () => {
            input.select();
            // Mobile keyboard scroll assistance
            setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        });

        input.addEventListener('click', () => input.select());
    }
};

// --- OCR Session Controller ---
class OcrSession {
    constructor() {
        this.cache = []; // {mat: cv.Mat, digit: number}
        this.cellCanvases = [];
        this.gridResult = new Uint32Array(81);
        this.groupCorrectionQueue = [];
        this.recognizedCellsCount = 0;
        this.ocrLibrariesLoaded = false;

        DifficultyEvaluator.connectDictionary([...TECHNIQUES, ...TECHNIQUES_ADVANCED]);
    }

    // --- State & UI Helpers ---
    setState(state) {
        DOM.ocrModal.dataset.state = state;
        if (state === CONFIG.UI.MODAL_STATES.UPLOAD) {
            this.clearInlineError();
        }
    }

    updateStatus(messageKey, useRaw = false) {
        DOM.ocrStatus.textContent = useRaw ? messageKey : t(messageKey);
    }

    updateProgress(percent) {
        DOM.progressFill.style.setProperty('--progress', `${percent}%`);
    }

    showInlineError(msgKey) {
        const el = document.getElementById('upload-inline-error');
        if (el) {
            el.textContent = t(msgKey);
            el.classList.add('visible');
        }
    }

    clearInlineError() {
        const el = document.getElementById('upload-inline-error');
        if (el) el.classList.remove('visible');
    }

    // --- Resource Loading ---
    async ensureLibraries() {
        if (this.ocrLibrariesLoaded) return;

        const isReady = () => {
            if (typeof cv !== 'undefined' && cv.Mat && typeof cv.Mat === 'function') {
                return typeof Tesseract !== 'undefined';
            }
            return false;
        };

        if (isReady()) {
            this.ocrLibrariesLoaded = true;
            return;
        }

        // Script loading
        if (typeof cv === 'undefined' && !document.getElementById('opencv-script')) {
            const s = document.createElement('script');
            s.id = 'opencv-script';
            s.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/dist/opencv.js';
            s.async = true;
            document.head.appendChild(s);
        }

        if (typeof Tesseract === 'undefined') {
            const module = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
            window.Tesseract = module.default || module;
        }

        return new Promise((resolve, reject) => {
            let retries = 0;
            const interval = setInterval(() => {
                if (isReady()) {
                    clearInterval(interval);
                    this.ocrLibrariesLoaded = true;
                    resolve();
                }
                if (++retries > 200) {
                    clearInterval(interval);
                    reject(new Error("OCR libraries timeout"));
                }
            }, 100);
        });
    }

    // --- Cache Management ---
    async loadCache() {
        const stored = localStorage.getItem(CONFIG.CACHE.STORAGE_KEY);
        if (!stored) return;

        try {
            const data = JSON.parse(stored);
            this.clearCache(false); // Memory clear only

            for (const item of data) {
                const img = new Image();
                await new Promise(r => { img.onload = r; img.src = item.image; });

                const canvas = document.createElement('canvas');
                canvas.width = img.width; canvas.height = img.height;
                canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);

                const mat = cv.imread(canvas);
                cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY, 0);
                this.cache.push({ mat: mat, digit: item.digit });
            }
        } catch (e) {
            console.error("Cache load failed:", e);
        }
    }

    saveCache() {
        const items = this.cache.slice(-CONFIG.CACHE.MAX_SIZE).map(c => {
            const canvas = document.createElement('canvas');
            canvas.getContext('2d', { willReadFrequently: true });
            cv.imshow(canvas, c.mat);
            return { image: canvas.toDataURL(), digit: c.digit };
        });
        localStorage.setItem(CONFIG.CACHE.STORAGE_KEY, JSON.stringify(items));
    }

    clearCache(removeFromStorage = true) {
        this.cache.forEach(c => { if (c.mat && !c.mat.isDeleted()) c.mat.delete(); });
        this.cache = [];
        if (removeFromStorage) localStorage.removeItem(CONFIG.CACHE.STORAGE_KEY);
    }

    // --- Pipeline Steps ---

    /**
     * Step 1: Detect Grid
     */
    async pipelineDetectGrid() {
        this.updateStatus('ocrStatusLoading');
        this.updateProgress(5);

        const result = await GridDetector.detect(DOM.mainCanvas, (p) => {
            this.updateProgress(Math.round(p * 30));
        });
        this.cellCanvases = result.cells;
        return result.groups;
    }

    /**
     * Step 2: Recognize Digits (Cache -> OCR)
     */
    async pipelineRecognize(groups) {
        const worker = await Tesseract.createWorker(CONFIG.OCR.LANG);
        await worker.setParameters({
            tessedit_char_whitelist: CONFIG.OCR.WHITELIST,
            tessedit_pageseg_mode: CONFIG.OCR.PSM
        });

        this.updateStatus('ocrStatusExtracting');
        this.recognizedCellsCount = 0;
        this.groupCorrectionQueue = [];

        for (const group of groups) {
            let digit = await this.tryMatchCache(group.canvases[0]);

            if (digit === 0) {
                digit = await this.performTesseract(worker, group.canvases);
            }

            if (digit !== 0) {
                group.indices.forEach(idx => this.gridResult[idx] = SudokuBitUtils.createSolved(digit, true));
            } else {
                this.groupCorrectionQueue.push({ indices: group.indices, canvas: group.canvases[0] });
            }

            this.recognizedCellsCount += group.indices.length;
            this.updateProgress(30 + Math.round((this.recognizedCellsCount / 81) * 70));
        }

        await worker.terminate();
    }

    async tryMatchCache(canvas) {
        if (this.cache.length === 0) return 0;

        const currentMat = cv.imread(canvas);
        cv.cvtColor(currentMat, currentMat, cv.COLOR_RGBA2GRAY, 0);
        let foundDigit = 0;

        for (const item of this.cache) {
            const res = new cv.Mat();
            cv.matchTemplate(currentMat, item.mat, res, cv.TM_CCOEFF_NORMED);
            const mm = cv.minMaxLoc(res);
            const match = mm.maxVal > CONFIG.CACHE.MATCH_THRESHOLD;
            res.delete();

            if (match) {
                foundDigit = item.digit;
                break;
            }
        }
        currentMat.delete();
        return foundDigit;
    }

    async performTesseract(worker, canvases) {
        for (const canvas of canvases) {
            const ret = await worker.recognize(canvas);
            const text = ret.data.text.trim();
            if (text.length === 1 && text >= '1' && text <= '9') {
                const digit = parseInt(text, 10);
                this.addToCache(canvas, digit);
                return digit;
            }
        }
        return 0;
    }

    addToCache(canvas, digit, threshold = CONFIG.CACHE.DEDUPE_THRESHOLD) {
        const mat = cv.imread(canvas);
        cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY, 0);

        // Deduplicate before adding
        let exists = false;
        for (const item of this.cache) {
            const res = new cv.Mat();
            cv.matchTemplate(mat, item.mat, res, cv.TM_CCOEFF_NORMED);
            if (cv.minMaxLoc(res).maxVal > threshold) exists = true;
            res.delete();
            if (exists) break;
        }

        if (!exists) {
            this.cache.push({ mat, digit });
            this.saveCache();
        } else {
            mat.delete();
        }
    }

    /**
     * Main Pipeline Controller
     */
    async startWorkflow() {
        this.setState(CONFIG.UI.MODAL_STATES.ANALYZING);
        this.gridResult.fill(0);

        try {
            await this.ensureLibraries();
            await this.loadCache();

            const groups = await this.pipelineDetectGrid();
            await this.pipelineRecognize(groups);

            if (this.groupCorrectionQueue.length > 0) {
                this.handleCorrectionFlow();
            } else {
                this.handleCompletionFlow();
            }
        } catch (err) {
            console.error("OCR Workflow Error:", err);
            this.handleFailure(err.toString());
        }
    }

    handleCorrectionFlow() {
        this.setState(CONFIG.UI.MODAL_STATES.CORRECTION);
        this.renderParsedPreview([]); // Pass empty "extra unrecognized" because it's handled via groupCorrectionQueue
        showCorrectionSubModal(this.groupCorrectionQueue, this.gridResult, (finalGrid) => {
            this.gridResult = finalGrid;
            this.handleCompletionFlow();
        });
    }

    handleCompletionFlow() {
        this.setState(CONFIG.UI.MODAL_STATES.PREVIEW);
        DOM.previewLabel.textContent = t('parsedGrid');
        this.updateStatus('', true);
        this.renderParsedPreview([]);
        this.validateAndApply();
    }

    handleFailure(msg) {
        this.updateStatus('', true);
        this.setState(CONFIG.UI.MODAL_STATES.CORRECTION);
        DOM.previewLabel.textContent = t('originalImageFailed');
        renderManualEditableGrid(new Uint8Array(81));
    }

    // --- UI Rendering ---
    renderParsedPreview(unrecognizedIndices = []) {
        const container = DOM.parsedPreview || DOM.manualGrid;
        if (!container) return;
        container.innerHTML = '';

        this.gridResult.forEach((item, idx) => {
            const val = SudokuBitUtils.getValue(item);
            const cell = document.createElement('div');
            cell.className = 'preview-cell';

            const isUnrecognized = unrecognizedIndices.some(u =>
                (typeof u === 'number' ? u === idx : u.index === idx)
            );

            if (isUnrecognized) {
                cell.textContent = '?';
                cell.classList.add('unrecognized');
            } else if (val !== 0) {
                cell.textContent = val;
            } else {
                cell.innerHTML = '&nbsp;';
            }
            container.appendChild(cell);
        });
    }

    validateAndApply() {
        const grid = this.gridResult;
        let isRuleValid = true;

        for (let i = 0; i < 81; i++) {
            const raw = grid[i];
            const val = SudokuBitUtils.getValue(raw);
            if (val !== 0) {
                grid[i] = 0;
                if (!SudokuBitUtils.isValid(grid, i, val)) isRuleValid = false;
                grid[i] = raw;
            }
            if (!isRuleValid) break;
        }

        const isSolvable = isRuleValid && (SudokuDLX.countSolutions(grid) === 1);

        if (isRuleValid && isSolvable) {
            this.finalizePuzzle();
        } else {
            this.setState(CONFIG.UI.MODAL_STATES.CORRECTION);
            DOM.previewLabel.textContent = t('correctionGrid');
            renderManualEditableGrid(grid);
        }
    }

    finalizePuzzle() {
        const resultEval = DifficultyEvaluator.evaluate(this.gridResult, 4);
        const solBuffer = new Uint32Array(this.gridResult);
        SudokuDLX.solveAndFill(solBuffer);

        const finalPuzzle = new Uint32Array(81);
        for (let i = 0; i < 81; i++) {
            const solDigit = SudokuBitUtils.getValue(solBuffer[i]);
            finalPuzzle[i] = SudokuBitUtils.setSolution(this.gridResult[i], solDigit);
        }

        document.dispatchEvent(new CustomEvent('ocr:complete', {
            detail: {
                puzzle: finalPuzzle,
                technique: resultEval.technique
            }
        }));
    }
}

const session = new OcrSession();

// --- External Modal: Manual Digit Correction ---
function showCorrectionSubModal(queue, gridResult, onComplete) {
    DOM.correctionList.innerHTML = '';
    const inputs = [];

    const finish = () => {
        inputs.forEach(item => {
            const val = parseInt(item.input.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 9) {
                item.indices.forEach(idx => gridResult[idx] = SudokuBitUtils.createSolved(val, true));
                session.addToCache(item.canvas, val);
            }
        });
        DOM.ocrCorrectionModal.close();
        onComplete(gridResult);
    };

    queue.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'correction-item';

        const img = document.createElement('img');
        img.src = item.canvas.toDataURL();

        const input = document.createElement('input');
        InputUtils.setupNumericInput(input, () => {
            if (idx < queue.length - 1) inputs[idx + 1].input.focus();
            else finish();
        });

        div.append(img, input);
        DOM.correctionList.appendChild(div);
        inputs.push({ input, indices: item.indices, canvas: item.canvas });

        if (idx === 0) setTimeout(() => input.focus(), 100);
    });

    DOM.btnCorrectionSubmit.onclick = finish;
    DOM.ocrCorrectionModal.showModal();
}

// --- Internal View: 81-cell Manual Grid ---
function renderManualEditableGrid(initialGrid) {
    DOM.manualGrid.innerHTML = '';
    for (let i = 0; i < 81; i++) {
        const input = document.createElement('input');
        input.dataset.index = i;
        const val = SudokuBitUtils.getValue(initialGrid[i]);
        input.value = val !== 0 ? val : '';

        InputUtils.setupNumericInput(input);
        DOM.manualGrid.appendChild(input);
    }
}

// --- UI Event Handlers ---

function handleFile(file) {
    if (!file.type.startsWith('image/')) return session.showInlineError('invalidFileType');

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            DOM.mainCanvas.width = img.width;
            DOM.mainCanvas.height = img.height;
            DOM.mainCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
            session.startWorkflow();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Global Paste Support
document.addEventListener('paste', (e) => {
    if (!DOM.ocrModal.open) return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image/') !== -1) {
            handleFile(item.getAsFile());
            break;
        }
    }
});

async function readFromClipboard() {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const types = item.types.filter(t => t.startsWith('image/'));
            if (types.length) {
                const blob = await item.getType(types[0]);
                handleFile(new File([blob], "paste.png", { type: types[0] }));
                return;
            }
        }
        session.showInlineError('clipboardError');
    } catch { session.showInlineError('clipboardNoAccess'); }
}

// Setup Upload Zones
[DOM.uploadZone, DOM.unifiedDropZone].forEach(zone => {
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    zone.addEventListener('click', (e) => {
        if (e.target !== DOM.fileInput && !e.target.closest('button')) DOM.fileInput.click();
    });
});

DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

DOM.btnOcrOpen.addEventListener('click', () => {
    session.setState(CONFIG.UI.MODAL_STATES.UPLOAD);
    DOM.ocrModal.showModal();
    applyLanguage(currentLang);
});

DOM.btnManualPlay.addEventListener('click', async () => {
    DOM.btnManualPlay.disabled = true;
    const originalText = DOM.btnManualPlay.textContent;
    DOM.btnManualPlay.textContent = t('ocrVerifying');

    const inputs = DOM.manualGrid.querySelectorAll('input');
    const newGrid = new Uint32Array(81);
    inputs.forEach(input => {
        const val = parseInt(input.value, 10);
        if (val >= 1 && val <= 9) newGrid[input.dataset.index] = SudokuBitUtils.createSolved(val, true);
    });

    await new Promise(r => setTimeout(r, 300));
    session.gridResult = newGrid;
    session.validateAndApply();

    DOM.btnManualPlay.disabled = false;
    DOM.btnManualPlay.textContent = originalText;
});

DOM.btnReRecognize.addEventListener('click', () => {
    session.clearCache();
    session.startWorkflow();
});

[DOM.btnPaste, DOM.btnUnifiedPaste].forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    readFromClipboard();
}));

// Backdrops
[DOM.ocrModal, DOM.ocrCorrectionModal].forEach(modal => {
    modal?.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
});
