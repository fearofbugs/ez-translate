(async () => {
    const root = document.getElementById('model-priority');
    root.innerHTML = `
        <h2>Free models</h2>
        <p>Connect your accounts once. Browse separate provider catalogs and arrange your providers and models.</p>
        <div class="model-connections">
            <label>OpenRouter API key<input id="queue-openrouter-key" type="password" autocomplete="off"></label>
            <label>OpenCode API key<input id="queue-opencode-key" type="password" autocomplete="off"></label>
            <label>Cloudflare Workers AI API token<input id="queue-cloudflare-key" type="password" autocomplete="off"></label>
            <label>Cloudflare Account ID<input id="queue-cloudflare-account" type="text" autocomplete="off" placeholder="32-character Account ID" spellcheck="false"></label>
        </div>
        <p class="hint">Cloudflare models share a daily free allowance. Use a Workers Free account for a hard free limit; paid accounts can be billed beyond that allowance. <a href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noopener noreferrer">Get a token and Account ID</a></p>
        <p class="hint">OpenCode’s free chat models currently require its own client. They may appear in the catalog but return an access error here. <a href="https://opencode.ai/docs/console/models/" target="_blank" rel="noopener noreferrer">OpenCode availability</a></p>
        <button id="fetch-free-models" type="button">Save keys & fetch all free models</button>
        <p id="catalog-status" role="status" aria-live="polite"></p>
        <h3>Translation order</h3>
        <p>Drag provider headers to set provider order. Drag models within a provider to set its primary and backups, or drag a catalog model into its provider group. Changes save automatically.</p>
        <ol id="model-order" aria-label="Model priority"></ol>
        <p id="queue-status" role="status" aria-live="polite"></p>
        <button id="reset-model-cooldowns" type="button">Retry quota-limited models now</button>
        <h3>Available free models <span id="model-count"></span></h3>
        <label>Search models<input id="model-search" type="search" placeholder="Model name or source"></label>
        <div id="free-model-catalog"></div>`;
    const find = id => document.getElementById(id);
    const status = find('catalog-status'), queueStatus = find('queue-status');
    let settings;
    try { settings = await chrome.storage.local.get(null); }
    catch (error) { status.textContent = error.message; return; }
    let queue = Array.isArray(settings.modelQueue) ? settings.modelQueue.filter(m => ModelCatalog.sources[m.provider] && m.free) : [];
    let catalog = Array.isArray(settings.freeModelCatalog) ? settings.freeModelCatalog.filter(m => ModelCatalog.sources[m.provider] && m.free) : [];
    for (const provider of Object.keys(ModelCatalog.sources)) find(`queue-${provider}-key`).value = settings[`${provider}ApiKey`] || '';
    find('queue-cloudflare-account').value = settings.cloudflareAccountId || '';
    const providers = Object.keys(ModelCatalog.sources);
    let providerOrder = [...new Set([
        ...(Array.isArray(settings.modelProviderOrder) ? settings.modelProviderOrder : []),
        ...queue.map(model => model.provider), ...providers,
    ])].filter(provider => providers.includes(provider));
    const orderedQueue = () => providerOrder.flatMap(provider => queue.filter(model => model.provider === provider));
    const originalOrder = queue.map(model => `${model.provider}/${model.id}`).join('|');
    queue = orderedQueue();
    // Keep storage writes ordered when users rapidly move several models.
    let writes = Promise.resolve();
    function save() {
        queue = orderedQueue();
        const snapshot = queue.map(model => ({ ...model }));
        const providerSnapshot = [...providerOrder];
        queueStatus.textContent = 'Saving…';
        writes = writes.catch(() => {}).then(() => chrome.storage.local.set({ modelQueue: snapshot, modelProviderOrder: providerSnapshot, modelQueueEnabled: true }))
            .then(() => { queueStatus.textContent = 'Priority list saved'; })
            .catch(error => { queueStatus.textContent = `Could not save: ${error.message}`; });
    }
    const identity = model => `${model.provider}/${model.id}`;
    function button(label, action, disabled = false) {
        const node = document.createElement('button');
        node.type = 'button'; node.textContent = label; node.disabled = disabled;
        node.addEventListener('click', action);
        return node;
    }
    function describe(model) {
        return `${ModelCatalog.sources[model.provider].name} · ${model.name || model.id}${model.vision ? ' · Text + image' : ' · Text'}${model.provider === 'opencode' ? ' · Client restriction' : ''}${model.provider === 'cloudflare' ? ' · Daily free allowance' : ''}`;
    }
    let dragged = null;
    function draggable(node, payload) {
        node.draggable = true;
        node.addEventListener('dragstart', event => {
            event.stopPropagation();
            dragged = payload;
            event.dataTransfer.setData('text/plain', payload.key);
            event.dataTransfer.effectAllowed = payload.from === 'catalog' ? 'copy' : 'move';
        });
        node.addEventListener('dragend', () => {
            dragged = null;
            root.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    }
    function dropTarget(node, accepts, action) {
        node.addEventListener('dragover', event => {
            if (!dragged || !accepts(dragged)) return;
            event.preventDefault(); event.stopPropagation();
            event.dataTransfer.dropEffect = dragged.from === 'catalog' ? 'copy' : 'move';
            node.classList.add('drag-over');
        });
        node.addEventListener('dragleave', event => {
            if (!node.contains(event.relatedTarget)) node.classList.remove('drag-over');
        });
        node.addEventListener('drop', event => {
            if (!dragged || !accepts(dragged)) return;
            event.preventDefault(); event.stopPropagation();
            const payload = dragged; dragged = null;
            node.classList.remove('drag-over');
            action(payload);
        });
    }
    function moveProvider(provider, to) {
        const from = providerOrder.indexOf(provider);
        if (from < 0 || to < 0 || to >= providerOrder.length || from === to) return;
        providerOrder.splice(to, 0, providerOrder.splice(from, 1)[0]);
        queue = orderedQueue(); render(); save();
    }
    function moveModel(provider, from, to) {
        const models = queue.filter(model => model.provider === provider);
        if (to < 0 || to >= models.length || from === to) return;
        models.splice(to, 0, models.splice(from, 1)[0]);
        queue = queue.filter(model => model.provider !== provider).concat(models);
        queue = orderedQueue(); render(); save();
    }
    function addModel(model) {
        if (queue.some(item => identity(item) === identity(model))) return;
        queue.push({ ...model }); queue = orderedQueue(); render(); save();
    }
    function dropModel(payload, provider, targetKey) {
        const model = [...queue, ...catalog].find(item => identity(item) === payload.key);
        if (!model || model.provider !== provider) return;
        const models = queue.filter(item => item.provider === provider && identity(item) !== payload.key);
        const target = models.findIndex(item => identity(item) === targetKey);
        models.splice(target < 0 ? models.length : target, 0, { ...model });
        queue = queue.filter(item => item.provider !== provider).concat(models);
        queue = orderedQueue(); render(); save();
    }
    function render() {
        const list = find('model-order'); list.replaceChildren();
        providerOrder.forEach((provider, providerIndex) => {
            const group = document.createElement('li');
            group.className = 'provider-priority-group'; group.dataset.provider = provider;
            const header = document.createElement('div'); header.className = 'provider-heading';
            const title = document.createElement('h4'); title.textContent = `${providerIndex + 1}. ${ModelCatalog.sources[provider].name}`;
            header.append(title, button('↑', () => moveProvider(provider, providerIndex - 1), providerIndex === 0), button('↓', () => moveProvider(provider, providerIndex + 1), providerIndex === providerOrder.length - 1));
            draggable(header, { kind: 'provider', key: provider });
            dropTarget(group, payload => payload.kind === 'provider', payload => moveProvider(payload.key, providerIndex));
            const models = queue.filter(model => model.provider === provider);
            const modelList = document.createElement('ol'); modelList.className = 'provider-model-order';
            modelList.setAttribute('aria-label', `${ModelCatalog.sources[provider].name} model priority`);
            dropTarget(modelList, payload => payload.kind === 'model' && payload.provider === provider, payload => dropModel(payload, provider));
            if (!models.length) {
                const empty = document.createElement('li'); empty.className = 'provider-empty';
                empty.textContent = 'Drop models from this provider here, or use Add below.'; modelList.append(empty);
            }
            models.forEach((model, index) => {
                const row = document.createElement('li'); row.className = 'model-row';
                row.dataset.model = identity(model);
                const name = document.createElement('span'); name.textContent = `${index === 0 ? 'Primary' : `Backup ${index}`} · ${model.name || model.id}${model.vision ? ' · Text + image' : ''}`;
                name.title = model.id;
                row.append(name, button('↑', () => moveModel(provider, index, index - 1), index === 0), button('↓', () => moveModel(provider, index, index + 1), index === models.length - 1), button('Remove', () => {
                    queue = queue.filter(item => identity(item) !== identity(model)); render(); save();
                }));
                draggable(row, { kind: 'model', key: identity(model), provider, from: 'queue' });
                dropTarget(row, payload => payload.kind === 'model' && payload.provider === provider,
                    payload => { if (payload.key !== identity(model)) dropModel(payload, provider, identity(model)); });
                modelList.append(row);
            });
            group.append(header, modelList); list.append(group);
        });
        renderCatalog();
    }
    function renderCatalog() {
        const container = find('free-model-catalog'); container.replaceChildren();
        const search = find('model-search').value.toLowerCase().trim();
        const filtered = catalog.filter(model => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(search));
        find('model-count').textContent = `(${filtered.length} of ${catalog.length})`;
        for (const provider of providers) {
            const group = document.createElement('section'); group.className = 'provider-catalog'; group.dataset.provider = provider;
            const title = document.createElement('h4');
            const matches = filtered.filter(model => model.provider === provider);
            const total = catalog.filter(model => model.provider === provider).length;
            title.textContent = `${ModelCatalog.sources[provider].name} (${matches.length} of ${total})`; group.append(title);
            if (!matches.length) {
                const empty = document.createElement('p'); empty.className = 'provider-empty';
                empty.textContent = total ? 'No models match your search.' : 'Fetch models for this provider to see its catalog.';
                group.append(empty);
            }
            for (const model of matches) {
                const row = document.createElement('div'); row.className = 'model-row'; row.dataset.model = identity(model);
                const title = document.createElement('span'); title.textContent = describe(model); title.title = model.id;
                const added = queue.some(item => identity(item) === identity(model));
                row.append(title, button(added ? 'Added' : 'Add', () => addModel(model), added));
                draggable(row, { kind: 'model', key: identity(model), provider, from: 'catalog' });
                group.append(row);
            }
            container.append(group);
        }
    }
    find('model-search').addEventListener('input', renderCatalog);
    find('fetch-free-models').addEventListener('click', async () => {
        const fetchButton = find('fetch-free-models'); fetchButton.disabled = true; status.textContent = 'Fetching full catalogs…';
        try {
            const keys = Object.fromEntries(Object.keys(ModelCatalog.sources).map(provider => [`${provider}ApiKey`, find(`queue-${provider}-key`).value.trim()]));
            keys.cloudflareAccountId = find('queue-cloudflare-account').value.trim();
            await chrome.storage.local.set(keys);
            const providers = Object.keys(ModelCatalog.sources);
            const results = await Promise.allSettled(providers.map(provider => ModelCatalog.fetchModels(provider, keys[`${provider}ApiKey`], keys.cloudflareAccountId)));
            const messages = [];
            results.forEach((result, index) => {
                const provider = providers[index];
                if (result.status === 'fulfilled') {
                    catalog = catalog.filter(model => model.provider !== provider).concat(result.value.models);
                    messages.push(`${ModelCatalog.sources[provider].name}: ${result.value.models.length} ${provider === 'cloudflare' ? 'free-allowance' : 'free'} text models from ${result.value.total} catalog entries.`);
                } else messages.push(`${ModelCatalog.sources[provider].name}: ${result.reason.message}. Previous catalog retained.`);
            });
            // Refresh capability metadata for models still present; never change the user's order.
            queue = queue.map(model => catalog.find(item => identity(item) === identity(model)) || model);
            await chrome.storage.local.set({ freeModelCatalog: catalog, modelQueue: queue, modelQueueEnabled: true });
            status.textContent = messages.join(' ');
            render();
        } catch (error) { status.textContent = `Could not fetch models: ${error.message}`; }
        finally { fetchButton.disabled = false; }
    });
    find('reset-model-cooldowns').addEventListener('click', async () => {
        try { await chrome.storage.session.remove('modelCooldowns'); queueStatus.textContent = 'Quota cooldowns cleared. The next translation will retry from the first model.'; }
        catch (error) { queueStatus.textContent = error.message; }
    });
    render();
    if (queue.map(identity).join('|') !== originalOrder) save();
    // This page now uses the queue instead of selecting an active provider.
    await chrome.storage.local.set({ modelQueueEnabled: true });
})().catch(error => { document.getElementById('queue-status').textContent = error.message; });
