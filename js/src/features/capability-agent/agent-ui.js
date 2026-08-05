/**
 * Agent UI 组件 — 停止按钮、输入锁定、徽章样式
 *
 * 管理 Agent 运行期间的 UI 元素：
 *   - 输入框锁定/解锁（防止用户在 agent 运行时输入）
 *   - 自定义停止按钮（允许用户中断 agent）
 *   - Agent 徽章 CSS（标记 agent 自主产生的消息）
 */

import { state } from './state-store.js';
import { getInput, getStopBtn, isGenerating } from './input-dom.js';

/**
 * 锁定输入框和发送按钮（agent 运行期间禁止用户输入和发送）
 *
 * 策略：
 *   - 在输入框容器上覆盖半透明遮罩，阻止点击和键盘输入
 *   - 将输入框设为只读（双重保险）
 *   - 显示自定义停止按钮，允许用户中断 agent
 */
export function lockInput() {
    const input = getInput();
    if (!input) return;

    // 标记输入框为只读
    input.setAttribute('data-ds-agent-locked', 'true');
    input.setAttribute('readonly', 'readonly');
    // 拦截键盘输入（防止 React 状态更新绕过 readonly）
    input.addEventListener('input', _blockInputEvent, true);
    input.addEventListener('beforeinput', _blockInputEvent, true);

    // 创建或显示停止按钮
    showStopButton();
}

/**
 * 解锁输入框和发送按钮（agent 结束后恢复用户输入）
 */
export function unlockInput() {
    const input = getInput();
    if (input) {
        input.removeAttribute('data-ds-agent-locked');
        input.removeAttribute('readonly');
        input.removeEventListener('input', _blockInputEvent, true);
        input.removeEventListener('beforeinput', _blockInputEvent, true);
    }
    hideStopButton();
}

/**
 * 阻止输入事件的默认行为（用于 agent 运行期间锁定输入框）
 *
 * 关键：当 state.isScriptInjecting 为 true 时不拦截事件，
 * 允许 injectText 派发的 input 事件冒泡到 React root，
 * 使 React 更新内部状态，确保续跑 prompt 能正确发送。
 * @param {Event} e
 */
function _blockInputEvent(e) {
    if (state.isScriptInjecting) return;
    e.preventDefault();
    e.stopPropagation();
}

/**
 * 显示自定义停止按钮（agent 运行期间允许用户中断）
 *
 * 按钮固定在输入框右下角，点击后：
 *   - 设置 userStopRequested = true，终止续跑循环
 *   - 如果 AI 正在生成，点击 DeepSeek 原生停止按钮
 *   - 解锁输入框
 */
function showStopButton() {
    if (state.inputLockOverlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'ds-agent-stop-overlay';
    overlay.innerHTML = `
        <div class="ds-agent-stop-btn" role="button" tabindex="0">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/>
            </svg>
            <span>停止 Agent</span>
        </div>
    `;
    overlay.style.cssText = `
        position: fixed;
        z-index: 99999;
        pointer-events: none;
    `;
    const btn = overlay.querySelector('.ds-agent-stop-btn');
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 32px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: linear-gradient(135deg, #ff6b6b, #ee5a52);
        color: #fff;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 4px 16px rgba(238, 90, 82, 0.4);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        user-select: none;
    `;
    btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-1px)';
        btn.style.boxShadow = '0 6px 20px rgba(238, 90, 82, 0.5)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 4px 16px rgba(238, 90, 82, 0.4)';
    });
    btn.addEventListener('click', (e) => {
        console.log('[CapabilityAgent] 用户请求停止 Agent', e.isTrusted ? '(真实点击)' : '(程序触发)', new Error().stack);
        state.userStopRequested = true;
        // 如果 AI 正在生成，点击 DeepSeek 原生停止按钮
        const nativeStop = getStopBtn();
        if (nativeStop && isGenerating()) {
            try { nativeStop.click(); } catch (e) {}
        }
        unlockInput();
    });

    document.body.appendChild(overlay);
    state.inputLockOverlay = overlay;
}

/**
 * 隐藏自定义停止按钮
 */
export function hideStopButton() {
    if (state.inputLockOverlay) {
        state.inputLockOverlay.remove();
        state.inputLockOverlay = null;
    }
}

/**
 * 注入 Agent 徽章 CSS 样式
 *
 * 徽章用于标记 agent 自主产生的消息，让用户一目了然知道
 * 该消息是脚本自动发送的续跑 prompt，而非用户手动输入
 */
export function _injectAgentBadgeStyles() {
    if (document.getElementById('ds-agent-badge-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-agent-badge-styles';
    style.textContent = `
.ds-agent-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 0 8px 0;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    border-radius: 8px;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.4;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
    user-select: none;
    max-width: 100%;
}
.ds-agent-badge-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 6px;
}
.ds-agent-badge-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
}
.ds-agent-badge-title {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
}
.ds-agent-badge-summary {
    font-size: 11px;
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
    `;
    document.head.appendChild(style);
}
