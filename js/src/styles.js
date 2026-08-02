/**
 * 样式注入模块
 *
 * 管理主题 CSS、窄边距 CSS、Mermaid CSS 的注入与缓存。
 * 当主题、暗色模式、图片渲染开关或窄边距开关变化时，重新注入对应样式。
 */
import { CONFIG } from './config.js';
import { utils } from './utils.js';
import { getThemeColors } from './themes.js';
import { getBorderThemeCSS } from './customizations/border-theme.js';

/**
 * 通用主题增强样式（标题竖条、引用块点阵、文字颜色、侧边栏透明化等）
 * 使用 --anime-* CSS 变量，自动适配每个主题的配色方案
 * @param {boolean} isDark - 是否为深色模式
 * @returns {string} CSS 文本
 */
function getEnhancedThemeCSS(isDark) {
    const dotColor = isDark ? '%23ffffff' : '%23000000';
    const dotOpacity = isDark ? '0.10' : '0.08';
    return `
        /* ========== 消息宽度优化 ========== */
        :root { --message-list-max-width: 75%; }
        .ds-markdown table { width: max-content; max-width: 70%; }

        /* ========== 标题左侧彩色竖条 ========== */
        .ds-markdown h1, .ds-markdown h2, .ds-markdown h3,
        .ds-markdown h4, .ds-markdown h5, .ds-markdown h6 {
            border-left: none !important;
            padding-left: 16px !important;
            position: relative;
        }
        .ds-markdown h1::before, .ds-markdown h2::before, .ds-markdown h3::before,
        .ds-markdown h4::before, .ds-markdown h5::before, .ds-markdown h6::before {
            content: ""; position: absolute; left: 0; top: 4px; bottom: 4px;
            width: 4px; border-radius: 4px;
        }
        .ds-markdown h1::before { background: var(--anime-primary); }
        .ds-markdown h2::before { background: var(--anime-accent); }
        .ds-markdown h3::before { background: var(--anime-link-color); }
        .ds-markdown h4::before { background: var(--anime-primary); opacity: 0.65; }
        .ds-markdown h5::before { background: var(--anime-accent); opacity: 0.65; }
        .ds-markdown h6::before { background: var(--anime-link-color); opacity: 0.65; }

        /* ========== 引用块点阵图案 + 左侧竖条 ========== */
        .ds-markdown blockquote {
            border-left: none !important;
            border-radius: 6px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='${dotColor}' fill-opacity='${dotOpacity}' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
            position: relative;
        }
        .ds-markdown blockquote blockquote { background-image: none !important; }
        .ds-markdown blockquote::before {
            content: ""; position: absolute; left: 0; top: 8px; bottom: 8px;
            width: 4px; border-radius: 4px;
            background: var(--anime-primary);
        }

        /* ========== 文字颜色增强 ========== */
        .ds-markdown strong { color: var(--anime-primary) !important; }
        .ds-markdown em { color: var(--anime-accent) !important; }
        .ds-markdown code:not(pre code):not(.md-code-block code) { color: var(--anime-link-color) !important; }

        /* ========== 数学公式颜色 ========== */
        .ds-markdown-math, .katex, .katex *,
        .math-inline, .math-block { color: var(--anime-link-color) !important; }

        /* ========== 侧边栏/头部透明化（排除思考面板容器 _5ab5d64 / _245c867） ========== */
        .b8812f16, ._519be07, ._233f913,
        .f8d1e4c0, .the-header, .f3d18f6a, ._74c0879,
        ._1d72f01 {
            background-color: transparent !important;
            background: transparent !important;
        }
    `;
}

// 样式缓存状态
let currentThemeName = null;
let currentDarkMode = null;
let currentNarrowState = null;
let currentImageRenderState = null;

/**
 * 确保三个 <style> 元素存在（主题、窄边距、Mermaid）
 * @returns {{themeStyle:HTMLStyleElement, narrowStyle:HTMLStyleElement, mermaidStyle:HTMLStyleElement}}
 */
function ensureStyleElements() {
    let themeStyle = document.getElementById('anime-theme-style');
    if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = 'anime-theme-style';
        document.head.appendChild(themeStyle);
    }
    let narrowStyle = document.getElementById('anime-narrow-style');
    if (!narrowStyle) {
        narrowStyle = document.createElement('style');
        narrowStyle.id = 'anime-narrow-style';
        document.head.appendChild(narrowStyle);
    }
    let mermaidStyle = document.getElementById('anime-mermaid-style');
    if (!mermaidStyle) {
        mermaidStyle = document.createElement('style');
        mermaidStyle.id = 'anime-mermaid-style';
        document.head.appendChild(mermaidStyle);
    }
    return { themeStyle, narrowStyle, mermaidStyle };
}

