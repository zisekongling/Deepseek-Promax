/**
 * Cherry 樱花主题专属样式
 *
 * 粉色系，浪漫樱花氛围：
 *   - 浅色模式：樱花飞舞渐变背景
 *   - 深色模式：夜樱暗香纯色背景
 *
 * 灵感来源：Obsidian Rosé Pine 主题
 */

/**
 * 获取 Cherry 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
export function getCherryThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 樱花飞舞渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #FFF5F600;
            --dsw-alias-bg-layer-1: #FFF5F600;
            --dsw-alias-bg-layer-2: #F8D8E0;
            --dsw-alias-bg-layer-3: #F0C8D8;
            --dsw-alias-label-primary: #4A2A3A;
            --dsw-alias-label-secondary: #7A5A6A;
            --dsw-alias-label-tertiary: #AA8A9A;
            --dsw-alias-label-caption: #7A5A6A;
            --dsw-alias-brand-primary: #D4687C;
            --dsw-alias-brand-text: #E8889C;
            --dsw-alias-border-l1: rgba(74,42,58,0.06);
            --dsw-alias-border-l2: rgba(74,42,58,0.10);
            --dsw-alias-border-l3: rgba(74,42,58,0.14);
            --dsw-alias-markdown-inline-code: #F8D8E0;
            --dsw-alias-markdown-code-block: #FFF5F6;
            --dsw-alias-markdown-code-block-banner: #FBE8EC;
            background-color: #FFF5F6;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 35%, rgba(240,180,195,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(230,160,180,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(245,200,210,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: cherryPetalShift 4s ease-in-out infinite alternate;
        }
        @keyframes cherryPetalShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 70% 65%, 15% 75%, 85% 20%; }
            100% { background-position: 25% 85%, 75% 30%, 10% 55%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #FFF5F6;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 35%, rgba(240,180,195,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(230,160,180,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(245,200,210,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: cherryPetalShift 4s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - 夜樱暗香 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #1E1820 !important;
            --dsw-alias-bg-base: #1E1820;
            --dsw-alias-bg-layer-1: #1E1820;
            --dsw-alias-bg-layer-2: #241E26;
            --dsw-alias-bg-layer-3: #2A242E;
            --dsw-alias-label-primary: hsl(330,6%,88%);
            --dsw-alias-label-secondary: hsl(330,9%,64%);
            --dsw-alias-label-tertiary: hsl(330,12%,48%);
            --dsw-alias-label-caption: hsl(330,9%,56%);
            --dsw-alias-brand-primary: hsl(340,45%,58%);
            --dsw-alias-brand-text: hsl(340,45%,63%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #1E1820; }
    `;
}