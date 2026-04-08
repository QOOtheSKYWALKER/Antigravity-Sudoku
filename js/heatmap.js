import { SudokuBitUtils, SudokuDLX, DifficultyEvaluator } from './solver.js';
import { TECHNIQUES, TECHNIQUES_ADVANCED } from './solver-techniques.js';

/**
 * HEATMAP CONFIGURATION
 */
const CONFIG = {
    COLORS: {
        INF: { bg: '#2b0000', text: '#f9d423', isDark: true },
        EMPTY: { bg: 'transparent', text: '#111111' },
        RANK_SCALE: { S: [10, 90], L: [98, 55] }
    },
    ANALYSIS: {
        CHUNK_SIZE: 10,
        MAX_TARGET_RANK: 4
    }
};

/**
 * HEATMAP ANALYZER - Pure logic layer
 */
class HeatmapAnalyzer {
    static async analyze(grid, sandbox) {
        const report = {
            baseCount: SudokuDLX.countSolutions(grid),
            baseDifficulty: 'INF',
            cellReports: {},
            causalLinks: [],
            techniqueCounts: {},
            currentInfIndices: new Set()
        };

        if (report.baseCount === 1) {
            const res = DifficultyEvaluator.evaluate(grid, CONFIG.ANALYSIS.MAX_TARGET_RANK, sandbox);
            report.baseDifficulty = res.difficulty || 'basic';
            report.techniqueCounts = res.techniqueCounts;

            for (let i = 0; i < 81; i++) {
                if (grid[i] === 0) continue;
                const val = grid[i]; grid[i] = 0;
                if (SudokuDLX.countSolutions(grid) > 1) report.currentInfIndices.add(i);
                grid[i] = val;
            }
        }

        const gridCopy = new Uint8Array(grid);
        for (let i = 0; i < 81; i++) {
            if (i > 0 && i % CONFIG.ANALYSIS.CHUNK_SIZE === 0) await new Promise(r => setTimeout(r, 0));
            if (gridCopy[i] === 0) continue;

            const val = gridCopy[i]; gridCopy[i] = 0;
            const count = SudokuDLX.countSolutions(gridCopy);
            const cellRes = { isInf: count > 1, difficulty: 'INF', lockCount: 0 };

            if (count === 1) {
                const res = DifficultyEvaluator.evaluate(gridCopy, CONFIG.ANALYSIS.MAX_TARGET_RANK, sandbox);
                cellRes.difficulty = res.difficulty || 'basic';

                let newInfCount = 0;
                for (let j = 0; j < 81; j++) {
                    if (gridCopy[j] === 0) continue;
                    const valJ = gridCopy[j]; gridCopy[j] = 0;
                    if (SudokuDLX.countSolutions(gridCopy) > 1) {
                        newInfCount++;
                        if (!report.currentInfIndices.has(j)) report.causalLinks.push([i, j]);
                    }
                    gridCopy[j] = valJ;
                }
                cellRes.lockCount = newInfCount - report.currentInfIndices.size;
            }
            report.cellReports[i] = cellRes;
            gridCopy[i] = val;
        }

        return report;
    }
}

/**
 * HEATMAP VISUALIZER - DOM/SVG projection layer
 */
class HeatmapVisualizer {
    static getCellColor(cellReport) {
        if (!cellReport) return CONFIG.COLORS.EMPTY;
        if (cellReport.isInf) return CONFIG.COLORS.INF;
        const rankValue = DifficultyEvaluator.nameToRank(cellReport.difficulty);
        let t = Math.min(1, (rankValue - 1) / 3);
        const { S, L } = CONFIG.COLORS.RANK_SCALE;
        const s = S[0] + (t * (S[1] - S[0]));
        const l = L[0] - (t * (L[0] - L[1]));
        return { bg: `hsl(0, ${s}%, ${l}%)`, text: '#111111' };
    }

    static updateDashboard(grid, report, dashBoardEl) {
        const cells = dashBoardEl.children;
        for (let i = 0; i < 81; i++) {
            const cell = cells[i];
            const res = report.cellReports[i];

            if (grid[i] === 0) {
                cell.className = 'cell empty';
                cell.style.backgroundColor = '';
                cell.children[0].textContent = '';
                cell.children[1].textContent = '';
                continue;
            }

            cell.className = 'cell filled';
            const color = this.getCellColor(res);
            cell.style.backgroundColor = color.bg;
            cell.style.color = color.text;

            if (res) {
                cell.children[0].textContent = (res.difficulty).toUpperCase();
                const sign = res.lockCount >= 0 ? '+' : '';
                cell.children[1].textContent = `INF ${sign}${res.lockCount}`;
            }
        }
    }

