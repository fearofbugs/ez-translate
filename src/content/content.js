// Old content scripts survive an extension update until the page is refreshed.
function extensionAvailable() {
    try { return !!chrome.runtime.id; } catch { return false; }
}
function extensionError(error) {
    if (!extensionAvailable() || /context invalidated/i.test(error?.message || '')) {
        // Stale scripts quietly stop instead of displaying a notice on every click.
        if (typeof removeTranslationUI === 'function') removeTranslationUI();
        if (typeof closeFloatingPanel === 'function') closeFloatingPanel();
        return null;
    }
    return error?.message || 'Could not contact the extension. Please retry.';
}
function sendExtensionMessage(message, callback) {
    const fail = error => {
        const message = extensionError(error);
        if (message) callback({ error: message });
    };
    try {
        if (!extensionAvailable()) { fail(new Error('Extension context invalidated.')); return; }
        chrome.runtime.sendMessage(message, response => {
            const error = chrome.runtime.lastError;
            if (error) fail(error);
            else callback(response);
        });
    } catch (error) { fail(error); }
}
function messageText(key, substitutions) {
    try { return extensionAvailable() ? chrome.i18n.getMessage(key, substitutions) : ''; }
    catch { return ''; }
}

// Storage language keys -> English names passed to the backend prompt.
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
const langAliasToEnName = {
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
function normalizeToEnName(input) {
    if (!input) return 'English';
    if (langKeyToEnName[input]) return langKeyToEnName[input];
    if (langAliasToEnName[input]) return langAliasToEnName[input];
    if (Object.values(langKeyToEnName).includes(input)) return input;
    return 'English';
}
async function getTargetLanguageNames() {
    const { targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['targetLanguage', 'secondTargetLanguage']);
    return {
        targetLanguageName: normalizeToEnName(targetLanguage || 'langSimplifiedChinese'),
        secondTargetLanguageName: normalizeToEnName(secondTargetLanguage || 'langEnglish')
    };
}

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
        TranslationTiming.finish(resultPopover, request);
    } else if (request.type === 'toggleFloatingPanel') {
        toggleFloatingPanel();
    }
});

