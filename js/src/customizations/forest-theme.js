/**
 * Forest 森林主题专属样式
 *
 * 深绿色系，自然森林氛围：
 *   - 浅色模式：林间晨光渐变背景
 *   - 深色模式：暗夜森林纯色背景
 *
 * 灵感来源：Obsidian Everforest 主题
 */

/**
 * 获取 Forest 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
export function getForestThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 林间晨光渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #F5F2EB00;
            --dsw-alias-bg-layer-1: #F5F2EB00;
            --dsw-alias-bg-layer-2: #E5DFC5;
            --dsw-alias-bg-layer-3: #D8DCC4;
            --dsw-alias-label-primary: #3A4A3F;
            --dsw-alias-label-secondary: #6B7B6F;
            --dsw-alias-label-tertiary: #8FA090;
            --dsw-alias-label-caption: #6B7B6F;
            --dsw-alias-brand-primary: #4A7C59;
            --dsw-alias-brand-text: #6B9B7A;
            --dsw-alias-border-l1: rgba(58,74,63,0.06);
            --dsw-alias-border-l2: rgba(58,74,63,0.10);
            --dsw-alias-border-l3: rgba(58,74,63,0.14);
            --dsw-alias-markdown-inline-code: #E5DFC5;
            --dsw-alias-markdown-code-block: #F5F2EB;
            --dsw-alias-markdown-code-block-banner: #EBE7D8;
            background-color: #F5F2EB;
            background-image:
                radial-gradient(ellipse 80% 60% at 15% 35%, rgba(163,190,140,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 80% 20%, rgba(143,170,120,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 85%, rgba(180,200,160,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: forestMistShift 4s ease-in-out infinite alternate;
        }
        @keyframes forestMistShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 70% 70%, 15% 75%, 85% 15%; }
            100% { background-position: 25% 85%, 75% 35%, 10% 55%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #F5F2EB;
            background-image:
                radial-gradient(ellipse 80% 60% at 15% 35%, rgba(163,190,140,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 80% 20%, rgba(143,170,120,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 85%, rgba(180,200,160,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: forestMistShift 4s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - 暗夜森林 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #1E2320 !important;
            --dsw-alias-bg-base: #1E2320;
            --dsw-alias-bg-layer-1: #1E2320;
            --dsw-alias-bg-layer-2: #242A26;
            --dsw-alias-bg-layer-3: #2A312C;
            --dsw-alias-label-primary: hsl(140,6%,88%);
            --dsw-alias-label-secondary: hsl(140,9%,64%);
            --dsw-alias-label-tertiary: hsl(140,12%,48%);
            --dsw-alias-label-caption: hsl(140,9%,56%);
            --dsw-alias-brand-primary: hsl(140,40%,55%);
            --dsw-alias-brand-text: hsl(140,40%,60%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #1E2320; }
    `;
}