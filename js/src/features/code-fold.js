/**
 * 代码块实时折叠模块
 *
 * 功能：
 *   1. 按行数阈值自动折叠代码块（默认 20 行）
 *   2. 折叠后显示预览行数（0 = 完全隐藏）
 *   3. 折叠/展开按钮嵌入代码块标题栏
 *   4. 通过 observer-hub 统一调度，实时响应流式输出中的代码块
 *
 * 适配自 dass.js 的代码块折叠逻辑，接入项目统一的 observer-hub 实时机制
 */
import { CONFIG } from '../config.js';
import { registerDomHandler } from '../utils/observer-hub.js';

// ============================================================
// 状态
// ============================================================

let installed = false;
let domHandlerId = 0;

// ============================================================
// SVG 图标
// ============================================================

const ICON_CHEVRON_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor"><path d="M297.4 470.6C309.9 483.1 330.2 483.1 342.7 470.6L534.7 278.6C547.2 266.1 547.2 245.8 534.7 233.3C522.2 220.8 501.9 220.8 489.4 233.3L320 402.7L150.6 233.4C138.1 220.9 117.8 220.9 105.3 233.4C92.8 245.9 92.8 266.2 105.3 278.7L297.3 470.7z"/></svg>`;
const ICON_CHEVRON_UP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor"><path d="M297.4 169.4C309.9 156.9 330.2 156.9 342.7 169.4L534.7 361.4C547.2 373.9 547.2 394.2 534.7 406.7C522.2 419.2 501.9 419.2 489.4 406.7L320 237.3L150.6 406.6C138.1 419.1 117.8 419.1 105.3 406.6C92.8 394.1 92.8 373.8 105.3 361.3L297.3 169.3z"/></svg>`;

const PROCESSED_ATTR = 'data-ds-fold-processed';
const BTN_TEXT_FOLD = '折叠';
const BTN_TEXT_UNFOLD = '展开';

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取代码块的行数
 * @param {Element} preEl - <pre> 元素
 * @returns {number}
 */
function getLineCount(preEl) {
    const text = preEl.innerText || preEl.textContent || '';
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.length;
}

/**
 * 获取代码块的行高（px）
 * @param {Element} preEl - <pre> 元素
 * @returns {number}
 */
function getLineHeight(preEl) {
    const style = window.getComputedStyle(preEl);
    let lh = style.lineHeight;
    if (lh === 'normal') lh = parseFloat(style.fontSize) * 1.2 + 'px';
    return parseFloat(lh);
}

/**
 * 是否使用预览模式（显示部分行）
 * @param {Element} preEl - <pre> 元素
 * @returns {boolean}
 */
function shouldUsePreviewMode(preEl) {
    const previewLines = CONFIG.codeFoldPreviewLines || 0;
    if (previewLines <= 0) return false;
    return getLineCount(preEl) > previewLines;
}

// ============================================================
// 折叠/展开逻辑
// ============================================================

/**
 * 折叠代码块
 * @param {Element} preEl - <pre> 元素
 * @param {Element} btn - 折叠按钮
 */
function collapseBlock(preEl, btn) {
    if (shouldUsePreviewMode(preEl)) {
        const lh = getLineHeight(preEl);
        const previewLines = CONFIG.codeFoldPreviewLines || 0;
        const maxH = lh * previewLines;
        if (!preEl.dataset.dsOrigMaxHeight) {
            preEl.dataset.dsOrigMaxHeight = preEl.style.maxHeight || '';
            preEl.dataset.dsOrigOverflow = preEl.style.overflow || '';
        }
        preEl.style.maxHeight = maxH + 'px';
        preEl.style.overflow = 'hidden';
        preEl.classList.add('ds-fold-preview');
    } else {
        if (!preEl.dataset.dsOrigDisplay) {
            preEl.dataset.dsOrigDisplay = window.getComputedStyle(preEl).display;
        }
        preEl.style.display = 'none';
        preEl.classList.remove('ds-fold-preview');
    }
    const iconDiv = btn.querySelector('.ds-fold-icon');
    if (iconDiv) iconDiv.innerHTML = ICON_CHEVRON_UP;
    const textSpan = btn.querySelector('span');
    if (textSpan) textSpan.textContent = BTN_TEXT_UNFOLD;
    btn.setAttribute('aria-label', '展开代码块');
}

/**
 * 展开代码块
 * @param {Element} preEl - <pre> 元素
 * @param {Element} btn - 折叠按钮
 */
function expandBlock(preEl, btn) {
    if (preEl.dataset.dsOrigMaxHeight !== undefined) {
        preEl.style.maxHeight = preEl.dataset.dsOrigMaxHeight || '';
        preEl.style.overflow = preEl.dataset.dsOrigOverflow || '';
        preEl.classList.remove('ds-fold-preview');
    }
    if (preEl.dataset.dsOrigDisplay !== undefined) {
        preEl.style.display = preEl.dataset.dsOrigDisplay || '';
    } else {
        preEl.style.display = '';
    }
    const iconDiv = btn.querySelector('.ds-fold-icon');
    if (iconDiv) iconDiv.innerHTML = ICON_CHEVRON_DOWN;
    const textSpan = btn.querySelector('span');
    if (textSpan) textSpan.textContent = BTN_TEXT_FOLD;
    btn.setAttribute('aria-label', '折叠代码块');
}

