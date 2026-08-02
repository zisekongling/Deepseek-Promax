/**
 * 聊天背景自定义模块
 *
 * 允许用户设置自定义背景图片和透明度，
 * 并提供 applyCustomizations 统一入口（字体 + 背景）。
 */
import { CONFIG } from '../config.js';
import { utils } from '../utils.js';
import { applyFont } from './font.js';
import { applyPlaceholderStyle, initPlaceholder } from './placeholder.js';

/**
 * 应用聊天背景图片与透明度
 * 通过在 body 上设置 background-image 和 --anime-card-bg-opacity 变量
 */
export function applyBackground() {
    const bgImage = CONFIG.bgImage || '';
    const bgOpacity = CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5;
    const oldBgStyle = document.getElementById('anime-custom-bg-style');
    if (oldBgStyle) oldBgStyle.remove();

    if (!bgImage) {
        document.body.style.backgroundImage = '';
        document.documentElement.style.removeProperty('--anime-card-bg-opacity');
        return;
    }

    const style = document.createElement('style');
    style.id = 'anime-custom-bg-style';
    style.textContent = `
        body {
            background-image: url("${bgImage}") !important;
            background-size: cover !important;
            background-position: center !important;
            background-attachment: fixed !important;
        }
        /* 半透明遮罩层：通过伪元素叠加在背景之上 */
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(var(--anime-card-bg-rgb, 255,255,255), ${bgOpacity});
            z-index: -1;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 统一应用所有自定义项（字体 + 背景 + 占位符文字）
 */
export function applyCustomizations() {
    applyFont();
    applyBackground();
    applyPlaceholderStyle();
    initPlaceholder();
}
