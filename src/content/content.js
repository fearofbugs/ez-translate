// content.js - Handles the UI and interactions for text-selection translation (v2 - fixed)

// --- Global variables ---
let translateIcon = null;
let resultPopover = null;
let isEnabled = true; // Enabled by default
let disableInEditable = false;
let translateOnSelection = false;
let requireCtrlOnSelection = false;
let selectionRequestId = 0;
let editableSelectionOrigin = null;
let pendingSelection = null;
let ctrlPressCandidate = false;

// --- Initialization & settings listeners ---
// Fetch settings on first load
chrome.storage.local.get([
    'isSelectionTranslationEnabled',
    'disableTranslationInEditable',
    'translateOnSelection',
    'requireCtrlOnSelection'
], (result) => {
    // Default to true if not set
    isEnabled = result.isSelectionTranslationEnabled !== false;
    disableInEditable = result.disableTranslationInEditable === true;
    translateOnSelection = result.translateOnSelection === true;
    requireCtrlOnSelection = result.requireCtrlOnSelection === true;
});

// Listen for setting changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.isSelectionTranslationEnabled) {
        isEnabled = changes.isSelectionTranslationEnabled.newValue;
        // If disabled, remove the existing UI immediately
        if (!isEnabled) {
            removeTranslationUI();
        }
    }
    if (changes.disableTranslationInEditable) {
        disableInEditable = changes.disableTranslationInEditable.newValue === true;
    }
    if (changes.translateOnSelection) {
        translateOnSelection = changes.translateOnSelection.newValue === true;
        if (translateOnSelection) pendingSelection = null;
    }
    if (changes.requireCtrlOnSelection) {
        requireCtrlOnSelection = changes.requireCtrlOnSelection.newValue === true;
        if (!requireCtrlOnSelection) ctrlPressCandidate = false;
    }
});


// --- Event listeners ---

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'contextMenuTranslate') {
        handleContextMenuTranslation(request);
    } else if (request.type === 'startScreenshotSelection') {
        startScreenshotSelectionOverlay();
    } else if (request.type === 'showImageTranslationResult') {
        showImageTranslationResultPopover(request.translation || '', false);
    }
});

// Show/update the image translation result popover; hide the copy button and show a waiting hint when isLoading=true
function showImageTranslationResultPopover(translation, isLoading) {
    // If a popover already exists, just update its content
    if (resultPopover && document.body.contains(resultPopover)) {
        const resultText = resultPopover.querySelector('#llm-translate-result-text');
        const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
        if (resultText) resultText.textContent = translation;
        if (copyBtn) copyBtn.style.display = isLoading ? 'none' : 'inline-block';
        return;
    }

    // Create a new popover
    resultPopover = document.createElement('div');
    resultPopover.id = 'llm-translate-popover';
    resultPopover.className = 'context-menu-popup';
    resultPopover.innerHTML = `
        <div class="llm-translate-header">
            <span class="llm-translate-title">${chrome.i18n.getMessage('popupTitle')}</span>
            <button class="llm-translate-close" id="llm-translate-close">×</button>
        </div>
        <div class="llm-translate-content">
            <div class="llm-translate-result">
                <div class="llm-translate-result-header">
                    <strong>${chrome.i18n.getMessage('translationResult') || 'Translation'}:</strong>
                    <button class="llm-translate-copy-btn" id="llm-translate-copy-btn" title="${chrome.i18n.getMessage('copyTranslation') || 'Copy translation'}">📋</button>
                </div>
                <div class="llm-translate-text" id="llm-translate-result-text"></div>
            </div>
        </div>
    `;
    document.body.appendChild(resultPopover);

    const closeBtn = resultPopover.querySelector('#llm-translate-close');
    const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
    const resultText = resultPopover.querySelector('#llm-translate-result-text');
    resultText.textContent = translation;
    copyBtn.style.display = isLoading ? 'none' : 'inline-block';

    closeBtn.addEventListener('click', () => removeTranslationUI());
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(resultText.textContent || '');
            const original = copyBtn.textContent;
            copyBtn.textContent = '✅';
            setTimeout(() => { copyBtn.textContent = original; }, 1200);
        } catch (e) {
            const original = copyBtn.textContent;
            copyBtn.textContent = '❌';
            setTimeout(() => { copyBtn.textContent = original; }, 1200);
        }
    });
}

