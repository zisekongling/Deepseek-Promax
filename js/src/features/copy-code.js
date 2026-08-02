/**
 * 行内代码点击复制模块
 *
 * 点击 Markdown 中的行内代码（<code> 不在 <pre> 或 .md-code-block 内）时，
 * 自动复制内容到剪贴板，并显示 Toast 提示。
 * 支持深色/浅色模式自适应。
 */
import { CONFIG } from '../config.js';
import { utils } from '../utils.js';

let installed = false;

/**
 * 显示 Toast 提示
 * @param {string} message - 提示消息
 */
function showToast(message) {
    const existing = document.querySelector('.ds-copy-toast');
    if (existing) existing.remove();

    const isDark = utils.isDarkMode();
    const toast = document.createElement('div');
    toast.className = 'ds-copy-toast';
    toast.innerHTML = `
        <div class="ds-copy-toast-icon">
            <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/**
 * 判断元素是否为行内代码（不在 pre 或代码块中）
 * @param {Element} el
 * @returns {boolean}
 */
function isInlineCode(el) {
    if (el.tagName !== 'CODE') return false;
    if (el.closest('pre')) return false;
    if (el.closest('.md-code-block')) return false;
    if (el.closest('.md-code-block-banner-wrap')) return false;
    return true;
}

/**
 * 注入 Toast 样式（仅一次）
 */
function injectToastStyle() {
    if (document.getElementById('ds-copy-toast-style')) return;
    const style = document.createElement('style');
    style.id = 'ds-copy-toast-style';
    style.textContent = `
        .ds-markdown code:not(pre code):not(.md-code-block code) { cursor: pointer; }
        .ds-copy-toast {
            position: fixed; top: 16px; left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: #fff; border-radius: 8px; padding: 12px 20px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            display: flex; align-items: center; gap: 8px;
            z-index: 99999; opacity: 0; transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px; color: #333;
        }
        .ds-copy-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        .ds-copy-toast-icon {
            width: 20px; height: 20px; background: #52c41a; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ds-copy-toast-icon svg {
            width: 12px; height: 12px; fill: none; stroke: #fff;
            stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
        }
        body[data-ds-dark-theme] .ds-copy-toast {
            background: #2d2e34; color: #e0e0e0; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
    `;
    document.head.appendChild(style);
}

/**
 * 点击事件处理器
 * @param {Event} e
 */
function handleClick(e) {
    if (!CONFIG.copyCodeEnabled) return;
    const code = e.target.closest('code');
    if (code && isInlineCode(code)) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(code.textContent).then(() => {
            showToast('成功复制到剪贴板！');
        }).catch(() => {
            const textArea = document.createElement('textarea');
            textArea.value = code.textContent;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
            showToast('成功复制到剪贴板！');
        });
    }
}

/**
 * 安装行内代码点击复制功能
 * 使用事件捕获模式，确保在 DeepSeek 的事件处理之前执行
 */
export function initCopyCode() {
    if (installed) return;
    installed = true;
    injectToastStyle();
    document.addEventListener('click', handleClick, true);
}
