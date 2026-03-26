// ============================================================================
// OCR Module - Image Recognition & Board Import
// ============================================================================

const btnOcrOpen = document.getElementById('btn-ocr-open');
const ocrModal = document.getElementById('ocr-main-modal');
const ocrCorrectionModal = document.getElementById('ocr-correction-modal');
const ocrStatus = document.getElementById('ocr-status');

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const mainCanvas = document.getElementById('main-canvas');
const progressBar = document.getElementById('ocr-progress-bar');
const progressFill = document.getElementById('ocr-progress-fill');
// messageEl is shared from script.js global scope




let uploadedImage = null;
let cellCanvases = [];
let manualCorrectionCache = []; // {mat: cv.Mat, digit: number} - runtime cache
const STORAGE_KEY_OCR_CACHE = 'sudoku-ocr-correction-cache';
const MAX_OCR_CACHE_SIZE = 100;

/**
 * Load OCR correction cache from localStorage
 */
async function loadOcrCache() {
    const stored = localStorage.getItem(STORAGE_KEY_OCR_CACHE);
    if (!stored) return;

    try {
        const data = JSON.parse(stored);
        // data is [{image: dataUrl, digit: number}, ...]

        // Clear current runtime cache mats if any
        manualCorrectionCache.forEach(c => {
            if (c.mat && !c.mat.isDeleted()) c.mat.delete();
        });
        manualCorrectionCache = [];

        for (const item of data) {
            const img = new Image();
            await new Promise((resolve) => {
                img.onload = resolve;
                img.src = item.image;
            });
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const mat = cv.imread(tempCanvas);
            cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY, 0);
            manualCorrectionCache.push({ mat: mat, digit: item.digit });
        }
        console.log(`Loaded ${manualCorrectionCache.length} OCR corrections from storage.`);
    } catch (e) {
        console.error("Failed to load OCR cache:", e);
    }
}

/**
 * Save current manualCorrectionCache (representing unique image->digit pairs) to localStorage
 */
function saveOcrCache() {
    // We only store the last MAX_OCR_CACHE_SIZE items
    const itemsToStore = manualCorrectionCache.slice(-MAX_OCR_CACHE_SIZE).map(c => {
        // Convert Mat back to DataURL for storage
        const tempCanvas = document.createElement('canvas');
        cv.imshow(tempCanvas, c.mat);
        return {
            image: tempCanvas.toDataURL(),
            digit: c.digit
        };
    });
    localStorage.setItem(STORAGE_KEY_OCR_CACHE, JSON.stringify(itemsToStore));
}

/**
 * Clear OCR cache from both memory and storage
 */
function clearOcrCache() {
    manualCorrectionCache.forEach(c => {
        if (c.mat && !c.mat.isDeleted()) c.mat.delete();
    });
    manualCorrectionCache = [];
    localStorage.removeItem(STORAGE_KEY_OCR_CACHE);
    console.log("OCR correction cache cleared.");
}



