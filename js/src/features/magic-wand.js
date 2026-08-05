/**
 * 页面缩略控制模块
 *
 * 提供以下页面元素的折叠/缩放功能：
 *   1. 侧边栏宽度切换（400px 宽屏模式）
 *   2. 用户对话字体大小切换（12px 小字模式）
 *   3. 底部输入框高度扩展（85vh）
 *   4. 用户编辑输入框最大高度扩展
 *
 * 控制面板按钮位于设置面板 → 对话增强 → 页面缩略控制
 */
import { CONFIG } from '../config.js';

// ============================================================
// CSS 样式
// ============================================================

/** 功能效果样式 */
const EFFECTS_CSS = `
.beibeibeibei-sidebar--widened {
    width: 400px;
    max-width: 400px;
    left: 0;
}
.beibeibeibei-userchat-font--small {
    font-size: 12px;
    line-height: 12px;
}
.beibeibeibei-textarea--expanded {
    max-height: calc(85vh - 100px) !important;
    height: calc(85vh - 100px) !important;
}
.ds-textarea {
    max-height: calc(75vh - 100px) !important;
}
`;

// ============================================================
// 状态
// ============================================================

let installed = false;

// ============================================================
// 核心功能
// ============================================================

/**
 * 注入样式表
 * @param {string} id - 样式标签 ID
 * @param {string} css - CSS 文本
 */
function injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * 切换侧边栏宽度
 */
export function toggleSidebarWidth() {
    const sidebar = document.querySelector('#root > div > div > div > div > div');
    if (sidebar) {
        sidebar.classList.toggle('beibeibeibei-sidebar--widened');
    }
}

/**
 * 切换所有用户对话字体大小
 */
export function toggleUserChatFont() {
    const userChats = document.querySelectorAll(
        "#root > div > div > div > div:nth-child(3) > div > div:nth-child(2) > div.scrollable > div > div:nth-child(1) > div:nth-child(odd)"
    );
    userChats.forEach(c => {
        c.classList.toggle('beibeibeibei-userchat-font--small');
    });
}

/**
 * 切换底部输入框高度扩展
 */
export function toggleTextareaExpand() {
    const chatInput = document.querySelector('#chat-input');
    if (chatInput && chatInput.parentElement) {
        chatInput.parentElement.classList.toggle('beibeibeibei-textarea--expanded');
    }
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化页面缩略控制模块
 * 注入 CSS 样式，根据 CONFIG.magicWandEnabled 决定是否启用控制面板
 */
export function initMagicWand() {
    if (installed) return;
    installed = true;

    if (!CONFIG.magicWandEnabled) return;

    injectStyle('beibeibeibei-collapse-effects-style', EFFECTS_CSS);
}