/**
 * GridDetector - OpenCV.js based Sudoku board recognition engine
 */
export class GridDetector {
    // --- Knobs & Constants ---
    static NORM_SIZE = 128;
    static PADDING_FACTOR = 0.8;
    static NOISE_HEIGHT_THRESHOLD = 0.95; // Ignore objects taller than 95% of cell
    static MIN_HEIGHT_RATIO = 0.75;       // Valid digit must be >= 75% of max found height
    static SIMILARITY_THRESHOLD = 0.90;   // Template matching threshold

    static async _yield() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Main image recognition pipeline
     * @param {HTMLCanvasElement} canvas
     * @param {Function} onProgress
     */
    static async detect(canvas, onProgress) {
        const updateProgress = (p) => onProgress?.(p);
        let src = cv.imread(canvas);

        try {
            updateProgress(0.05);

            // 1. Extract Board
            const boardMat = this.extractBoard(src);
            if (!boardMat) throw new Error("Could not locate the sudoku grid boundary.");
            updateProgress(0.1);

            // 2. Split into 81 cell Mats
            const cellMats = this.splitIntoCells(boardMat);
            boardMat.delete();
            updateProgress(0.15);

            // 3. Analyze Cells (Binarization & Object Detection in one pass)
            const cellDataList = await this.analyzeAllCells(cellMats);
            // We no longer need the raw color cellMats after this
            cellMats.forEach(m => m.delete());
            updateProgress(0.50);

            // 4. Height Filtering & Normalization
            const normalizedMats = await this.normalizeAllCells(cellDataList);
            // Clean up binary mats from analysis phase
            cellDataList.forEach(data => data.binary?.delete());
            updateProgress(0.80);

            // 5. Group Similar Digits
            const groups = await this.groupSimilarDigits(normalizedMats);
            updateProgress(0.95);

            // 6. Generate Canvas Results
            const result = this.generateFinalResult(normalizedMats, groups);
            
            // Final Clean up of normalized mats
            normalizedMats.forEach(m => m.delete());
            updateProgress(1.0);

            return result;

        } catch (err) {
            console.error("OCR Engine Error:", err);
            throw err;
        } finally {
            if (src && !src.isDeleted()) src.delete();
        }
    }

    /**
     * Locates the largest square-like contour (the grid)
     */
    static extractBoard(src) {
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let thresh = new cv.Mat();
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
            cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
            cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0;
            let bestRect = null;

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let rect = cv.boundingRect(cnt);
                let area = rect.width * rect.height;
                let aspect = rect.width / rect.height;

                if (aspect > 0.8 && aspect < 1.2 && area > maxArea) {
                    maxArea = area;
                    bestRect = rect;
                }
                cnt.delete();
            }

