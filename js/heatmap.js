import { SudokuBitUtils, SudokuDLX, SudokuLogicalSolver, DifficultyEvaluator } from './solver.js';
import { TECHNIQUES, TECHNIQUES_ADVANCED } from './solver-techniques.js';
DifficultyEvaluator.connectDictionary([...TECHNIQUES, ...TECHNIQUES_ADVANCED]);
const rank1Names = new Set(TECHNIQUES.filter(t => t.rank === 1).map(t => t.name));
const dashBoard = document.getElementById('dashboard-board');
const miniBoard = document.getElementById('mini-board');
const btnStart = document.getElementById('btn-start');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const statusMsg = document.getElementById('status-message');
const connectionLayer = document.getElementById('connection-layer');

let currentGrid = new Uint8Array(81);
let solutionGrid = new Uint8Array(81); // Store the base solution
let undoStack = [];
let redoStack = [];
let currentConnections = []; // Analysis result: Pairs of [idx1, idx2] (Blue)
let persistentConnections = []; // Committed: Pairs of [fromVacantIdx, toInfIdx] (Red)

let isCalculating = false;

// Initial memory allocation for engine & sandbox
SudokuDLX.init();
const evalSandbox = DifficultyEvaluator.createSandbox();

// Initialize Grids
function initGrids() {
    dashBoard.innerHTML = '';
    miniBoard.innerHTML = '';

    for (let i = 0; i < 81; i++) {
        // Dashboard Cell
        const dCell = document.createElement('div');
        dCell.className = 'cell';
        dCell.dataset.index = i;

        const rateSpan = document.createElement('span');
        rateSpan.className = 'cell-node-rate';

        const diffSpan = document.createElement('span');
        diffSpan.className = 'cell-difficulty';

        dCell.appendChild(rateSpan);
        dCell.appendChild(diffSpan);

        dCell.addEventListener('click', () => handleCellClick(i));
        dashBoard.appendChild(dCell);

        // Mini Cell
        const mCell = document.createElement('div');
        mCell.className = 'mini-cell empty';
        mCell.id = `mini-cell-${i}`;
        miniBoard.appendChild(mCell);
    }
}

function updateMiniBoard(grid, evalResult = null) {
    let currentCluesCount = 0;

    // Use SudokuBitUtils to find the current state of candidates
    const bitGrid = SudokuBitUtils.fromUint8Array(grid);

    for (let i = 0; i < 81; i++) {
        const cell = document.getElementById(`mini-cell-${i}`);
        if (grid[i] !== 0) {
            cell.textContent = grid[i];
            cell.classList.remove('empty', 'memo-cell');
            currentCluesCount++;
        } else {
            // Render candidates as a memo grid
            cell.innerHTML = '';
            cell.classList.add('memo-cell');
            cell.classList.remove('empty');

            const memoGrid = document.createElement('div');
            memoGrid.className = 'mini-memo-grid';
            const candMask = bitGrid[i] & SudokuBitUtils.MASK_CANDIDATES;
            for (let v = 1; v <= 9; v++) {
                const span = document.createElement('span');
                if (candMask & (1 << (v - 1))) {
                    span.textContent = v;
                }
                memoGrid.appendChild(span);
            }
            cell.appendChild(memoGrid);
        }
    }
    document.getElementById('hints-val').textContent = currentCluesCount;

    // --- Global Techniques Display ---
    const globalTechEl = document.getElementById('global-techniques');
    if (globalTechEl) {
        // Direct engine calls for global evaluation
        const counts = evalResult?.techniqueCounts;

        if (counts && Object.keys(counts).length > 0) {
            const techs = Object.entries(counts)
                .filter(([name]) => !rank1Names.has(name))   // rank1 を除外
                .map(([name, count]) => `${name}${count > 1 ? ' x' + count : ''}`)
                .join('\n');
            globalTechEl.textContent = techs;
        } else {
            globalTechEl.textContent = '';
        }
    }
}


