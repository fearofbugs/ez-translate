// Only provider requests call this helper. Native fetch remains unchanged.
async function learningFetch(url, options = {}) {
    const { skipLegacyFallback = false, promptLanguages = {}, ...fetchOptions } = options;
    options = fetchOptions;
    if (!options.body || options.method !== 'POST') return fetch(url, options);
    const settings = await chrome.storage.local.get(['learnPrompt', 'translatePrompt', 'learningMode', 'targetLanguage', 'secondTargetLanguage', 'fallbackEnabled', 'backupModels']);
    let body;
    try { body = JSON.parse(options.body); } catch { return fetch(url, options); }
    const promptKey = (settings.learningMode || PromptSettings.mode) === 'learn' ? 'learnPrompt' : 'translatePrompt';
    const languageName = (key, fallback) => key ? (key.startsWith('lang') ? chrome.i18n.getMessage(key) || fallback : key) : fallback;
    const prompt = (settings[promptKey]?.trim() || PromptSettings[promptKey])
        .replaceAll('{targetLanguage}', languageName(promptLanguages?.targetLanguage || settings.targetLanguage, 'Vietnamese'))
        .replaceAll('{secondTargetLanguage}', languageName(promptLanguages?.secondTargetLanguage || settings.secondTargetLanguage, 'English'));
    {
        if (body.messages) body.messages = [{ role: 'system', content: prompt }, ...body.messages.filter(message => message.role !== 'system')];
        else if (body.contents) body.systemInstruction = { parts: [{ text: prompt }] };
        else if (body.prompt) body.system = prompt;
    }
    let response = await fetch(url, { ...options, body: JSON.stringify(body) });
    if (!skipLegacyFallback && String(url).includes('openrouter.ai') && settings.fallbackEnabled && [429, 502, 503, 504].includes(response.status)) {
        const primaryModel = body.model;
        for (const model of [...new Set(settings.backupModels || [])].slice(0, 3)) {
            if (model === primaryModel) continue;
            body.model = model;
            response = await fetch(url, { ...options, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
            if (![429, 502, 503, 504].includes(response.status)) break;
        }
    }
    return response;
}
