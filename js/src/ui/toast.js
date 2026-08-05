/**
 * 通用 Toast 通知组件
 *
 * 提供 showToast 函数，支持 tone（语气）和 duration（持续时间）选项。
 * 用于 memory.js / inline-export.js 等模块的用户操作反馈。
 *
 * 用法：
 *   import { showToast } from '../ui/toast.js';
 *   showToast('已保存', { tone: 'success', duration: 3000 });
 *   showToast('出错了', { tone: 'error' });
 *   showToast('提示信息');  // 默认 info 语气
 */

/** tone → 颜色 + 图标映射 */
const TONE_CONFIG = {
    success: { color: '#52c41a', icon: '<polyline points="20 6 9 17 4 12"></polyline>' },
    warning: { color: '#faad14', icon: '<path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>' },
    error:   { color: '#f5222d', icon: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' },
    info:    { color: '#1890ff', icon: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>' }
};

/** 样式是否已注入 */
let styleInjected = false;

/**
 * 注入 Toast 样式（仅一次）
 */
function injectStyle() {
    if (styleInjected) return;
    if (document.getElementById('ds-toast-style')) {
        styleInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = 'ds-toast-style';
    style.textContent = `
        .ds-toast {
            position: fixed; top: 16px; left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: #fff; border-radius: 8px; padding: 12px 20px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            display: flex; align-items: center; gap: 8px;
            z-index: 99999999; opacity: 0; transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px; color: #333; max-width: 80vw;
        }
        .ds-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        .ds-toast-icon {
            width: 20px; height: 20px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ds-toast-icon svg {
            width: 12px; height: 12px; fill: none; stroke: #fff;
            stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
        }
        body[data-ds-dark-theme] .ds-toast {
            background: #2d2e34; color: #e0e0e0; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
    `;
    document.head.appendChild(style);
    styleInjected = true;
}

/**
 * 显示 Toast 通知
 * @param {string} message - 提示消息
 * @param {Object} [opts] - 选项
 * @param {string} [opts.tone='info'] - 语气：success/warning/error/info
 * @param {number} [opts.duration=3000] - 持续时间（毫秒）
 */
export function showToast(message, opts = {}) {
    if (typeof document === 'undefined') return;
    injectStyle();

    const tone = TONE_CONFIG[opts.tone] ? opts.tone : 'info';
    const duration = typeof opts.duration === 'number' ? opts.duration : 3000;
    const cfg = TONE_CONFIG[tone];

    // 移除已有 toast（避免叠加）
    const existing = document.querySelector('.ds-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'ds-toast';
    toast.innerHTML = `
        <div class="ds-toast-icon" style="background:${cfg.color}">
            <svg viewBox="0 0 24 24">${cfg.icon}</svg>
        </div>
        <span>${String(message || '').replace(/</g, '&lt;')}</span>
    `;
    document.body.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => toast.classList.add('show'));

    // 自动消失
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
