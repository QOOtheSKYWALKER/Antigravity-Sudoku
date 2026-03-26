// ===== Internationalization (i18n) =====

const translations = {
    ja: {
        reset: '最初に戻す',
        input: '入力',
        memo: '📝',
        undoTitle: '元に戻す (Ctrl+Z)',
        redoTitle: 'やり直す (Ctrl+Y)',
        clear: '🎉 クリア！',
        conflictFound: '矛盾が見つかりました！',
        memoDone: '候補をメモしました 📝',
        rocketFilled: '🚀 確定セルを埋めました',
        themeDark: '🌙 ダーク',
        themeLight: '☀️ ライト',
        themeSystem: '🖥️ 端末設定',
        guideMove: '← → ↑ ↓ : セル移動',
        guideNumber: '1〜9 : 数字入力',
        guideDel: 'Del / BS : 消去',
        guideMemo: 'Space : メモ切替',
        guideUndo: 'Ctrl/⌘+Z : 元に戻す',
        guideRedo: 'Ctrl/⌘+Y : やり直す',
        modeInput: '入力モード',
        modeMemo: 'メモモード📝',
        confirmReset: '現在の盤面をリセットしますか？',
        ok: 'OK',
        importOcr: '📷 取込',
        ocrDropText: 'ここに数独の画像（スクリーンショット）をドラッグ＆ドロップ',
        ocrClickText: 'またはクリックしてファイルを選択',
        ocrStatusLoaded: '解析中...',
        ocrStatusLoading: 'Tesseract.js OCRエンジンをロード中...',
        ocrStatusExtracting: '81マスを個別に解析中...',
        ocrCorrectionDesc: '認識エラー。\nこのマスの数字は何ですか？',
        ocrCorrectionSubmit: 'OK',
        ocrManualPlayBtn: 'OK',
        ocrReRecognizeBtn: '再認識',
        confirmChangeDifficulty: '新しい問題を始めますか？',
        memoPruned: '🔍 候補を絞り込みました',
        generatorError: 'パズルの生成に失敗しました。',
        clipboardError: 'クリップボードに画像が見つかりませんでした。',
        clipboardNoAccess: 'クリップボードへのアクセスが許可されていないか、対応していないブラウザです。「Ctrl+V」や長押しでのペーストをお試しください。',
        invalidFileType: '画像ファイルを選択してください。',
        originalImage: 'オリジナル画像',
        ocrPasteBtn: '📋 クリップボードから画像を読む',
        ocrManualHint: '別の画像（スクショ）をアップロードするか、右側の盤面に直接入力してください。\n（カメラで撮影した写真は非対応です）',
        ocrImportComplete: '取込が完了しました。\n引き続きSudokuをお楽しみください。',
        originalImageFailed: 'オリジナル画像 (失敗)',
        correctionGrid: '修正用盤面',
        ocrVerifying: '検証中...',
        ocrDuplicateError: '盤面に重複した数字があります。',
        ocrNoSolution: 'この盤面には解が存在しません。',
        ocrMultipleSolutions: '解が複数存在するため、一意に決定できません。',
        ocrNoDigitsDetected: '解析失敗: 数字が一つも検出されませんでした。',
    },
    en: {
        reset: 'Reset',
        input: 'Input',
        memo: '📝',
        undoTitle: 'Undo (Ctrl+Z)',
        redoTitle: 'Redo (Ctrl+Y)',
        clear: '🎉 Cleared!',
        conflictFound: 'Conflict found!',
        memoDone: 'Candidates noted 📝',
        rocketFilled: '🚀 Filled certain cells',
        themeDark: '🌙 Dark',
        themeLight: '☀️ Light',
        themeSystem: '🖥️ System',
        guideMove: '← → ↑ ↓ : Move cell',
        guideNumber: '1-9 : Enter number',
        guideDel: 'Del / BS : Delete',
        guideMemo: 'Space : Toggle memo',
        guideUndo: 'Ctrl/⌘+Z : Undo',
        guideRedo: 'Ctrl/⌘+Y : Redo',
        modeInput: 'Input Mode',
        modeMemo: 'Memo Mode 📝',
        confirmReset: 'Reset the current board?',
        ok: 'OK',
        importOcr: '📷 Scan',
        ocrDropText: 'Drag & Drop a Sudoku image (screenshot) here',
        ocrClickText: 'or click to select a file',
        ocrStatusLoaded: 'Analyzing...',
        ocrStatusLoading: 'Loading Tesseract.js OCR engine...',
        ocrStatusExtracting: 'Analyzing 81 cells individually...',
        ocrCorrectionDesc: 'Recognition error.\nWhat is the number in this cell?',
        ocrCorrectionSubmit: 'OK',
        ocrManualPlayBtn: 'OK',
        ocrReRecognizeBtn: 'Re-recognize',
        confirmChangeDifficulty: 'Start a new puzzle?',
        memoPruned: '🔍 Candidates pruned',
        generatorError: 'Failed to generate puzzle.',
        clipboardError: 'No image found in clipboard.',
        clipboardNoAccess: 'Clipboard access denied or not supported. Try "Ctrl+V" or long-press paste.',
        invalidFileType: 'Please select an image file.',
        originalImage: 'Original Image',
        ocrPasteBtn: '📋 Read image from clipboard',
        ocrManualHint: 'Upload another image (screenshot) or enter digits on the right grid directly.\n(Camera photos are not supported)',
        ocrImportComplete: 'Import completed. Enjoy Sudoku!',
        originalImageFailed: 'Original Image (Failed)',
        correctionGrid: 'Correction Grid',
        ocrVerifying: 'Verifying...',
        ocrDuplicateError: 'The board has duplicate numbers.',
        ocrNoSolution: 'This board has no solution.',
        ocrMultipleSolutions: 'Multiple solutions exist; cannot determine uniquely.',
        ocrNoDigitsDetected: 'Analysis failed: No digits detected.',
    }
};



let currentLang = localStorage.getItem('sudoku-lang') || 'ja';

// Translation function
function t(key) {
    return translations[currentLang]?.[key] || translations.ja[key] || key;
}

/**
 * Format a technique name for the info panel.
 * Prepends the brain emoji. Technique names are always displayed in English
 * regardless of language setting; the name is looked up from TECHNIQUES if
 * available, otherwise the raw name string is used as-is.
 * Single source of truth for the 🧠 emoji used in the UI.
 */
function tTechnique(name) {
    return '🧠 ' + name;
}

// Apply language to DOM elements
function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('sudoku-lang', lang);

    // Update textContent for elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang]?.[key]) {
            el.textContent = translations[lang][key];
        }
    });

    // Update title for elements with data-i18n-title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (translations[lang]?.[key]) {
            el.title = translations[lang][key];
        }
    });

    // Update textContent for <option> elements with data-i18n-option attribute
    document.querySelectorAll('[data-i18n-option]').forEach(el => {
        const key = el.getAttribute('data-i18n-option');
        if (translations[lang]?.[key]) {
            el.textContent = translations[lang][key];
        }
    });

    // Update html lang attribute
    document.documentElement.lang = lang === 'en' ? 'en' : 'ja';
}
