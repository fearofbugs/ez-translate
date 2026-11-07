// One ordered model list, independent of the legacy active provider.
async function translateWithQueue(settings, text, imageDataUrl, promptLanguages) {
    const startedAt = Date.now();
    const attempts = [];
    const timing = () => ({ totalMs: Math.max(0, Date.now() - startedAt), attempts });
    const queue = settings.modelQueue || [];
    if (!queue.length) throw new Error('Add a model to your priority list in Settings.');
    const failures = [];
    const cooldowns = (await chrome.storage.session.get('modelCooldowns')).modelCooldowns || {};
    const blockedSources = new Set();
    const skip = (model, reason) => { failures.push(`${model}: ${reason}`); attempts.push({ model, outcome: 'skipped', durationMs: 0, reason }); };
    for (const entry of queue) {
        const identity = `${entry.provider}/${entry.id}`;
        if (imageDataUrl && !entry.vision) { skip(identity, 'No image support'); continue; }
        if (blockedSources.has(entry.provider)) { skip(identity, 'Provider blocked by an earlier access or quota error'); continue; }
        const dailyCooldownKey = `cloudflare:${settings.cloudflareAccountId?.trim()}:daily`;
        if (entry.provider === 'cloudflare' && cooldowns[dailyCooldownKey] > Date.now()) {
            skip(identity, 'Cloudflare daily allowance exhausted; retries after 00:00 UTC'); continue;
        }
        if (cooldowns[identity] > Date.now()) { skip(identity, 'Cooling down after quota limit'); continue; }
        const key = settings[`${entry.provider}ApiKey`]?.trim();
        if (!key) { skip(identity, 'API key missing'); continue; }
        const attempt = { model: identity, outcome: 'error', durationMs: 0 };
        const attemptStartedAt = Date.now();
        attempts.push(attempt);
        try {
            let url, body;
            const headers = { 'Content-Type': 'application/json' };
            const base = entry.provider === 'cloudflare'
                ? `${ModelCatalog.cloudflareBase(settings.cloudflareAccountId)}/v1`
                : ModelCatalog.sources[entry.provider]?.base;
            if (!base || entry.free !== true) throw new Error('Refresh the free model catalog and add this model again.');
            url = `${base}/chat/completions`;
            headers.Authorization = `Bearer ${key}`;
            const content = imageDataUrl ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: imageDataUrl } }] : text;
            body = { model: entry.id, messages: [{ role: 'user', content }], max_tokens: 2048 };
            if (entry.provider === 'openrouter') body.provider = { max_price: { prompt: 0, completion: 0 } };
            const response = await learningFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000), skipLegacyFallback: true, promptLanguages });
            attempt.headersMs = Math.max(0, Date.now() - attemptStartedAt);
            attempt.httpStatus = response.status;
            const data = await response.json().catch(() => null);
            if (!response.ok || data?.error || data?.success === false) {
                const providerError = data?.error || data?.errors?.[0];
                const errorCode = Number(providerError?.code);
                const errorMessage = providerError?.message || 'Request failed';
                const status = response.ok ? (errorCode >= 400 && errorCode < 600 ? errorCode : 503) : response.status;
                const cloudflareModelError = entry.provider === 'cloudflare' && [5016, 5018, 3041, 5035].includes(errorCode);
                if ([401, 403].includes(status) && !cloudflareModelError) blockedSources.add(entry.provider);
                if (entry.provider === 'cloudflare' && (errorCode === 3036 ||
                    /daily.*(?:neuron|allocation|quota)|(?:neuron|allocation).*daily/i.test(errorMessage))) {
                    const nextReset = new Date();
                    nextReset.setUTCHours(24, 0, 0, 0);
                    cooldowns[dailyCooldownKey] = nextReset.getTime();
                    blockedSources.add('cloudflare');
                    await chrome.storage.session.set({ modelCooldowns: cooldowns });
                }
                if ([402, 429].includes(status)) {
                    const retryValue = response.headers.get('retry-after');
                    const retry = Number(retryValue) || (Date.parse(retryValue) - Date.now()) / 1000;
                    cooldowns[identity] = Date.now() + (retry > 0 ? Math.min(retry, 86400) : 60) * 1000;
                    await chrome.storage.session.set({ modelCooldowns: cooldowns });
                }
                throw new Error(`HTTP ${status}: ${errorMessage}${entry.provider === 'opencode' && status === 403 ? '. OpenCode free chat requires its own client.' : ''}`);
            }
            const result = data?.choices?.[0]?.message?.content;
            if (typeof result !== 'string' || !result.trim()) throw new Error('No text returned');
            attempt.outcome = 'success';
            attempt.durationMs = Math.max(0, Date.now() - attemptStartedAt);
            return { translation: result.trim(), model: identity, timing: timing() };
        } catch (error) {
            attempt.durationMs = Math.max(0, Date.now() - attemptStartedAt);
            attempt.reason = error.name === 'TimeoutError' ? 'Timed out after 20 seconds' : error.message;
            failures.push(`${identity}: ${attempt.reason}`);
        }
    }
    throw Object.assign(new Error(failures.length ? `All models failed. ${failures.join('; ')}` : 'No image-capable model in your priority list.'), { timing: timing() });
}
