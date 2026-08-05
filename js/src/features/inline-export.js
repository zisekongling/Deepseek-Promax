/**
 * 消息内联导出模块
 *
 * 在每条消息节点上注入一个"导出 Markdown"按钮，点击后将该条消息
 * 内容生成为 Markdown 文件并下载。
 *
 * 参考 deepseek-pp/entrypoints/content/adapters/ux-polish.ts + core/export/secondary-artifacts.ts：
 *   - 消息容器选择器统一为 [data-message-id][data-message-role], [data-message-author-role]
 *   - 按钮直接 appendChild 到 message 节点末尾（不再依赖 action bar）
 *   - 使用 :scope > .class 的 DOM 级别检查避免重复注入（React 重渲染后仍可靠）
 *   - 仅要求 textContent 非空即注入（不强制判断 assistant 角色）
 *   - 文件名使用 messageId 净化（safeFilename）
 *
 * 保留 js 项目原有优势：
 *   - 通过 observer-hub 的 registerDomHandler 统一分发（不独立创建 MutationObserver）
 *   - 分离思考过程（reasoning）单独输出
 *   - Markdown 元数据含 Role、消息 ID、导出时间
 */
import { showToast } from '../ui/toast.js';
import { registerDomHandler, unregisterDomHandler } from '../utils/observer-hub.js';

/** 导出按钮的 class 标识 */
const EXPORT_BTN_CLASS = 'ds-inline-export-btn';

/** 内联样式节点 ID */
const STYLE_ID = 'ds-inline-export-style';

/**
 * 消息容器选择器（与 deepseek-pp/ux-polish.ts 保持一致）
 * 优先使用 DeepSeek 官方 DOM 暴露的 data-message-id + data-message-role 属性
 */
const MESSAGE_SELECTOR = '[data-message-id][data-message-role], [data-message-author-role]';

let installed = false;
let domHandlerId = 0;