/**
 * 判断当前是否处于折叠状态
 * @param {Element} preEl - <pre> 元素
 * @returns {boolean}
 */
function isCurrentlyFolded(preEl) {
    if (preEl.dataset.dsOrigMaxHeight !== undefined && preEl.style.maxHeight && preEl.style.maxHeight !== 'none') {
        return true;
    }
    if (preEl.style.display === 'none') {
        return true;
    }
    return false;
}

// ============================================================
// 按钮容器查找
// ============================================================

/**
 * 查找代码块标题栏中的按钮容器
 * @param {Element} preEl - <pre> 元素
 * @returns {Element|null}
 */
function findButtonContainer(preEl) {
    const codeBlock = preEl.closest('.md-code-block');
    if (!codeBlock) return null;
    // 优先通过 .code-info-button-text（"复制"/"下载"文字）定位按钮容器
    const textSpan = codeBlock.querySelector('.code-info-button-text');
    if (textSpan) {
        const btn = textSpan.closest('[role="button"], .ds-button');
        if (btn && btn.parentElement) return btn.parentElement;
    }
    // 兼容旧版 .ds-text-button
    const oldBtn = codeBlock.querySelector('.ds-text-button');
    if (oldBtn) return oldBtn.parentElement;
    // 兼容哈希容器
    const hashContainer = codeBlock.querySelector('.efa13877');
    if (hashContainer) return hashContainer;
    return null;
}

/**
 * 创建折叠/展开按钮
 * @param {Element} preEl - <pre> 元素
 * @returns {HTMLElement}
 */
function createFoldButton(preEl) {
    if (!preEl.dataset.dsOrigDisplay) {
        preEl.dataset.dsOrigDisplay = window.getComputedStyle(preEl).display;
    }

    const threshold = CONFIG.codeFoldThreshold || 20;
    const shouldAutoFold = threshold > 0 && getLineCount(preEl) > threshold;
    let isFolded = false;

    if (shouldAutoFold) {
        if (shouldUsePreviewMode(preEl)) {
            const lh = getLineHeight(preEl);
            const previewLines = CONFIG.codeFoldPreviewLines || 0;
            const maxH = lh * previewLines;
            if (!preEl.dataset.dsOrigMaxHeight) {
                preEl.dataset.dsOrigMaxHeight = preEl.style.maxHeight || '';
                preEl.dataset.dsOrigOverflow = preEl.style.overflow || '';
            }
            preEl.style.maxHeight = maxH + 'px';
            preEl.style.overflow = 'hidden';
            preEl.classList.add('ds-fold-preview');
        } else {
            preEl.style.display = 'none';
            preEl.classList.remove('ds-fold-preview');
        }
        isFolded = true;
    }

    const btn = document.createElement('button');
    btn.className = 'ds-fold-btn';
    const iconDiv = document.createElement('div');
    iconDiv.className = 'ds-fold-icon';
    iconDiv.innerHTML = isFolded ? ICON_CHEVRON_UP : ICON_CHEVRON_DOWN;
    const textSpan = document.createElement('span');
    textSpan.textContent = isFolded ? BTN_TEXT_UNFOLD : BTN_TEXT_FOLD;
    btn.appendChild(iconDiv);
    btn.appendChild(textSpan);
    btn.setAttribute('aria-label', isFolded ? '展开代码块' : '折叠代码块');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCurrentlyFolded(preEl)) {
            expandBlock(preEl, btn);
        } else {
            collapseBlock(preEl, btn);
        }
    });
    return btn;
}

/**
 * 为单个代码块添加折叠按钮
 * @param {Element} preEl - <pre> 元素
 */
function addFoldButtonToCodeBlock(preEl) {
    if (preEl.hasAttribute(PROCESSED_ATTR)) return;
    const targetContainer = findButtonContainer(preEl);
    if (targetContainer) {
        if (targetContainer.querySelector('.ds-fold-btn')) {
            preEl.setAttribute(PROCESSED_ATTR, 'true');
            return;
        }
        targetContainer.appendChild(createFoldButton(preEl));
    } else {
        const wrapper = document.createElement('div');
        wrapper.className = 'ds-fold-btn-wrapper';
        wrapper.style.textAlign = 'right';
        wrapper.style.marginBottom = '6px';
        wrapper.appendChild(createFoldButton(preEl));
        preEl.parentNode.insertBefore(wrapper, preEl);
    }
    preEl.setAttribute(PROCESSED_ATTR, 'true');
}

// ============================================================
// 实时 DOM 处理（接入 observer-hub）
// ============================================================