// Display an inline error message inside the upload zone
function showUploadInlineError(msg) {
    const el = document.getElementById('upload-inline-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
}

function clearUploadInlineError() {
    const el = document.getElementById('upload-inline-error');
    if (el) el.classList.remove('visible');
}

/**
 * State Management for the OCR Modal
 */
function setOcrModalState(state) {
    ocrModal.dataset.state = state;
}


let ocrLibrariesLoaded = false;

function loadOcrLibrariesV2() {
    console.log("loadOcrLibrariesV2 called - Checking readiness...");
    return new Promise((resolve, reject) => {
        if (ocrLibrariesLoaded) {
            console.log("OCR Libraries already marked as loaded");
            resolve();
            return;
        }

        const isReady = () => {
            if (typeof cv !== 'undefined') {
                if (cv instanceof Promise) {
                    // Replace the global promise with the resolved module once done
                    cv.then(target => { window.cv = target; }).catch(console.error);
                    return false;
                }
                if (cv.Mat && typeof cv.Mat === 'function') {
                    return typeof Tesseract !== 'undefined';
                }
            }
            return false;
        };

        if (isReady()) {
            console.log("OCR Libraries are ready immediately");
            ocrLibrariesLoaded = true;
            resolve();
            return;
        }

        // Dynamic Loading
        if (typeof cv === 'undefined' && !document.getElementById('opencv-script')) {
            console.log("Injecting OpenCV.js...");
            const s = document.createElement('script');
            s.id = 'opencv-script';
            s.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/dist/opencv.js';
            s.async = true;
            document.head.appendChild(s);
        }
        if (typeof Tesseract === 'undefined' && !document.getElementById('tesseract-script')) {
            console.log("Injecting Tesseract.js...");
            const s = document.createElement('script');
            s.id = 'tesseract-script';
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            s.async = true;
            document.head.appendChild(s);
        }

        console.log("Waiting for OCR Libraries (CV/Tesseract)...");
        let retryCount = 0;
        const maxRetries = 200; // 20 seconds
        const checkReady = setInterval(() => {
            if (isReady()) {
                console.log("OCR Libraries ready after " + (retryCount * 100) + "ms");
                clearInterval(checkReady);
                ocrLibrariesLoaded = true;
                resolve();
            }
            retryCount++;
            if (retryCount > maxRetries) {
                console.error("OCR libraries TIMEOUT.", {
                    cv: typeof cv !== 'undefined',
                    Tess: typeof Tesseract !== 'undefined'
                });
                clearInterval(checkReady);
                reject(new Error("OCR libraries failed to load (timeout)"));
            }
        }, 100);
    });
}

// OCR modal open/close
btnOcrOpen.addEventListener('click', () => {
    ocrModal.showModal();
    applyLanguage(currentLang);

    // Reset to upload state
    setOcrModalState('upload');

    uploadedImage = null;
    fileInput.value = '';
    clearUploadInlineError();
});



// Main OCR modal Enter key support (Close)
ocrModal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        // Only close if not focus on button/input (to avoid conflict with nested modal)
        if (activeElement.tagName !== 'BUTTON' && activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            ocrModal.close();
        }
    }
});

// Close dialog when clicking on backdrop
[ocrModal, ocrCorrectionModal].forEach(modal => {
    if (!modal) return;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.close();
    });
});

// Clipboard paste support (PC/Mobile)
document.addEventListener('paste', (e) => {
    // Ignore if modal is not open
    if (!ocrModal.open) return;

    // Catch image from clipboard items
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image/') !== -1) {
            const file = item.getAsFile();
            if (file) {
                e.preventDefault();
                handleFile(file);
                break;
            }
        }
    }
});

// Mobile: explicit clipboard read button
async function readFromClipboard() {
    clearUploadInlineError();
    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const clipboardItem of clipboardItems) {
            const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));
            for (const imageType of imageTypes) {
                const blob = await clipboardItem.getType(imageType);
                const file = new File([blob], "pasted-image.png", { type: imageType });
                handleFile(file);
                return;
            }
        }
        showUploadInlineError(t('clipboardError'));
    } catch (err) {
        console.error("Paste error:", err);
        showUploadInlineError(t('clipboardNoAccess'));
    }
}

// Mobile: explicit clipboard read button
document.getElementById('btn-paste').addEventListener('click', async (e) => {
    e.stopPropagation(); // Prevent file selection dialog from parent upload-zone click
    await readFromClipboard();
});

// Inline unified paste button
document.getElementById('btn-unified-paste').addEventListener('click', async (e) => {
    e.stopPropagation();
    await readFromClipboard();
});

// File loading handler
function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showUploadInlineError(t('invalidFileType'));
        return;
    }
    clearUploadInlineError();

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            uploadedImage = img;

            // Draw full image to canvas
            const ctx = mainCanvas.getContext('2d');
            mainCanvas.width = img.width;
            mainCanvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            ocrStatus.textContent = t('ocrStatusLoaded');
            cellCanvases = [];

            // Trigger analysis immediately
            startOCRAnalysis();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Shared logic for drag & drop zones
 */
