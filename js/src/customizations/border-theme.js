/**
 * Obsidian Border 主题专属样式
 *
 * 仅包含 Border 主题独有的视觉特性：
 *   - 覆盖 DeepSeek 的 --dsw-alias-* CSS 变量系统
 *   - 浅色模式：晨光花园动态渐变背景
 *   - 深色模式：Border 风格纯色背景
 *
 * 通用增强样式（标题竖条、引用块点阵、文字颜色等）已在 styles.js 的
 * getEnhancedThemeCSS() 中统一处理，所有非 original 主题共享。
 *
 * 灵感来源：Obsidian Border 主题
 */

/**
 * 获取 Border 主题的专属 CSS 样式
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
export function getBorderThemeCSS(isDark) {
    return `
        /* ========== 浅色模式 - 晨光花园渐变背景 ========== */
        body:not([data-ds-dark-theme]) {
            --dsw-alias-bg-base: #F9F6F400;
            --dsw-alias-bg-layer-1: #F9F6F400;
            --dsw-alias-bg-layer-2: #F2E0E4;
            --dsw-alias-bg-layer-3: #EBE4F0;
            --dsw-alias-label-primary: #4A4348;
            --dsw-alias-label-secondary: #8B7F88;
            --dsw-alias-label-tertiary: #A9A0A6;
            --dsw-alias-label-caption: #8B7F88;
            --dsw-alias-brand-primary: #793f82;
            --dsw-alias-brand-text: #9B7AA0;
            --dsw-alias-border-l1: rgba(74,67,72,0.06);
            --dsw-alias-border-l2: rgba(74,67,72,0.10);
            --dsw-alias-border-l3: rgba(74,67,72,0.14);
            --dsw-alias-markdown-inline-code: #F2E0E4;
            --dsw-alias-markdown-code-block: #FEFBF5;
            --dsw-alias-markdown-code-block-banner: #F7F0E3;
            background-color: #F9F6F4;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 40%, rgba(235,213,216,0.5) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(220,209,228,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(211,224,223,0.45) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: morningGardenShift 3s ease-in-out infinite alternate;
        }
        @keyframes morningGardenShift {
            0% { background-position: 0% 0%, 100% 0%, 50% 100%; }
            50% { background-position: 80% 60%, 10% 80%, 90% 20%; }
            100% { background-position: 30% 90%, 70% 30%, 10% 60%; }
        }
        html, #root, #root > div { background: inherit !important; }
        body:not([data-ds-dark-theme])::before {
            content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -999;
            background-color: #F9F6F4;
            background-image:
                radial-gradient(ellipse 80% 60% at 20% 40%, rgba(235,213,216,0.5) 0%, transparent 70%),
                radial-gradient(ellipse 70% 80% at 75% 25%, rgba(220,209,228,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 60% 70% at 50% 80%, rgba(211,224,223,0.45) 0%, transparent 70%);
            background-size: 120% 120%;
            animation: morningGardenShift 3s ease-in-out infinite alternate;
            pointer-events: none;
        }

        /* ========== 深色模式 - Border 风格 ========== */
        body[data-ds-dark-theme] {
            background-image: none !important;
            background-size: auto !important;
            animation: none !important;
            background-color: #27282e !important;
            --dsw-alias-bg-base: #27282e;
            --dsw-alias-bg-layer-1: #27282e;
            --dsw-alias-bg-layer-2: #2d2e34;
            --dsw-alias-bg-layer-3: #32333a;
            --dsw-alias-label-primary: hsl(232,6%,88%);
            --dsw-alias-label-secondary: hsl(232,9%,64%);
            --dsw-alias-label-tertiary: hsl(232,12%,48%);
            --dsw-alias-label-caption: hsl(232,9%,56%);
            --dsw-alias-brand-primary: hsl(232,70%,65%);
            --dsw-alias-brand-text: hsl(232,70%,70%);
        }
        body[data-ds-dark-theme]::before { display: none !important; }
        body[data-ds-dark-theme] ._189b4a0,
        body[data-ds-dark-theme] ._6ffc3c9 { background-color: #27282e; }
    `;
}
