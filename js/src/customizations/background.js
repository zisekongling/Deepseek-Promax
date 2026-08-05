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
 *
 * 使用 CSS 多层 background 实现：底层为图片，顶层为 linear-gradient 遮罩。
 * 避免伪元素方案中 z-index 层叠问题导致遮罩不可见。
 */
export function applyBackground() {
    const bgImage = CONFIG.bgImage || '';
    const bgOpacity = CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5;
    const oldBgStyle = document.getElementById('anime-custom-bg-style');
    if (oldBgStyle) oldBgStyle.remove();

    // 聊天背景开关关闭或无图片时，清除背景
    if (!CONFIG.bgImageEnabled || !bgImage) {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundAttachment = '';
        return;
    }

    const style = document.createElement('style');
    style.id = 'anime-custom-bg-style';
    // 多层 background：底层 = 图片，顶层 = 半透明白色遮罩（通过 bgOpacity 控制透明度）
    style.textContent = `
        body {
            background-image:
                linear-gradient(rgba(255,255,255,${bgOpacity}), rgba(255,255,255,${bgOpacity})),
                url("${bgImage}") !important;
            background-size: cover, cover !important;
            background-position: center, center !important;
            background-attachment: fixed, fixed !important;
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