// --- SVG icon markup (replaces emoji) ---
const ICON_COPY = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
const ICON_CHECK = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_CLOSE = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// Show/update the image translation result popover; hide the copy button and show a waiting hint when isLoading=true
function showImageTranslationResultPopover(translation, isLoading) {
    // If a popover already exists, just update its content
    if (resultPopover && document.body.contains(resultPopover)) {
        const resultText = resultPopover.querySelector('#llm-translate-result-text');
        const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
        if (resultText) renderMarkdown(resultText, translation);
        if (copyBtn) copyBtn.style.display = isLoading ? 'none' : 'inline-flex';
        return;
    }

    // Create a new popover
    resultPopover = document.createElement('div');
    resultPopover.id = 'llm-translate-popover';
    resultPopover.className = 'context-menu-popup';
    resultPopover.innerHTML = `
        <div class="llm-translate-header">
            <span class="llm-translate-title">${messageText('popupTitle')}</span>
            <button class="llm-translate-close" id="llm-translate-close">${ICON_CLOSE}</button>
        </div>
        <div class="llm-translate-content">
            <div class="llm-translate-result">
                <div class="llm-translate-result-header">
                    <strong>${messageText('translationResult') || 'Translation'}</strong>
                    <button class="llm-translate-copy-btn" id="llm-translate-copy-btn" title="${messageText('copyTranslation') || 'Copy translation'}">${ICON_COPY}</button>
                </div>
                <div class="llm-translate-text" id="llm-translate-result-text"></div>
            </div>
        </div>
    `;
    document.body.appendChild(resultPopover);

    const closeBtn = resultPopover.querySelector('#llm-translate-close');
    const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
    const resultText = resultPopover.querySelector('#llm-translate-result-text');
    renderMarkdown(resultText, translation);
    copyBtn.style.display = isLoading ? 'none' : 'inline-flex';

    closeBtn.addEventListener('click', () => removeTranslationUI());
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(resultText.textContent || '');
            copyBtn.innerHTML = ICON_CHECK;
            copyBtn.classList.add('copy-done');
            setTimeout(() => {
                copyBtn.innerHTML = ICON_COPY;
                copyBtn.classList.remove('copy-done');
            }, 1200);
        } catch (e) {
            copyBtn.innerHTML = ICON_CHECK;
            copyBtn.classList.add('copy-failed');
            setTimeout(() => {
                copyBtn.innerHTML = ICON_COPY;
                copyBtn.classList.remove('copy-failed');
            }, 1200);
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
    if (!extensionAvailable()) { removeTranslationUI(); closeFloatingPanel(); return; }

    // Ignore events targeting our own UI to avoid conflicts
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#llm-translate-icon, #llm-translate-popover, #llm-translate-floating-host')) return;

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
        chrome.storage.local.set({ 'lastSelectedText': selectedText }).catch(error => {
            showResultPopover(event.clientX, event.clientY, extensionError(error));
        });
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
                    (selection.anchorNode.parentElement?.closest('#llm-translate-popover') ||
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
    try { iconImg.src = chrome.runtime.getURL('icons/icon48.png'); }
    catch (error) { showResultPopover(x, y, extensionError(error)); return; }
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
    let targetLanguageName, secondTargetLanguageName;
    try {
        if (!extensionAvailable()) throw new Error('Extension context invalidated.');
        ({ targetLanguageName, secondTargetLanguageName } = await getTargetLanguageNames());
    } catch (error) {
        if (requestId === selectionRequestId) showResultPopover(x, y, extensionError(error));
        return;
    }
    if (requestId !== selectionRequestId) return;

    if (translateIcon) {
        translateIcon.remove();
        translateIcon = null;
    }
    showResultPopover(x, y, messageText('statusTranslating'));
    const popover = resultPopover;
    TranslationTiming.start(popover);
    sendExtensionMessage({
        type: 'translate',
        text,
        targetLanguage: targetLanguageName,
        secondTargetLanguage: secondTargetLanguageName
    }, (response) => {
        if (requestId !== selectionRequestId || resultPopover !== popover) return;
        if (response?.error) {
            updateResultPopover(response.error);
        } else {
            updateResultPopover(response?.translation || messageText('statusError', ['Unknown error']));
        }
        TranslationTiming.finish(popover, response);
        keepResultPopoverInView();
    });
}

/**
 * Show or create the result popover
 */
function showResultPopover(x, y, content) {
    if (!content) return;
    if (!resultPopover) {
        resultPopover = document.createElement('div');
        resultPopover.id = 'llm-translate-popover';
        document.body.appendChild(resultPopover);
    }
    resultPopover.style.left = `${x + window.scrollX}px`;
    resultPopover.style.top = `${y + window.scrollY + 15}px`;
    resultPopover.textContent = content;
    resultPopover.style.display = 'block';
    keepResultPopoverInView();
}

function keepResultPopoverInView() {
    if (!resultPopover || resultPopover.classList.contains('context-menu-popup')) return;
    const rect = resultPopover.getBoundingClientRect();
    const x = Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12));
    const y = Math.max(12, Math.min(rect.top, window.innerHeight - rect.height - 12));
    resultPopover.style.left = `${x + window.scrollX}px`;
    resultPopover.style.top = `${y + window.scrollY}px`;
}
window.addEventListener('resize', keepResultPopoverInView);

/**
 * Update the content of the result popover
 */
