/**
 * 字体自定义模块
 *
 * 通过 CSS 变量 --anime-custom-font 注入自定义字体，
 * 配合 styles 模块中的 var(--anime-custom-font, fallback) !important 生效。
 * 支持：系统字体名、在线字体文件（woff2/woff/ttf/otf）、Google Fonts CSS 链接。
 *
 * 字体回退链：用户自定义字体 → DeepSeek 原生 Inter → 系统中文字体 → sans-serif
 * 这样既允许用户自定义字体，又不破坏 DeepSeek 原有的英文/数字渲染。
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

/** DeepSeek 原生字体回退链，确保不破坏原有渲染 */
const FALLBACK_FONTS = "'Inter', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";

/**
 * 应用自定义字体：通过 CSS 变量 --anime-custom-font 注入，
 * 被 styles 模块的 !important 规则引用。
 *
 * 字体优先级：
 *   1. 有 URL 字体文件时：CustomFont → 用户指定的 family → Inter → 系统字体
 *   2. 仅填 family 时：用户指定的 family → Inter → 系统字体
 *   3. 都不填时：移除变量，使用 styles 模块的默认回退链
 */
export function applyFont() {
    const family = CONFIG.fontFamily || '';
    const url = CONFIG.fontUrl || '';
    const oldFontStyle = document.getElementById('anime-custom-font-style');
    if (oldFontStyle) oldFontStyle.remove();
    // 清除旧的行内样式（兼容旧版本残留）
    document.body.style.fontFamily = '';

    if (!family && !url) {
        // 无自定义字体，移除 CSS 变量，回退到 styles 模块的默认字体链
        document.documentElement.style.removeProperty('--anime-custom-font');
        return;
    }

    const style = document.createElement('style');
    style.id = 'anime-custom-font-style';
    let cssText = '';
    /** 最终写入 CSS 变量的字体链 */
    let effectiveFamily = '';

    if (url) {
        if (url.endsWith('.css') || url.includes('fonts.googleapis.com')) {
            // Google Fonts 或外部 CSS：@import 加载，使用 family 名称
            cssText += `@import url("${url}");\n`;
            // family 优先，然后回退到 Inter + 系统字体
            effectiveFamily = (family ? family + ', ' : '') + FALLBACK_FONTS;
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
            // 有 URL 字体文件时，CustomFont 优先，然后回退到用户 family → Inter → 系统字体
            effectiveFamily = "'CustomFont'" + (family ? ', ' + family : '') + ', ' + FALLBACK_FONTS;
        }
    } else {
        // 仅填字体名，回退到 Inter + 系统字体
        effectiveFamily = family + ', ' + FALLBACK_FONTS;
    }

    if (effectiveFamily) {
        // 通过 CSS 变量注入，被 styles 模块的 !important 规则引用
        cssText += `:root { --anime-custom-font: ${effectiveFamily}; }`;
    }

    style.textContent = cssText;
    document.head.appendChild(style);
}
