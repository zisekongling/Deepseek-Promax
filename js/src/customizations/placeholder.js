/**
 * 输入框占位符文字修改模块
 *
 * 修改 DeepSeek 输入框（textarea._27c9245）的占位符文字内容，
 * 替换默认的"在此处修改"等灰色提示文字为用户自定义内容。
 * 使用 MutationObserver 持续监听新出现的输入框。
 */
import { CONFIG } from '../config.js';

let observer = null;

/**
 * 对单个 textarea 应用自定义占位符文字
 * @param {HTMLTextAreaElement} textarea
 */
function applyPlaceholder(textarea) {
    if (!textarea || textarea.tagName !== 'TEXTAREA') return;
    if (!textarea.classList.contains('_27c9245')) return;
    // 避免重复设置相同值触发不必要的事件
    const newText = CONFIG.placeholderText || '说点什么吧～';
    if (textarea.placeholder !== newText) {
        textarea.placeholder = newText;
    }
}

/**
 * 扫描容器中所有 textarea 并应用占位符
 * @param {Element} root
 */
export function applyPlaceholderStyle() {
    if (!CONFIG.placeholderTextEnabled) return;
    if (!document.body) return;
    const textareas = document.querySelectorAll('textarea._27c9245');
    textareas.forEach(applyPlaceholder);
}

/**
 * 初始化占位符修改：立即应用 + MutationObserver 持续监听
 */
export function initPlaceholder() {
    if (!CONFIG.placeholderTextEnabled) return;

    applyPlaceholderStyle();

    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
        if (!CONFIG.placeholderTextEnabled) return;
        for (const mut of mutations) {
            if (mut.type === 'childList') {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.tagName === 'TEXTAREA') {
                            applyPlaceholder(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('textarea._27c9245').forEach(applyPlaceholder);
                        }
                    }
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