function updateResultPopover(content) {
    if (resultPopover) {
        renderMarkdown(resultPopover, content);
        keepResultPopoverInView();
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
            <span class="llm-translate-title">${messageText('popupTitle')}</span>
            <button class="llm-translate-close" id="llm-translate-close">${ICON_CLOSE}</button>
        </div>
        <div class="llm-translate-content">
            <div class="llm-translate-original">
                <strong>${messageText('originalText') || 'Original'}</strong>
                <div class="llm-translate-text"></div>
            </div>
            <div class="llm-translate-result">
                <div class="llm-translate-result-header">
                    <strong>${messageText('translationResult') || 'Translation'}</strong>
                    <button class="llm-translate-copy-btn" id="llm-translate-copy-btn" title="${messageText('copyTranslation') || 'Copy translation'}" style="display: none;">${ICON_COPY}</button>
                </div>
                <div class="llm-translate-text" id="llm-translate-result-text">${messageText('statusTranslating') || 'Translating...'}</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(resultPopover);
    
    resultPopover.querySelector('.llm-translate-original .llm-translate-text').textContent = text;
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
            copyBtn.innerHTML = ICON_CHECK;
            copyBtn.classList.add('copy-done');
            setTimeout(() => {
                copyBtn.innerHTML = ICON_COPY;
                copyBtn.classList.remove('copy-done');
            }, 1500);
        } catch (error) {
            console.error('Copy failed:', error);
            // Show a copy-failure indicator
            copyBtn.innerHTML = ICON_CHECK;
            copyBtn.classList.add('copy-failed');
            setTimeout(() => {
                copyBtn.innerHTML = ICON_COPY;
                copyBtn.classList.remove('copy-failed');
            }, 1500);
        }
    });
    
    // Close on outside click (reuse the existing mousedown listener logic)
    
    // Keep late responses from updating a closed or newer popup.
    const popover = resultPopover;
    const requestId = ++selectionRequestId;
    TranslationTiming.start(popover);
    // Send the translation request
    try {
        sendExtensionMessage({
            type: 'translate',
            text,
            targetLanguage,
            secondTargetLanguage
        }, (response) => {
            if (resultPopover !== popover || requestId !== selectionRequestId) return;
            TranslationTiming.finish(popover, response);
            const resultText = popover.querySelector('#llm-translate-result-text');
            const copyBtn = resultPopover.querySelector('#llm-translate-copy-btn');
            
            if (response && response.translation) {
                renderMarkdown(resultText, response.translation);
                resultText.style.color = '';
                // Show the copy button after a successful translation
                copyBtn.style.display = 'inline-flex';
            } else if (response && response.error) {
                resultText.textContent = `Error: ${response.error}`;
                resultText.style.color = '#dc2626';
                // Hide the copy button when translation fails
                copyBtn.style.display = 'none';
            } else {
                resultText.textContent = messageText('statusError', ['Unknown error']) || 'Unknown error';
                resultText.style.color = '#dc2626';
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
        TranslationTiming.cancel(resultPopover);
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
        position: absolute; border: 2px solid #6366f1; background: rgba(99,102,241,0.12);
        pointer-events: none;
    `;

    const toolbar = document.createElement('div');
    toolbar.id = 'llm-translate-selection-toolbar';
    toolbar.style.cssText = `
        position: absolute; padding: 6px; background: #ffffff; border: 1px solid #e4e6f0; border-radius: 10px;
        box-shadow: 0 4px 12px rgba(31,35,51,0.16), 0 10px 32px rgba(31,35,51,0.10); display: none; gap: 6px; align-items: center;
    `;

    const translateBtn = document.createElement('button');
    translateBtn.classList.add('primary');
    translateBtn.textContent = messageText('selectionTranslateButton') || 'Translate';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = messageText('cancelButton') || 'Cancel';
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
        const waitingText = messageText('statusTranslating') || 'Translating...';
        showImageTranslationResultPopover(waitingText, true);
        TranslationTiming.start(resultPopover);
        // ask background to capture and crop
        console.log('[LLM-Translate] Requesting captureAndTranslateImage', selectionRect);
        sendExtensionMessage({ type: 'captureAndTranslateImage', rect: selectionRect }, (resp) => {
            if (chrome.runtime.lastError) {
                console.error('[LLM-Translate] captureAndTranslateImage error:', chrome.runtime.lastError.message);
                showImageTranslationResultPopover(`Error: ${chrome.runtime.lastError.message}`, false);
            } else if (resp && resp.error) {
                console.error('[LLM-Translate] captureAndTranslateImage response error:', resp.error);
                showImageTranslationResultPopover(`Error: ${resp.error}`, false);
                TranslationTiming.finish(resultPopover, resp);
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

// --- Floating translator panel (draggable, Shadow DOM isolated) ---
const FLOATING_PANEL_WIDTH = 600;
let floatingPanelHost = null;
let floatingPanelResizeObserver = null;

const FLOATING_PANEL_STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .fp {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: min(320px, calc(100vw - 16px));
        min-height: 200px;
        width: ${FLOATING_PANEL_WIDTH}px;
        max-width: calc(100vw - 16px);
        background: #ffffff;
        border: 1px solid #e4e6f0;
        border-radius: 14px;
        box-shadow: 0 10px 36px rgba(31, 35, 51, 0.22), 0 2px 8px rgba(31, 35, 51, 0.10);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.65;
        color: #1f2333;
        overflow: hidden;
        max-height: calc(100dvh - 16px);
        overscroll-behavior: contain;
    }
    .fp-bar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        cursor: move;
        touch-action: none;
        user-select: none;
    }
    .fp-logo { width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; }
    .fp-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: #ffffff; letter-spacing: 0.01em; }
    .fp-icon {
        background: rgba(255, 255, 255, 0.16);
        border: none;
        border-radius: 7px;
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
    }
    .fp-icon:hover { background: rgba(255, 255, 255, 0.32); }
    .svg-icon { width: 14px; height: 14px; display: block; }
    .fp-body { padding: 18px 18px 24px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; }
    .fp[data-sized] .fp-body { flex: 1; }
    .fp[data-sized] .fp-result-text { max-height: none; overflow-y: visible; }
    .fp-resize { position: absolute; right: 2px; bottom: 2px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: #f2f3f9; color: #6366f1; cursor: nwse-resize; touch-action: none; font-size: 18px; line-height: 24px; }
    .fp-resize:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
    .fp-input {
        width: 100%;
        min-height: 52px;
        max-height: 120px;
        resize: vertical;
        padding: 8px 10px;
        border: 1px solid #e4e6f0;
        border-radius: 10px;
        background: #ffffff;
        font: inherit;
        font-size: 14px;
        line-height: 1.45;
        color: #1f2333;
    }
    .fp-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px #eef0ff; }
    .fp-input::placeholder { color: #a1a5b8; }
    .fp-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .fp-hint { font-size: 10.5px; color: #8a8fa3; }
    .fp-go {
        padding: 7px 14px;
        border: none;
        border-radius: 9px;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        color: #ffffff;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(99, 102, 241, 0.35);
    }
    .fp-go:hover { filter: brightness(1.07); }
    .fp-go:disabled { opacity: 0.6; cursor: progress; }
    .fp-result { border-top: 1px solid #eef0f6; padding-top: 8px; }
    .fp-result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
    .fp-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8fa3; }
    .fp-copy { background: none; color: #8a8fa3; }
    .fp-copy:hover { background: #eef0f6; color: #3a3f52; }
    .fp-copy.fp-copy-done { color: #16a34a !important; }
    .fp-copy.fp-copy-failed { color: #dc2626 !important; }
    .fp-result-text {
        max-height: min(520px, 55dvh);
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(42, 46, 63, 0.25) transparent;
        font-size: 14px;
        line-height: 1.65;
        overflow-wrap: anywhere;
        user-select: text;
        cursor: text;
    }
    .fp-result-text::-webkit-scrollbar { width: 6px; }
    .fp-result-text::-webkit-scrollbar-track { background: transparent; }
    .fp-result-text::-webkit-scrollbar-thumb { background: rgba(42, 46, 63, 0.22); border-radius: 999px; }
    .translation-timing { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e4e6f0; color: #70758a; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    .translation-timing summary { cursor: pointer; margin-top: 4px; }
    .translation-timing ul { padding-left: 18px; margin: 6px 0; }
    .fp-result-text.loading { color: #8a8fa3; }
    .fp-result-text.error { color: #dc2626; }
    .fp-result-text p { margin: 0.65em 0; }
    .fp-result-text h1, .fp-result-text h2, .fp-result-text h3,
    .fp-result-text h4, .fp-result-text h5, .fp-result-text h6 {
        font-size: 15px;
        line-height: 1.35;
        font-weight: 650;
        margin: 1em 0 0.45em;
    }
    .fp-result-text h1 { font-size: 19px; }
    .fp-result-text h2 { font-size: 17px; }
    .fp-result-text > :first-child { margin-top: 0; }
    .fp-result-text ul, .fp-result-text ol { margin: 0.65em 0; padding-left: 1.2em; }
    .fp-result-text li { margin: 0.1em 0; }
    .fp-result-text pre {
        overflow: auto;
        white-space: pre;
        padding: 7px 9px;
        background: #f5f6fb;
        border-radius: 8px;
    }
    .fp-result-text code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    .fp-result-text pre code { font-size: inherit; }
    .fp-result-text blockquote {
        border-left: 3px solid #6366f1;
        margin: 6px 0;
        padding-left: 10px;
        color: #5a5f73;
    }
    .fp-result-text a { color: #6366f1; }
    .fp-result-text table {
        width: 100%;
        margin: 6px 0;
        border-collapse: collapse;
        font-size: 13px;
        display: block;
        overflow-x: auto;
    }
    .fp-result-text th, .fp-result-text td {
        border: 1px solid #e4e6f0;
        padding: 9px 12px;
        min-width: 112px;
        text-align: left;
        vertical-align: top;
    }
    .fp-result-text th { background: #f2f3f9; font-weight: 600; white-space: normal; }
    .fp-result-text tr:nth-child(even) td { background: #fafbfe; }
`;

function toggleFloatingPanel() {
    if (floatingPanelHost) closeFloatingPanel();
    else openFloatingPanel();
}

function closeFloatingPanel() {
    floatingPanelResizeObserver?.disconnect();
    floatingPanelResizeObserver = null;
    if (floatingPanelHost) {
        TranslationTiming.cancel(floatingPanelHost.shadowRoot.querySelector('.fp-result'));
        floatingPanelHost.remove();
        floatingPanelHost = null;
    }
}

function keepFloatingPanelInView() {
    if (!floatingPanelHost) return;
    const rect = floatingPanelHost.getBoundingClientRect();
    floatingPanelHost.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
    floatingPanelHost.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`;
}
window.addEventListener('resize', keepFloatingPanelInView);

function positionFloatingPanel(host) {
    const margin = 16;
    const clampX = x => Math.min(Math.max(8, x), Math.max(8, window.innerWidth - host.getBoundingClientRect().width - 8));
    const clampY = y => Math.min(Math.max(8, y), Math.max(8, window.innerHeight - host.getBoundingClientRect().height - 8));
    const fallback = () => {
        host.style.left = `${clampX(window.innerWidth - FLOATING_PANEL_WIDTH - margin)}px`;
        host.style.top = `${clampY(Math.round(window.innerHeight * 0.22))}px`;
    };
    try {
        chrome.storage.local.get(['floatingPanelPosition', 'floatingPanelSize'], ({ floatingPanelPosition: pos, floatingPanelSize: size }) => {
            if (floatingPanelHost !== host) return;
            const panel = host.shadowRoot.querySelector('.fp');
            if (Number.isFinite(size?.width) && Number.isFinite(size?.height) && size.width > 0 && size.height > 0) {
                panel.style.width = `${Math.max(320, size.width)}px`;
                panel.style.height = `${Math.max(200, size.height)}px`;
                panel.dataset.sized = 'true';
            }
            const x = Number.isFinite(pos?.x) ? clampX(pos.x) : clampX(window.innerWidth - FLOATING_PANEL_WIDTH - margin);
            const y = Number.isFinite(pos?.y) ? clampY(pos.y) : clampY(Math.round(window.innerHeight * 0.22));
            host.style.left = `${x}px`;
            host.style.top = `${y}px`;
        });
    } catch {
        fallback();
    }
}

function enableFloatingPanelResize(host, shadow) {
    const panel = shadow.querySelector('.fp');
    const handle = shadow.querySelector('.fp-resize');
    let start = null;
    const applySize = (width, height) => {
        const rect = host.getBoundingClientRect();
        const maxWidth = Math.max(0, window.innerWidth - Math.max(8, rect.left) - 8);
        const maxHeight = Math.max(0, window.innerHeight - Math.max(8, rect.top) - 8);
        panel.style.width = `${Math.min(maxWidth, Math.max(320, width))}px`;
        panel.style.height = `${Math.min(maxHeight, Math.max(200, height))}px`;
        panel.dataset.sized = 'true';
    };
    const saveSize = () => {
        const rect = panel.getBoundingClientRect();
        try {
            chrome.storage.local.set({ floatingPanelSize: { width: Math.round(rect.width), height: Math.round(rect.height) } }).catch(extensionError);
        } catch (error) { extensionError(error); }
    };
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const rect = panel.getBoundingClientRect();
        start = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
        if (!start) return;
        applySize(start.width + event.clientX - start.x, start.height + event.clientY - start.y);
    });
    const stop = event => {
        if (!start) return;
        start = null;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        saveSize();
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const rect = panel.getBoundingClientRect();
        applySize(rect.width + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0),
            rect.height + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0));
        saveSize();
    });
    handle.addEventListener('dblclick', () => {
        panel.style.removeProperty('width'); panel.style.removeProperty('height');
        delete panel.dataset.sized;
        try { chrome.storage.local.remove('floatingPanelSize').catch(extensionError); }
        catch (error) { extensionError(error); }
        keepFloatingPanelInView();
    });
}

function enableFloatingPanelDrag(host, shadow) {
    const bar = shadow.querySelector('.fp-bar');
    let dragging = false, offsetX = 0, offsetY = 0;
    bar.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('button')) return;
        const rect = host.getBoundingClientRect();
        dragging = true;
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        try { bar.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        event.preventDefault();
    });
    bar.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const rect = host.getBoundingClientRect();
        const x = Math.min(Math.max(0, event.clientX - offsetX), Math.max(0, window.innerWidth - rect.width));
        const y = Math.min(Math.max(0, event.clientY - offsetY), Math.max(0, window.innerHeight - rect.height));
        host.style.left = `${x}px`;
        host.style.top = `${y}px`;
    });
    const stop = (event) => {
        if (!dragging) return;
        dragging = false;
        try { bar.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
        const rect = host.getBoundingClientRect();
        chrome.storage.local.set({ floatingPanelPosition: { x: Math.round(rect.left), y: Math.round(rect.top) } }).catch(() => {});
    };
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
}

function openFloatingPanel() {
    if (floatingPanelHost) {
        floatingPanelHost.shadowRoot?.querySelector('.fp-input')?.focus();
        return;
    }
    const host = document.createElement('div');
    host.id = 'llm-translate-floating-host';
    host.style.cssText = 'all: initial; position: fixed; left: 16px; top: 80px; z-index: 2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const inputPlaceholder = messageText('floatingPanelPlaceholder') || messageText('textInputPlaceholder') || 'Enter a word or sentence…';
    shadow.innerHTML = `
        <style>${FLOATING_PANEL_STYLE}</style>
        <div class="fp" role="dialog" aria-label="${messageText('popupTitle') || 'EZ Translate'}">
            <div class="fp-bar">
                <img class="fp-logo" alt="">
                <span class="fp-title">${messageText('floatingPanelTitle') || messageText('popupTitle') || 'EZ Translate'}</span>
                <button class="fp-icon" type="button" data-action="close" title="${messageText('floatingPanelClose') || 'Close'}">${ICON_CLOSE}</button>
            </div>
            <div class="fp-body">
                <textarea class="fp-input" rows="2" placeholder="${inputPlaceholder}"></textarea>
                <div class="fp-row">
                    <span class="fp-hint">${messageText('floatingPanelHint') || 'Ctrl+Enter to translate'}</span>
                    <button class="fp-go" type="button">${messageText('translateButton') || 'Translate'}</button>
                </div>
                <div class="fp-result" hidden>
                    <div class="fp-result-head">
                        <span class="fp-label">${messageText('translationResult') || 'Result'}</span>
                        <button class="fp-icon fp-copy" type="button" data-action="copy" title="${messageText('copyTranslation') || 'Copy'}">${ICON_COPY}</button>
                    </div>
                    <div class="fp-result-text llm-markdown"></div>
                </div>
            </div>
            <button class="fp-resize" type="button" aria-label="Resize translator" title="Drag or use arrow keys to resize. Double-click to reset.">↘</button>
        </div>
    `;
    document.documentElement.appendChild(host);
    floatingPanelHost = host;
    floatingPanelResizeObserver = new ResizeObserver(keepFloatingPanelInView);
    floatingPanelResizeObserver.observe(shadow.querySelector('.fp'));

    try {
        shadow.querySelector('.fp-logo').src = chrome.runtime.getURL('icons/icon48.png');
    } catch { /* extension context may be invalidated */ }

    const input = shadow.querySelector('.fp-input');
    const goBtn = shadow.querySelector('.fp-go');
    const resultBox = shadow.querySelector('.fp-result');
    const resultText = shadow.querySelector('.fp-result-text');
    const copyBtn = shadow.querySelector('.fp-copy');
    const closeBtn = shadow.querySelector('[data-action="close"]');
    let panelRequestId = 0;

    const showError = (message) => {
        if (!message) return;
        resultBox.hidden = false;
        resultText.classList.remove('loading');
        resultText.classList.add('error');
        resultText.textContent = message;
        TranslationTiming.finish(resultBox, { error: message });
        goBtn.disabled = false;
    };

    const runTranslation = async () => {
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        const requestId = ++panelRequestId;
        resultBox.hidden = false;
        resultText.classList.remove('error');
        resultText.classList.add('loading');
        resultText.textContent = messageText('statusTranslating') || 'Translating…';
        goBtn.disabled = true;
        TranslationTiming.start(resultBox);
        let names;
        try {
            if (!extensionAvailable()) throw new Error('Extension context invalidated.');
            names = await getTargetLanguageNames();
        } catch (error) {
            if (requestId === panelRequestId) showError(extensionError(error));
            return;
        }
        if (requestId !== panelRequestId) return;
        sendExtensionMessage({
            type: 'translate',
            text,
            targetLanguage: names.targetLanguageName,
            secondTargetLanguage: names.secondTargetLanguageName
        }, (response) => {
            if (requestId !== panelRequestId || floatingPanelHost !== host) return;
            TranslationTiming.finish(resultBox, response);
            goBtn.disabled = false;
            resultText.classList.remove('loading');
            if (response?.error) {
                resultText.classList.add('error');
                resultText.textContent = response.error;
                return;
            }
            resultText.classList.remove('error');
            renderMarkdown(resultText, response?.translation || messageText('statusError', ['Unknown error']));
        });
    };

    closeBtn.addEventListener('click', () => closeFloatingPanel());
    goBtn.addEventListener('click', runTranslation);
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(resultText.textContent || '');
            copyBtn.innerHTML = ICON_CHECK;
            copyBtn.classList.add('fp-copy-done');
            setTimeout(() => { copyBtn.innerHTML = ICON_COPY; copyBtn.classList.remove('fp-copy-done'); }, 1200);
        } catch {
            copyBtn.classList.add('fp-copy-failed');
            setTimeout(() => copyBtn.classList.remove('fp-copy-failed'), 1200);
        }
    });
    shadow.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeFloatingPanel();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            runTranslation();
        }
    });

    enableFloatingPanelDrag(host, shadow);
    enableFloatingPanelResize(host, shadow);
    positionFloatingPanel(host);
    setTimeout(() => input.focus(), 0);
}
