/**
 * Sunset 日落主题专属样式
 *
 * 暖橙/金色系，温暖日落氛围：
 *   - 浅色模式：黄昏暖光渐变背景
 *   - 深色模式：暮色余晖纯色背景
 *
 * 灵感来源：Obsidian Golden Topaz 主题
 */

/**
 * 获取 Sunset 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
export function getSunsetThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 黄昏暖光渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #FDF6F000;
            --dsw-alias-bg-layer-1: #FDF6F000;
            --dsw-alias-bg-layer-2: #F5E0C8;
            --dsw-alias-bg-layer-3: #F0D8C0;
            --dsw-alias-label-primary: #5A3A2A;
            --dsw-alias-label-secondary: #8A6A5A;
            --dsw-alias-label-tertiary: #B09A8A;
            --dsw-alias-label-caption: #8A6A5A;
            --dsw-alias-brand-primary: #D4783A;
            --dsw-alias-brand-text: #E8985A;
            --dsw-alias-border-l1: rgba(90,58,42,0.06);
            --dsw-alias-border-l2: rgba(90,58,42,0.10);
            --dsw-alias-border-l3: rgba(90,58,42,0.14);
            --dsw-alias-markdown-inline-code: #F5E0C8;
            --dsw-alias-markdown-code-block: #FDF6F0;
            --dsw-alias-markdown-code-block-banner: #F8ECD8;
            background-color: #FDF6F0;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 30%, rgba(240,180,120,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 20%, rgba(230,160,100,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 85%, rgba(245,200,150,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: sunsetGlowShift 4s ease-in-out infinite alternate;
        }
        @keyframes sunsetGlowShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 70% 60%, 10% 75%, 90% 25%; }
            100% { background-position: 25% 85%, 75% 30%, 10% 55%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #FDF6F0;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 30%, rgba(240,180,120,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 20%, rgba(230,160,100,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 85%, rgba(245,200,150,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: sunsetGlowShift 4s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - 暮色余晖 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #1E1A18 !important;
            --dsw-alias-bg-base: #1E1A18;
            --dsw-alias-bg-layer-1: #1E1A18;
            --dsw-alias-bg-layer-2: #24201E;
            --dsw-alias-bg-layer-3: #2A2624;
            --dsw-alias-label-primary: hsl(25,6%,88%);
            --dsw-alias-label-secondary: hsl(25,9%,64%);
            --dsw-alias-label-tertiary: hsl(25,12%,48%);
            --dsw-alias-label-caption: hsl(25,9%,56%);
            --dsw-alias-brand-primary: hsl(25,55%,55%);
            --dsw-alias-brand-text: hsl(25,55%,60%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #1E1A18; }
    `;
}