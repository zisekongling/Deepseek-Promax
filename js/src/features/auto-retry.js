/**
 * 自动重试模块
 *
 * 检测 DeepSeek 回复中的"重新生成"按钮，当出现网络错误时自动点击重试。
 * 通过 SVG path 属性识别特定的重试按钮图标。
 * 最多重试 10 次，每次显示通知提示。
 */
import { CONFIG } from '../config.js';

let retryAttempts = {};
let retryNotification = null;

/**
 * 显示重试通知（复用同一 DOM 元素，4 秒后淡出）
 * @param {string} text - 通知文本
 */
function showRetryNotification(text) {
    if (!retryNotification) {
        retryNotification = document.createElement('div');
        retryNotification.id = 'anime-retry-notification';
        retryNotification.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: rgba(0,0,0,0.75);
            color: #fff;
            padding: 10px 18px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: 500;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            backdrop-filter: blur(4px);
            transition: opacity 0.3s;
            pointer-events: none;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        document.body.appendChild(retryNotification);
    }
    retryNotification.textContent = text;
    retryNotification.style.opacity = '1';
    clearTimeout(retryNotification._hideTimer);
    retryNotification._hideTimer = setTimeout(() => {
        retryNotification.style.opacity = '0';
    }, 4000);
}

/**
 * 处理重试按钮：点击并通知
 * @param {HTMLElement} button - 重试按钮
 */
function handleRetryButton(button) {
    if (!CONFIG.autoRetryEnabled) return;
    if (button.getAttribute('aria-disabled') === 'true' || button.classList.contains('ds-button--disabled')) return;
    const key = location.pathname + '-' + Date.now();
    if (!retryAttempts[key]) retryAttempts[key] = 0;
    const attempts = retryAttempts[key];
    if (attempts >= 10) {
        showRetryNotification('⛔ 已达到最大重试次数 (10)');
        return;
    }
    button.click();
    retryAttempts[key] = attempts + 1;
    showRetryNotification(`🔄 重试中... 第 ${retryAttempts[key]} 次`);
}

/**
 * 扫描页面中的重试按钮（通过 SVG path 属性识别）并自动点击
 * 无参数，扫描整个文档
 */
export function scanRetryButton() {
    if (!CONFIG.autoRetryEnabled) return;
    const buttons = document.querySelectorAll('div.ds-button div.ds-icon svg');
    for (let svg of buttons) {
        const path = svg.querySelector('path');
        if (!path) continue;
        const d = path.getAttribute('d');
        if (d && d.includes('M') && d.includes('C') && d.includes('1.272') && d.includes('6.21348')) {
            let btn = svg.closest('div.ds-button');
            if (btn && !btn.dataset.animeRetryProcessed) {
                btn.dataset.animeRetryProcessed = 'true';
                handleRetryButton(btn);
            }
        }
    }
}

/**
 * 重置重试计数器
 */
export function resetRetryAttempts() {
    retryAttempts = {};
}
