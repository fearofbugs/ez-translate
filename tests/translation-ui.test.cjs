const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Markdown formats explanations while escaping HTML and unsafe links', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync('src/shared/markdown.js', 'utf8'), context);
    const html = context.markdownHTML('# Meaning\n**hello**\n- example\n```js\n<script>alert(1)</script>\n```\n[x](javascript:alert(1))\n<img src=x onerror=alert(1)>');
    assert.match(html, /<h1>Meaning<\/h1>/);
    assert.match(html, /<strong>hello<\/strong>/);
    assert.match(html, /<ul>\n<li>example<\/li>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script|<img|href="javascript:/);
});

test('Markdown renders GFM tables and escapes cell HTML', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync('src/shared/markdown.js', 'utf8'), context);
    const html = context.markdownHTML('| Word | Meaning |\n| --- | :---: |\n| **hello** | greeting \\| salutation |\n| hi | <script>alert(1)</script> |');
    assert.match(html, /<table>/);
    assert.match(html, /<th>Word<\/th><th>Meaning<\/th>/);
    assert.match(html, /<td><strong>hello<\/strong><\/td><td>greeting \| salutation<\/td>/);
    assert.doesNotMatch(html, /<script/);
});

test('OpenRouter errors and empty responses produce actionable messages', async () => {
    const source = fs.readFileSync('src/background/background.js', 'utf8');
    const parser = source.slice(source.indexOf('async function parseOpenRouterResponse('), source.indexOf('\nasync function callOrcaRouterAPI'));
    const context = vm.createContext({});
    vm.runInContext(parser, context);
    const response = (status, data) => ({ status, ok: status === 200, json: async () => data });
    assert.equal(await context.parseOpenRouterResponse(response(200, { choices: [{ message: { content: ' **Hello** ' } }] })), '**Hello**');
    await assert.rejects(context.parseOpenRouterResponse(response(402, {})), /insufficient credits/);
    await assert.rejects(context.parseOpenRouterResponse(response(200, { error: { message: 'Provider unavailable' } })), /Provider unavailable/);
    await assert.rejects(context.parseOpenRouterResponse(response(200, { choices: [] })), /no translation/);
});

test('content bridge catches invalidated contexts and runtime channel errors', () => {
    const source = fs.readFileSync('src/content/content.js', 'utf8').split('// content.js')[0];
    const chrome = { runtime: { id: undefined } };
    const context = vm.createContext({ chrome });
    vm.runInContext(source, context);
    let result;
    context.sendExtensionMessage({}, response => { result = response; });
    assert.equal(result, undefined, 'stale contexts do not display a notification');
    assert.equal(context.extensionError(new Error('Extension context invalidated.')), null);
    chrome.runtime.id = 'extension-id';
    chrome.runtime.sendMessage = (_, callback) => {
        chrome.runtime.lastError = { message: 'Message channel closed' };
        callback();
    };
    context.sendExtensionMessage({}, response => { result = response; });
    assert.equal(result.error, 'Message channel closed');
});