            return bestRect ? src.roi(bestRect) : null;
        } finally {
            gray.delete(); blurred.delete(); thresh.delete(); contours.delete(); hierarchy.delete();
        }
    }

    /**
     * Cuts the board into 81 equal pieces
     */
    static splitIntoCells(boardMat) {
        const cellWidth = boardMat.cols / 9;
        const cellHeight = boardMat.rows / 9;
        const cells = [];

        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                let rect = new cv.Rect(
                    Math.floor(col * cellWidth), Math.floor(row * cellHeight),
                    Math.floor(cellWidth), Math.floor(cellHeight)
                );
                cells.push(boardMat.roi(rect));
            }
        }
        return cells;
    }

    /**
     * Performs image processing on all cells.
     * Returns metadata for later normalization.
     */
    static async analyzeAllCells(cellMats) {
        const cellDataList = [];

        for (let i = 0; i < 81; i++) {
            if (i % 9 === 0) await this._yield();

            const mat = cellMats[i];
            let gray = new cv.Mat();
            cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY, 0);

            // Invert colors if dark mode detected
            if (cv.mean(gray)[0] < 128) cv.bitwise_not(gray, gray);

            let binary = new cv.Mat();
            cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
            gray.delete();

            // Labeling
            let labels = new cv.Mat();
            let stats = new cv.Mat();
            let centroids = new cv.Mat();
            let nLabels = cv.connectedComponentsWithStats(binary, labels, stats, centroids);

            let maxArea = 0;
            let bestLabel = -1;
            let bestHeight = 0;
            let bestRect = null;

            for (let l = 1; l < nLabels; l++) {
                let left = stats.intAt(l, cv.CC_STAT_LEFT);
                let top = stats.intAt(l, cv.CC_STAT_TOP);
                let width = stats.intAt(l, cv.CC_STAT_WIDTH);
                let height = stats.intAt(l, cv.CC_STAT_HEIGHT);
                let area = stats.intAt(l, cv.CC_STAT_AREA);

                const touchesEdge = (left <= 0) || (top <= 0) || (left + width >= binary.cols) || (top + height >= binary.rows);

                if (!touchesEdge && area > maxArea) {
                    maxArea = area;
                    bestLabel = l;
                    bestHeight = height;
                    bestRect = { left, top, width, height };
                }
            }

            cellDataList.push({
                binary, // Keep binary mat for normalization
                labels, // Keep labels for mask extraction
                bestLabel,
                h: bestHeight,
                rect: bestRect,
                cellH: binary.rows
            });

            stats.delete(); centroids.delete();
        }
        return cellDataList;
    }

    /**
     * Normalizes detected objects into consistent 128x128 images.
     */
    static async normalizeAllCells(cellDataList) {
        // Find max height among non-noise cells
        const validHeights = cellDataList
            .map(d => d.h)
            .filter((h, i) => h > 0 && h < cellDataList[i].cellH * this.NOISE_HEIGHT_THRESHOLD);
        
        const maxH = validHeights.length > 0 ? Math.max(...validHeights) : 0;
        const threshold = maxH * this.MIN_HEIGHT_RATIO;

        const normalizedMats = [];

        for (let i = 0; i < 81; i++) {
            if (i % 9 === 0) await this._yield();
            const data = cellDataList[i];

            if (data.h >= threshold && data.h > 0 && data.bestLabel !== -1) {
                // Extract and center the mask
                normalizedMats.push(this.extractCenteredDigit(data));
            } else {
                // Empty cell
                let empty = new cv.Mat.ones(this.NORM_SIZE, this.NORM_SIZE, cv.CV_8UC1);
                empty.setTo(new cv.Scalar(255));
                normalizedMats.push(empty);
            }
            // Cleanup labels as we go
            data.labels.delete();
        }
        return normalizedMats;
    }

    /**
     * Extracts the specific connected component and centers it.
     */
    static extractCenteredDigit(data) {
        let labelMask = new cv.Mat();
        let labelCompareMat = new cv.Mat(data.labels.rows, data.labels.cols, cv.CV_32S, [data.bestLabel, 0, 0, 0]);
        cv.compare(data.labels, labelCompareMat, labelMask, cv.CMP_EQ);
        labelCompareMat.delete();

        // ROI of the actual digit
        const rect = new cv.Rect(data.rect.left, data.rect.top, data.rect.width, data.rect.height);
        let digitROI = labelMask.roi(rect);

        // Scale to fit target size while maintaining aspect ratio
        let scale = (this.NORM_SIZE * this.PADDING_FACTOR) / Math.max(rect.width, rect.height);
        let w = Math.floor(rect.width * scale);
        let h = Math.floor(rect.height * scale);

        let resized = new cv.Mat();
        cv.resize(digitROI, resized, new cv.Size(w, h), 0, 0, cv.INTER_CUBIC);

        // Prep final white canvas
        let output = new cv.Mat.ones(this.NORM_SIZE, this.NORM_SIZE, cv.CV_8UC1);
        output.setTo(new cv.Scalar(255));

        // Center on output
        let tx = Math.floor((this.NORM_SIZE - w) / 2);
        let ty = Math.floor((this.NORM_SIZE - h) / 2);
        let inverted = new cv.Mat();
        cv.bitwise_not(resized, inverted);
        
        inverted.copyTo(output.roi(new cv.Rect(tx, ty, w, h)));

        labelMask.delete(); digitROI.delete(); resized.delete(); inverted.delete();
        return output;
    }

    /**
     * Groups cells by visual similarity
     */
    static async groupSimilarDigits(normalizedMats) {
        const groups = [];
        const hasDigit = normalizedMats.map(m => {
            // Quick check if the mat is just a white square (empty)
            // If the top-left pixel is 255 and it's mostly white, it's likely empty.
            // But we actually marked empty cells by height threshold earlier.
            return cv.mean(m)[0] < 250; 
        });

        for (let i = 0; i < 81; i++) {
            if (!hasDigit[i]) continue;
            await this._yield();

            let matched = false;
            for (let group of groups) {
                let res = new cv.Mat();
                cv.matchTemplate(normalizedMats[i], normalizedMats[group.representativeIdx], res, cv.TM_CCOEFF_NORMED);
                let mm = cv.minMaxLoc(res);
                res.delete();

                if (mm.maxVal > this.SIMILARITY_THRESHOLD) {
                    group.indices.push(i);
                    matched = true;
                    break;
                }
            }
            if (!matched) groups.push({ representativeIdx: i, indices: [i] });
        }
        return groups;
    }

    /**
     * Packages memory Mats into usable canvas elements
     */
    static generateFinalResult(normalizedMats, groups) {
        const cells = [];
        normalizedMats.forEach((mat, i) => {
            const canvas = document.createElement('canvas');
            canvas.width = mat.cols;
            canvas.height = mat.rows;
            canvas.getContext('2d', { willReadFrequently: true });
            cv.imshow(canvas, mat);
            
            const isEmpty = cv.mean(mat)[0] > 250;
            canvas.dataset.hasDigit = isEmpty ? 'false' : 'true';
            cells.push(canvas);
        });

        return {
            cells,
            groups: groups.map(g => ({
                canvases: [cells[g.representativeIdx]],
                indices: g.indices
            }))
        };
    }
}