// Heatmap Color scale logic
function getHeatmapColor(res) {
    if (res.isInf) return { bg: '#2b0000', text: '#f9d423', isDark: true };

    const rank = DifficultyEvaluator.nameToRank(res.difficulty) - 1;
    // Scale rank: 0 (basic) to 3 (hard/extreme)
    let t = rank / 3;
    if (t > 1) t = 1;

    // Interpolate Saturation and Lightness
    const s = 10 + (t * 80); // 10% to 90%
    const l = 98 - (t * 43); // 98% to 55%

    return {
        bg: `hsl(0, ${s}%, ${l}%)`,
        text: '#111111',
        isDark: false
    };
}

function renderEmptyDashboard() {
    const cells = dashBoard.children;
    for (let i = 0; i < 81; i++) {
        const c = cells[i];
        c.className = 'cell empty';
        c.style.backgroundColor = '';
        c.children[0].textContent = '';
        c.children[1].textContent = '';
        if (c.children[2]) c.children[2].textContent = '';
    }
    clearConnections();
}

function clearConnections() {
    connectionLayer.innerHTML = '';
    currentConnections = [];
    // Note: persistentConnections are NOT cleared here
}

function drawConnections() {
    connectionLayer.innerHTML = '';
    const boardRect = connectionLayer.getBoundingClientRect();

    // 1. Draw Persistent Red Lines
    for (const [i, j] of persistentConnections) {
        if (currentGrid[i] !== 0 || currentGrid[j] === 0) continue;

        const cellA = dashBoard.children[i];
        const cellB = dashBoard.children[j];
        if (!cellA || !cellB) continue;

        const rectA = cellA.getBoundingClientRect();
        const rectB = cellB.getBoundingClientRect();

        const x1 = (rectA.left + rectA.width / 2) - boardRect.left;
        const y1 = (rectA.top + rectA.height / 2) - boardRect.top;
        const x2 = (rectB.left + rectB.width / 2) - boardRect.left;
        const y2 = (rectB.top + rectB.height / 2) - boardRect.top;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.className.baseVal = 'persistent-line';
        connectionLayer.appendChild(line);
    }

    // 2. Draw Temporary Blue Lines (Analysis)
    if (currentConnections.length === 0) return;
    const seen = new Set();
    for (const [i, j] of currentConnections) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cellA = dashBoard.children[i];
        const cellB = dashBoard.children[j];
        if (!cellA || !cellB) continue;
        const rectA = cellA.getBoundingClientRect();
        const rectB = cellB.getBoundingClientRect();
        const x1 = (rectA.left + rectA.width / 2) - boardRect.left;
        const y1 = (rectA.top + rectA.height / 2) - boardRect.top;
        const x2 = (rectB.left + rectB.width / 2) - boardRect.left;
        const y2 = (rectB.top + rectB.height / 2) - boardRect.top;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.className.baseVal = 'connection-line';
        connectionLayer.appendChild(line);
    }
}

function updateDashboardWithResults(results) {
    const cells = dashBoard.children;
    for (let i = 0; i < 81; i++) {
        const c = cells[i];
        if (currentGrid[i] === 0) {
            c.className = 'cell empty';
            c.style.backgroundColor = '';
            c.children[0].textContent = '';
            c.children[1].textContent = '';
            if (c.children[2]) c.children[2].textContent = '';
            continue;
        }

        c.className = 'cell filled';
        const res = results[i];

        if (!res) continue;

        c.children[0].textContent = (res.difficulty || 'basic').toUpperCase();

        const sign = res.lockCount >= 0 ? '+' : '';
        c.children[1].textContent = `INF ${sign}${res.lockCount}`;

        const colorMode = getHeatmapColor(res);
        c.style.backgroundColor = colorMode.bg;
        c.style.color = colorMode.text;
    }
}

