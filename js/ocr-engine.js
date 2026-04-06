export class GridDetector {
    static async _yield() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    // Constants for normalization and output size
    static NORM_SIZE = 128;
    static PADDING_FACTOR = 0.8; // Use 80% of canvas for the digit

    /**
     * Main image recognition pipeline
     * @param {HTMLCanvasElement} canvas Input image drawn on canvas
     * @param {Function} onProgress Progress update callback
     * @returns {Promise<{cells: Array<HTMLCanvasElement>, groups: Array}>} 81 cell canvases and groups
     */
    static async detect(canvas, onProgress) {
        const updateProgress = (p) => { if (onProgress) onProgress(p); };

        await this._yield();
        let src = cv.imread(canvas);
        updateProgress(0.05);

        // 1. Crop grid area
        const bestRect = this.findGridRect(src);
        if (!bestRect) {
            src.delete();
            throw new Error("Could not locate the sudoku grid boundary.");
        }
        let boardMat = src.roi(bestRect);

        updateProgress(0.1);

        // 2. Split into 81 cells
        const totalRows = boardMat.rows;
        const totalCols = boardMat.cols;
        const cellWidth = totalCols / 9;
        const cellHeight = totalRows / 9;

        let cellsMats = [];
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                let rect = new cv.Rect(
                    Math.floor(col * cellWidth),
                    Math.floor(row * cellHeight),
                    Math.floor(cellWidth),
                    Math.floor(cellHeight)
                );
                cellsMats.push(boardMat.roi(rect));
            }
        }

        // 3. Preliminary height analysis
        let heightInfos = [];

        for (let i = 0; i < 81; i++) {
            if (i % 9 === 0) await this._yield(); // Yield every 9 cells

            let cellGray = new cv.Mat();
            cv.cvtColor(cellsMats[i], cellGray, cv.COLOR_RGBA2GRAY, 0);

            // Dark mode detection by average brightness
            let meanRes = cv.mean(cellGray);
            let meanVal = (meanRes.val || meanRes)[0];
            if (meanVal < 128) {
                cv.bitwise_not(cellGray, cellGray);
            }

            let cellBinary = new cv.Mat();
            cv.threshold(cellGray, cellBinary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

            let labels = new cv.Mat();
            let stats = new cv.Mat();
            let centroids = new cv.Mat();
            let nLabels = cv.connectedComponentsWithStats(cellBinary, labels, stats, centroids);

            let maxArea = 0;
            let currentH = 0;

            // Find the largest object that does not touch the cell edges
            for (let l = 1; l < nLabels; l++) {
                let left = stats.intAt(l, cv.CC_STAT_LEFT);
                let top = stats.intAt(l, cv.CC_STAT_TOP);
                let width = stats.intAt(l, cv.CC_STAT_WIDTH);
                let height = stats.intAt(l, cv.CC_STAT_HEIGHT);
                let area = stats.intAt(l, cv.CC_STAT_AREA);

                let touchesEdge = (left <= 0) || (top <= 0) || (left + width >= cellBinary.cols) || (top + height >= cellBinary.rows);

                if (!touchesEdge && area > maxArea) {
                    maxArea = area;
                    currentH = height;
                }
            }

            heightInfos.push({ h: currentH, maxH_possible: cellBinary.rows });
            cellGray.delete(); cellBinary.delete(); labels.delete(); stats.delete(); centroids.delete();
        }

        // 4. Height filtering
        // Exclude extremely large noise (>= 95% of cell height) from max calculation
        let validHeights = heightInfos.map(info => info.h).filter((h, i) => h < heightInfos[i].maxH_possible * 0.95);
        const maxH = validHeights.length > 0 ? Math.max(...validHeights) : 0;
        const heightThreshold = maxH * 0.75;

        // 5. Normalization (only for valid digits)
        let processedCellMatInfo = []; // { mat, h }
        const validIndices = new Set();

        for (let i = 0; i < 81; i++) {
            if (i % 9 === 0) await this._yield(); // Yield every 9 cells

            let h = heightInfos[i].h;
            let finalCell = new cv.Mat.ones(this.NORM_SIZE, this.NORM_SIZE, cv.CV_8UC1);
            finalCell.setTo(new cv.Scalar(255)); // Initialize to white background

            if (h >= heightThreshold && h > 0) {
                validIndices.add(i);

                // Re-process to extract mask and normalize
                let cellGray = new cv.Mat();
                cv.cvtColor(cellsMats[i], cellGray, cv.COLOR_RGBA2GRAY, 0);

                // Dark mode detection
                if (cv.mean(cellGray)[0] < 128) cv.bitwise_not(cellGray, cellGray);

                let cellBinary = new cv.Mat();
                cv.threshold(cellGray, cellBinary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

                let labels = new cv.Mat();
                let stats = new cv.Mat();
                let centroids = new cv.Mat();
                let nLabels = cv.connectedComponentsWithStats(cellBinary, labels, stats, centroids);

                // Find the same best label
                let bestLabel = -1;
                let maxArea = 0;
                for (let l = 1; l < nLabels; l++) {
                    let left = stats.intAt(l, cv.CC_STAT_LEFT);
                    let top = stats.intAt(l, cv.CC_STAT_TOP);
                    let width = stats.intAt(l, cv.CC_STAT_WIDTH);
                    let height = stats.intAt(l, cv.CC_STAT_HEIGHT);
                    let area = stats.intAt(l, cv.CC_STAT_AREA);
                    let touchesEdge = (left <= 0) || (top <= 0) || (left + width >= cellBinary.cols) || (top + height >= cellBinary.rows);
                    if (!touchesEdge && area > maxArea) {
                        maxArea = area;
                        bestLabel = l;
                    }
                }

                if (bestLabel !== -1) {
                    let labelMask = new cv.Mat();
                    let labelMat = new cv.Mat(labels.rows, labels.cols, cv.CV_32S, [bestLabel, 0, 0, 0]);
                    cv.compare(labels, labelMat, labelMask, cv.CMP_EQ);
                    labelMat.delete();

                    let centeredMat = this.centerDigit(labelMask);
                    finalCell.delete();
                    finalCell = centeredMat;
                    labelMask.delete();
                }

                cellGray.delete(); cellBinary.delete(); labels.delete(); stats.delete(); centroids.delete();
            } else {
                // Treatment below threshold (mark as empty/white)
                h = 0;
            }
            processedCellMatInfo.push({ mat: finalCell, h: h });
        }

        updateProgress(0.25);

        // 6. Grouping (similarity > 90%)
        let groups = [];
        for (let i = 0; i < 81; i++) {
            if (!validIndices.has(i)) continue;
            await this._yield(); // Yield per matched cell

            let matched = false;
            for (let group of groups) {
                let res = new cv.Mat();
                // Use normalized cross-correlation for template matching
                cv.matchTemplate(processedCellMatInfo[i].mat, processedCellMatInfo[group.representativeIdx].mat, res, cv.TM_CCOEFF_NORMED);
                let mm = cv.minMaxLoc(res);
                res.delete();

                if (mm.maxVal > 0.90) {
                    group.indices.push(i);
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                groups.push({ representativeIdx: i, indices: [i] });
            }
        }

        // 7. Generate final result
        let cells = [];
        for (let i = 0; i < 81; i++) {
            let info = processedCellMatInfo[i];
            let hasDigit = validIndices.has(i);

            let canvas = document.createElement('canvas');
            canvas.width = info.mat.cols;
            canvas.height = info.mat.rows;

            if (!hasDigit) {
                // Empty cells remain white background
                let whiteMat = new cv.Mat.ones(info.mat.rows, info.mat.cols, cv.CV_8UC1);
                whiteMat.setTo(new cv.Scalar(255));
                cv.imshow(canvas, whiteMat);
                whiteMat.delete();
            } else {
                // Show the processed digit (which includes centering)
                cv.imshow(canvas, info.mat);
            }

            canvas.dataset.hasDigit = hasDigit ? 'true' : 'false';
            cells.push(canvas);

            info.mat.delete();
            cellsMats[i].delete();
        }

        return {
            cells, groups: groups.map(g => ({
                canvases: [cells[g.representativeIdx]],
                indices: g.indices
            }))
        };
    }

    static findGridRect(src) {
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        let blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        let thresh = new cv.Mat();
        // Adaptive thresholding to find grid lines
        cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestRect = null;

        // Find contours that resemble grid lines (aspect ratio check)
        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let rect = cv.boundingRect(cnt);
            let area = rect.width * rect.height;
            let aspect = rect.width / rect.height;

            // Check for rectangular shapes typical of grid lines (aspect ratio 0.8 to 1.2)
            if (aspect > 0.8 && aspect < 1.2 && area > maxArea) {
                maxArea = area;
                bestRect = rect;
            }
            cnt.delete();
        }

        gray.delete(); blurred.delete(); thresh.delete(); contours.delete(); hierarchy.delete();
        return bestRect;
    }

    /**
     * Centers the detected digit within a target square of size NORM_SIZE x NORM_SIZE.
     * @param {cv.Mat} cellMat The binary mask of the cell containing the digit.
     * @returns {cv.Mat} The centered and inverted digit mask.
     */
    static centerDigit(cellMat) {
        const TARGET_SIZE = this.NORM_SIZE;
        const PADDING_FACTOR = this.PADDING_FACTOR; // 80% padding

        let labels = new cv.Mat();
        let stats = new cv.Mat();
        let centroids = new cv.Mat();

        let clonedMat = cellMat.clone();
        let nLabels = cv.connectedComponentsWithStats(clonedMat, labels, stats, centroids);
        clonedMat.delete();

        let bestRect = null;
        let maxArea = 0;
        let digitIndex = -1;

        // Find the largest object (the digit)
        for (let i = 1; i < nLabels; i++) {
            let area = stats.intAt(i, cv.CC_STAT_AREA);
            if (area > maxArea) {
                maxArea = area;
                digitIndex = i;
                bestRect = new cv.Rect(
                    stats.intAt(i, cv.CC_STAT_LEFT),
                    stats.intAt(i, cv.CC_STAT_TOP),
                    stats.intAt(i, cv.CC_STAT_WIDTH),
                    stats.intAt(i, cv.CC_STAT_HEIGHT)
                );
            }
        }

        // Initialize output canvas to white background (255)
        let output = new cv.Mat.ones(TARGET_SIZE, TARGET_SIZE, cv.CV_8UC1);
        output.setTo(new cv.Scalar(255));

        if (bestRect && digitIndex !== -1) {
            // Extract the digit pixels
            let digitMask = new cv.Mat();
            let labelMat = new cv.Mat(labels.rows, labels.cols, cv.CV_32S, [digitIndex, 0, 0, 0]);
            cv.compare(labels, labelMat, digitMask, cv.CMP_EQ);
            labelMat.delete();

            let digitROI = digitMask.roi(bestRect);

            // Calculate scale factor maintaining aspect ratio
            let scale = (TARGET_SIZE * PADDING_FACTOR) / Math.max(bestRect.width, bestRect.height);
            let newWidth = Math.floor(bestRect.width * scale);
            let newHeight = Math.floor(bestRect.height * scale);

            let resizedDigit = new cv.Mat();
            cv.resize(digitROI, resizedDigit, new cv.Size(newWidth, newHeight), 0, 0, cv.INTER_CUBIC);

            // Center correctly on TARGET_SIZE canvas
            let targetX = Math.floor((TARGET_SIZE - newWidth) / 2);
            let targetY = Math.floor((TARGET_SIZE - newHeight) / 2);
            let targetRect = new cv.Rect(targetX, targetY, newWidth, newHeight);

            let invertedDigit = new cv.Mat();
            cv.bitwise_not(resizedDigit, invertedDigit);
            invertedDigit.copyTo(output.roi(targetRect));

            digitMask.delete(); digitROI.delete(); resizedDigit.delete(); invertedDigit.delete();
        }

        labels.delete(); stats.delete(); centroids.delete();
        return output;
    }
}
