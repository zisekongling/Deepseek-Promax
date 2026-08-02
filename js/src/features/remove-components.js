/**
 * 无用组件移除模块
 *
 * 隐藏 DeepSeek 网页端的无用 UI 组件：
 *   1. 转发按钮（._57370c5._5dedc1e / ds-button--iconLabelPrimary）
 *   2. 下载应用入口（._9579690 容器 / 含"下载手机应用"的下拉菜单项）
 *
 * 使用 display:none 隐藏而非 remove() 移除，避免 React 在 commit 阶段
 * 因找不到预期子节点而抛出 NotFoundError: removeChild。
 */
import { CONFIG } from '../config.js';

/**
 * 判断元素是否为转发按钮
 * 通过 class 名组合和 SVG 路径特征识别
 * @param {Element} el
 * @returns {boolean}
 */
function isForwardButton(el) {
    if (!el || el.nodeType !== 1) return false;
    // 匹配 ._57370c5._5dedc1e 的转发按钮
    if (el.classList.contains('_57370c5') && el.classList.contains('_5dedc1e')) return true;
    // 匹配 .db183363 的分享/操作按钮
    if (el.classList.contains('db183363')) return true;
    // 兜底：ds-button--iconLabelPrimary 且包含分享/转发 SVG
    if (el.classList.contains('ds-button--iconLabelPrimary')) {
        const label = el.textContent || '';
        if (label.includes('转发') || label.includes('分享')) return true;
    }
    return false;
}

/**
 * 判断元素是否为下载应用入口
 * @param {Element} el
 * @returns {boolean}
 */
function isDownloadAppElement(el) {
    if (!el || el.nodeType !== 1) return false;
    // 匹配 ._9579690 容器
    if (el.classList.contains('_9579690')) return true;
    // 匹配含"下载"文字的 ds-dropdown-menu-option
    if (el.classList.contains('ds-dropdown-menu-option')) {
        const label = el.querySelector('.ds-dropdown-menu-option__label');
        if (label && /下载.*应用|下载.*App/i.test(label.textContent || '')) return true;
    }
    // 匹配含 ad8d4bfc 的下载按钮
    if (el.classList.contains('ad8d4bfc')) return true;
    return false;
}

/**
 * 扫描并隐藏指定容器中的无用组件
 * 使用 display:none 而非 remove()，避免破坏 React 的 DOM 管理
 * @param {Element} root - 扫描根节点
 */
export function removeUnwantedComponents(root) {
    if (!root || root.nodeType !== 1) return;

    // 隐藏转发按钮
    if (CONFIG.removeForwardEnabled) {
        const forwardBtns = root.querySelectorAll('._57370c5._5dedc1e, .db183363, .ds-button--iconLabelPrimary');
        forwardBtns.forEach(el => {
            if (isForwardButton(el) && el.style.display !== 'none') {
                el.style.display = 'none';
            }
        });
    }

    // 隐藏下载应用入口（不处理 ds-dropdown-menu-option，由 menu-inject 负责）
    if (CONFIG.removeDownloadAppEnabled) {
        const downloadEls = root.querySelectorAll('._9579690, .ad8d4bfc');
        downloadEls.forEach(el => {
            if (isDownloadAppElement(el) && el.style.display !== 'none') {
                el.style.display = 'none';
            }
        });
        // 仅处理不在 ds-dropdown-menu 内的选项
        const allOptions = root.querySelectorAll('.ds-dropdown-menu-option');
        allOptions.forEach(el => {
            if (isDownloadAppElement(el) && el.style.display !== 'none' && !el.closest('.ds-dropdown-menu')) {
                el.style.display = 'none';
            }
        });
    }
}

/**
 * 初始化组件移除：对整个 body 执行一次清理
 * 持续清理由主 MutationObserver（observer.js）的 scheduleScan 集成处理，
 * 不再创建独立 observer，避免双倍监听开销。
 */
export function initRemoveComponents() {
    if (document.body) {
        removeUnwantedComponents(document.body);
    }
}
