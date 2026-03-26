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
        // Landing Page
        aboutTitle: 'Antigravity Sudoku — Overview',
        heroSub: '論理的ソルバーによる厳密な難易度制御と、洗練されたUI（ダーク/ライト対応）を備えたブラウザベースの数独パズル。',
        playBtn: '▶ プレイする',
        featuresTitle: '✨特徴',
        featuresLead: '論理的な解法に基づく本格的な数独体験を提供します。',
        feat1Title: '第2世代 問題生成エンジン',
        feat1Desc: '「地ならし（Smoothing）」と「探索（Exploration）」の2フェーズによる革新的アルゴリズムを搭載。ヒント数を最小22個まで削ぎ落としつつ、解きごたえのある高品質な問題を爆速で生成します。',
        feat2Title: '厳密な難易度制御',
        feat2Desc: 'Naked Single〜XY-Chainまで、解法に必要な戦略に基づいて難易度を厳密に定義。直感や運に頼らない、純粋な論理の世界を楽しめます。',
        feat3Title: 'ロケットボタン',
        feat3Desc: '1回押すとNaked Single / Hidden Singleで確定できるセルを自動入力。手順が進まない場合、空白セルがあれば候補メモを全入力・剪定します。',
        feat4Title: 'メモモード',
        feat4Desc: 'トグルスイッチで入力モードとメモモードをワンタッチ切替。モバイル画面でも操作しやすい配置。',
        feat5Title: 'Undo / Redo',
        feat5Desc: '最大127ステップの履歴管理。ロケットボタンの操作も実際の変化があった場合のみ1ステップとして記録されます。',
        feat6Title: 'テーマ & 言語設定',
        feat6Desc: 'ダーク/ライトモードの切り替えに加え、端末設定との連動も可能。日本語・英語の表示言語切り替えにも対応。',
        feat7Title: '取込 (OCR)',
        feat7Desc: 'カメラや画像から数独の盤面を自動認識。OpenCV.js を使用した高度な画像処理により、手入力の手間を省いて即座にプレイ可能です。',
        diffTitle: '📊難易度レベル',
        diffLead: '各難易度は、パズルの解法に必要な最高度の戦略によって定義されます。',
        diffColLevel: 'レベル',
        diffColStrategy: '必要な戦略',
        diffColDesc: '説明',
        diffDescEasy: '候補の数字が特定の行や列に限定されること（Pointing / Claiming）を利用した基本推論が必要。',
        diffDescMedium: '候補のペア（2国同盟）〜クアッド（4国同盟）を見つけて候補を除外する中級の推論が必要。',
        diffDescHard: 'Jellyfish 等の高度な魚系、Unique Rectangle（唯一解）、XY-Chain 等の多段階推論が必要。',
        controlsTitle: '🎮操作方法',
        controlsLead: 'キーボードとオンスクリーンキーパッドの両方に対応しています。',
        controlMove: 'セル間を移動',
        controlNumber: '数字を入力',
        controlDelete: 'セルを消去',
        controlMemo: 'メモモード切替',
        controlUndo: '元に戻す（Undo）',
        controlRedo: 'やり直す（Redo）',
        techTitle: '⚙️テクノロジー',
        techLead: 'フレームワーク不使用。HTML + CSS + JavaScript のみで構築しています。',
        footerPlay: 'プレイする →',
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
        // Landing Page
        aboutTitle: 'Antigravity Sudoku — Overview',
        heroSub: 'Browser-based Sudoku with rigorous logical difficulty control and polished UI (Dark/Light mode).',
        playBtn: '▶ Play Now',
        featuresTitle: '✨Features',
        featuresLead: 'Delivering an authentic Sudoku experience based on pure logic.',
        feat1Title: 'Gen-2 Puzzle Engine',
        feat1Desc: 'Powered by an innovative two-phase algorithm (Smoothing & Exploration). Generates high-quality minimalist puzzles (down to 22 hints) at lightning speed.',
        feat2Title: 'Rigorous Difficulty Control',
        feat2Desc: 'Difficulty is strictly defined by the strategies required (Naked Single to XY-Chain). Enjoy a world of pure logic, free from guesswork.',
        feat3Title: 'Rocket Button',
        feat3Desc: 'Fills confirmed cells (Singles) instantly. If stuck, it fills and prunes candidate memos automatically.',
        feat4Title: 'Memo Mode',
        feat4Desc: 'One-tap toggle between input and memo modes. Optimized layout for mobile devices.',
        feat5Title: 'Undo / Redo',
        feat5Desc: 'Up to 127 steps of history. Rocket button actions are recorded as a single step only when a change occurs.',
        feat6Title: 'Themes & Localization',
        feat6Desc: 'Dark/Light modes with system sync support. Seamlessly switch between Japanese and English.',
        feat7Title: 'Scan (OCR)',
        feat7Desc: 'Recognize board layouts from images or screenshots. Advanced processing via OpenCV.js allows instant play without manual entry.',
        diffTitle: '📊Difficulty Levels',
        diffLead: 'Each level is defined by the most advanced strategy required to solve the puzzle.',
        diffColLevel: 'Level',
        diffColStrategy: 'Strategy',
        diffColDesc: 'Description',
        diffDescEasy: 'Requires basic inference techniques like Pointing and Claiming (Locked Candidates).',
        diffDescMedium: 'Requires intermediate inference such as Pairs, Triples, and Quads.',
        diffDescHard: 'Requires advanced multi-step inference like Fish techniques, Unique Rectangles, and XY-Chains.',
        controlsTitle: '🎮Controls',
        controlsLead: 'Responsive to both keyboard shortcuts and on-screen keypad.',
        controlMove: 'Move between cells',
        controlNumber: 'Enter numbers',
        controlDelete: 'Clear cell',
        controlMemo: 'Toggle memo mode',
        controlUndo: 'Undo last action',
        controlRedo: 'Redo last action',
        techTitle: '⚙️Technology',
        techLead: 'Built with vanilla HTML, CSS, and JavaScript. No frameworks used.',
        footerPlay: 'Play Now →',
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
