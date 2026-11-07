const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const model = (provider, id, extra = {}) => ({ provider, id, name: id, free: true, ...extra });
function setup(responses = [], settings = {}) {
    const calls = [], session = {};
    const context = vm.createContext({ AbortSignal, URL, fetch: async (url, options) => {
        calls.push({ url, options, body: options?.body ? JSON.parse(options.body) : null });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return { ok: (response?.status || 200) === 200, status: response?.status || 200,
            headers: { get: () => response?.retry || null }, json: async () => response?.data || {} };
    }, chrome: { storage: {
        local: { get: async () => settings },
        session: { get: async () => session, set: async values => Object.assign(session, values) },
    }, i18n: { getMessage: key => key } } });
    for (const file of ['src/shared/prompts.js', 'src/shared/model-catalog.js', 'src/background/learning.js', 'src/background/model-queue.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    }
    return { context, calls, session };
}
const success = { choices: [{ message: { content: '# Translation\nHello' } }] };

test('catalog includes all free text models, including text-only and zero-price models without free in their names', () => {
    const { context } = setup();
    const normalize = context.ModelCatalog.normalize;
    const base = { id: 'text-only', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } };
    assert.equal(normalize('openrouter', base).vision, false);
    assert.equal(normalize('openrouter', { ...base, id: 'paid:free', pricing: { prompt: '0.01', completion: '0' } }), null);
    assert.equal(normalize('openrouter', { id: 'unknown:free' }), null);
    assert.equal(normalize('openrouter', { ...base, pricing: { prompt: '', completion: '0' } }), null);
    assert.equal(normalize('openrouter', { ...base, architecture: { output_modalities: ['image'] } }), null);
    assert.equal(normalize('opencode', { id: 'some-model-free' }).free, true);
    assert.equal(normalize('opencode', { id: 'paid-model' }), null);
});

test('catalog follows pagination without imposing a model count cap', async () => {
    const raw = id => ({ id, name: id, pricing: { prompt: '0', completion: '0' } });
    const { context, calls } = setup([
        { data: { data: Array.from({ length: 100 }, (_, i) => raw(`model-${i}`)), links: { next: '?page=2' } } },
        { data: { data: [raw('last-model')] } },
    ]);
    const result = await context.ModelCatalog.fetchModels('openrouter', 'key');
    assert.equal(result.models.length, 101);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /page=2/);
});

test('quota fallback respects cross-source order and retains custom prompt; exhausted models cool down', async () => {
    const settings = { modelQueue: [model('openrouter', 'first'), model('opencode', 'second-free')], openrouterApiKey: 'one', opencodeApiKey: 'two', learnPrompt: 'Explain in Vietnamese', fallbackEnabled: true, backupModels: ['legacy-should-not-run'] };
    const { context, calls, session } = setup([{ status: 429, data: { error: { message: 'Quota exceeded' } }, retry: '120' }, { data: success }, { data: success }], settings);
    const result = await context.translateWithQueue(settings, 'hello');
    assert.equal(result.model, 'opencode/second-free');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.messages[0].content, 'Explain in Vietnamese');
    assert.equal(calls[1].options.skipLegacyFallback, undefined);
    assert.equal(calls[1].options.promptLanguages, undefined);
    assert.ok(session.modelCooldowns['openrouter/first'] > Date.now());
    await context.translateWithQueue(settings, 'again');
    assert.equal(calls[2].body.model, 'second-free');
});

test('OpenCode access restriction skips other models from that source and falls back to OpenRouter', async () => {
    const settings = { modelQueue: [model('opencode', 'one-free'), model('opencode', 'two-free'), model('openrouter', 'backup')], opencodeApiKey: 'key', openrouterApiKey: 'key' };
    const { context, calls } = setup([{ status: 403 }, { data: success }], settings);
    assert.equal((await context.translateWithQueue(settings, 'text')).model, 'openrouter/backup');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.provider.max_price.prompt, 0);
});

test('network errors, empty results and missing keys advance to next model', async () => {
    const settings = { modelQueue: [model('opencode', 'missing-free'), model('openrouter', 'network'), model('openrouter', 'empty'), model('openrouter', 'last')], openrouterApiKey: 'key' };
    const { context, calls } = setup([new Error('Network unavailable'), { data: { choices: [] } }, { data: success }], settings);
    assert.equal((await context.translateWithQueue(settings, 'text')).model, 'openrouter/last');
    assert.equal(calls.length, 3);
});

test('screenshot queue skips text-only models and reports when no usable backups remain', async () => {
    const settings = { modelQueue: [model('openrouter', 'text'), model('openrouter', 'image', { vision: true })], openrouterApiKey: 'key' };
    const { context, calls } = setup([{ data: success }], settings);
    await context.translateWithQueue(settings, 'Read image', 'data:image/png;base64,abc');
    assert.equal(calls[0].body.model, 'image');
    assert.equal(calls[0].body.messages[1].content[1].type, 'image_url');
    await assert.rejects(context.translateWithQueue({ modelQueue: [] }, 'text'), /Add a model/);
    await assert.rejects(context.translateWithQueue({ modelQueue: [model('openrouter', 'missing-key')] }, 'text'), /API key missing/);
});

const accountId = '1234567890abcdef1234567890abcdef';
const cfModel = (name, extra = {}) => ({ name, task: { name: 'Text Generation' }, ...extra });

