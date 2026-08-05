/**
 * HTML 导出模块
 *
 * 把单条消息或整对话导出为单文件 HTML（内联 CSS，无外部依赖）。
 * 使用纯正则实现简易 Markdown → HTML 转换，不引入外部库（marked.js 等）。
 *
 * 支持的 Markdown 元素：
 *   - 标题（#/##/###/.../######）
 *   - 无序列表（- / * / +）
 *   - 有序列表（1.）
 *   - 代码块（```lang ... ```）
 *   - 行内代码（`code`）
 *   - 引用（>）
 *   - 链接（[text](url)）/ 图片（![alt](url)）
 *   - 粗体（**text** / __text__）/ 斜体（*text* / _text_）
 *   - 水平线（--- / *** / ___）
 *   - 表格（简易：| a | b | + |---|---|）
 *
 * 主题：跟随 utils.isDarkMode()，通过 data-theme 属性在生成时快照
 * （导出的 HTML 是独立文件，打开时不再动态切换主题，保证离线可用）
 */

import { utils } from '../../utils.js';
import { normalizeRole, formatTimestamp, formatBytes } from './markdown.js';

/**
 * HTML 转义（& < > " '）
 * @param {string} text - 原始文本
 * @returns {string} 转义后的安全 HTML 文本
 */
export function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 简易 Markdown → HTML 转换（纯正则实现）
 * 注意：本函数不对外部输入做安全过滤，调用方应确保传入的是可信 Markdown；
 *       输出中所有用户文本均经过 escapeHtml 处理。
 * @param {string} md - Markdown 文本
 * @returns {string} HTML 片段（不含 <html> 外壳）
 */
