/**
 * Lavender 薰衣草主题专属样式
 *
 * 紫色系，温柔薰衣草氛围：
 *   - 浅色模式：薰衣草田渐变背景
 *   - 深色模式：暗夜紫罗兰纯色背景
 *
 * 灵感来源：Obsidian Purple Owl 主题
 */

/**
 * 获取 Lavender 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
export function getLavenderThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 薰衣草田渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #F8F4FA00;
            --dsw-alias-bg-layer-1: #F8F4FA00;
            --dsw-alias-bg-layer-2: #E8DCF0;
            --dsw-alias-bg-layer-3: #DCC8E8;
            --dsw-alias-label-primary: #3A2A4A;
            --dsw-alias-label-secondary: #6A5A7A;
            --dsw-alias-label-tertiary: #9A8AAA;
            --dsw-alias-label-caption: #6A5A7A;
            --dsw-alias-brand-primary: #7B5EA7;
            --dsw-alias-brand-text: #9B7EC7;
            --dsw-alias-border-l1: rgba(58,42,74,0.06);
            --dsw-alias-border-l2: rgba(58,42,74,0.10);
            --dsw-alias-border-l3: rgba(58,42,74,0.14);
            --dsw-alias-markdown-inline-code: #E8DCF0;
            --dsw-alias-markdown-code-block: #F8F4FA;
            --dsw-alias-markdown-code-block-banner: #EEE4F4;
            background-color: #F8F4FA;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 35%, rgba(180,150,210,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(160,130,200,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(190,160,220,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: lavenderBreezeShift 4s ease-in-out infinite alternate;
        }
        @keyframes lavenderBreezeShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 75% 65%, 15% 80%, 85% 20%; }
            100% { background-position: 30% 85%, 70% 30%, 10% 55%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #F8F4FA;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 35%, rgba(180,150,210,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(160,130,200,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(190,160,220,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: lavenderBreezeShift 4s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - 暗夜紫罗兰 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #1E1A2A !important;
            --dsw-alias-bg-base: #1E1A2A;
            --dsw-alias-bg-layer-1: #1E1A2A;
            --dsw-alias-bg-layer-2: #242034;
            --dsw-alias-bg-layer-3: #2A263E;
            --dsw-alias-label-primary: hsl(260,6%,88%);
            --dsw-alias-label-secondary: hsl(260,9%,64%);
            --dsw-alias-label-tertiary: hsl(260,12%,48%);
            --dsw-alias-label-caption: hsl(260,9%,56%);
            --dsw-alias-brand-primary: hsl(265,40%,58%);
            --dsw-alias-brand-text: hsl(265,40%,63%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #1E1A2A; }
    `;
}