test('Cloudflare catalog uses model names rather than UUIDs and excludes paid-only and non-chat models', () => {
    const { context } = setup();
    const normalize = raw => context.ModelCatalog.normalize('cloudflare', raw);
    const raw = cfModel('@cf/zai-org/glm-4.7-flash', { id: 'catalog-uuid' });
    assert.equal(normalize(raw).id, raw.name);
    assert.equal(normalize(raw).allowance, 'daily');
    assert.equal(normalize(cfModel('@cf/zai-org/glm-5.3')), null);
    assert.equal(normalize(cfModel('@cf/some/paid', { properties: [{ property_id: 'requires_paid_plan', value: 'true' }] })), null);
    assert.equal(normalize({ name: '@cf/image/model', task: { name: 'Text-to-Image' } }), null);
    assert.equal(normalize(cfModel('@cf/old/model', { properties: [{ property_id: 'deprecated', value: true }] })), null);
});

test('Cloudflare catalog fetches all pages with account-scoped authentication', async () => {
    const { context, calls } = setup([
        { data: { success: true, result: [cfModel('@cf/vendor/first')], result_info: { total_pages: 2 } } },
        { data: { success: true, result: [cfModel('@cf/vendor/last')], result_info: { total_pages: 2 } } },
    ]);
    const result = await context.ModelCatalog.fetchModels('cloudflare', 'cf-token', accountId);
    assert.equal(result.models.length, 2);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer cf-token');
    assert.match(calls[0].url, new RegExp(`/accounts/${accountId}/ai/models/search`));
    assert.match(calls[1].url, /page=2$/);
    await assert.rejects(context.ModelCatalog.fetchModels('cloudflare', '', accountId), /API token/);
    await assert.rejects(context.ModelCatalog.fetchModels('cloudflare', 'token', '../invalid'), /Account ID/);
});

test('Cloudflare translation uses chat completions with the saved prompt and preserves Markdown', async () => {
    const settings = { modelQueue: [model('cloudflare', '@cf/zai-org/glm-4.7-flash')], cloudflareAccountId: accountId, cloudflareApiKey: 'token', learnPrompt: 'My tutor prompt' };
    const { context, calls } = setup([{ data: success }], settings);
    const result = await context.translateWithQueue(settings, 'hello');
    assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`);
    assert.equal(calls[0].body.messages[0].content, 'My tutor prompt');
    assert.equal(calls[0].body.messages[1].content, 'hello');
    assert.equal(result.translation, '# Translation\nHello');
});

test('Cloudflare daily quota skips all its models until the next UTC reset, including later requests', async () => {
    const settings = { modelQueue: [model('cloudflare', '@cf/vendor/first'), model('cloudflare', '@cf/vendor/second'), model('openrouter', 'backup')], cloudflareApiKey: 'token', cloudflareAccountId: accountId, openrouterApiKey: 'token' };
    const { context, calls, session } = setup([
        { status: 429, data: { success: false, errors: [{ code: 3036, message: 'Daily free allocation exceeded' }] } },
        { data: success }, { data: success },
    ], settings);
    assert.equal((await context.translateWithQueue(settings, 'hello')).model, 'openrouter/backup');
    assert.equal(calls.length, 2);
    const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
    assert.equal(session.modelCooldowns[`cloudflare:${accountId}:daily`], reset.getTime());
    await context.translateWithQueue(settings, 'again');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body.model, 'backup');
});

test('Cloudflare capacity and model-specific access errors still allow another Cloudflare backup', async () => {
    for (const error of [
        { status: 429, data: { errors: [{ code: 3040, message: 'Out of capacity' }] } },
        { status: 403, data: { errors: [{ code: 5035, message: 'Model requires Workers Paid' }] } },
        { status: 200, data: { success: false, errors: [{ code: 5018, message: 'Private model' }] } },
    ]) {
        const settings = { modelQueue: [model('cloudflare', '@cf/vendor/first'), model('cloudflare', '@cf/vendor/second')], cloudflareApiKey: 'token', cloudflareAccountId: accountId };
        const { context, calls } = setup([error, { data: success }], settings);
        assert.equal((await context.translateWithQueue(settings, 'hello')).model, 'cloudflare/@cf/vendor/second');
        assert.equal(calls.length, 2);
    }
});

test('timing reports skipped, failed and successful models without including input or credentials', async () => {
    const settings = { modelQueue: [model('opencode', 'missing'), model('openrouter', 'first'), model('openrouter', 'second')], openrouterApiKey: 'private-api-key' };
    const { context } = setup([{ status: 503 }, { data: success }], settings);
    vm.runInContext('Date.now = (() => { let time = 1000; return () => time += 100; })()', context);
    const result = await context.translateWithQueue(settings, 'private-selected-text');
    assert.deepEqual(Array.from(result.timing.attempts, attempt => attempt.outcome), ['skipped', 'error', 'success']);
    assert.equal(result.timing.attempts[0].durationMs, 0);
    for (const attempt of result.timing.attempts.slice(1)) {
        assert.ok(attempt.durationMs > 0);
        assert.ok(attempt.headersMs <= attempt.durationMs);
    }
    assert.ok(result.timing.totalMs >= result.timing.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0));
    assert.doesNotMatch(JSON.stringify(result.timing), /private-api-key|private-selected-text/);
});

test('failure timing is retained when all models fail', async () => {
    const settings = { modelQueue: [model('openrouter', 'unavailable')], openrouterApiKey: 'key' };
    const { context } = setup([new Error('Network unavailable')], settings);
    await assert.rejects(context.translateWithQueue(settings, 'hello'), error => {
        assert.equal(error.timing.attempts[0].outcome, 'error');
        assert.match(error.timing.attempts[0].reason, /Network unavailable/);
        assert.ok(error.timing.totalMs >= 0);
        return true;
    });
});