export function renderMarkdownToHtml(md) {
    if (!md) return '';
    let text = String(md).replace(/\r\n/g, '\n');

    // 1. 提取代码块（保护其内容不被后续行内替换影响）
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push({ lang: String(lang || '').trim(), code: String(code).replace(/\n$/, '') });
        return `\u0000CODEBLOCK${idx}\u0000`;
    });

    // 2. 提取行内代码（保护其内容不被行内格式化影响）
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_m, code) => {
        const idx = inlineCodes.length;
        inlineCodes.push(code);
        return `\u0000INLINECODE${idx}\u0000`;
    });

    // 3. 逐行处理块级元素
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        // 标题 # ~ ######
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            const level = h[1].length;
            out.push(`<h${level}>${formatInline(h[2])}</h${level}>`);
            i++;
            continue;
        }

        // 水平线 --- / *** / ___
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            out.push('<hr/>');
            i++;
            continue;
        }

        // 引用块（连续 > 开头合并为 <blockquote>，递归渲染内部）
        if (/^\s*>\s?/.test(line)) {
            const quoteLines = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            out.push(`<blockquote>${renderMarkdownToHtml(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        // 无序列表（- / * / +）
        if (/^\s*[-*+]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
                items.push(`<li>${formatInline(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ul>${items.join('')}</ul>`);
            continue;
        }

        // 有序列表（1.）
        if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                items.push(`<li>${formatInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ol>${items.join('')}</ol>`);
            continue;
        }

        // 表格（简易：当前行 |...|，下一行是 |---|---| 分隔线）
        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
            /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
            const headerCells = splitTableRow(line);
            i += 2; // 跳过表头与分隔行
            const rows = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
                rows.push(splitTableRow(lines[i]));
                i++;
            }
            const header = `<thead><tr>${headerCells.map((c) => `<th>${formatInline(c)}</th>`).join('')}</tr></thead>`;
            const body = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${formatInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
            out.push(`<table>${header}${body}</table>`);
            continue;
        }

        // 空行跳过
        if (/^\s*$/.test(line)) {
            i++;
            continue;
        }

        // 代码块占位符独占一行时直接输出（避免被 <p> 包裹导致 <pre> 嵌套非法）
        if (/^\u0000CODEBLOCK\d+\u0000$/.test(line)) {
            out.push(line);
            i++;
            continue;
        }

        // 普通段落（合并连续非块级行）
        const paraLines = [];
        while (i < lines.length) {
            const cur = lines[i];
            if (/^\s*$/.test(cur)) break;
            if (/^(#{1,6}\s)/.test(cur)) break;
            if (/^\s*>\s?/.test(cur)) break;
            if (/^\s*[-*+]\s+/.test(cur)) break;
            if (/^\s*\d+\.\s+/.test(cur)) break;
            if (/^\s*\|.*\|\s*$/.test(cur)) break;
            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(cur)) break;
            // 代码块占位符独占一行时结束当前段落（避免 <pre> 嵌套进 <p>）
            if (/^\u0000CODEBLOCK\d+\u0000$/.test(cur)) break;
            paraLines.push(cur);
            i++;
        }
        if (paraLines.length > 0) {
            out.push(`<p>${formatInline(paraLines.join(' '))}</p>`);
        }
    }

    let html = out.join('\n');

    // 4. 还原行内代码（内容需 escape）
    html = html.replace(/\u0000INLINECODE(\d+)\u0000/g, (_m, idx) =>
        `<code>${escapeHtml(inlineCodes[+idx])}</code>`);

    // 5. 还原代码块（内容需 escape，附 language-xxx class 便于后续高亮）
    html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, idx) => {
        const block = codeBlocks[+idx];
        const langCls = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
        return `<pre><code${langCls}>${escapeHtml(block.code)}</code></pre>`;
    });

    return html;
}

/**
 * 分割表格行为单元格数组
 * @param {string} line - 形如 "| a | b |" 的表格行
 * @returns {string[]} 单元格内容数组（已 trim）
 */
function splitTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '')
        .split('|').map((s) => s.trim());
}

/**
 * 行内格式化：图片、链接、粗体、斜体
 * 处理顺序：先用占位符提取图片/链接（保护其 URL 不被转义），再 escape 剩余文本，
 *           再处理粗体/斜体，最后还原占位符。
 * @param {string} text - 原始行内文本（未转义）
 * @returns {string} 格式化后的 HTML 片段
 */
function formatInline(text) {
    if (!text) return '';
    const placeholders = [];

    // 图片 ![alt](url "title")
    let s = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt, url, title) => {
        const idx = placeholders.length;
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        placeholders.push(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${t}/>`);
        return `\u0000PH${idx}\u0000`;
    });

    // 链接 [text](url "title")
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, txt, url, title) => {
        const idx = placeholders.length;
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        placeholders.push(`<a href="${escapeHtml(url)}"${t} target="_blank" rel="noopener">${escapeHtml(txt)}</a>`);
        return `\u0000PH${idx}\u0000`;
    });

    // 转义剩余文本（占位符中的 \u0000 不会被 escape 影响）
    s = escapeHtml(s);

    // 粗体 **text** 或 __text__（先于斜体，避免 ** 被斜体正则误吞）
    s = s.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // 斜体 *text* 或 _text_（要求前后非 * / _，避免与粗体冲突）
    s = s.replace(/(^|[^\*])\*([^\*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

    // 还原占位符
    s = s.replace(/\u0000PH(\d+)\u0000/g, (_m, idx) => placeholders[+idx]);
    return s;
}

/**
 * 渲染单条消息为 HTML 片段（消息气泡）
 * @param {Object} message - 消息对象
 * @returns {string} HTML 片段（<article> 包裹）
 */
export function renderMessageHtml(message) {
    if (!message) return '';
    const role = normalizeRole(message.role);
    const roleLabel = role === 'user' ? '👤 用户'
                    : role === 'assistant' ? '🤖 DeepSeek'
                    : role;
    const ts = message.timestamp ? formatTimestamp(message.timestamp) : formatTimestamp();

    const contentHtml = renderMarkdownToHtml(message.content || '');
    const thinkingHtml = message.thinking
        ? `<details class="ds-thinking"><summary>💭 思考过程</summary>${renderMarkdownToHtml(message.thinking)}</details>`
        : '';

    let attachmentsHtml = '';
    if (message.attachments && message.attachments.length > 0) {
        const items = message.attachments.map((att) => {
            const name = escapeHtml(att.fileName || att.name || att.id || 'unknown');
            const sizeRaw = att.sizeBytes != null ? att.sizeBytes : att.size;
            const sizeStr = sizeRaw != null ? ` · ${escapeHtml(formatBytes(sizeRaw))}` : '';
            const status = att.status ? ` · ${escapeHtml(att.status)}` : '';
            return `<li>${name}<span class="ds-att-meta">${sizeStr}${status}</span></li>`;
        }).join('');
        attachmentsHtml = `<ul class="ds-attachments">${items}</ul>`;
    }

    return `<article class="ds-message ds-role-${escapeHtml(role)}">
  <header class="ds-message-header">
    <span class="ds-role">${roleLabel}</span>
    <span class="ds-time">${escapeHtml(ts)}</span>
  </header>
  ${thinkingHtml}
  <div class="ds-content">${contentHtml}</div>
  ${attachmentsHtml}
</article>`;
}

/**
 * 获取内联 CSS（浅色/深色主题，基于 html[data-theme] 切换）
 * @returns {string} CSS 文本
 */
function getStyles() {
    return `
:root { color-scheme: light dark; }
html[data-theme="light"] body {
    background: #f7f7f8; color: #1d1d1f;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif;
}
html[data-theme="dark"] body {
    background: #212121; color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif;
}
body { margin: 0; padding: 24px; font-size: 14px; line-height: 1.62; }
.ds-container { max-width: 860px; margin: 0 auto; }
.ds-doc-header h1 { font-size: 26px; margin: 0 0 6px; line-height: 1.25; }
.ds-meta { font-size: 12px; color: #64748b; margin-bottom: 18px; }
html[data-theme="dark"] .ds-meta { color: #9ca3af; }
.ds-doc-footer {
    margin-top: 32px; padding-top: 16px;
    border-top: 1px solid rgba(128,128,128,0.2);
    font-size: 12px; color: #888; text-align: center;
}

.ds-message {
    margin: 14px 0; padding: 14px 16px; border-radius: 12px;
    border: 1px solid rgba(128,128,128,0.15);
}
html[data-theme="light"] .ds-message { background: #fff; }
html[data-theme="dark"] .ds-message { background: #2d2e34; }

.ds-role-user { border-left: 3px solid #3b82f6; }
.ds-role-assistant { border-left: 3px solid #10b981; }

.ds-message-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 8px; font-size: 13px;
}
.ds-role { font-weight: 600; }
.ds-role-user .ds-role { color: #3b82f6; }
html[data-theme="dark"] .ds-role-user .ds-role { color: #93c5fd; }
.ds-role-assistant .ds-role { color: #10b981; }
html[data-theme="dark"] .ds-role-assistant .ds-role { color: #6ee7b7; }
.ds-time { color: #888; font-size: 11px; }

.ds-content h1, .ds-content h2, .ds-content h3, .ds-content h4,
.ds-content h5, .ds-content h6 { margin: 14px 0 6px; line-height: 1.3; }
.ds-content h1 { font-size: 20px; }
.ds-content h2 { font-size: 17px; }
.ds-content h3 { font-size: 15px; }
.ds-content h4 { font-size: 14px; }
.ds-content p { margin: 8px 0; }
.ds-content ul, .ds-content ol { margin: 8px 0; padding-left: 24px; }
.ds-content li { margin: 4px 0; }
.ds-content blockquote {
    margin: 8px 0; padding: 8px 12px; border-left: 3px solid #d1d5db;
    color: #64748b; background: rgba(128,128,128,0.05); border-radius: 0 6px 6px 0;
}
html[data-theme="dark"] .ds-content blockquote {
    color: #9ca3af; border-left-color: #4b5563;
}
.ds-content pre {
    margin: 10px 0; padding: 12px 14px; border-radius: 8px; overflow-x: auto;
    background: #f3f4f6; border: 1px solid #e5e7eb;
}
html[data-theme="dark"] .ds-content pre {
    background: #1e1e1e; border-color: #333;
}
.ds-content pre code {
    background: transparent; padding: 0; font-size: 13px;
    font-family: "SF Mono", Monaco, Consolas, "Courier New", monospace;
}
.ds-content code {
    background: rgba(128,128,128,0.12); padding: 2px 5px; border-radius: 4px;
    font-family: "SF Mono", Monaco, Consolas, "Courier New", monospace; font-size: 0.92em;
}
html[data-theme="dark"] .ds-content code { background: rgba(255,255,255,0.08); }
.ds-content table {
    border-collapse: collapse; margin: 10px 0; width: 100%;
    font-size: 13px;
}
.ds-content th, .ds-content td {
    border: 1px solid rgba(128,128,128,0.25); padding: 6px 10px; text-align: left;
}
html[data-theme="light"] .ds-content th { background: #f9fafb; }
html[data-theme="dark"] .ds-content th { background: #374151; }
.ds-content hr { border: none; border-top: 1px solid rgba(128,128,128,0.25); margin: 14px 0; }
.ds-content img { max-width: 100%; border-radius: 8px; }
.ds-content a { color: #2563eb; text-decoration: none; }
html[data-theme="dark"] .ds-content a { color: #93c5fd; }
.ds-content a:hover { text-decoration: underline; }

.ds-thinking {
    margin: 8px 0; padding: 8px 12px; border-radius: 6px;
    background: rgba(250,173,20,0.08); border: 1px solid rgba(250,173,20,0.25);
}
.ds-thinking summary { cursor: pointer; font-size: 13px; color: #92400e; font-weight: 500; }
html[data-theme="dark"] .ds-thinking summary { color: #fbbf24; }

.ds-attachments {
    margin: 10px 0 0; padding-left: 20px; font-size: 12px; color: #64748b;
}
html[data-theme="dark"] .ds-attachments { color: #9ca3af; }
.ds-att-meta { color: #9ca3af; font-size: 11px; }

@media print {
    body { padding: 12mm; background: #fff !important; color: #000 !important; }
    .ds-message { break-inside: avoid; box-shadow: none; }
    .ds-thinking { break-inside: avoid; }
}
`;
}

/**
 * 生成完整 HTML 文档（整对话）
 * @param {Array} messages - 消息数组
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title='DeepSeek 对话'] - 文档标题
 * @param {boolean} [options.darkMode] - 是否使用深色主题（默认跟随 utils.isDarkMode()）
 * @returns {string} 完整 HTML 文档字符串
 */
export function buildConversationHtml(messages, options = {}) {
    const title = options.title || 'DeepSeek 对话';
    const dark = options.darkMode != null
        ? options.darkMode
        : (utils && typeof utils.isDarkMode === 'function' ? utils.isDarkMode() : false);
    const ts = formatTimestamp();
    const msgsHtml = (messages || []).map(renderMessageHtml).join('\n');
    const themeAttr = dark ? 'dark' : 'light';

    return `<!doctype html>
<html lang="zh-CN" data-theme="${themeAttr}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${getStyles()}</style>
</head>
<body>
<main class="ds-container">
  <header class="ds-doc-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="ds-meta">导出时间: ${escapeHtml(ts)} · 共 ${(messages || []).length} 条消息</div>
  </header>
  ${msgsHtml}
  <footer class="ds-doc-footer">由 DeepSeek 油猴脚本导出</footer>
</main>
</body>
</html>`;
}

/**
 * 生成单条消息的完整 HTML 文档
 * @param {Object} message - 消息对象
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title='DeepSeek 消息'] - 文档标题
 * @param {boolean} [options.darkMode] - 是否使用深色主题
 * @returns {string} 完整 HTML 文档字符串
 */
export function buildSingleMessageHtml(message, options = {}) {
    const title = options.title || 'DeepSeek 消息';
    const dark = options.darkMode != null
        ? options.darkMode
        : (utils && typeof utils.isDarkMode === 'function' ? utils.isDarkMode() : false);
    const ts = formatTimestamp();
    const msgHtml = renderMessageHtml(message);
    const themeAttr = dark ? 'dark' : 'light';

    return `<!doctype html>
<html lang="zh-CN" data-theme="${themeAttr}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${getStyles()}</style>
</head>
<body>
<main class="ds-container">
  <header class="ds-doc-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="ds-meta">导出时间: ${escapeHtml(ts)}</div>
  </header>
  ${msgHtml}
  <footer class="ds-doc-footer">由 DeepSeek 油猴脚本导出</footer>
</main>
</body>
</html>`;
}