function getEditableElement(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element) return null;
    return element.closest('input, textarea') ||
        (element.isContentEditable || element.closest('[role="textbox"]') ? element : null);
}

function getEventEditableElement(event) {
    const path = event.composedPath?.() || [event.target];
    for (const node of path) {
        const editable = getEditableElement(node);
        if (editable) return editable;
    }
    return null;
}

// Remember where the selection started so drags ending outside an input aren't missed
document.addEventListener('mousedown', (event) => {
    editableSelectionOrigin = getEventEditableElement(event);
}, true);

// Listen for mouseup to show the translate icon
document.addEventListener('mouseup', (event) => {
    const selectionOrigin = editableSelectionOrigin;
    editableSelectionOrigin = null;
    // Do nothing if the feature is disabled
    if (!isEnabled) return;

    // Ignore events targeting our own UI to avoid conflicts
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#llm-translate-icon, #llm-translate-popover')) return;

    // Remove any existing UI
    removeTranslationUI();

    const editable = selectionOrigin || getEventEditableElement(event) ||
        getEditableElement(window.getSelection()?.anchorNode);
    const input = editable?.matches('input, textarea') ? editable : null;
    if (input?.type === 'password' || (editable && disableInEditable)) return;

    let selectedText;
    if (input) {
        if (input.selectionStart == null || input.selectionEnd == null) return;
        selectedText = input.value.slice(input.selectionStart, input.selectionEnd).trim();
    } else {
        selectedText = window.getSelection().toString().trim();
    }
    if (selectedText.length > 0) {
        // Save the text for use by the popup
        chrome.storage.local.set({ 'lastSelectedText': selectedText });
        if (translateOnSelection) {
            translateSelection(event.clientX, event.clientY, selectedText);
        } else {
            pendingSelection = { x: event.clientX, y: event.clientY, text: selectedText };
            createTranslateIcon(event.clientX, event.clientY, selectedText);
        }
    }
});

// Listen for mousedown to remove the UI when a new interaction starts
document.addEventListener('mousedown', (event) => {
    // Remove the UI if the click isn't on it
    if (!event.target.closest('#llm-translate-icon, #llm-translate-popover')) {
        // Check whether a translation popover exists
        const popover = document.querySelector('#llm-translate-popover');
        if (popover && popover.classList.contains('context-menu-popup')) {
            // For the context-menu popup, use stricter close conditions
            // Only close when the user clicks elsewhere on the page and isn't selecting text
            setTimeout(() => {
                const selection = window.getSelection();
                const hasSelection = selection && selection.toString().trim().length > 0;
                
                // Check whether text is being selected inside the popover
                const isSelectingInPopover = hasSelection && 
                    selection.anchorNode && 
                    (selection.anchorNode.closest('#llm-translate-popover') ||
                     (selection.anchorNode.parentNode && selection.anchorNode.parentNode.closest('#llm-translate-popover')));
                
                // Close the popover if the user isn't selecting text inside it and there's no active selection
                if (!isSelectingInPopover && !hasSelection) {
                    removeTranslationUI();
                }
            }, 150);
        } else {
            // For the regular text-selection translate icon, close immediately
            removeTranslationUI();
        }
    }
});

// Listen for keyboard events; ESC closes the popover
document.addEventListener('keydown', (event) => {
    if (event.key === 'Control') {
        if (!event.repeat && isEnabled && requireCtrlOnSelection && !translateOnSelection && pendingSelection) {
            ctrlPressCandidate = true;
        }
    } else if (event.ctrlKey) {
        ctrlPressCandidate = false;
    }
    if (event.key === 'Escape') {
        const popover = document.querySelector('#llm-translate-popover');
        if (popover) {
            removeTranslationUI();
        }
    }
});

document.addEventListener('keyup', (event) => {
    if (event.key !== 'Control') return;
    const selection = pendingSelection;
    const shouldTranslate = ctrlPressCandidate && isEnabled && requireCtrlOnSelection && !translateOnSelection && selection;
    ctrlPressCandidate = false;
    if (shouldTranslate) translateSelection(selection.x, selection.y, selection.text);
});


// --- UI creation & teardown ---

/**
 * Create the small translate icon
 * @param {number} x - Mouse X coordinate
 * @param {number} y - Mouse Y coordinate
 * @param {string} text - The selected text
 */