/**
 * 注入所有样式：主题 CSS + 窄边距 CSS + Mermaid CSS
 * 使用缓存避免重复注入，仅在配置变化时更新。
 */
export function injectStyles() {
    const { themeStyle, narrowStyle, mermaidStyle } = ensureStyleElements();
    const themeName = CONFIG.themeColor || 'border';
    const narrowOn = CONFIG.narrowPaddingEnabled;
    const isDark = utils.isDarkMode();
    const imgRender = CONFIG.imageRenderEnabled;

    // 主题、暗色模式或图片渲染开关变化时重新注入主题样式
    if (themeName !== currentThemeName || isDark !== currentDarkMode || imgRender !== currentImageRenderState) {
        currentThemeName = themeName;
        currentDarkMode = isDark;
        currentImageRenderState = imgRender;
        const t = getThemeColors(themeName);
        if (!t) {
            themeStyle.textContent = '';
        } else {
            themeStyle.textContent = `
                :root {
                    --anime-primary: ${t.primary}; --anime-primary-hover: ${t.primaryHover};
                    --anime-accent: ${t.accent}; --anime-glow: ${t.glow};
                    --anime-radius: 14px; --anime-radius-lg: 20px;
                    --deep-think-active: ${t.deepThinkActive}; --button-bg: ${t.buttonBg};
                    --button-hover: ${t.buttonHover}; --main-border-glow: ${t.mainBorderGlow};
                    --anime-msg-bubble-bg: ${t.msgBubbleBg}; --anime-msg-bubble-border: ${t.msgBubbleBorder};
                    --anime-code-bg: ${t.codeBg}; --anime-link-color: ${t.linkColor};
                    --anime-think-bg: ${t.thinkBg}; --anime-card-bg: ${t.cardBg};
                }
                body, div, p, span, input, textarea, button, select {
                    font-family: var(--anime-custom-font, 'PingFang SC','Hiragino Sans GB','Noto Sans SC','Microsoft YaHei',sans-serif) !important;
                }
                ::selection { background: ${t.primary} !important; color: #fff !important; }
                ::-webkit-scrollbar { width: 7px !important; }
                ::-webkit-scrollbar-track { background: ${isDark ? '#1e1625' : '#fff0f4'} !important; }
                ::-webkit-scrollbar-thumb { background: ${isDark ? '#5a3a50' : '#f8c5d0'} !important; border-radius: 10px !important; }
                ::-webkit-scrollbar-thumb:hover { background: ${t.primary} !important; }
                ._24fad49, ._24fad49 .ds-scroll-area__gutters,
                [class*="sidebar"] [class*="scroll-area"] { border: none !important; outline: none !important; box-shadow: none !important; }
                ._77cefa5._3d616d3, div._77cefa5._3d616d3,
                [class*="chat-container"], main[class*="main"] {
                    border: 2px solid ${t.primary} !important;
                    border-radius: var(--anime-radius-lg) !important;
                    box-shadow: 0 0 20px ${t.mainBorderGlow}, 0 4px 16px rgba(0,0,0,0.1) !important;
                    background: var(--anime-card-bg) !important;
                }
                textarea._27c9245, textarea,
                [class*="input-area"] textarea, [contenteditable="true"] {
                    border: none !important; box-shadow: none !important; outline: none !important;
                    caret-color: ${t.primary} !important;
                    border-radius: var(--anime-radius) !important;
                    background: var(--anime-card-bg) !important; color: ${t.textPrimary} !important;
                }
                textarea:focus, [contenteditable="true"]:focus { border: none !important; box-shadow: none !important; outline: none !important; }
                .ds-message {
                    background: var(--anime-msg-bubble-bg) !important;
                    border: 1px solid var(--anime-msg-bubble-border) !important;
                    border-radius: var(--anime-radius) !important;
                    padding: 6px 12px !important; margin-bottom: 4px !important;
                }
                .md-code-block, .md-code-block-banner, .md-code-block-banner-wrap,
                .md-code-block pre, .ds-markdown pre, ._121d384, .d2a24f03, .efa13877, .md-code-block * {
                    background: var(--anime-code-bg) !important;
                    border-radius: var(--anime-radius) !important;
                }
                .md-code-block { border: 1px solid ${t.border} !important; }
                .ds-markdown code, .md-code-block code { background: var(--anime-code-bg) !important; color: ${t.textPrimary} !important; }
                .ds-markdown a { color: var(--anime-link-color) !important; text-decoration: none !important; }
                .ds-markdown a:hover { text-decoration: underline !important; color: ${t.primaryHover} !important; }
                button[class*="primary"], button[class*="blue"],
                [class*="btn-primary"], [class*="button-primary"] {
                    background: linear-gradient(135deg, ${t.primary}, ${t.accent}) !important;
                    border-color: ${t.primary} !important; color: #fff !important;
                }
                button[class*="primary"]:hover, button[class*="blue"]:hover { background: ${t.buttonHover} !important; }
                .ds-button--primary { background: ${t.buttonBg} !important; border-color: ${t.primary} !important; color: #fff !important; }
                .ds-button--primary:hover { background: ${t.buttonHover} !important; box-shadow: 0 4px 15px ${t.glow} !important; }
                .ds-button--disabled.ds-button--primary { background: ${t.buttonBg} !important; opacity: 0.5; }
                .ds-button--primary svg, .ds-button--primary .ds-icon svg { color: #fff !important; fill: #fff !important; }
                .f79352dc.ds-toggle-button--selected, .f79352dc[aria-pressed="true"], .ds-toggle-button--selected {
                    background: ${t.deepThinkActive} !important; border-color: ${t.deepThinkActive} !important;
                    color: #fff !important; box-shadow: 0 0 12px ${t.glow} !important; transform: scale(1.02) !important;
                }
                .f79352dc.ds-toggle-button--selected svg, .f79352dc[aria-pressed="true"] svg { color: #fff !important; fill: #fff !important; }
                ._245c867._34a54ec {
                    background: var(--anime-think-bg) !important;
                    border: 1px solid ${t.thinkPanelBorder} !important;
                    border-radius: 12px !important; padding: 10px 14px !important; margin-bottom: 6px !important;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important;
                }
                ._245c867._34a54ec:hover { border-color: ${t.primary} !important; box-shadow: 0 2px 10px ${t.glow} !important; }
                ._5ab5d64 ._5255ff8 { color: ${t.thinkTitleColor} !important; font-weight: 600 !important; }
                ._245c867 .ds-icon { color: ${t.thinkTitleColor} !important; }
                ${imgRender ? `
                .anime-rendered-image {
                    max-width: 100%; border-radius: 12px;
                    margin-top: 8px; display: block; border: 1px solid ${t.border};
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: all 0.3s ease;
                }
                .anime-rendered-image:hover { border-color: ${t.primary}; box-shadow: 0 4px 12px ${t.glow}; }
                .anime-image-link { display: inline-block; text-decoration: none !important; }
                ` : ''}
                del { text-decoration: line-through; opacity: 0.7; }
                .anime-mermaid-container {
                    background: ${isDark ? '#1a1a2e' : '#f9f9fb'};
                    padding: 12px;
                    border-radius: 12px;
                    margin: 8px 0;
                    border: 1px solid ${t.border};
                    overflow-x: auto;
                    position: relative;
                }
                .anime-mermaid-container svg {
                    max-width: 100%;
                    height: auto;
                }
                .anime-mermaid-container .mermaid-chart {
                    display: block;
                }
                .anime-mermaid-container .anime-mermaid-source {
                    display: none;
                    margin-top: 8px;
                }
                .anime-mermaid-toggle {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    z-index: 10;
                    background: rgba(0,0,0,0.5);
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    padding: 4px 10px;
                    cursor: pointer;
                    font-size: 12px;
                    backdrop-filter: blur(4px);
                }
                .anime-mermaid-toggle:hover {
                    background: rgba(0,0,0,0.7);
                }
            `;
            // 所有非 original 主题应用通用增强样式（标题竖条、引用块点阵、文字颜色等）
            if (themeName !== 'original') {
                themeStyle.textContent += getEnhancedThemeCSS(isDark);
            }
            // Border 主题额外追加专属 CSS（渐变背景、--dsw-alias-* 变量覆盖）
            if (themeName === 'border') {
                themeStyle.textContent += getBorderThemeCSS(isDark);
            }
        }
    }

    if (narrowOn !== currentNarrowState) {
        currentNarrowState = narrowOn;
        narrowStyle.textContent = narrowOn ? `
            ._6f2c522, [class*="virtual-list-items"] {
                padding-left: 16px !important; padding-right: 16px !important;
            }
            ._871cbca .aaff8b8f { padding-left: 16px !important; padding-right: 16px !important; }
            ._871cbca .aaff8b8f ._77cefa5,
            ._871cbca .aaff8b8f ._020ab5b,
            ._871cbca .aaff8b8f ._24fad49 {
                padding-left: 0 !important; padding-right: 0 !important;
            }
        ` : '';
    }

    mermaidStyle.textContent = ``;
}

/**
 * 重置样式缓存（暗色模式切换时调用，强制下次 injectStyles 重新注入）
 */
export function resetStyleCache() {
    currentDarkMode = null;
}