    static drawAllLinks(activeLinks, persistentLinks, grid, dashBoardEl, layerEl) {
        layerEl.innerHTML = '';
        const boardRect = layerEl.getBoundingClientRect();

        // 1. Persistent Red Lines (From removed hints to what they were supporting)
        for (const [from, to] of persistentLinks) {
            if (grid[from] !== 0 || grid[to] === 0) continue;
            this.drawLine(from, to, 'persistent-line', dashBoardEl, layerEl, boardRect);
        }

        // 2. Dynamic Blue Lines (Current structural dependencies)
        const seen = new Set();
        for (const [from, to] of activeLinks) {
            const key = from < to ? `${from}-${to}` : `${to}-${from}`;
            if (seen.has(key)) continue; seen.add(key);
            this.drawLine(from, to, 'connection-line', dashBoardEl, layerEl, boardRect);
        }
    }

    static drawLine(from, to, className, dashBoardEl, layerEl, boardRect) {
        const rectA = dashBoardEl.children[from].getBoundingClientRect();
        const rectB = dashBoardEl.children[to].getBoundingClientRect();
        const x1 = (rectA.left + rectA.width / 2) - boardRect.left;
        const y1 = (rectA.top + rectA.height / 2) - boardRect.top;
        const x2 = (rectB.left + rectB.width / 2) - boardRect.left;
        const y2 = (rectB.top + rectB.height / 2) - boardRect.top;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.className.baseVal = className;
        layerEl.appendChild(line);
    }

    static updateMiniBoard(grid, report, miniBoardEl, rank1Names) {
        const bitGrid = SudokuBitUtils.fromUint8Array(grid);
        let cluesCount = 0;
        for (let i = 0; i < 81; i++) {
            const cell = miniBoardEl.children[i];
            if (grid[i] !== 0) {
                cell.textContent = grid[i]; cell.className = 'mini-cell';
                cluesCount++;
            } else {
                cell.innerHTML = ''; cell.className = 'mini-cell memo-cell';
                const mGrid = document.createElement('div'); mGrid.className = 'mini-memo-grid';
                const mask = bitGrid[i] & SudokuBitUtils.MASK_CANDIDATES;
                for (let v = 1; v <= 9; v++) {
                    const s = document.createElement('span');
                    if (mask & (1 << (v - 1))) s.textContent = v;
                    mGrid.appendChild(s);
                }
                cell.appendChild(mGrid);
            }
        }
        document.getElementById('hints-val').textContent = cluesCount;

        const techEl = document.getElementById('global-techniques');
        if (techEl && report.techniqueCounts) {
            techEl.textContent = Object.entries(report.techniqueCounts)
                .filter(([name]) => !rank1Names.has(name))
                .map(([name, count]) => `${name}${count > 1 ? ' x' + count : ''}`).join('\n');
        }
    }
}

/**
 * HEATMAP CONTROLLER
 */
const DOM = {
    dashBoard: document.getElementById('dashboard-board'),
    miniBoard: document.getElementById('mini-board'),
    connectionLayer: document.getElementById('connection-layer'),
    statusMsg: document.getElementById('status-message'),
    btnStart: document.getElementById('btn-start'),
    btnUndo: document.getElementById('btn-undo'),
    btnRedo: document.getElementById('btn-redo')
};

let currentGrid = new Uint8Array(81);
let solutionGrid = new Uint8Array(81);
let undoStack = [];
let redoStack = [];
let persistentLinks = [];
let currentReport = null;
let isCalculating = false;

const evalSandbox = DifficultyEvaluator.createSandbox();
const rank1Names = new Set(TECHNIQUES.filter(t => t.rank === 1).map(t => t.name));

DifficultyEvaluator.connectDictionary([...TECHNIQUES, ...TECHNIQUES_ADVANCED]);
SudokuDLX.init();

function init() {
    DOM.dashBoard.innerHTML = '';
    DOM.miniBoard.innerHTML = '';
    for (let i = 0; i < 81; i++) {
        const r = Math.floor(i / 9), c = i % 9;
        const dCell = document.createElement('div');
        dCell.className = 'cell';
        if (c % 3 === 2 && c !== 8) dCell.classList.add('border-r');
        if (r % 3 === 2 && r !== 8) dCell.classList.add('border-b');

        const spanRate = document.createElement('span'); spanRate.className = 'cell-node-rate';
        const spanDiff = document.createElement('span'); spanDiff.className = 'cell-difficulty';
        dCell.append(spanRate, spanDiff);
        dCell.addEventListener('click', () => handleCellClick(i));
        DOM.dashBoard.appendChild(dCell);

        const mCell = document.createElement('div');
        mCell.className = 'mini-cell empty';
        if (c % 3 === 2 && c !== 8) mCell.classList.add('border-r');
        if (r % 3 === 2 && r !== 8) mCell.classList.add('border-b');
        DOM.miniBoard.appendChild(mCell);
    }
    window.addEventListener('keydown', handleKeyDown);
    startNewGame();
}