function createTranslateIcon(x, y, text) {
    translateIcon = document.createElement('div');
    translateIcon.id = 'llm-translate-icon';
    translateIcon.style.left = `${x + window.scrollX}px`;
    translateIcon.style.top = `${y + window.scrollY + 15}px`;

    // Use chrome.runtime.getURL() to load the real icon file
    const iconImg = document.createElement('img');
    iconImg.id = 'llm-translate-icon-img';
    iconImg.src = chrome.runtime.getURL('icons/icon48.png');
    // Set the size to 20x20
    iconImg.style.width = '20px';
    iconImg.style.height = '20px';
    translateIcon.appendChild(iconImg);

    // Stop mouseup propagation to avoid conflicts
    translateIcon.addEventListener('mouseup', (e) => {
        e.stopPropagation();
    });

    translateIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        translateSelection(x, y, text);
    });

    document.body.appendChild(translateIcon);
}

async function translateSelection(x, y, text) {
    pendingSelection = null;
    ctrlPressCandidate = false;
    const requestId = ++selectionRequestId;
    const { targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['targetLanguage', 'secondTargetLanguage']);
    if (requestId !== selectionRequestId) return;
    // Storage holds language keys (e.g. langEnglish). Handle legacy data robustly.
    const storedPrimary = targetLanguage || 'langSimplifiedChinese';
    const storedSecondary = secondTargetLanguage || 'langEnglish';

    // Convert language keys to language names (English names are passed to the backend prompt)
    const langKeyToEnName = {
        'langEnglish': 'English',
        'langSimplifiedChinese': 'Simplified Chinese',
        'langTraditionalChinese': 'Traditional Chinese',
        'langFrench': 'French',
        'langSpanish': 'Spanish',
        'langArabic': 'Arabic',
        'langRussian': 'Russian',
        'langPortuguese': 'Portuguese',
        'langGerman': 'German',
        'langItalian': 'Italian',
        'langDutch': 'Dutch',
        'langDanish': 'Danish',
        'langJapanese': 'Japanese',
        'langKorean': 'Korean',
        'langVietnamese': 'Vietnamese',
        'langThai': 'Thai',
        'langIndonesian': 'Indonesian',
        'langHindi': 'Hindi',
        'langTurkish': 'Turkish',
        'langPolish': 'Polish',
        'langFinnish': 'Finnish',
        'langHungarian': 'Hungarian',
        'langCzech': 'Czech',
        'langGreek': 'Greek',
        'langRomanian': 'Romanian',
        'langSlovak': 'Slovak'
    };

    // Handle three kinds of input: language keys, English names, and others (fall back to English)
    const normalizeToEnName = (input) => {
        if (!input) return 'English';
        if (langKeyToEnName[input]) return langKeyToEnName[input];
        // Normalize common localized names/aliases
        const aliasToEnName = {
            '中文': 'Simplified Chinese',
            '简体中文': 'Simplified Chinese',
            '繁體中文': 'Traditional Chinese',
            '繁体中文': 'Traditional Chinese',
            '英语': 'English',
            '英文': 'English',
            '日语': 'Japanese',
            '日本語': 'Japanese',
            '韩语': 'Korean',
            '韓國語': 'Korean',
            '한국어': 'Korean'
        };
        if (aliasToEnName[input]) return aliasToEnName[input];
        // If it's already an English name (from an older version or manual entry), use it as-is
        const values = Object.values(langKeyToEnName);
        if (values.includes(input)) return input;
        return 'English';
    };

    const targetLanguageName = normalizeToEnName(storedPrimary);
    const secondTargetLanguageName = normalizeToEnName(storedSecondary);

    if (translateIcon) {
        translateIcon.remove();
        translateIcon = null;
    }
    showResultPopover(x, y, chrome.i18n.getMessage('statusTranslating'));
    const popover = resultPopover;
    chrome.runtime.sendMessage({
        type: 'translate',
        text,
        targetLanguage: targetLanguageName,
        secondTargetLanguage: secondTargetLanguageName
    }, (response) => {
        if (requestId !== selectionRequestId || resultPopover !== popover) return;
        if (response?.error) {
            updateResultPopover(response.error);
        } else {
            updateResultPopover(response?.translation || chrome.i18n.getMessage('statusError', ['Unknown error']));
        }
    });
}

/**
 * Show or create the result popover
 */
function showResultPopover(x, y, content) {
    if (!resultPopover) {
        resultPopover = document.createElement('div');
        resultPopover.id = 'llm-translate-popover';
        document.body.appendChild(resultPopover);
    }
    resultPopover.style.left = `${x + window.scrollX}px`;
    resultPopover.style.top = `${y + window.scrollY + 15}px`;
    resultPopover.textContent = content;
    resultPopover.style.display = 'block';
}

