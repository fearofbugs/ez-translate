const section = document.createElement('section');
section.className = 'learning-settings';
section.innerHTML = `
    <h2>Learning preferences</h2>
    <div class="learning-mode-row">
        <label for="learning-mode">Mode</label>
        <select id="learning-mode"><option value="translate">Translate</option><option value="learn">Learn English</option></select>
    </div>
    <p class="learning-hint">System instructions (saved in this browser)</p>
    <textarea id="custom-prompt" rows="8"></textarea>
    <div class="learning-actions">
        <button id="save-learning">Save</button>
        <span id="learning-saved" role="status"></span>
    </div>`;
document.querySelector('.target-language-settings').before(section);
let saved = {};
const mode = document.getElementById('learning-mode'), prompt = document.getElementById('custom-prompt');
const loadPrompt = () => { const key = mode.value === 'learn' ? 'learnPrompt' : 'translatePrompt'; prompt.value = saved[key] || PromptSettings[key]; };
chrome.storage.local.get(null, s => { saved = s; mode.value = s.learningMode || 'learn'; loadPrompt(); });
mode.onchange = loadPrompt;
document.getElementById('save-learning').onclick = async () => {
    const values = { learningMode: mode.value, [mode.value === 'learn' ? 'learnPrompt' : 'translatePrompt']: prompt.value };
    await chrome.storage.local.set(values); Object.assign(saved, values); document.getElementById('learning-saved').textContent = ' Saved';
};