function pushState() {
    undoStack.push(new Uint8Array(currentGrid));
    redoStack = [];
    updateButtons();
}

function updateButtons() {
    btnUndo.disabled = undoStack.length === 0;
    btnRedo.disabled = redoStack.length === 0;
}

function handleCellClick(index) {
    if (isCalculating) return;

    const symMode = document.querySelector('input[name="symmetry"]:checked').value;
    const r = Math.floor(index / 9);
    const c = index % 9;
    let peerIndex = -1;

    if (symMode === 'point') {
        peerIndex = (8 - r) * 9 + (8 - c);
    } else if (symMode === 'line') {
        peerIndex = r * 9 + (8 - c);
    }

    pushState();

    if (currentGrid[index] !== 0) {
        commitPersistentConnections(index);
        if (peerIndex !== -1 && peerIndex !== index) {
            commitPersistentConnections(peerIndex);
        }

        currentGrid[index] = 0;
        if (peerIndex !== -1 && peerIndex !== index) {
            currentGrid[peerIndex] = 0;
        }
    } else {
        currentGrid[index] = solutionGrid[index];
        if (peerIndex !== -1 && peerIndex !== index) {
            currentGrid[peerIndex] = solutionGrid[peerIndex];
        }
    }

    requestEvaluation();
}

function commitPersistentConnections(sourceIndex) {
    for (const [i, j] of currentConnections) {
        if (i === sourceIndex) {
            persistentConnections.push([i, j]);
        }
    }
}


async function requestEvaluation() {
    if (isCalculating) return;
    isCalculating = true;
    clearConnections();
    statusMsg.textContent = 'Calculating...';

    // 1. Base evaluation
    const baseCount = SudokuDLX.countSolutions(currentGrid);
    let baseDifficulty = 'INF';

    if (baseCount === 1) {
        const resBit = DifficultyEvaluator.evaluate(currentGrid, 4, evalSandbox);
        baseDifficulty = resBit.difficulty || 'basic';
    }

    const evalResult = baseCount === 1
        ? DifficultyEvaluator.evaluate(currentGrid, 4, evalSandbox)
        : null;

    updateMiniBoard(currentGrid, evalResult);

    // 1b. Calculate current INF count and which clues are already INF
    let currentInfCount = 0;
    const initialInfCells = new Set();
    if (baseCount === 1) {
        for (let i = 0; i < 81; i++) {
            if (currentGrid[i] !== 0) {
                const val = currentGrid[i];
                currentGrid[i] = 0;
                const check = SudokuDLX.countSolutions(currentGrid);
                if (check > 1) {
                    currentInfCount++;
                    initialInfCells.add(i);
                }
                currentGrid[i] = val;
            }
        }
    }

    const results = {};
    const gridCopy = new Uint8Array(currentGrid);
    currentConnections = [];

    // 2. Sequential Async Evaluation
    for (let i = 0; i < 81; i++) {
        if (gridCopy[i] !== 0) {
            const val = gridCopy[i];
            gridCopy[i] = 0;

            const count = SudokuDLX.countSolutions(gridCopy);
            let diff = 'INVALID';
            let isInf = false;

            if (count === 1) {
                const resBit = DifficultyEvaluator.evaluate(gridCopy, 4, evalSandbox);
                diff = resBit.difficulty || 'basic';
            } else {
                isInf = true;
                diff = 'INF';
            }

            results[i] = { isInf, difficulty: diff, lockCount: 0 };

            if (count === 1) {
                let newLocks = 0;
                for (let j = 0; j < 81; j++) {
                    if (gridCopy[j] !== 0) {
                        const valJ = gridCopy[j];
                        gridCopy[j] = 0;
                        const checkJ = SudokuDLX.countSolutions(gridCopy);
                        if (checkJ > 1) {
                            newLocks++;
                            if (!initialInfCells.has(j)) {
                                currentConnections.push([i, j]);
                            }
                        }
                        gridCopy[j] = valJ;
                    }
                }
                results[i].lockCount = newLocks - currentInfCount;
            }

            gridCopy[i] = val;


        }
    }

    isCalculating = false;
    statusMsg.innerHTML = `Diff: ${baseDifficulty}`;
    updateDashboardWithResults(results);
    drawConnections();
}

