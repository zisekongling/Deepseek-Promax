/**
 * Ocean 海洋主题专属样式
 *
 * 蓝色系，深邃海洋氛围：
 *   - 浅色模式：浅海晨光渐变背景
 *   - 深色模式：深海暗流纯色背景
 *
 * 灵感来源：Obsidian Blue Topaz 主题
 */

/**
 * 获取 Ocean 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
export function getOceanThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 浅海晨光渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #F0F4F800;
            --dsw-alias-bg-layer-1: #F0F4F800;
            --dsw-alias-bg-layer-2: #D8E6F0;
            --dsw-alias-bg-layer-3: #C8DCF0;
            --dsw-alias-label-primary: #2A3F5A;
            --dsw-alias-label-secondary: #5A6F8A;
            --dsw-alias-label-tertiary: #8A9FB0;
            --dsw-alias-label-caption: #5A6F8A;
            --dsw-alias-brand-primary: #3A6FB5;
            --dsw-alias-brand-text: #5A8FD5;
            --dsw-alias-border-l1: rgba(42,63,90,0.06);
            --dsw-alias-border-l2: rgba(42,63,90,0.10);
            --dsw-alias-border-l3: rgba(42,63,90,0.14);
            --dsw-alias-markdown-inline-code: #D8E6F0;
            --dsw-alias-markdown-code-block: #F0F4F8;
            --dsw-alias-markdown-code-block-banner: #E0EAF4;
            background-color: #F0F4F8;
            background-image:
                radial-gradient(ellipse 80% 60% at 25% 30%, rgba(160,200,230,0.45) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 70% 25%, rgba(140,190,225,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(170,210,235,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: oceanWaveShift 4s ease-in-out infinite alternate;
        }
        @keyframes oceanWaveShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 75% 65%, 20% 70%, 80% 20%; }
            100% { background-position: 30% 80%, 70% 30%, 15% 60%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #F0F4F8;
            background-image:
                radial-gradient(ellipse 80% 60% at 25% 30%, rgba(160,200,230,0.45) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 70% 25%, rgba(140,190,225,0.35) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(170,210,235,0.4) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: oceanWaveShift 4s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - 深海暗流 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #1A1D2E !important;
            --dsw-alias-bg-base: #1A1D2E;
            --dsw-alias-bg-layer-1: #1A1D2E;
            --dsw-alias-bg-layer-2: #202438;
            --dsw-alias-bg-layer-3: #262B42;
            --dsw-alias-label-primary: hsl(225,6%,88%);
            --dsw-alias-label-secondary: hsl(225,9%,64%);
            --dsw-alias-label-tertiary: hsl(225,12%,48%);
            --dsw-alias-label-caption: hsl(225,9%,56%);
            --dsw-alias-brand-primary: hsl(215,50%,58%);
            --dsw-alias-brand-text: hsl(215,50%,63%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #1A1D2E; }
    `;
}