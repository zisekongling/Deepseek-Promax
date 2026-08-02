/**
 * 字体自定义模块
 *
 * 通过 CSS 变量 --anime-custom-font 注入自定义字体，
 * 配合 styles 模块中的 var(--anime-custom-font, fallback) !important 生效。
 * 支持：系统字体名、在线字体文件（woff2/woff/ttf/otf）、Google Fonts CSS 链接。
 */
import { CONFIG } from '../config.js';

/**
 * 根据 URL 扩展名推断 @font-face 的 format() 值
 * @param {string} url - 字体文件 URL
 * @returns {string} 格式标识符
 */
function detectFontFormat(url) {
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    if (lower.endsWith('.woff2')) return 'woff2';
    if (lower.endsWith('.woff')) return 'woff';
    if (lower.endsWith('.ttf')) return 'truetype';
    if (lower.endsWith('.otf')) return 'opentype';
    if (lower.endsWith('.eot')) return 'embedded-opentype';
    if (lower.endsWith('.svg')) return 'svg';
    return 'truetype';
}

/**
 * 应用自定义字体：通过 CSS 变量 --anime-custom-font 注入，
 * 被 styles 模块的 !important 规则引用。
 */
export function applyFont() {
    const family = CONFIG.fontFamily || '';
    const url = CONFIG.fontUrl || '';
    const oldFontStyle = document.getElementById('anime-custom-font-style');
    if (oldFontStyle) oldFontStyle.remove();
    // 清除旧的行内样式（兼容旧版本残留）
    document.body.style.fontFamily = '';

    if (!family && !url) {
        // 无自定义字体，移除 CSS 变量
        document.documentElement.style.removeProperty('--anime-custom-font');
        return;
    }

    const style = document.createElement('style');
    style.id = 'anime-custom-font-style';
    let cssText = '';
    let effectiveFamily = family;

    if (url) {
        if (url.endsWith('.css') || url.includes('fonts.googleapis.com')) {
            // Google Fonts 或外部 CSS：@import 加载，使用 family 名称
            cssText += `@import url("${url}");\n`;
        } else {
            // 字体文件：创建 @font-face，自动推断格式
            const fmt = detectFontFormat(url);
            cssText += `
                @font-face {
                    font-family: 'CustomFont';
                    src: url("${url}") format('${fmt}');
                    font-weight: normal;
                    font-style: normal;
                    font-display: swap;
                }
            `.trim() + '\n';
            // 有 URL 字体文件时，优先使用 CustomFont
            effectiveFamily = "'CustomFont'" + (family ? ', ' + family : '');
        }
    }

    if (effectiveFamily) {
        // 通过 CSS 变量注入，被 styles 模块的 !important 规则引用
        cssText += `:root { --anime-custom-font: ${effectiveFamily}; }`;
    }

    style.textContent = cssText;
    document.head.appendChild(style);
}