function setupUploadListeners(zone) {
    if (!zone) return;
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    zone.addEventListener('click', (e) => {
        // Only trigger file input if the click wasn't on a button
        if (e.target !== fileInput && !e.target.closest('button')) {
            fileInput.click();
        }
    });
}

// Initialize listeners
setupUploadListeners(uploadZone);
setupUploadListeners(document.getElementById('ocr-unified-drop-zone'));

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});


// Modal state

let finalValidatedGrid = null;

function hideAllOcrStates() {
    // Note: State management now handled via setOcrModalState in CSS.
    // This function can be kept for UI resets if needed.
    const manualGrid = document.getElementById('ocr-manual-grid');
    const previewLabel = document.getElementById('ocr-preview-label');
    if (previewLabel) previewLabel.textContent = t('correctionGrid');
}

/**
 * Generate parsed board preview
 */
function renderParsedPreview(grid1D, unrecognizedIndices = []) {
    const previewContainer = document.getElementById('ocr-parsed-preview');
    if (!previewContainer) return;
    previewContainer.innerHTML = '';

    grid1D.forEach((item, idx) => {
        const val = (grid1D instanceof Uint32Array) ? SudokuBitUtils.getValue(item) : item;
        const cell = document.createElement('div');
        cell.className = 'preview-cell';

        // Handle both numeric array and {index: i, ...} object array
        const isUnrecognized = unrecognizedIndices.some(item =>
            (typeof item === 'number' ? item === idx : (item && item.index === idx))
        );

        if (isUnrecognized) {
            cell.textContent = '?';
            cell.classList.add('unrecognized');
        } else if (val !== 0) {
            cell.textContent = val;
        } else {
            cell.innerHTML = '&nbsp;'; // Prevent empty cells from collapsing
        }

        previewContainer.appendChild(cell);
    });
}

function applyGridToBoardAndCloseModal(grid1D) {
    const isBit = (grid1D instanceof Uint32Array);
    // Use the shared sandbox for consistent difficulty evaluation
    const result = SudokuLogicalSolver.evaluate(grid1D, 4, evalSandbox);

    // DLXによる正解生成もBitGridのまま実行
    const solBuffer = new Uint32Array(grid1D);
    SudokuDLX.solveAndFill(solBuffer);
    
    // unifiedBoardの初期化。grid1Dが既にBitGridならそのまま、そうでなければ変換
    const puzzleBits = isBit ? grid1D : SudokuBitUtils.fromUint8Array(grid1D, true);

    for (let i = 0; i < 81; i++) {
        const solDigit = SudokuBitUtils.getValue(solBuffer[i]);
        // Given + Value + Solutionをセット。Bit 12-15に正解を埋め込む
        unifiedBoard[i] = SudokuBitUtils.setSolution(puzzleBits[i], solDigit);
    }
    SudokuBitUtils.clearUnsolvedCandidates(unifiedBoard);
    SudokuBitUtils.updateErrorFlags(unifiedBoard);
    initialSnapshot.set(unifiedBoard);

    undoStack = [];
    redoStack = [];
    selectedRow = 0;
    selectedCol = 0;
    lastInputNumber = 0;
    rocketCount = 0;

    const techLevel = result.technique;
    messageEl.textContent = tTechnique(techLevel);
    currentTechnique = techLevel;

    ocrModal.close();
    hideAllOcrStates();

    renderBoard();
    updateUndoRedoButtons();
    setTimeout(async () => {
        await showSimpleAlert(t('ocrImportComplete'));
    }, 100);
}


// Display state for total analysis failure (grid detection / hint shortage)
function showOcrTotalFailure(errorMsg = null) {
    ocrStatus.textContent = '';
    setOcrModalState('correction');
    document.getElementById('ocr-preview-label').textContent = t('originalImageFailed');

    // Show empty board for manual input
    renderManualCorrectionGrid(new Uint8Array(81));

    if (errorMsg) {
        console.warn("OCR Total Failure:", errorMsg);
    }
}