/**
 * Update the content of the result popover
 */
function updateResultPopover(content) {
    if (resultPopover) {
        resultPopover.textContent = content;
    }
}

// Handle context-menu translation
async function handleContextMenuTranslation(request) {
    const { text, targetLanguage, secondTargetLanguage } = request;
    
    // Remove any existing UI
    removeTranslationUI();
    
    // Show the translation result popup
    showTranslationResult(text, targetLanguage, secondTargetLanguage);
}

// Show the translation result popup
async function showTranslationResult(text, targetLanguage, secondTargetLanguage) {
    // Create the result popup
    resultPopover = document.createElement('div');
    resultPopover.id = 'llm-translate-popover';
    resultPopover.className = 'context-menu-popup'; // Special class used for styling
    resultPopover.innerHTML = `
        <div class="llm-translate-header">
            <span class="llm-translate-title">${chrome.i18n.getMessage('popupTitle')}</span>
            <button class="llm-translate-close" id="llm-translate-close">×</button>
        </div>
        <div class="llm-translate-content">
            <div class="llm-translate-original">
                <strong>${chrome.i18n.getMessage('originalText') || 'Original'}:</strong>
                <div class="llm-translate-text">${text}</div>
            </div>
            <div class="llm-translate-result">
                <div class="llm-translate-result-header">
                    <strong>${chrome.i18n.getMessage('translationResult') || 'Translation'}:</strong>
                    <button class="llm-translate-copy-btn" id="llm-translate-copy-btn" title="${chrome.i18n.getMessage('copyTranslation') || 'Copy translation'}" style="display: none;">📋</button>
                </div>
                <div class="llm-translate-text" id="llm-translate-result-text">${chrome.i18n.getMessage('statusTranslating') || 'Translating...'}</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(resultPopover);
    
    // Attach the close button event
    const closeBtn = resultPopover.querySelector('#llm-translate-close');
    closeBtn.addEventListener('click', () => {
        removeTranslationUI();
    });
    
    // Attach the copy button event
    const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
    copyBtn.addEventListener('click', async () => {
        const resultText = resultPopover.querySelector('#llm-translate-result-text');
        const textToCopy = resultText.textContent;
        
        try {
            await navigator.clipboard.writeText(textToCopy);
            // Show a copy-success indicator
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅';
            copyBtn.style.color = '#4caf50';
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.color = '';
            }, 1500);
        } catch (error) {
            console.error('Copy failed:', error);
            // Show a copy-failure indicator
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '❌';
            copyBtn.style.color = '#f44336';
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.color = '';
            }, 1500);
        }
    });
    
    // Close on outside click (reuse the existing mousedown listener logic)
    
    // Send the translation request
    try {
        chrome.runtime.sendMessage({
            type: 'translate',
            text,
            targetLanguage,
            secondTargetLanguage
        }, (response) => {
            const resultText = resultPopover.querySelector('#llm-translate-result-text');
            const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
            
            if (response && response.translation) {
                resultText.textContent = response.translation;
                resultText.style.color = '#333';
                // Show the copy button after a successful translation
                copyBtn.style.display = 'inline-block';
            } else if (response && response.error) {
                resultText.textContent = `Error: ${response.error}`;
                resultText.style.color = '#d32f2f';
                // Hide the copy button when translation fails
                copyBtn.style.display = 'none';
            } else {
                resultText.textContent = chrome.i18n.getMessage('statusError', ['Unknown error']) || 'Unknown error';
                resultText.style.color = '#d32f2f';
                // Hide the copy button when translation fails
                copyBtn.style.display = 'none';
            }
        });
    } catch (error) {
        const resultText = resultPopover.querySelector('#llm-translate-result-text');
        resultText.textContent = `Error: ${error.message}`;
        resultText.style.color = '#d32f2f';
    }
}

/**
 * Remove all translation-related UI elements
 */
function removeTranslationUI() {
    pendingSelection = null;
    ctrlPressCandidate = false;
    selectionRequestId++;
    if (translateIcon) {
        translateIcon.remove();
        translateIcon = null;
    }
    if (resultPopover) {
        resultPopover.remove();
        resultPopover = null;
    }
}

// --- Screenshot selection overlay ---
let selectionOverlay = null;
let selectionRect = null;
let isSelecting = false;

function startScreenshotSelectionOverlay() {
    if (selectionOverlay) return;

    selectionOverlay = document.createElement('div');
    selectionOverlay.id = 'llm-translate-screenshot-overlay';
    selectionOverlay.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair;
        background: rgba(0,0,0,0.15);
    `;

    const selectionBox = document.createElement('div');
    selectionBox.id = 'llm-translate-selection-box';
    selectionBox.style.cssText = `
        position: absolute; border: 2px solid #4caf50; background: rgba(76,175,80,0.15);
        pointer-events: none;
    `;

    const toolbar = document.createElement('div');
    toolbar.id = 'llm-translate-selection-toolbar';
    toolbar.style.cssText = `
        position: absolute; padding: 6px 8px; background: #fff; border: 1px solid #ddd; border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: none; gap: 8px; align-items: center;
    `;

    const translateBtn = document.createElement('button');
    translateBtn.textContent = chrome.i18n.getMessage('selectionTranslateButton') || 'Translate';
    translateBtn.style.cssText = 'padding: 4px 8px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = chrome.i18n.getMessage('cancelButton') || 'Cancel';
    cancelBtn.style.cssText = 'padding: 4px 8px;';
    toolbar.appendChild(translateBtn);
    toolbar.appendChild(cancelBtn);

    selectionOverlay.appendChild(selectionBox);
    selectionOverlay.appendChild(toolbar);
    document.body.appendChild(selectionOverlay);

    let startX = 0, startY = 0;

    function onMouseDown(e) {
        // Ignore clicks on toolbar buttons
        if (e.target.closest('#llm-translate-selection-toolbar')) return;
        e.preventDefault();
        isSelecting = true;
        startX = e.clientX; startY = e.clientY;
        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';
        toolbar.style.display = 'none';
    }
    function onMouseMove(e) {
        if (!isSelecting) return;
        e.preventDefault();
        const x = Math.min(e.clientX, startX);
        const y = Math.min(e.clientY, startY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        selectionBox.style.left = `${x}px`;
        selectionBox.style.top = `${y}px`;
        selectionBox.style.width = `${w}px`;
        selectionBox.style.height = `${h}px`;
    }
    function onMouseUp(e) {
        if (!isSelecting) return;
        isSelecting = false;
        const rect = selectionBox.getBoundingClientRect();
        selectionRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height, devicePixelRatio: window.devicePixelRatio || 1 };
        if (rect.width < 5 || rect.height < 5) {
            cleanup();
            return;
        }
        // position toolbar near rect
        toolbar.style.left = `${rect.left + rect.width - 140}px`;
        toolbar.style.top = `${rect.top - 40}px`;
        toolbar.style.display = 'flex';
    }

    function cleanup() {
        selectionOverlay?.remove();
        selectionOverlay = null;
        selectionRect = null;
        isSelecting = false;
        window.removeEventListener('mousedown', onMouseDown, true);
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('mouseup', onMouseUp, true);
    }

    cancelBtn.addEventListener('click', (ev) => { ev.stopPropagation(); cleanup(); });
    translateBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!selectionRect) return;
        // First show a loading popover
        const waitingText = chrome.i18n.getMessage('statusTranslating') || 'Translating...';
        showImageTranslationResultPopover(waitingText, true);
        // ask background to capture and crop
        console.log('[LLM-Translate] Requesting captureAndTranslateImage', selectionRect);
        chrome.runtime.sendMessage({ type: 'captureAndTranslateImage', rect: selectionRect }, (resp) => {
            if (chrome.runtime.lastError) {
                console.error('[LLM-Translate] captureAndTranslateImage error:', chrome.runtime.lastError.message);
                showImageTranslationResultPopover(`Error: ${chrome.runtime.lastError.message}`, false);
            } else if (resp && resp.error) {
                console.error('[LLM-Translate] captureAndTranslateImage response error:', resp.error);
                showImageTranslationResultPopover(`Error: ${resp.error}`, false);
            } else {
                console.log('[LLM-Translate] captureAndTranslateImage response ok');
            }
        });
        cleanup();
    });

    // Attach to overlay instead of window to avoid interference with toolbar
    selectionOverlay.addEventListener('mousedown', onMouseDown, true);
    selectionOverlay.addEventListener('mousemove', onMouseMove, true);
    selectionOverlay.addEventListener('mouseup', onMouseUp, true);
}
