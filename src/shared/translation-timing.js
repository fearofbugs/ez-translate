// UI elapsed time includes messaging/setup; attempt timings come from the worker.
globalThis.TranslationTiming = (() => {
    const active = new WeakMap();
    const seconds = ms => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;
    function cancel(container) {
        const state = container && active.get(container);
        if (state) { clearInterval(state.timer); active.delete(container); }
    }
    function start(container) {
        cancel(container);
        container.querySelector(':scope > .translation-timing')?.remove();
        const node = document.createElement('div');
        node.className = 'translation-timing';
        node.setAttribute('role', 'status');
        const state = { node, startedAt: performance.now() };
        const update = () => {
            if (!container.isConnected) { cancel(container); return; }
            node.textContent = `Translating · ${seconds(performance.now() - state.startedAt)}`;
        };
        container.append(node);
        active.set(container, state);
        update();
        state.timer = setInterval(update, 100);
    }
    function finish(container, response = {}) {
        if (!container?.isConnected) return;
        const state = active.get(container);
        const elapsed = state ? performance.now() - state.startedAt : response.timing?.totalMs;
        cancel(container);
        const node = state?.node || document.createElement('div');
        node.className = 'translation-timing';
        node.replaceChildren();
        container.querySelector(':scope > .translation-timing')?.remove();
        const summary = document.createElement('div');
        summary.textContent = `${response.error ? 'Failed' : 'Completed'} in ${seconds(elapsed)}${response.model ? ` · ${response.model}` : ''}`;
        node.append(summary);
        if (response.timing?.attempts?.length) {
            const details = document.createElement('details');
            const title = document.createElement('summary'); title.textContent = 'Timing details';
            const total = document.createElement('div'); total.textContent = `Model queue total: ${seconds(response.timing.totalMs)}`;
            const list = document.createElement('ul');
            for (const attempt of response.timing.attempts) {
                const row = document.createElement('li');
                row.textContent = `${attempt.model} · ${attempt.outcome} · ${seconds(attempt.durationMs)}${Number.isFinite(attempt.headersMs) ? ` · response headers at ${seconds(attempt.headersMs)}` : ''}${attempt.reason ? ` · ${attempt.reason}` : ''}`;
                list.append(row);
            }
            details.append(title, total, list); node.append(details);
        }
        container.append(node);
    }
    return Object.freeze({ start, finish, cancel });
})();
