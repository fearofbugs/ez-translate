const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function runtime(settings = {}, statuses = [200]) {
    const calls = [];
    const nativeFetch = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return { status: statuses.shift() || 200 };
    };
    const context = vm.createContext({ fetch: nativeFetch, AbortSignal, chrome: {
        storage: { local: { get: async () => settings } },
        i18n: { getMessage: key => ({ langVietnamese: 'Vietnamese', langEnglish: 'English' })[key] },
    } });
    for (const file of ['src/shared/prompts.js', 'src/background/learning.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    return { context, calls, nativeFetch };
}

test('custom prompt replaces system messages and leaves selected text untouched', async () => {
    const { context, calls, nativeFetch } = runtime({ learningMode: 'learn', learnPrompt: 'Explain in Vietnamese.' });
    await context.learningFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'system', content: 'old' }, { role: 'user', content: 'resilient' }] }) });
    assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 'Explain in Vietnamese.' }, { role: 'user', content: 'resilient' }]);
    assert.equal(context.fetch, nativeFetch);
});

test('Gemini and Ollama receive saved instructions in their system fields', async () => {
    for (const body of [{ contents: [{ parts: [{ text: 'hello' }] }] }, { prompt: 'hello', images: ['base64'] }]) {
        const { context, calls } = runtime({ learnPrompt: 'Custom teacher' });
        await context.learningFetch('provider', { method: 'POST', body: JSON.stringify(body) });
        assert.equal(calls[0].body.system || calls[0].body.systemInstruction.parts[0].text, 'Custom teacher');
        if (body.images) assert.deepEqual(calls[0].body.images, body.images);
    }
});

test('translation placeholders resolve and blank prompts use shared defaults', async () => {
    const { context, calls } = runtime({ learningMode: 'translate', translatePrompt: ' ', targetLanguage: 'langVietnamese', secondTargetLanguage: 'langEnglish' });
    await context.learningFetch('provider', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
    assert.match(calls[0].body.messages[0].content, /Vietnamese/);
    assert.match(calls[0].body.messages[0].content, /English/);
    assert.doesNotMatch(calls[0].body.messages[0].content, /\{targetLanguage\}/);
});

test('backup requests retain the configured system prompt', async () => {
    const { context, calls } = runtime({ learnPrompt: 'My teacher', fallbackEnabled: true, backupModels: ['backup', 'primary', 'backup'] }, [429, 200]);
    await context.learningFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'primary', messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.model, 'backup');
    assert.equal(calls[1].body.messages[0].content, 'My teacher');
});