/**
 * ランダムシードを埋め込んだ上でsolveAndFillを呼び、
 * 毎回異なる完全盤面をUint8Array形式で生成して返す。
 * generator.jsと同じ方式: 有効なランダム配置を5つ置いてからDLXで補完する。
 * @param {Uint8Array} outGrid - 結果を書き込むUint8Array(81)
 */
function randomSolveAndFill(outGrid) {
    // Uint32Arrayのシードグリッドを用意（DLXはUint32も受け付ける）
    const seedBits = new Uint32Array(81);
    let placed = 0;
    let guard = 0;
    while (placed < 5 && guard < 200) {
        guard++;
        const idx = Math.floor(Math.random() * 81);
        const val = Math.floor(Math.random() * 9) + 1;
        if (seedBits[idx] !== 0) continue; // 既に配置済み
        if (SudokuBitUtils.isValid(seedBits, idx, val)) {
            seedBits[idx] = SudokuBitUtils.createSolved(val, true);
            placed++;
        }
    }
    // DLXで残りを補完
    SudokuDLX.solveAndFill(seedBits);
    // Uint8Arrayに変換して返す
    for (let i = 0; i < 81; i++) {
        outGrid[i] = SudokuBitUtils.getValue(seedBits[i]);
    }
}

async function startNewGame() {
    isCalculating = true;
    statusMsg.textContent = 'Generating unique board...';
    await new Promise(r => setTimeout(r, 0));

    const mode = document.getElementById('start-mode').value;
    const grid = new Uint8Array(81);
    const solveGrid = new Uint8Array(81);

    if (mode === 'checkered') {
        const MAX_TRIES = 20;
        for (let tries = 0; tries < MAX_TRIES; tries++) {
            randomSolveAndFill(solveGrid);
            const testGrid = new Uint8Array(81);
            for (let i = 0; i < 81; i++) {
                const r = Math.floor(i / 9), c = i % 9;
                testGrid[i] = ((r + c) % 2 === 0) ? solveGrid[i] : 0;
            }

            if (SudokuDLX.countSolutions(testGrid) === 1 || tries === MAX_TRIES - 1) {
                grid.set(testGrid);
                break;
            }
        }

    } else {
        // Full モード: ランダム化した完全盤面をそのまま使用
        randomSolveAndFill(solveGrid);
        grid.set(solveGrid);
    }

    isCalculating = false;
    pushState();
    currentGrid.set(grid);
    solutionGrid.set(solveGrid);
    persistentConnections = [];
    requestEvaluation();
}

btnStart.addEventListener('click', startNewGame);

// モード切り替え時
document.getElementById('start-mode').addEventListener('change', startNewGame);

// DOMContentLoaded 時
document.addEventListener('DOMContentLoaded', () => {
    initGrids();
    startNewGame();   // renderEmptyDashboard() は不要になる（startNewGame が上書きするため）
});


function undo() {
    if (undoStack.length === 0 || isCalculating) return;
    redoStack.push(new Uint8Array(currentGrid));
    currentGrid = undoStack.pop();
    updateButtons();
    requestEvaluation();
}

function redo() {
    if (redoStack.length === 0 || isCalculating) return;
    undoStack.push(new Uint8Array(currentGrid));
    currentGrid = redoStack.pop();
    updateButtons();
    requestEvaluation();
}

btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

window.addEventListener('keydown', (e) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
    } else if (isMod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
    }
});


// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initGrids();
    renderEmptyDashboard();
});

window.addEventListener('resize', () => {
    drawConnections();
});