/**
 * 处理 observer-hub 分发的元素批次
 * 实时响应流式输出中新增的代码块，立即添加折叠按钮
 * @param {Element[]} elements - 本轮新增的元素节点数组
 */
function handleNewElements(elements) {
    for (const el of elements) {
        if (!el || el.nodeType !== 1) continue;
        // 自身是 <pre> 标签
        if (el.matches && el.matches('pre')) {
            if (!el.hasAttribute(PROCESSED_ATTR)) addFoldButtonToCodeBlock(el);
        }
        // 内部包含 <pre> 标签（如 .md-code-block 整体新增）
        if (el.querySelectorAll) {
            const innerPres = el.querySelectorAll('pre');
            for (const pre of innerPres) {
                if (!pre.hasAttribute(PROCESSED_ATTR)) addFoldButtonToCodeBlock(pre);
            }
        }
    }
}

// ============================================================
// 批量处理（初始扫描）
// ============================================================

/**
 * 处理所有已有代码块（初始全量扫描）
 */
function processAllExistingCodeBlocks() {
    document.querySelectorAll('pre').forEach(block => {
        if (!block.hasAttribute(PROCESSED_ATTR)) addFoldButtonToCodeBlock(block);
    });
}

/**
 * 重新应用折叠到所有代码块（设置变更时调用）
 */
export function reapplyFoldToAllCodeBlocks() {
    document.querySelectorAll('pre').forEach(pre => {
        pre.removeAttribute(PROCESSED_ATTR);
        if (pre.dataset.dsOrigDisplay) {
            pre.style.display = pre.dataset.dsOrigDisplay;
            delete pre.dataset.dsOrigDisplay;
        }
        if (pre.dataset.dsOrigMaxHeight) {
            pre.style.maxHeight = pre.dataset.dsOrigMaxHeight;
            pre.style.overflow = pre.dataset.dsOrigOverflow || '';
            delete pre.dataset.dsOrigMaxHeight;
            delete pre.dataset.dsOrigOverflow;
        }
        pre.classList.remove('ds-fold-preview');
        const btn = pre.parentElement?.querySelector('.ds-fold-btn');
        if (btn) btn.remove();
        addFoldButtonToCodeBlock(pre);
    });
}

/**
 * 清理遗留的折叠按钮包装器
 */
function cleanupLegacyWrappers() {
    document.querySelectorAll('.ds-fold-btn-wrapper').forEach(w => w.remove());
}

/**
 * 去重折叠按钮
 */
function deduplicateButtons() {
    const seen = new Set();
    document.querySelectorAll('.code-info-button-text').forEach(span => {
        const btn = span.closest('[role="button"], .ds-button');
        if (!btn) return;
        const container = btn.parentElement;
        if (!container || seen.has(container)) return;
        seen.add(container);
        const btns = container.querySelectorAll('.ds-fold-btn');
        if (btns.length > 1) for (let i = 1; i < btns.length; i++) btns[i].remove();
    });
    document.querySelectorAll('.ds-text-button').forEach(btn => {
        const container = btn.parentElement;
        if (!container || seen.has(container)) return;
        seen.add(container);
        const btns = container.querySelectorAll('.ds-fold-btn');
        if (btns.length > 1) for (let i = 1; i < btns.length; i++) btns[i].remove();
    });
}

// ============================================================
// CSS 样式
// ============================================================

const CODE_FOLD_CSS = `
.ds-fold-btn {
    background: transparent; border: none; border-radius: 12px;
    font-size: 13px; padding: 4px 8px; cursor: pointer;
    transition: all 0.2s; font-family: system-ui, sans-serif;
    user-select: none; display: inline-flex; align-items: center; gap: 2px;
    opacity: 0.7;
}
.ds-fold-btn:hover { background: rgba(128,128,128,0.2); opacity: 1; }
.ds-fold-btn .ds-fold-icon { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
.ds-fold-btn .ds-fold-icon svg { width: 20px; height: 20px; display: block; }
.ds-fold-preview::after { content: " ..."; display: block; text-align: center; color: inherit; opacity: 0.6; margin-top: 4px; }
`;

/**
 * 注入样式
 */
function injectStyles() {
    if (document.getElementById('ds-code-fold-style')) return;
    const style = document.createElement('style');
    style.id = 'ds-code-fold-style';
    style.textContent = CODE_FOLD_CSS;
    document.head.appendChild(style);
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化代码块实时折叠模块
 * 注入样式、扫描已有代码块，并向 observer-hub 注册实时 DOM 处理器
 */
export function initCodeFold() {
    if (installed) return;
    installed = true;

    if (!CONFIG.codeFoldEnabled) return;

    injectStyles();
    cleanupLegacyWrappers();
    deduplicateButtons();
    // 先处理当前已存在的代码块（一次全量扫描）
    processAllExistingCodeBlocks();
    // 后续变化由 observer-hub 实时分发（与 inline-export/token-speed 等模块共享同一调度中心）
    domHandlerId = registerDomHandler({ onElements: handleNewElements });
}