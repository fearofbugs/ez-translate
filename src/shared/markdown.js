// Deliberately supports a safe Markdown subset; raw HTML is always escaped.
function markdownHTML(value) {
    const escape = text => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const inline = text => {
        const codes = [];
        let html = escape(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(`<code>${code}</code>`) - 1}\u0000`);
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>');
        return html.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
    };
    // GFM table rows: split on unescaped pipes, then unescape "\|".
    const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '')
        .split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
    const isTableSeparator = line => /^[\s|:-]+$/.test(line) && line.includes('-') && line.includes('|');
    const output = [];
    let code = null, list = null;
    const closeList = () => { if (list) output.push(`</${list}>`); list = null; };
    const lines = String(value ?? '').replace(/\u0000/g, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
            closeList();
            if (code) { output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); code = null; }
            else code = [];
            continue;
        }
        if (code) { code.push(line); continue; }
        // Pipe table: header row followed by a |---| separator row.
        if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            closeList();
            const headers = splitRow(line);
            let html = `<table>\n<thead>\n<tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr>\n</thead>\n<tbody>`;
            i++; // consume the separator row
            while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes('|')) {
                i++;
                const cells = splitRow(lines[i]);
                html += `\n<tr>${headers.map((_, column) => `<td>${inline(cells[column] ?? '')}</td>`).join('')}</tr>`;
            }
            output.push(html + '\n</tbody>\n</table>');
            continue;
        }
        const item = line.match(/^\s*(?:([-+*])|\d+\.)\s+(.+)$/);
        if (item) {
            const type = item[1] ? 'ul' : 'ol';
            if (list !== type) { closeList(); list = type; output.push(`<${type}>`); }
            output.push(`<li>${inline(item[2])}</li>`); continue;
        }
        closeList();
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
        else if (/^>\s?/.test(line)) output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
        else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    if (code) output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
    return output.join('\n');
}
function renderMarkdown(element, text) {
    element.classList.add('llm-markdown');
    element.innerHTML = markdownHTML(text);
}
