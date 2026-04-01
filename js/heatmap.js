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
SudokuDLX.allocateMemory();
const evalSandbox = SudokuLogicalSolver.createSandbox();

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

function updateMiniBoard(grid) {
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

    // --- NEW: Global Techniques Display ---
    const globalTechEl = document.getElementById('global-techniques');
    if (globalTechEl) {
        // Direct engine calls for global evaluation
        const solutions = SudokuDLX.countSolutions(grid);
        const baseEval = { count: solutions };
        if (solutions === 1) {
            const solver = evalSandbox;
            solver.reset(grid);
            const fullRes = solver.solveByRank(4);
            baseEval.techniqueCounts = fullRes.techniqueCounts;
        }

        if (baseEval.techniqueCounts && Object.keys(baseEval.techniqueCounts).length > 0) {
            const techs = Object.entries(baseEval.techniqueCounts)
                .map(([name, count]) => `${name}${count > 1 ? ' x' + count : ''}`)
                .join(', ');
            globalTechEl.textContent = techs ? techs : '';
        } else {
            globalTechEl.textContent = '';
        }
    }
}


// Heatmap Color scale logic
function getHeatmapColor(res) {
    if (res.isInf) return { bg: '#2b0000', text: '#f9d423', isDark: true };

    const rank = (res.difficulty in DIFFICULTY_RANK) ? DIFFICULTY_RANK[res.difficulty] : 0;
    // Scale rank: 0 (basic) to 3 (hard/extreme)
    let t = rank / 3;
    if (t < 0) t = 0;
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
    // These connect EMPTY slots (i) to their corresponding INF cells (j)
    for (const [i, j] of persistentConnections) {
        // Only draw if 'i' is actually empty and 'j' is actually a hint
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
        // If the cell was removed, clean it up
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

        // 1. Main Text: Difficulty Level (e.g., MEDIUM)
        c.children[0].textContent = (res.difficulty || 'basic').toUpperCase();

        // 2. Sub Text: INF status and Lock Count increase (Now uniform "INF +X")
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
        // COMMITTING RED LINES:
        // Move blue dependencies for this index into red persistent connections
        commitPersistentConnections(index);
        if (peerIndex !== -1 && peerIndex !== index) {
            commitPersistentConnections(peerIndex);
        }

        // Remove cell
        currentGrid[index] = 0;
        if (peerIndex !== -1 && peerIndex !== index) {
            currentGrid[peerIndex] = 0;
        }
    } else {
        // Restore cell from original solution
        currentGrid[index] = solutionGrid[index];
        if (peerIndex !== -1 && peerIndex !== index) {
            currentGrid[peerIndex] = solutionGrid[peerIndex];
        }
    }

    updateMiniBoard(currentGrid);
    requestEvaluation();
}

function commitPersistentConnections(sourceIndex) {
    // Collect specific dependencies for the sourceIndex from the CURRENT blue lines
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

    // UI Yielding Helper
    const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

    // 1. Base evaluation (direct エンジン 呼び出し)
    const baseCount = SudokuDLX.countSolutions(currentGrid);
    let baseDifficulty = 'INF';

    if (baseCount === 1) {
        const resBit = SudokuLogicalSolver.evaluate(currentGrid, 4, evalSandbox);
        baseDifficulty = resBit.difficulty || 'basic';
    }

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
                const resBit = SudokuLogicalSolver.evaluate(gridCopy, 4, evalSandbox);
                diff = resBit.difficulty || 'basic';
            } else {
                isInf = true;
                diff = 'INF';
            }

            results[i] = { isInf, difficulty: diff, lockCount: 0 };

            if (count === 1) {
                // Look-ahead: Find which clues become INF when 'i' is removed
                let newLocks = 0;
                for (let j = 0; j < 81; j++) {
                    if (gridCopy[j] !== 0) {
                        const valJ = gridCopy[j];
                        gridCopy[j] = 0;
                        const checkJ = SudokuDLX.countSolutions(gridCopy);
                        if (checkJ > 1) {
                            newLocks++;
                            // If it wasn't INF before, then it's a new dependency
                            if (!initialInfCells.has(j)) {
                                currentConnections.push([i, j]);
                            }
                        }
                        gridCopy[j] = valJ;
                    }
                }
                // Record the INCREASE (+X)
                results[i].lockCount = newLocks - currentInfCount;
            }

            gridCopy[i] = val;

            // Yield to browser UI more frequently (every 2 cells) due to N^2 complexity
            if (i % 2 === 0) {
                statusMsg.textContent = `Analyzing Strategy... ${Math.round((i / 81) * 100)}%`;
                await yieldUI();
            }
        }
    }


    isCalculating = false;
    statusMsg.innerHTML = `Diff: ${baseDifficulty}`;
    updateDashboardWithResults(results);
    drawConnections();

}




btnStart.addEventListener('click', async () => {
    isCalculating = true;
    statusMsg.textContent = 'Generating unique board...';
    await new Promise(r => setTimeout(r, 0));

    const mode = document.getElementById('start-mode').value;
    const grid = new Uint8Array(81);
    const solveGrid = new Uint8Array(81);

    if (mode === 'checkered') {
        let found = false;
        // Try to find a solution that remains unique when checkered
        for (let tries = 0; tries < 100; tries++) {
            solveGrid.fill(0);
            SudokuDLX.solveAndFill(solveGrid);
            const testGrid = new Uint8Array(solveGrid);
            for (let i = 0; i < 81; i++) {
                const r = Math.floor(i / 9);
                const c = i % 9;
                if ((r + c) % 2 !== 0) testGrid[i] = 0;
            }
            if (SudokuDLX.countSolutions(testGrid) === 1) {
                grid.set(testGrid);
                found = true;
                break;
            }
        }
        // Fallback
        if (!found) {
            solveGrid.fill(0);
            SudokuDLX.solveAndFill(solveGrid);
            grid.set(solveGrid);
            for (let i = 0; i < 81; i++) {
                const r = Math.floor(i / 9), c = i % 9;
                if ((r + c) % 2 !== 0) grid[i] = 0;
            }
        }
    } else {
        SudokuDLX.solveAndFill(solveGrid);
        grid.set(solveGrid);
    }

    isCalculating = false;
    pushState();
    currentGrid.set(grid);
    solutionGrid.set(solveGrid); // Remember the full solution
    persistentConnections = []; // Reset dependency trace on new game

    updateMiniBoard(currentGrid);
    requestEvaluation();
});



function undo() {
    if (undoStack.length === 0 || isCalculating) return;
    redoStack.push(new Uint8Array(currentGrid));
    currentGrid = undoStack.pop();
    updateButtons();
    updateMiniBoard(currentGrid);
    requestEvaluation();
}

function redo() {
    if (redoStack.length === 0 || isCalculating) return;
    undoStack.push(new Uint8Array(currentGrid));
    currentGrid = redoStack.pop();
    updateButtons();
    updateMiniBoard(currentGrid);
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