function proceedToValidation(grid1D) {
    validateAndApplyOcrGrid(grid1D);
}

/**
 * Show modal for user to manually input unrecognized digits
 */
function showOcrCorrectionModal(queue, gridResult) {
    const modal = ocrCorrectionModal;
    const listContainer = document.getElementById('ocr-correction-list');
    const submitBtn = document.getElementById('modal-btn-submit');
    listContainer.innerHTML = '';
    const inputs = [];

    let isFinishing = false;
    const finish = () => {
        if (isFinishing) return;
        isFinishing = true;

        // Register to cache and apply values
        inputs.forEach(item => {
            const val = parseInt(item.input.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 9) {
                // Apply to grid
                item.indices.forEach(idx => {
                    gridResult[idx] = SudokuBitUtils.createSolved(val, true);
                });

                // Save to cache (memory + storage)
                let mat = cv.imread(item.canvas);
                cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY, 0);
                manualCorrectionCache.push({ mat: mat, digit: val });
                saveOcrCache();
            }
        });

        modal.removeEventListener('keydown', onModalKeyDown);
        modal.removeEventListener('cancel', onCancel);
        modal.removeEventListener('click', onBackdropClick);
        modal.removeEventListener('close', finish);

        if (modal.open) modal.close();

        // Target the manual-grid element if parsed-preview is missing
        const parsedPreview = document.getElementById('ocr-parsed-preview') || document.getElementById('ocr-manual-grid');
        if (parsedPreview) {
            parsedPreview.textContent = ''; // Clear
        }
        setOcrModalState('preview');
        renderParsedPreview(gridResult);
        proceedToValidation(gridResult);
    };

    const onModalKeyDown = (e) => {
        if (e.key === 'Enter' && e.target === modal) {
            e.preventDefault();
            finish();
        }
    };
    const onCancel = (e) => {
        e.preventDefault();
        finish();
    };
    const onBackdropClick = (e) => {
        if (e.target === modal) {
            finish();
        }
    };
    modal.addEventListener('keydown', onModalKeyDown);
    modal.addEventListener('cancel', onCancel);
    modal.addEventListener('click', onBackdropClick);
    modal.addEventListener('close', finish, { once: true });

    modal.showModal();

    queue.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'correction-item';

        const img = document.createElement('img');
        img.src = item.canvas.toDataURL();

        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.pattern = '[1-9]*';
        input.maxLength = 1;
        input.placeholder = '?';

        // Input restriction
        input.addEventListener('input', (e) => {
            input.value = input.value.replace(/[^1-9]/g, '').slice(-1);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (idx < queue.length - 1) {
                    inputs[idx + 1].input.focus();
                } else {
                    finish();
                }
            }
        });

        div.appendChild(img);
        div.appendChild(input);
        listContainer.appendChild(div);

        inputs.push({
            input: input,
            indices: item.indices,
            canvas: item.canvas
        });

        // Focus first element with scroll assistance
        if (idx === 0) {
            setTimeout(() => {
                input.focus();
                input.scrollIntoView({ block: 'center' });
            }, 100);
        }

        input.addEventListener('focus', () => {
            input.select();
            // Scroll with delay for iOS/Android keyboard animation smooth transition
            setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        });
    });

    // Use onclick to avoid duplicate addEventListener
    submitBtn.onclick = () => finish();
}