/**
 * 注入内联导出按钮所需的样式（单例）
 * 按钮使用 float: right 定位，附加到 message 节点末尾
 * 适配深色模式
 */
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .${EXPORT_BTN_CLASS} {
            float: right;
            margin: 0 0 6px 8px;
            padding: 3px 8px;
            border-radius: 6px;
            border: 1px solid rgba(0, 0, 0, 0.12);
            background: rgba(255, 255, 255, 0.92);
            color: #334155;
            font-size: 11px;
            line-height: 1.2;
            cursor: pointer;
            user-select: none;
            transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        .${EXPORT_BTN_CLASS}:hover {
            background: rgba(59, 130, 246, 0.12);
            color: #2563eb;
            border-color: rgba(59, 130, 246, 0.3);
        }
        body[data-ds-dark-theme] .${EXPORT_BTN_CLASS},
        [data-theme="dark"] .${EXPORT_BTN_CLASS} {
            background: rgba(45, 46, 52, 0.8);
            color: #d1d5db;
            border-color: rgba(255, 255, 255, 0.1);
        }
        body[data-ds-dark-theme] .${EXPORT_BTN_CLASS}:hover,
        [data-theme="dark"] .${EXPORT_BTN_CLASS}:hover {
            background: rgba(59, 130, 246, 0.2);
            color: #93c5fd;
            border-color: rgba(59, 130, 246, 0.5);
        }
    `;
    document.head.appendChild(style);
}

/**
 * 净化字符串为安全文件名（参考 deepseek-pp/secondary-artifacts.ts:107-109 的 safeFilename）
 * 把非 [\w.-] 字符替换为 -，截断到 80 字符，空值兜底为 message
 * @param {string} value
 * @returns {string}
 */
function safeFilename(value) {
    const cleaned = String(value || '')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return cleaned || 'message';
}

/**
 * 规范化消息角色（参考 deepseek-pp/ux-polish.ts:155-158 的 normalizeRole）
 * @param {string|undefined} value
 * @returns {'user'|'assistant'|'system'|'tool'|'unknown'}
 */
function normalizeRole(value) {
    const lower = String(value || '').toLowerCase();
    if (lower === 'user' || lower === 'human') return 'user';
    if (lower === 'assistant' || lower === 'ai' || lower === 'bot') return 'assistant';
    if (lower === 'system') return 'system';
    if (lower === 'tool') return 'tool';
    return 'unknown';
}

/**
 * 从消息节点中提取 messageId（用于文件名）
 * 优先取 data-message-id 属性，其次取 id 属性，兜底使用时间戳
 * @param {Element} messageEl
 * @returns {string}
 */
function getMessageId(messageEl) {
    if (!messageEl) return `dom-${Date.now()}`;
    return messageEl.getAttribute('data-message-id') ||
           messageEl.id ||
           `dom-${Date.now()}`;
}

/**
 * 从消息节点中提取角色信息
 * @param {Element} messageEl
 * @returns {string}
 */
function getMessageRole(messageEl) {
    if (!messageEl) return 'unknown';
    const role = messageEl.getAttribute('data-message-role') ||
                 messageEl.getAttribute('data-message-author-role') ||
                 messageEl.getAttribute('data-role') ||
                 '';
    return normalizeRole(role);
}

/**
 * 从消息节点中提取纯文本内容
 * 克隆节点后移除已注入的导出按钮、操作栏、各类 UI 装饰元素，再取 textContent
 * 同时尝试分离思考过程（reasoning_content / thinking）
 * @param {Element} messageEl - 消息容器
 * @returns {{ content: string, thinking: string }}
 */
function extractMessageText(messageEl) {
    const clone = messageEl.cloneNode(true);
    // 移除已注入的导出按钮自身
    clone.querySelectorAll('.' + EXPORT_BTN_CLASS).forEach(el => el.remove());

    // 移除各类 UI 装饰元素（操作栏、按钮、引用标记等）
    const removeSelectors = [
        '[class*="action"]',
        '[class*="operation"]',
        '[class*="toolbar"]',
        '[class*="button"]',
        'button',
        '[role="button"]',
        '.ds-button',
        '[class*="citation"]',
        '[data-citation]',
        'sup',
        '[class*="anchor"]',
        '[class*="copy"]',
    ];
    for (const sel of removeSelectors) {
        clone.querySelectorAll(sel).forEach(el => el.remove());
    }

    // 提取思考过程（如果有）
    let thinking = '';
    const thinkingSelectors = [
        '[class*="thinking"]',
        '[class*="reasoning"]',
        '.ds-reasoning',
        '[data-thinking]',
        '[data-reasoning]'
    ];
    for (const sel of thinkingSelectors) {
        const thinkEl = clone.querySelector(sel);
        if (thinkEl) {
            const t = (thinkEl.textContent || '').trim();
            if (t && t.length > 0) {
                thinking = t;
                thinkEl.remove();
                break;
            }
        }
    }

    // 优先取 markdown 渲染区文本，其次取整体 textContent
    const md = clone.querySelector('.ds-markdown, [class*="markdown"]');
    const content = (md || clone).textContent || '';

    return {
        content: content.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
        thinking: thinking.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    };
}

/**
 * 生成 Markdown 文件内容（参考 deepseek-pp/secondary-artifacts.ts:20-36 + 时间戳与思考过程）
 * @param {Object} extracted - { content, thinking }
 * @param {string} messageId - 消息 ID
 * @param {string} role - 消息角色
 * @returns {string}
 */
function buildMarkdown(extracted, messageId, role) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const safeRole = role || 'unknown';

    const parts = [
        `# DeepSeek Message ${messageId}`,
        '',
        `- Role: ${safeRole}`,
        `- Exported: ${ts}`,
        ''
    ];
    if (extracted.thinking) {
        parts.push('> 🤔 思考过程', '', extracted.thinking, '', '---', '');
    }
    parts.push(extracted.content || '_No text content_', '');
    return parts.join('\n');
}

/**
 * 触发文件下载（参考 deepseek-pp/ux-polish.ts:252-262 的 downloadText）
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME 类型
 */
