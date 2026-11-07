// Shared catalog rules. Never classify missing prices as zero.
globalThis.ModelCatalog = (() => {
    const sources = Object.freeze({
        openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1' },
        cloudflare: { name: 'Cloudflare Workers AI', base: 'https://api.cloudflare.com/client/v4' },
        opencode: { name: 'OpenCode', base: 'https://opencode.ai/zen/v1' },
    });
    const zero = value => value !== undefined && value !== null && String(value).trim() !== '' && Number(value) === 0;
    // Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
    // Paid-only models documented by Cloudflare; catalog metadata takes precedence
    // when it flags additional models as paid. Free eligibility uses a shared allowance.
    const cloudflarePaidModels = new Set([
        '@cf/moonshotai/kimi-k2.6', '@cf/moonshotai/kimi-k2.7-code',
        '@cf/zai-org/glm-5.2', '@cf/zai-org/glm-5.3', '@cf/zai-org/glm-5.3-flash',
        '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
        '@cf/deepseek-ai/deepseek-v4-pro-0813',
    ]);
    function cloudflareBase(accountId) {
        const account = accountId?.trim();
        if (!/^[a-f0-9]{32}$/i.test(account || '')) throw new Error('Enter your 32-character Cloudflare Account ID in Settings.');
        return `${sources.cloudflare.base}/accounts/${account}/ai`;
    }
    function normalizeCloudflare(model) {
        const id = model.name || model.id;
        if (typeof id !== 'string' || !/^@(cf|hf)\//.test(id)) return null;
        if (model.task?.name?.toLowerCase() !== 'text generation') return null;
        const properties = Object.fromEntries((model.properties || []).map(item => [item.property_id, item.value]));
        const enabled = value => value === true || value === 'true';
        if (cloudflarePaidModels.has(id) || enabled(model.requires_paid_plan) ||
            enabled(properties.requires_paid_plan) || enabled(properties.paid) || enabled(properties.deprecated)) return null;
        return {
            provider: 'cloudflare', id, name: id.replace(/^@(cf|hf)\//, ''), free: true,
            vision: model.architecture?.input_modalities?.includes('image') === true ||
                enabled(properties.vision) || (model.tags || []).some(tag => typeof tag === 'string' && /^(vision|image-to-text)$/i.test(tag)),
            allowance: 'daily',
        };
    }
    function normalize(provider, model) {
        if (provider === 'cloudflare') return normalizeCloudflare(model);
        if (!sources[provider] || typeof model.id !== 'string') return null;
        const input = model.architecture?.input_modalities;
        const output = model.architecture?.output_modalities;
        if (input && !input.includes('text')) return null;
        // Output must be text-only: a model that also emits images/audio/video cannot chat.
        if (output && output.some(modality => modality !== 'text')) return null;
        if (/embed|rerank|whisper|transcri|tts|image-gen|lyria|imagen|\bveo\b|music|chirp/i.test(model.id)) return null;
        const price = model.pricing;
        const hasPrice = price?.prompt != null || price?.completion != null;
        const freePrice = zero(price?.prompt) && zero(price?.completion) && (price?.request == null || zero(price.request));
        const free = provider === 'openrouter' ? freePrice
            : hasPrice ? freePrice : /(?:^|[-/:])free$/.test(model.id);
        if (!free) return null;
        return { provider, id: model.id, name: model.name || model.id, vision: input?.includes('image') === true, free: true };
    }
    async function fetchCloudflareModels(apiKey, accountId) {
        if (!apiKey?.trim()) throw new Error('Enter your Cloudflare Workers AI API token in Settings.');
        const base = cloudflareBase(accountId);
        const models = new Map();
        let total = 0, page = 1;
        while (true) {
            const url = `${base}/models/search?task=Text%20Generation&source=1&per_page=50&page=${page}`;
            const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey.trim()}` }, signal: AbortSignal.timeout(20000) });
            const data = await response.json().catch(() => null);
            if (!response.ok || data?.success === false || data?.error) {
                throw new Error(`Cloudflare HTTP ${response.status}: ${data?.errors?.[0]?.message || data?.error?.message || 'Could not fetch catalog. Check the token and Account ID.'}`);
            }
            if (!Array.isArray(data?.result)) throw new Error('Cloudflare returned an invalid catalog');
            total += data.result.length;
            for (const raw of data.result) {
                const model = normalizeCloudflare(raw);
                if (model) models.set(model.id, model);
            }
            const info = data.result_info;
            if (info?.total_pages != null ? page >= info.total_pages :
                info?.total_count != null ? total >= info.total_count : data.result.length < 50) break;
            if (!data.result.length) break;
            page++;
        }
        return { models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)), total };
    }
    async function fetchModels(provider, apiKey, accountId) {
        if (provider === 'cloudflare') return fetchCloudflareModels(apiKey, accountId);
        const source = sources[provider];
        if (!source) throw new Error('Unknown model source');
        let url = `${source.base}/models`;
        const seen = new Set(), models = new Map();
        let total = 0;
        while (url && !seen.has(url)) {
            seen.add(url);
            const headers = apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
            const data = await response.json().catch(() => null);
            if (!response.ok || data?.error) {
                throw new Error(`${source.name} HTTP ${response.status}: ${data?.error?.message || 'Could not fetch catalog'}${provider === 'opencode' && response.status === 403 ? '. Free chat models may require the OpenCode client.' : ''}`);
            }
            if (!Array.isArray(data?.data)) throw new Error(`${source.name} returned an invalid catalog`);
            total += data.data.length;
            for (const raw of data.data) {
                const model = normalize(provider, raw);
                if (model) models.set(model.id, model);
            }
            const next = data.links?.next;
            url = next ? new URL(next, url).href : null;
            if (url && !url.startsWith(`${source.base}/models`)) throw new Error('Unexpected model catalog page URL');
        }
        return { models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)), total };
    }
    return Object.freeze({ sources, normalize, fetchModels, cloudflareBase });
})();