// Auto analysis trigger function
async function startOCRAnalysis() {
    setOcrModalState('analyzing');
    ocrStatus.textContent = t('ocrStatusLoading');

    progressFill.style.setProperty('--progress', '0%');

    try {
        // Step 0: Wait for libraries and load persistent cache
        await loadOcrLibrariesV2();
        await loadOcrCache();
        progressFill.style.setProperty('--progress', '5%');

        // Start new image recognition flow
        const result = await GridDetector.detect(mainCanvas, (p) => {
            progressFill.style.setProperty('--progress', `${Math.round(p * 30)}%`);
        });
        cellCanvases = result.cells;
        const groups = result.groups;

        const gridResult = new Uint32Array(81);

        // --- Step 2: OCR per group ---
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({
            tessedit_char_whitelist: '123456789', // Exclude 0 (no 0 in Sudoku)
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR
        });

        ocrStatus.textContent = t('ocrStatusExtracting');
        progressFill.style.setProperty('--progress', '30%');

        const correctionQueue = [];
        // Keep group info (one correction fixes entire group)
        const groupCorrectionQueue = [];

        let processedCellsCount = 0;

        for (const group of groups) {
            let recognizedNum = 0;

            // Check against cache (previous manual corrections)
            if (manualCorrectionCache.length > 0) {
                let repCanvas = group.canvases[0];
                let currentMat = cv.imread(repCanvas);
                cv.cvtColor(currentMat, currentMat, cv.COLOR_RGBA2GRAY, 0);

                for (const cache of manualCorrectionCache) {
                    let res = new cv.Mat();
                    cv.matchTemplate(currentMat, cache.mat, res, cv.TM_CCOEFF_NORMED);
                    let mm = cv.minMaxLoc(res);
                    if (mm.maxVal > 0.90) {
                        recognizedNum = cache.digit;
                        res.delete();
                        break;
                    }
                    res.delete();
                }
                currentMat.delete();
            }

            // If not in cache, run OCR
            if (recognizedNum === 0) {
                // Try next canvas in group if first fails
                for (const canvas of group.canvases) {
                    const ret = await worker.recognize(canvas);
                    const text = ret.data.text.trim();
                    let num = 0;
                    if (text.length === 1 && text >= '1' && text <= '9') {
                        num = parseInt(text, 10);
                    }

                    if (num !== 0) {
                        recognizedNum = num;

                        // Also cache successful OCR results to speed up future scans
                        const currentMat = cv.imread(canvas);
                        cv.cvtColor(currentMat, currentMat, cv.COLOR_RGBA2GRAY, 0);

                        // Simple deduplication: only add if not already very similar to something in cache
                        let alreadyCached = false;
                        for (const cache of manualCorrectionCache) {
                            let res = new cv.Mat();
                            cv.matchTemplate(currentMat, cache.mat, res, cv.TM_CCOEFF_NORMED);
                            let mm = cv.minMaxLoc(res);
                            if (mm.maxVal > 0.95) {
                                alreadyCached = true;
                                res.delete();
                                break;
                            }
                            res.delete();
                        }

                        if (!alreadyCached) {
                            manualCorrectionCache.push({ mat: currentMat, digit: recognizedNum });
                            saveOcrCache();
                        } else {
                            currentMat.delete();
                        }

                        break; // Success from any canvas confirms the group
                    }
                }
            }

            if (recognizedNum !== 0) {
                for (const idx of group.indices) {
                    gridResult[idx] = SudokuBitUtils.createSolved(recognizedNum, true);
                }
            } else {
                // Add to correction queue per group
                groupCorrectionQueue.push({
                    indices: group.indices,
                    canvas: group.canvases[0]
                });
                // Keep for compatibility (renderParsedPreview, etc.)
                for (const idx of group.indices) {
                    correctionQueue.push({ index: idx, canvas: cellCanvases[idx] });
                }
            }


            processedCellsCount += group.indices.length;
            progressFill.style.setProperty('--progress', `${30 + Math.round((processedCellsCount / 81) * 70)}%`);
        }


        await worker.terminate();

        // If there are unrecognized cells, show correction modal
        if (groupCorrectionQueue.length > 0) {
            const parsedPreview = document.getElementById('ocr-parsed-preview') || document.getElementById('ocr-manual-grid');
            if (parsedPreview) {
                parsedPreview.textContent = '';
            }
            setOcrModalState('correction');
            renderParsedPreview(gridResult, correctionQueue);

            showOcrCorrectionModal(groupCorrectionQueue, gridResult);
            return;
        }

        // All recognized: show preview and proceed
        setOcrModalState('preview');
        document.getElementById('ocr-preview-label').textContent = t('parsedGrid');

        renderParsedPreview(gridResult);
        proceedToValidation(gridResult);
        return;

    } catch (err) {
        console.error(err);
        showOcrTotalFailure(err.toString());
    }
}