function downloadText(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 延迟释放 ObjectURL，避免下载未完成就被回收
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 点击导出按钮的处理函数
 * 提取消息文本、生成 Markdown 并下载，成功后显示 Toast 提示
 * @param {Element} messageEl - 消息容器
 */
function handleExportClick(messageEl) {
    try {
        const extracted = extractMessageText(messageEl);
        if (!extracted.content && !extracted.thinking) {
            showToast('未提取到消息内容', { tone: 'warning' });
            return;
        }
        const messageId = getMessageId(messageEl);
        const role = getMessageRole(messageEl);
        const md = buildMarkdown(extracted, messageId, role);
        const filename = `deepseek-message-${safeFilename(messageId)}.md`;
        downloadText(md, filename, 'text/markdown;charset=utf-8');
        showToast('已导出该条消息', { tone: 'success' });
    } catch (e) {
        showToast('导出失败：' + (e && e.message ? e.message : '未知错误'), { tone: 'error' });
    }
}

/**
 * 创建导出按钮元素
 * @param {Element} messageEl - 对应的消息容器（用于绑定点击事件）
 * @returns {HTMLButtonElement}
 */
function createExportButton(messageEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = EXPORT_BTN_CLASS;
    btn.textContent = '导出';
    btn.title = '导出此条消息为 Markdown';
    btn.setAttribute('aria-label', '导出此条消息为 Markdown');
    // 使用 capture 阶段阻止事件冒泡，避免触发 DeepSeek 自身的事件处理
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleExportClick(messageEl);
    }, true);
    return btn;
}

/**
 * 为单条消息注入导出按钮（参考 deepseek-pp/ux-polish.ts:118-136 的 mountMessageDownload）
 * 使用 :scope > .class 的 DOM 级别检查避免重复注入（React 重渲染后仍可靠）
 * 仅要求 textContent 非空即注入
 * @param {Element} messageEl - 消息容器
 */
function mountMessageDownload(messageEl) {
    if (!messageEl || !messageEl.querySelector) return;
    // DOM 级别检查：若已存在直接子元素按钮则跳过（比 dataset 标记更可靠）
    if (messageEl.querySelector(`:scope > .${EXPORT_BTN_CLASS}`)) return;
    // 仅当消息有非空文本内容时才注入
    const text = (messageEl.textContent || '').trim();
    if (!text) return;
    const btn = createExportButton(messageEl);
    messageEl.appendChild(btn);
}

/**
 * 收集指定根元素下的所有消息节点（包含根节点自身匹配）
 * 参考 deepseek-pp/ux-polish.ts:220-227 的 queryIncludingRoot
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
function collectMessageNodes(root) {
    const matches = [];
    if (root instanceof Element && root.matches(MESSAGE_SELECTOR)) {
        matches.push(root);
    }
    if (root.querySelectorAll) {
        matches.push(...Array.from(root.querySelectorAll(MESSAGE_SELECTOR)));
    }
    return matches;
}

/**
 * 扫描指定根元素下的所有消息节点并注入按钮（用于初始化与 fallback）
 * @param {Element} [root=document]
 */
function scanAndInject(root = document) {
    const nodes = collectMessageNodes(root);
    for (const node of nodes) {
        try { mountMessageDownload(node); } catch (e) {}
    }
}

/**
 * 处理 observer-hub 分发的本轮新增元素
 * 避免每次全文档扫描，只在需要时才 fallback 扫描
 * @param {Element[]} elements
 */
function handleDomElements(elements) {
    for (const el of elements) {
        if (!el || el.nodeType !== 1) continue;
        // 先处理自身是否匹配消息容器
        if (el.matches && el.matches(MESSAGE_SELECTOR)) {
            try { mountMessageDownload(el); } catch (e) {}
        }
        // 再处理内部的消息节点
        if (el.querySelectorAll) {
            const inner = collectMessageNodes(el);
            for (const msg of inner) {
                try { mountMessageDownload(msg); } catch (e) {}
            }
        }
    }
}

/**
 * 初始化消息内联导出模块
 * 注入样式、扫描已有消息，并向 observer-hub 注册 DOM 处理器
 */
export function initInlineExport() {
    if (installed) return;
    installed = true;
    injectStyles();
    // 先处理当前已存在的消息（一次全量扫描）
    scanAndInject(document);
    // 后续变化由 observer-hub 分发（避免独立 MutationObserver）
    domHandlerId = registerDomHandler({ onElements: handleDomElements });
}

/**
 * 清理内联导出模块（对外暴露的可选接口）
 */
export function destroyInlineExport() {
    if (!installed) return;
    installed = false;
    if (domHandlerId) unregisterDomHandler(domHandlerId);
    domHandlerId = 0;
}