async function requestEvaluation() {
    if (isCalculating) return;
    isCalculating = true;
    DOM.statusMsg.textContent = 'Analyzing causal structural dependencies...';
    currentReport = await HeatmapAnalyzer.analyze(currentGrid, evalSandbox);

    HeatmapVisualizer.updateDashboard(currentGrid, currentReport, DOM.dashBoard);
    HeatmapVisualizer.updateMiniBoard(currentGrid, currentReport, DOM.miniBoard, rank1Names);
    HeatmapVisualizer.drawAllLinks(currentReport.causalLinks, persistentLinks, currentGrid, DOM.dashBoard, DOM.connectionLayer);

    DOM.statusMsg.textContent = `Overall Difficulty: ${currentReport.baseDifficulty.toUpperCase()}`;
    isCalculating = false;
}

function handleCellClick(index) {
    if (isCalculating) return;
    const symMode = document.querySelector('input[name="symmetry"]:checked').value;
    const r = Math.floor(index / 9), c = index % 9;
    const peer = (symMode === 'point') ? (80 - index) : (symMode === 'line' ? r * 9 + (8 - c) : -1);

    pushState();

    const toggle = (idx) => {
        if (idx === -1) return;
        if (currentGrid[idx] !== 0) {
            // Commit current dependencies of this hint to persistent "Red Lines" before hiding it
            if (currentReport) {
                for (const [from, to] of currentReport.causalLinks) {
                    if (from === idx) persistentLinks.push([from, to]);
                }
            }
            currentGrid[idx] = 0;
        } else {
            currentGrid[idx] = solutionGrid[idx];
        }
    };
    toggle(index);
    if (peer !== -1 && peer !== index) toggle(peer);
    requestEvaluation();
}

function handleKeyDown(e) {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); DOM.btnUndo.click(); }
    else if ((isMod && e.key.toLowerCase() === 'z' && e.shiftKey) || (isMod && e.key.toLowerCase() === 'y')) {
        e.preventDefault(); DOM.btnRedo.click();
    }
}

function pushState() {
    undoStack.push({ grid: new Uint8Array(currentGrid), pLinks: [...persistentLinks] });
    redoStack = []; updateButtons();
}

function updateButtons() {
    DOM.btnUndo.disabled = undoStack.length === 0;
    DOM.btnRedo.disabled = redoStack.length === 0;
}

async function startNewGame() {
    if (isCalculating) return;
    isCalculating = true;
    DOM.statusMsg.textContent = 'Generating research seed...';
    await new Promise(r => setTimeout(r, 0));

    const mode = document.getElementById('start-mode').value;
    const maxTries = 20;
    let found = false;

    for (let t = 0; t < maxTries; t++) {
        const solveGrid = new Uint8Array(81);
        const seedBits = new Uint32Array(81);
        let placed = 0;
        while (placed < 5) {
            const idx = Math.floor(Math.random() * 81), val = Math.floor(Math.random() * 9) + 1;
            if (seedBits[idx] === 0 && SudokuBitUtils.isValid(seedBits, idx, val)) {
                seedBits[idx] = SudokuBitUtils.createSolved(val, true); placed++;
            }
        }
        SudokuDLX.solveAndFill(seedBits);
        for (let i = 0; i < 81; i++) solveGrid[i] = SudokuBitUtils.getValue(seedBits[i]);

        const tryGrid = new Uint8Array(81);
        if (mode === 'checkered') {
            for (let i = 0; i < 81; i++) {
                const r = Math.floor(i / 9), c = i % 9;
                if ((r + c) % 2 === 0) tryGrid[i] = solveGrid[i];
            }
        } else {
            tryGrid.set(solveGrid);
        }

        if (SudokuDLX.countSolutions(tryGrid) === 1 || t === maxTries - 1) {
            currentGrid.set(tryGrid); solutionGrid.set(solveGrid);
            found = true; break;
        }
    }

    undoStack = []; redoStack = []; persistentLinks = [];
    updateButtons();
    isCalculating = false;
    requestEvaluation();
}

DOM.btnStart.onclick = startNewGame;
document.getElementById('start-mode').onchange = startNewGame;
DOM.btnUndo.onclick = () => {
    if (undoStack.length === 0 || isCalculating) return;
    redoStack.push({ grid: new Uint8Array(currentGrid), pLinks: [...persistentLinks] });
    const state = undoStack.pop();
    currentGrid.set(state.grid); persistentLinks = state.pLinks;
    updateButtons(); requestEvaluation();
};
DOM.btnRedo.onclick = () => {
    if (redoStack.length === 0 || isCalculating) return;
    undoStack.push({ grid: new Uint8Array(currentGrid), pLinks: [...persistentLinks] });
    const state = redoStack.pop();
    currentGrid.set(state.grid); persistentLinks = state.pLinks;
    updateButtons(); requestEvaluation();
};

window.onresize = () => {
    if (currentReport) HeatmapVisualizer.drawAllLinks(currentReport.causalLinks, persistentLinks, currentGrid, DOM.dashBoard, DOM.connectionLayer);
};

document.addEventListener('DOMContentLoaded', init);