/**
 * Validate grid1D: check rule violations, solvability, and route to appropriate flow
 */
function validateAndApplyOcrGrid(grid1D) {
    let isRuleValid = true;

    for (let i = 0; i < 81; i++) {
        const raw = grid1D[i];
        const val = (grid1D instanceof Uint32Array) ? SudokuBitUtils.getValue(raw) : raw;
        if (val !== 0) {
            grid1D[i] = 0;
            // Use the verified isValid method from solver logic
            if (!SudokuLogicalSolver.isValid(grid1D, i, val)) {
                isRuleValid = false;
            }
            grid1D[i] = raw;
        }
    }

    let isSolvable = false;
    if (isRuleValid) {
        // DLX uniqueness check
        const solutionsCount = SudokuDLX.countSolutions(grid1D);
        isSolvable = (solutionsCount === 1);
    }

    ocrStatus.textContent = '';

    if (isRuleValid && isSolvable) {
        applyGridToBoardAndCloseModal(grid1D);
    } else {
        // Route D: rule violation / show correction
        setOcrModalState('correction');
        document.getElementById('ocr-preview-label').textContent = t('correctionGrid');
        renderManualCorrectionGrid(grid1D);
    }
}

/**
 * Build 81-cell interactive grid for manual correction
 */
function renderManualCorrectionGrid(grid1D) {
    const gridContainer = document.getElementById('ocr-manual-grid');
    gridContainer.innerHTML = '';

    for (let i = 0; i < 81; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.dataset.index = i;

        const raw = grid1D[i];
        const val = (grid1D instanceof Uint32Array) ? SudokuBitUtils.getValue(raw) : raw;
        if (val && val !== 0) {
            input.value = val;
        } else {
            input.value = '';
        }

        input.addEventListener('keydown', (e) => {
            if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                e.preventDefault();
            }
        });
        input.addEventListener('focus', () => {
            input.select();
            // Ensure active cell is not hidden by mobile keyboard
            setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        });
        input.addEventListener('click', () => input.select());
        input.addEventListener('input', (e) => {
            // Filter out non-digits
            let val = input.value.replace(/[^1-9]/g, '');

            // Limit to single digit
            if (val.length > 0) {
                val = val.slice(-1); // Always take the last character if multiple
            }

            input.value = val;
        });

        gridContainer.appendChild(input);
    }
}

/**
 * PLAY button handler for manual correction grid
 */
async function handleManualPlayGrid(e) {
    const btn = e.currentTarget;
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('ocrVerifying');

    const inputs = document.querySelectorAll('#ocr-manual-grid input');
    const newGrid1D = new Uint32Array(81);

    inputs.forEach(input => {
        const idx = parseInt(input.dataset.index, 10);
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val >= 1 && val <= 9) {
            newGrid1D[idx] = SudokuBitUtils.createSolved(val, true);
        }
    });

    // Brief delay to give user a "thinking" feel
    await new Promise(r => setTimeout(r, 300));

    try {
        hideAllOcrStates();
        validateAndApplyOcrGrid(newGrid1D);
    } finally {
        // Restore button on failure (modal disappears on success)
        btn.disabled = false;
        btn.textContent = oldText;
    }
}

document.getElementById('btn-manual-play').addEventListener('click', (e) => {
    e.stopPropagation();
    handleManualPlayGrid(e);
});

document.getElementById('btn-re-recognize').addEventListener('click', (e) => {
    e.stopPropagation();
    clearOcrCache();
    startOCRAnalysis();
});

btnOcrOpen.addEventListener('click', () => {
    setOcrModalState('upload');
    ocrModal.showModal();
});
