/**
 * 设置面板模块（v4.0.0 现代化重构）
 *
 * 分类标签页：
 *   🎨 外观  — 主题、樱花、窄边距、字体、背景
 *   ✨ 功能  — 图片、删除线、角标、Mermaid、防撤回、自动重试、代码复制、文件夹、默认模式
 *   🧹 清理  — 移除转发、移除下载、占位符修改
 *   🔒 隐私  — 标题伪装、自动跳转、敏感词替换
 *   💬 预设  — 消息预设管理
 *   📤 导出  — JSON/MD/PNG 导出、系统提示词注入
 *   👻 自动化 — 循环引擎、路线图、队列、交接报告
 *
 * 设计特性：响应式适配手机/平板/桌面，统一视觉体系，CSS 变量驱动主题。
 */
import { CONFIG, DEFAULTS, OPTION_CONFIG_KEYS, saveConfig } from '../config.js';
import { utils } from '../utils.js';
import { THEMES, getThemeColors } from '../themes.js';
import { doExport, doImageExport } from '../features/export.js';
import { clearPrivacyCache } from '../features/privacy-shield.js';
import { restoreFloatingWrappers } from './menu-inject.js';

let settingsModal = null;

/** 各功能开关的帮助描述文本（全部补全，无缺失） */
const optionDescriptions = {
    sakura: '在页面中飘落樱花动画，营造浪漫氛围',
    image: '自动将 Markdown 图片链接和纯图片 URL 渲染为可点击预览的图片',
    strikethrough: '将 ~~text~~ 转换为删除线样式（代码块内不生效）',
    redirect: '仅当访问 www.deepseek.com 或 deepseek.com 时跳转到 chat.deepseek.com',
    title: '随机更换浏览器标签页标题，防止他人通过标题窥探浏览内容',
    narrow: '压缩聊天内容的左右内边距，使布局更紧凑、信息密度更高',
    citation: '移除回复中的 [citation:数字] 标记和来源引用图标',
    antiRecall: '拦截并缓存被撤回的回复，防止对话内容意外消失',
    mermaid: '渲染 Mermaid 代码块为图表（流程图、时序图、甘特图等）',
    autoRetry: '当出现重试按钮时自动点击，最多重试 10 次，避免手动操作',
    defaultMode: '新对话开始时自动切换到指定模式（快速/专家/识图）',
    removeForward: '移除消息上的转发/分享按钮，保持界面简洁',
    removeDownloadApp: '移除页面中的下载应用入口和下拉菜单中的下载选项',
    placeholderText: '修改输入框的占位符提示文字内容（修改文字而非颜色）',
    promptInject: '在每次发送消息时自动注入系统提示词（DeepSeek 不会显示但会遵循）',
    privacyShield: '将页面中消息容器内的敏感词替换为指定文本，保护隐私信息',
    caseSensitive: '敏感词替换时是否区分大小写（关闭则不区分大小写匹配）',
    copyCode: '点击 Markdown 行内代码时自动复制到剪贴板，方便快捷引用',
    folderPanel: '在 DeepSeek 侧边栏嵌入文件夹管理面板，支持两层层级结构和会话收藏',
    loopEngine: '启用循环引擎，AI 回复以信号标记结尾时自动继续对话，实现无人值守循环',
    loopNotify: '循环引擎每次执行时发送浏览器桌面通知，实时掌握进度',
    loopCrashRecovery: '循环引擎崩溃后自动恢复执行，3 分钟无活动自动暂停',
    loopDrift: '漂移防护：达到轮次上限时软暂停，可选延长或重新锚定到原始任务',
    loopUnattended: '无人值守模式：允许后台标签页运行，使用 Web Worker 防止节流',
    personaPerTask: '每步注入人格：每条循环命令都附带人格指令（而非仅首轮）',
    workflowAutoAdvance: '工作流自动推进：AI 完成一阶段后自动发送下一阶段指令',
    workflowPauseBetween: '步间暂停：每个工作流阶段完成后暂停，等待用户手动继续'
};

// ============================================================
// 帮助弹出框（支持手机端触摸）
// ============================================================

/**
 * 显示帮助弹出框
 * @param {string} text - 帮助文本
 * @param {HTMLElement} anchorEl - 触发元素（用于定位）
 */
function showHelpPopup(text, anchorEl) {
    hideHelpPopup();

    const popup = document.createElement('div');
    popup.id = 'ds-help-popup';
    popup.textContent = text;
    popup.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 13px;
        max-width: 280px;
        z-index: 9999999;
        pointer-events: none;
        line-height: 1.6;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        animation: dsFadeIn 0.15s ease;
    `;

    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;

    document.body.appendChild(popup);

    const popupRect = popup.getBoundingClientRect();
    if (left + popupRect.width > window.innerWidth - 8) {
        left = window.innerWidth - popupRect.width - 8;
    }
    if (top + popupRect.height > window.innerHeight - 8) {
        top = rect.top - popupRect.height - 6;
    }

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
}

/**
 * 隐藏帮助弹出框
 */
function hideHelpPopup() {
    const existing = document.getElementById('ds-help-popup');
    if (existing) existing.remove();
}

// ============================================================
// 预设列表
// ============================================================

/**
 * 构建预设列表 HTML
 * @returns {string} 预设列表的 HTML 字符串
 */
function buildPresetList() {
    const presets = CONFIG.presets || [];
    if (presets.length === 0) return '<div class="ds-empty-hint">暂无预设，添加一个吧</div>';
    return presets.map((p, idx) => `
        <div class="ds-preset-item" data-index="${idx}">
            <div class="ds-preset-info">
                <span class="ds-preset-name">${p.name || '未命名'}</span>
                <span class="ds-preset-prompt">${p.prompt || ''}</span>
            </div>
            <button class="ds-preset-delete" data-index="${idx}">✕</button>
        </div>
    `).join('');
}

/**
 * 预设删除事件处理
 * @param {Event} e - 点击事件
 */
function deleteHandler(e) {
    const idx = parseInt(this.dataset.index);
    CONFIG.presets.splice(idx, 1);
    const container = document.getElementById('preset-list-container');
    if (container) {
        container.innerHTML = buildPresetList();
        container.querySelectorAll('.ds-preset-delete').forEach(btn => {
            btn.addEventListener('click', deleteHandler);
        });
    }
}

// ============================================================
// CSS 样式（现代化 + 响应式）
// ============================================================

/**
 * 生成设置面板的完整 CSS 样式文本
 * @param {boolean} isDark - 是否深色模式
 * @param {Object} t - 主题配色对象
 * @returns {string} CSS 文本
 */
function buildStylesCSS(isDark, t) {
    return `
    @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

    #ds-settings-modal {
        --ds-primary: ${t.primary};
        --ds-accent: ${t.accent};
        --ds-panel-bg: ${isDark ? '#1e1e2e' : '#ffffff'};
        --ds-panel-text: ${isDark ? '#cdd6f4' : '#1a1a2e'};
        --ds-panel-border: ${isDark ? '#313244' : '#e8e8ef'};
        --ds-card-bg: ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)'};
        --ds-input-bg: ${isDark ? '#313244' : '#f5f5f7'};
        --ds-input-border: ${isDark ? '#45475a' : '#d8d8e0'};
        --ds-section-color: ${isDark ? '#7f849c' : '#888'};
        --ds-hover-bg: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};
        --ds-radius: 14px;
        --ds-radius-sm: 10px;
        --ds-radius-xs: 8px;
        --ds-shadow: 0 24px 80px rgba(0,0,0,0.4);
        --ds-transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    #ds-settings-modal .ds-panel {
        animation: dsSlideUp 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* 开关组件 */
    #ds-settings-modal .ds-toggle {
        position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0;
    }
    #ds-settings-modal .ds-toggle input { opacity: 0; width: 0; height: 0; }
    #ds-settings-modal .ds-slider {
        position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--ds-input-border); transition: var(--ds-transition);
        border-radius: 24px;
    }
    #ds-settings-modal .ds-slider:before {
        position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px;
        background: white; transition: var(--ds-transition); border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    #ds-settings-modal .ds-toggle input:checked + .ds-slider { background: var(--ds-primary); }
    #ds-settings-modal .ds-toggle input:checked + .ds-slider:before { transform: translateX(18px); }

    /* 设置行 */
    #ds-settings-modal .ds-row {
        display: flex; align-items: center; gap: 8px;
        padding: 9px 12px; border-radius: var(--ds-radius-xs);
        transition: background var(--ds-transition);
    }
    #ds-settings-modal .ds-row:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-label { flex: 1; font-size: 14px; cursor: pointer; user-select: none; }

    /* 帮助图标 */
    #ds-settings-modal .ds-help {
        display: inline-flex; align-items: center; justify-content: center;
        width: 20px; height: 20px; border-radius: 50%;
        background: var(--ds-card-bg); color: var(--ds-section-color);
        font-size: 11px; font-weight: 700; cursor: pointer;
        transition: var(--ds-transition); flex-shrink: 0; user-select: none;
    }
    #ds-settings-modal .ds-help:hover { background: var(--ds-primary); color: #fff; }

    /* 标签栏 */
    #ds-settings-modal .ds-tabs {
        display: flex; gap: 2px; margin-bottom: 16px;
        overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none;
        border-bottom: 2px solid var(--ds-panel-border);
    }
    #ds-settings-modal .ds-tabs::-webkit-scrollbar { display: none; }
    #ds-settings-modal .ds-tab {
        padding: 10px 16px; cursor: pointer; font-size: 14px; font-weight: 500;
        border-bottom: 2px solid transparent; margin-bottom: -2px;
        transition: var(--ds-transition); border-radius: var(--ds-radius-xs) var(--ds-radius-xs) 0 0;
        white-space: nowrap; opacity: 0.55;
    }
    #ds-settings-modal .ds-tab:hover { opacity: 0.85; background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-tab.active {
        opacity: 1; border-bottom-color: var(--ds-primary); color: var(--ds-primary);
    }

    /* 标签内容 */
    #ds-settings-modal .ds-tab-content { display: none; }
    #ds-settings-modal .ds-tab-content.active { display: block; animation: dsFadeIn 0.2s ease; }

    /* 分区标题 */
    #ds-settings-modal .ds-section {
        font-weight: 600; font-size: 13px; margin: 16px 0 8px;
        color: var(--ds-section-color); text-transform: uppercase; letter-spacing: 0.5px;
    }
    #ds-settings-modal .ds-section:first-child { margin-top: 0; }

    /* 信息卡片 */
    #ds-settings-modal .ds-info-card {
        margin-top: 12px; padding: 12px 14px; border-radius: var(--ds-radius-sm);
        background: var(--ds-card-bg); font-size: 12px; line-height: 1.7;
        color: var(--ds-section-color); border: 1px solid var(--ds-panel-border);
    }
    #ds-settings-modal .ds-info-card b { color: var(--ds-panel-text); }
    #ds-settings-modal .ds-info-card code {
        background: var(--ds-card-bg); padding: 2px 6px; border-radius: 4px;
        font-size: 11px; border: 1px solid var(--ds-panel-border);
    }

    /* 预设列表 */
    #ds-settings-modal .ds-preset-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; border-radius: var(--ds-radius-xs);
        background: var(--ds-card-bg); margin-bottom: 4px;
        transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-preset-item:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-preset-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
    #ds-settings-modal .ds-preset-name { font-weight: 600; font-size: 14px; }
    #ds-settings-modal .ds-preset-prompt { font-size: 12px; color: var(--ds-section-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ds-settings-modal .ds-preset-delete {
        background: none; border: none; color: #e74c3c; cursor: pointer;
        font-size: 16px; padding: 4px 8px; border-radius: 6px; transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-preset-delete:hover { background: rgba(231,76,60,0.15); }
    #ds-settings-modal .ds-empty-hint { color: var(--ds-section-color); font-size: 13px; padding: 12px; text-align: center; }

    /* 输入框组 */
    #ds-settings-modal .ds-add-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    #ds-settings-modal .ds-add-row input { flex: 1; min-width: 80px; }

    /* 通用输入框 */
    #ds-settings-modal .ds-input {
        padding: 8px 12px; border-radius: var(--ds-radius-xs);
        border: 1px solid var(--ds-input-border); background: var(--ds-input-bg);
        width: 100%; font-size: 14px; box-sizing: border-box;
        color: var(--ds-panel-text); transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-input:focus {
        outline: none; border-color: var(--ds-primary);
        box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
    }
    #ds-settings-modal .ds-input-row {
        display: flex; gap: 8px; align-items: center;
        margin-bottom: 8px; flex-wrap: wrap;
    }
    #ds-settings-modal .ds-input-row label { font-size: 13px; min-width: 90px; flex-shrink: 0; }
    #ds-settings-modal textarea.ds-input { resize: vertical; line-height: 1.6; }

    /* 按钮 */
    #ds-settings-modal .ds-btn {
        padding: 9px 16px; border: none; border-radius: var(--ds-radius-sm);
        font-weight: 600; font-size: 13px; cursor: pointer;
        transition: var(--ds-transition); display: inline-flex;
        align-items: center; justify-content: center; gap: 4px;
    }
    #ds-settings-modal .ds-btn-primary { background: var(--ds-primary); color: #fff; }
    #ds-settings-modal .ds-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
    #ds-settings-modal .ds-btn-accent { background: var(--ds-accent); color: #fff; }
    #ds-settings-modal .ds-btn-accent:hover { opacity: 0.88; transform: translateY(-1px); }
    #ds-settings-modal .ds-btn-outline {
        background: transparent; border: 1px solid var(--ds-panel-border);
        color: var(--ds-panel-text);
    }
    #ds-settings-modal .ds-btn-outline:hover { background: var(--ds-hover-bg); }
    #ds-settings-modal .ds-btn-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    #ds-settings-modal .ds-btn-row .ds-btn { flex: 1; min-width: 100px; }

    /* 敏感词标签 */
    #ds-settings-modal .ds-tag {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 12px; margin: 3px 0; border-radius: var(--ds-radius-xs);
        background: var(--ds-card-bg); font-size: 13px;
        border: 1px solid var(--ds-panel-border);
    }
    #ds-settings-modal .ds-tag-remove {
        background: rgba(239,68,68,0.12); border: none; border-radius: 6px;
        padding: 2px 10px; cursor: pointer; color: #ef4444; font-size: 12px;
        transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-tag-remove:hover { background: rgba(239,68,68,0.25); }

    /* 主题选择器 */
    #ds-settings-modal .ds-theme-dot {
        display: inline-block; width: 32px; height: 32px; border-radius: 50%;
        cursor: pointer; border: 3px solid transparent;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin: 4px;
        transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-theme-dot:hover { transform: scale(1.1); }
    #ds-settings-modal .ds-theme-label {
        display: inline-block; padding: 4px 14px; border-radius: 20px;
        background: var(--ds-input-bg); color: var(--ds-panel-text);
        font-size: 13px; cursor: pointer; border: 3px solid transparent;
        margin: 4px; transition: var(--ds-transition);
    }
    #ds-settings-modal .ds-theme-label:hover { transform: scale(1.05); }

    /* 滑块 */
    #ds-settings-modal input[type="range"] {
        -webkit-appearance: none; appearance: none; height: 6px;
        border-radius: 3px; background: var(--ds-input-border); outline: none;
    }
    #ds-settings-modal input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 18px; height: 18px;
        border-radius: 50%; background: var(--ds-primary); cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    #ds-settings-modal input[type="range"]::-moz-range-thumb {
        width: 18px; height: 18px; border-radius: 50%; border: none;
        background: var(--ds-primary); cursor: pointer;
    }

    /* ====== 响应式：平板 ====== */
    @media (max-width: 768px) {
        #ds-settings-modal .ds-panel {
            width: 95% !important; max-width: none !important;
            padding: 20px !important; border-radius: 16px !important;
        }
        #ds-settings-modal .ds-tab { padding: 8px 12px; font-size: 13px; }
        #ds-settings-modal .ds-input-row label { min-width: 80px; }
    }

    /* ====== 响应式：手机 ====== */
    @media (max-width: 480px) {
        #ds-settings-modal .ds-panel {
            width: 100% !important; height: 100% !important;
            max-height: 100% !important; max-width: none !important;
            padding: 16px !important; border-radius: 0 !important;
            border: none !important;
        }
        #ds-settings-modal .ds-overlay {
            padding: 0 !important;
        }
        #ds-settings-modal .ds-tab { padding: 8px 10px; font-size: 12px; }
        #ds-settings-modal .ds-row { padding: 8px 8px; }
        #ds-settings-modal .ds-label { font-size: 13px; }
        #ds-settings-modal .ds-input-row label { min-width: 72px; font-size: 12px; }
        #ds-settings-modal .ds-input { font-size: 13px; padding: 7px 10px; }
        #ds-settings-modal .ds-btn { font-size: 12px; padding: 8px 12px; }
        #ds-settings-modal .ds-btn-row .ds-btn { min-width: 80px; }
        #ds-settings-modal .ds-section { font-size: 12px; }
    }
    `;
}

// ============================================================
// 创建设置面板
// ============================================================

/**
 * 创建设置面板 DOM 元素并绑定所有事件
 * @returns {HTMLElement} 设置面板的 modal 元素
 */
function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'ds-settings-modal';
    const isDark = utils.isDarkMode();
    const t = getThemeColors(CONFIG.themeColor) || { primary: '#793f82', accent: '#9B7AA0' };

    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
        display: none; justify-content: center; align-items: center;
        z-index: 999999; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
    `;

    // 注入样式（仅一次，每次创建时更新以适配主题/暗色切换）
    let styleEl = document.getElementById('ds-settings-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ds-settings-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = buildStylesCSS(isDark, t);

    // 主题颜色选择器
    const themeNames = ['border', 'original'];
    const themeOptions = themeNames.map(name => {
        if (name === 'original') {
            return `<span class="ds-theme-label" data-theme="original">默认</span>`;
        }
        const th = THEMES[name].light;
        return `<span class="ds-theme-dot" data-theme="${name}" style="background:${th.primary};" title="${name}"></span>`;
    }).join('');

    /**
     * 生成开关行的 HTML
     * @param {string} id - 配置短 ID
     * @param {string} label - 显示标签
     * @returns {string} HTML 字符串
     */
    function toggleRow(id, label) {
        const desc = optionDescriptions[id] || '';
        return `
            <div class="ds-row">
                <span class="ds-label" data-toggle="${id}">${label}</span>
                <span class="ds-help" data-help="${desc}">?</span>
                <label class="ds-toggle">
                    <input type="checkbox" id="chk-${id}" ${CONFIG[OPTION_CONFIG_KEYS[id]] ? 'checked' : ''}>
                    <span class="ds-slider"></span>
                </label>
            </div>
        `;
    }

    const panel = document.createElement('div');
    panel.className = 'ds-panel';
    panel.style.cssText = `
        background: ${isDark ? '#1e1e2e' : '#ffffff'};
        color: ${isDark ? '#cdd6f4' : '#1a1a2e'};
        border-radius: 24px; padding: 28px 32px;
        max-width: 720px; width: 92%; max-height: 88vh;
        overflow-y: auto; box-shadow: 0 24px 80px rgba(0,0,0,0.4);
        border: 1px solid ${isDark ? '#313244' : '#e8e8ef'};
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
            <div>
                <h2 style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg, ${t.primary}, ${t.accent});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-0.5px;">脚本设置</h2>
                <span style="font-size:12px;color:${isDark ? '#7f849c' : '#aaa'};margin-top:2px;display:block;">DeepSeek Promax v4.0.0</span>
            </div>
            <button id="ds-settings-close" style="background:var(--ds-card-bg);border:none;font-size:22px;cursor:pointer;color:inherit;opacity:0.6;transition:var(--ds-transition);padding:6px 10px;border-radius:var(--ds-radius-xs);line-height:1;">&times;</button>
        </div>

        <div class="ds-tabs">
            <div class="ds-tab active" data-tab="appearance">🎨 外观</div>
            <div class="ds-tab" data-tab="features">✨ 功能</div>
            <div class="ds-tab" data-tab="cleanup">🧹 清理</div>
            <div class="ds-tab" data-tab="privacy">🔒 隐私</div>
            <div class="ds-tab" data-tab="presets">💬 预设</div>
            <div class="ds-tab" data-tab="export">📤 导出</div>
            <div class="ds-tab" data-tab="automation">👻 自动化</div>
        </div>

        <!-- 🎨 外观 -->
        <div class="ds-tab-content active" data-content="appearance">
            <div class="ds-section">主题颜色</div>
            <div id="theme-selector" style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:8px;">${themeOptions}</div>
            ${toggleRow('sakura', '🌸 樱花飘落')}
            ${toggleRow('narrow', '📐 窄边距')}

            <div class="ds-section">🔤 字体自定义</div>
            <div class="ds-input-row">
                <label>系统字体</label>
                <input type="text" class="ds-input" id="font-family" placeholder="如：Arial, 'Microsoft YaHei'" value="${CONFIG.fontFamily || ''}" style="flex:1;">
            </div>
            <div class="ds-input-row">
                <label>在线字体</label>
                <input type="text" class="ds-input" id="font-url" placeholder=".woff2 / .ttf 或 Google Fonts CSS" value="${CONFIG.fontUrl || ''}" style="flex:1;">
            </div>

            <div class="ds-section">🖼️ 聊天背景</div>
            <div class="ds-input-row">
                <label>图片 URL</label>
                <input type="text" class="ds-input" id="bg-image" placeholder="输入图片链接或选择文件" value="${CONFIG.bgImage || ''}" style="flex:1;">
                <input type="file" id="bg-file-input" accept="image/*" style="max-width:120px;">
            </div>
            <div class="ds-input-row">
                <label>透明度</label>
                <input type="range" id="bg-opacity" min="0" max="1" step="0.05" value="${CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5}" style="flex:1;">
                <span id="bg-opacity-label" style="min-width:36px;text-align:right;font-size:13px;">${(CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5).toFixed(2)}</span>
            </div>
        </div>

        <!-- ✨ 功能 -->
        <div class="ds-tab-content" data-content="features">
            <div class="ds-section">内容渲染</div>
            ${toggleRow('image', '🖼️ 图片渲染')}
            ${toggleRow('strikethrough', '✏️ 删除线渲染')}
            ${toggleRow('mermaid', '📊 Mermaid 图表')}
            ${toggleRow('citation', '🗑️ 移除角标')}
            ${toggleRow('copyCode', '📋 行内代码点击复制')}

            <div class="ds-section">对话增强</div>
            ${toggleRow('antiRecall', '🛡️ 防撤回')}
            ${toggleRow('autoRetry', '🔄 自动重试')}
            ${toggleRow('folderPanel', '📁 文件夹管理')}
            ${toggleRow('defaultMode', '⚡ 默认模式')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>目标模式</label>
                <select id="default-mode-select" class="ds-input" style="flex:1;">
                    <option value="default" ${(CONFIG.defaultMode || 'default') === 'default' ? 'selected' : ''}>快速模式（不切换）</option>
                    <option value="expert" ${CONFIG.defaultMode === 'expert' ? 'selected' : ''}>专家模式</option>
                    <option value="vision" ${CONFIG.defaultMode === 'vision' ? 'selected' : ''}>识图模式</option>
                </select>
            </div>
        </div>

        <!-- 🧹 清理 -->
        <div class="ds-tab-content" data-content="cleanup">
            <div class="ds-section">界面清理</div>
            ${toggleRow('removeForward', '✂️ 移除转发按钮')}
            ${toggleRow('removeDownloadApp', '📱 移除下载入口')}
            ${toggleRow('placeholderText', '💬 修改占位符文字')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>占位文字</label>
                <input type="text" class="ds-input" id="placeholder-text" placeholder="如：说点什么吧～" value="${CONFIG.placeholderText || ''}" style="flex:1;">
            </div>
        </div>

        <!-- 🔒 隐私 -->
        <div class="ds-tab-content" data-content="privacy">
            <div class="ds-section">浏览隐私</div>
            ${toggleRow('title', '🎭 标题伪装')}
            ${toggleRow('redirect', '↗️ 自动跳转')}
            <div class="ds-input-row" style="margin-top:8px;">
                <label>标题列表</label>
                <textarea id="title-list-text" rows="5" class="ds-input" style="flex:1;" placeholder="每行一个标题">${(CONFIG.titleList || DEFAULTS.titleList).join('\n')}</textarea>
            </div>

            <div class="ds-section">🔐 敏感词替换</div>
            ${toggleRow('privacyShield', '🛡️ 启用敏感词替换')}
            ${toggleRow('caseSensitive', '🔍 区分大小写')}
            <div class="ds-add-row">
                <input type="text" class="ds-input" id="sensitive-word-input" placeholder="敏感词" style="flex:1;">
                <input type="text" class="ds-input" id="sensitive-replacement-input" placeholder="替换为" style="flex:1;">
                <button id="add-sensitive-word-btn" class="ds-btn ds-btn-primary">添加</button>
            </div>
            <div id="sensitive-word-list" style="margin-top:8px;"></div>
        </div>

        <!-- 💬 预设 -->
        <div class="ds-tab-content" data-content="presets">
            <div class="ds-section">消息预设</div>
            <div class="ds-info-card">在输入框中输入 <code>/</code> 可触发预设菜单，快速插入预设的提示词。</div>
            <div id="preset-list-container" style="margin-top:10px;">${buildPresetList()}</div>
            <div class="ds-add-row">
                <input type="text" class="ds-input" id="preset-name" placeholder="名称（如：猫娘）" style="flex:1;">
                <input type="text" class="ds-input" id="preset-prompt" placeholder="提示词（如：你是一个猫娘）" style="flex:2;">
                <button id="add-preset-btn" class="ds-btn ds-btn-primary">添加</button>
            </div>
        </div>

        <!-- 📤 导出 -->
        <div class="ds-tab-content" data-content="export">
            <div class="ds-section">对话导出</div>
            <div class="ds-info-card">点击下方按钮导出当前对话，数据来源优先级：API 拦截 → 直接请求 → DOM 提取。截图导出需联网加载 html2canvas。</div>
            <div class="ds-btn-row">
                <button id="ds-export-json-btn" class="ds-btn ds-btn-primary">📥 导出 JSON</button>
                <button id="ds-export-md-btn" class="ds-btn ds-btn-primary">📝 导出 MD</button>
                <button id="ds-export-img-btn" class="ds-btn ds-btn-primary">📸 截图 PNG</button>
            </div>

            <div class="ds-section">🤖 系统提示词注入</div>
            ${toggleRow('promptInject', '启用提示词注入')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>提示词内容</label>
                <textarea id="prompt-inject-text" rows="4" class="ds-input" style="flex:1;" placeholder="输入系统提示词，将在每次对话时自动注入…">${CONFIG.promptText || ''}</textarea>
            </div>
        </div>

        <!-- 👻 自动化 -->
        <div class="ds-tab-content" data-content="automation">
            <div class="ds-section">循环引擎</div>
            ${toggleRow('loopEngine', '👻 启用循环引擎')}
            ${toggleRow('loopNotify', '🔔 桌面通知')}
            ${toggleRow('loopCrashRecovery', '🔄 崩溃恢复')}
            ${toggleRow('loopDrift', '🛡️ 漂移防护（轮次上限）')}
            ${toggleRow('loopUnattended', '🤖 无人值守模式')}
            <div class="ds-input-row" style="margin-top:4px;">
                <label>最大轮次</label>
                <input type="number" id="loop-max-rounds" class="ds-input" min="1" max="999" value="${CONFIG.loopMaxRounds || 20}" style="flex:1;">
            </div>
            <div class="ds-info-card">
                <b>信号协议：</b>AI 回复以 <code>[[GITL::PROCEED]]</code> 结尾则自动继续，以 <code>[[GITL::HALT]]</code> 结尾则停止。<br>
                <b>防检测：</b>8-15 秒随机延迟。<br>
                <b>看门狗：</b>3 分钟无活动自动暂停。
            </div>

            <div class="ds-section">🧠 思考姿态</div>
            <div class="ds-input-row">
                <label>姿态选择</label>
                <select id="loop-posture-select" class="ds-input" style="flex:1;">
                    <option value="standard" ${(CONFIG.loopPosture || 'standard') === 'standard' ? 'selected' : ''}>🔒 锁定 — 严格按计划</option>
                    <option value="evolving" ${CONFIG.loopPosture === 'evolving' ? 'selected' : ''}>🌱 自适应 — 可中途扩展</option>
                    <option value="extended" ${CONFIG.loopPosture === 'extended' ? 'selected' : ''}>🔍 审计 — 计划 + 最终缺口审计</option>
                </select>
            </div>
            <div class="ds-info-card" id="posture-desc-card">
                锁定到声明的计划，不允许添加、删除、合并或重排步骤。最可预测。
            </div>

            <div class="ds-section">▶ 任务模式</div>
            <div class="ds-input-row">
                <label>模式选择</label>
                <select id="loop-payload-select" class="ds-input" style="flex:1;">
                    <option value="loop" ${(CONFIG.loopPayloadMode || 'loop') === 'loop' ? 'selected' : ''}>▶ 循环 — 分步执行</option>
                    <option value="think" ${CONFIG.loopPayloadMode === 'think' ? 'selected' : ''}>🧠 先思考 — AI 自规划分批</option>
                    <option value="roadmap" ${CONFIG.loopPayloadMode === 'roadmap' ? 'selected' : ''}>🗺 路线图 — AI 研究→路线图→自动执行</option>
                </select>
            </div>
            <div class="ds-input-row">
                <label>任务描述</label>
                <textarea id="loop-task-input" rows="3" class="ds-input" style="flex:1;" placeholder="输入要循环执行的任务…"></textarea>
            </div>
            <div class="ds-btn-row">
                <button id="ds-loop-start-btn" class="ds-btn ds-btn-primary">▶ 开始循环</button>
                <button id="ds-loop-pause-btn" class="ds-btn ds-btn-outline">⏸ 暂停</button>
                <button id="ds-loop-stop-btn" class="ds-btn ds-btn-outline">⏹ 停止</button>
                <button id="ds-loop-reset-btn" class="ds-btn ds-btn-outline">↺ 重置</button>
            </div>

            <div class="ds-section">👤 人格系统</div>
            <div class="ds-input-row">
                <label>选择人格</label>
                <select id="persona-select" class="ds-input" style="flex:1;" multiple size="4">
                    <option value="none" ${(CONFIG.personaSelected || ['none']).includes('none') ? 'selected' : ''}>无</option>
                    <option value="researcher" ${(CONFIG.personaSelected || []).includes('researcher') ? 'selected' : ''}>研究员</option>
                    <option value="builder" ${(CONFIG.personaSelected || []).includes('builder') ? 'selected' : ''}>建造者</option>
                    <option value="redteam" ${(CONFIG.personaSelected || []).includes('redteam') ? 'selected' : ''}>红队</option>
                    <option value="devil" ${(CONFIG.personaSelected || []).includes('devil') ? 'selected' : ''}>魔鬼代言人</option>
                    <option value="tester" ${(CONFIG.personaSelected || []).includes('tester') ? 'selected' : ''}>测试工程师</option>
                    <option value="customer" ${(CONFIG.personaSelected || []).includes('customer') ? 'selected' : ''}>客户声音</option>
                    <option value="executive" ${(CONFIG.personaSelected || []).includes('executive') ? 'selected' : ''}>执行官</option>
                    <option value="roundtable" ${(CONFIG.personaSelected || []).includes('roundtable') ? 'selected' : ''}>圆桌会议</option>
                </select>
            </div>
            <div class="ds-info-card">
                <b>多选：</b>按住 Ctrl/Cmd 多选组合委员会。<br>
                <b>圆桌会议：</b>AI 模拟 5 种视角独立评估后综合。<br>
                <b>每步注入：</b>开启后每条循环命令都附带人格指令。
            </div>
            ${toggleRow('personaPerTask', '🔁 每步注入人格')}

            <div class="ds-section">⛓ 工作流自动化</div>
            <div class="ds-input-row">
                <label>选择工作流</label>
                <select id="workflow-select" class="ds-input" style="flex:1;">
                    <option value="none" ${(CONFIG.workflowSelected || 'none') === 'none' ? 'selected' : ''}>手动（不自动注入阶段）</option>
                    <option value="deep_research" ${CONFIG.workflowSelected === 'deep_research' ? 'selected' : ''}>深度研究 — 研究→分支→红队→综合</option>
                    <option value="rd_lab" ${CONFIG.workflowSelected === 'rd_lab' ? 'selected' : ''}>R&D 实验室 — 发明→原型→评估→收敛</option>
                    <option value="shipyard" ${CONFIG.workflowSelected === 'shipyard' ? 'selected' : ''}>船坞 — 概念→执行计划→QA→生产就绪</option>
                    <option value="debate" ${CONFIG.workflowSelected === 'debate' ? 'selected' : ''}>辩论 — 多视角挑战与综合</option>
                    <option value="pre_mortem" ${CONFIG.workflowSelected === 'pre_mortem' ? 'selected' : ''}>前置复盘 — 假设失败→调查→加固</option>
                    <option value="trollproof" ${CONFIG.workflowSelected === 'trollproof' ? 'selected' : ''}>抗喷子 — 敌意反馈→过滤→加固</option>
                    <option value="lens_relay" ${CONFIG.workflowSelected === 'lens_relay' ? 'selected' : ''}>透镜接力 — 多视角独立评估→综合</option>
                </select>
            </div>
            ${toggleRow('workflowAutoAdvance', '⚡ 自动推进下一阶段')}
            ${toggleRow('workflowPauseBetween', '⏸ 步间暂停（每阶段后等待）')}

            <div class="ds-section">🗺 路线图自动驾驶</div>
            <div class="ds-input-row">
                <label>任务描述</label>
                <textarea id="roadmap-task-input" rows="3" class="ds-input" style="flex:1;" placeholder="输入任务，AI 会先生成路线图再逐步执行…"></textarea>
            </div>
            <div class="ds-btn-row">
                <button id="ds-roadmap-start-btn" class="ds-btn ds-btn-primary">🗺 路线图</button>
                <button id="ds-thinkfirst-btn" class="ds-btn ds-btn-outline">🧠 先思考</button>
            </div>

            <div class="ds-section">📋 提示词队列</div>
            <div class="ds-input-row">
                <label>任务列表</label>
                <textarea id="queue-input" rows="5" class="ds-input" style="flex:1;" placeholder="每行一个任务，脚本会依次执行…&#10;1. 分析需求&#10;2. 设计架构&#10;3. 编写代码&#10;4. 测试验证"></textarea>
            </div>
            <button id="ds-queue-start-btn" class="ds-btn ds-btn-primary" style="width:100%;margin-top:8px;">📋 开始队列</button>

            <div class="ds-section">🤝 交接报告</div>
            <div class="ds-input-row">
                <label>项目名称</label>
                <input type="text" id="project-name" class="ds-input" placeholder="用于交接报告元数据" value="${CONFIG.projectName || ''}" style="flex:1;">
            </div>
            <div class="ds-btn-row">
                <button id="ds-handoff-btn" class="ds-btn ds-btn-primary">🤝 生成交接</button>
                <button id="ds-handoff-backup-btn" class="ds-btn ds-btn-outline">📥 备份交接</button>
            </div>
        </div>

        <div style="display:flex;gap:12px;margin-top:24px;">
            <button id="ds-settings-save" class="ds-btn ds-btn-primary" style="flex:1;padding:13px;font-size:15px;border-radius:26px;background:linear-gradient(135deg, ${t.primary}, ${t.accent});box-shadow:0 4px 16px ${t.glow};">💾 保存并应用</button>
            <button id="ds-settings-reset" class="ds-btn ds-btn-outline" style="padding:13px 24px;border-radius:26px;">↺ 恢复默认</button>
        </div>
    `;

    modal.appendChild(panel);
    document.body.appendChild(modal);

    // ===== 事件绑定 =====
    const closeBtn = modal.querySelector('#ds-settings-close');
    const saveBtn = modal.querySelector('#ds-settings-save');
    const resetBtn = modal.querySelector('#ds-settings-reset');

    closeBtn.addEventListener('click', hideSettings);
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.6');
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetSettings);

    // 标签页切换
    modal.querySelectorAll('.ds-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            modal.querySelectorAll('.ds-tab').forEach(t => t.classList.toggle('active', t === tab));
            modal.querySelectorAll('.ds-tab-content').forEach(c => {
                c.classList.toggle('active', c.dataset.content === target);
            });
        });
    });

    // 导出按钮事件（带点击反馈，提示用户等待下载）
    const exportJsonBtn = modal.querySelector('#ds-export-json-btn');
    const exportMdBtn = modal.querySelector('#ds-export-md-btn');
    const exportImgBtn = modal.querySelector('#ds-export-img-btn');

    /**
     * 给导出按钮添加点击反馈：临时显示"正在准备…"提示，完成后恢复
     * @param {HTMLElement} btn - 按钮元素
     * @param {Function} fn - 异步导出函数
     */
    function exportWithFeedback(btn, fn) {
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const originalText = btn.textContent;
            btn.textContent = '⏳ 正在准备…';
            btn.style.opacity = '0.7';
            btn.style.pointerEvents = 'none';
            try {
                await fn();
            } finally {
                btn.textContent = originalText;
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
            }
        });
    }

    exportWithFeedback(exportJsonBtn, () => doExport('json'));
    exportWithFeedback(exportMdBtn, () => doExport('md'));
    exportWithFeedback(exportImgBtn, () => doImageExport());

    // 循环引擎事件绑定
    const loopStartBtn = modal.querySelector('#ds-loop-start-btn');
    const loopPauseBtn = modal.querySelector('#ds-loop-pause-btn');
    const loopStopBtn = modal.querySelector('#ds-loop-stop-btn');
    const loopResetBtn = modal.querySelector('#ds-loop-reset-btn');
    const roadmapStartBtn = modal.querySelector('#ds-roadmap-start-btn');
    const thinkFirstBtn = modal.querySelector('#ds-thinkfirst-btn');
    const queueStartBtn = modal.querySelector('#ds-queue-start-btn');
    const handoffBtn = modal.querySelector('#ds-handoff-btn');
    const handoffBackupBtn = modal.querySelector('#ds-handoff-backup-btn');

    if (loopStartBtn) loopStartBtn.addEventListener('click', async () => {
        const { startLoop, requestNotifyPermission, setEngineOptions } = await import('../features/loop-engine.js');
        if (CONFIG.loopNotifyEnabled) await requestNotifyPermission();

        // 同步 UI 选择的模式/姿态/轮次到引擎
        const payloadMode = modal.querySelector('#loop-payload-select')?.value || 'loop';
        const posture = modal.querySelector('#loop-posture-select')?.value || 'standard';
        const maxRounds = parseInt(modal.querySelector('#loop-max-rounds')?.value) || 20;
        CONFIG.loopPayloadMode = payloadMode;
        CONFIG.loopPosture = posture;
        CONFIG.loopMaxRounds = maxRounds;
        saveConfig(CONFIG);
        setEngineOptions({ payloadMode, posture, maxRounds });

        // 如果选中了工作流，激活它
        try { window.__dsStartWorkflowIfSelected?.(); } catch (_) {}

        const task = modal.querySelector('#loop-task-input')?.value || '';
        startLoop(task.trim() || undefined);
        hideSettings();
    });
    if (loopPauseBtn) loopPauseBtn.addEventListener('click', async () => {
        const { pauseLoop } = await import('../features/loop-engine.js');
        pauseLoop('手动暂停');
    });
    if (loopStopBtn) loopStopBtn.addEventListener('click', async () => {
        const { stopLoop } = await import('../features/loop-engine.js');
        stopLoop();
    });
    if (loopResetBtn) loopResetBtn.addEventListener('click', async () => {
        const { resetLoop } = await import('../features/loop-engine.js');
        resetLoop();
    });
    if (roadmapStartBtn) roadmapStartBtn.addEventListener('click', async () => {
        const { startRoadmap } = await import('../features/roadmap.js');
        const task = modal.querySelector('#roadmap-task-input')?.value || '';
        if (task.trim()) { startRoadmap(task); hideSettings(); }
    });
    if (thinkFirstBtn) thinkFirstBtn.addEventListener('click', async () => {
        const { startThinkFirst } = await import('../features/roadmap.js');
        const task = modal.querySelector('#roadmap-task-input')?.value || '';
        if (task.trim()) { startThinkFirst(task); hideSettings(); }
    });
    if (queueStartBtn) queueStartBtn.addEventListener('click', async () => {
        const { startQueue } = await import('../features/roadmap.js');
        const lines = modal.querySelector('#queue-input')?.value || '';
        if (lines.trim()) { startQueue(lines); hideSettings(); }
    });
    if (handoffBtn) handoffBtn.addEventListener('click', async () => {
        const { handoffInChat } = await import('../features/handoff.js');
        handoffInChat();
        hideSettings();
    });
    if (handoffBackupBtn) handoffBackupBtn.addEventListener('click', async () => {
        const { generateBackupHandoff, downloadHandoff } = await import('../features/handoff.js');
        const md = generateBackupHandoff();
        if (md) downloadHandoff(md);
    });

    // ── 姿态描述实时切换 ──
    const postureSelect = modal.querySelector('#loop-posture-select');
    const postureDescCard = modal.querySelector('#posture-desc-card');
    /** 三种姿态的中文描述（与 postures.js POSTURES.desc 对齐） */
    const postureDescs = {
        standard: '锁定到声明的计划，不允许添加、删除、合并或重排步骤。最可预测。',
        evolving: '计划可以在执行中扩展 — 当出现真实阻碍或缺口时，AI 可加步骤并说明理由。',
        extended: '锁定执行计划，完成后做一次覆盖审计，仅补材料性缺口。'
    };
    if (postureSelect && postureDescCard) {
        postureSelect.addEventListener('change', () => {
            postureDescCard.textContent = postureDescs[postureSelect.value] || postureDescs.standard;
        });
    }

    // ── 人格多选 ──
    const personaSelect = modal.querySelector('#persona-select');
    if (personaSelect) {
        personaSelect.addEventListener('change', async () => {
            const selected = [...personaSelect.selectedOptions].map(o => o.value).filter(Boolean);
            const { setPersonas } = await import('../features/personas.js');
            // 如果选中了 "none" 或清空了选择，重置为 ['none']
            if (selected.length === 0 || selected.includes('none')) {
                setPersonas(['none']);
            } else {
                setPersonas(selected);
            }
        });
    }

    // ── 工作流选择 ──
    const workflowSelect = modal.querySelector('#workflow-select');
    if (workflowSelect) {
        workflowSelect.addEventListener('change', async () => {
            const id = workflowSelect.value || 'none';
            const { setSelected } = await import('../features/workflows.js');
            setSelected(id);
        });
    }

    // ── 项目名称 ──
    const projectNameInput = modal.querySelector('#project-name');
    if (projectNameInput) {
        projectNameInput.addEventListener('change', () => {
            CONFIG.projectName = projectNameInput.value.trim();
            saveConfig(CONFIG);
        });
    }

    // ── 最大轮次实时同步 ──
    const maxRoundsInput = modal.querySelector('#loop-max-rounds');
    if (maxRoundsInput) {
        maxRoundsInput.addEventListener('change', async () => {
            const v = Math.max(1, Math.min(999, parseInt(maxRoundsInput.value) || 20));
            CONFIG.loopMaxRounds = v;
            saveConfig(CONFIG);
            const { setEngineOptions } = await import('../features/loop-engine.js');
            setEngineOptions({ maxRounds: v });
        });
    }

    // ── 模式选择实时同步 ──
    const payloadSelect = modal.querySelector('#loop-payload-select');
    if (payloadSelect) {
        payloadSelect.addEventListener('change', async () => {
            CONFIG.loopPayloadMode = payloadSelect.value;
            saveConfig(CONFIG);
            const { setEngineOptions } = await import('../features/loop-engine.js');
            setEngineOptions({ payloadMode: payloadSelect.value });
        });
    }

    // 敏感词列表渲染与事件
    const sensitiveList = modal.querySelector('#sensitive-word-list');
    const wordInput = modal.querySelector('#sensitive-word-input');
    const replacementInput = modal.querySelector('#sensitive-replacement-input');
    const addWordBtn = modal.querySelector('#add-sensitive-word-btn');

    /** 渲染敏感词列表 */
    function renderSensitiveList() {
        if (!sensitiveList) return;
        const entries = Object.entries(CONFIG.sensitiveWords || {});
        if (entries.length === 0) {
            sensitiveList.innerHTML = '<div class="ds-empty-hint">暂无敏感词</div>';
            return;
        }
        sensitiveList.innerHTML = entries.map(([word, replacement]) => `
            <div class="ds-tag">
                <span><strong>${word}</strong> → ${replacement}</span>
                <button data-word="${word}" class="ds-tag-remove">删除</button>
            </div>
        `).join('');
        sensitiveList.querySelectorAll('.ds-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = btn.dataset.word;
                delete CONFIG.sensitiveWords[w];
                saveConfig(CONFIG);
                clearPrivacyCache();
                renderSensitiveList();
            });
        });
    }

    if (addWordBtn) {
        addWordBtn.addEventListener('click', () => {
            const word = (wordInput?.value || '').trim();
            const replacement = (replacementInput?.value || '').trim();
            if (!word) { wordInput?.focus(); return; }
            if (!replacement) { replacementInput?.focus(); return; }
            if (!CONFIG.sensitiveWords) CONFIG.sensitiveWords = {};
            CONFIG.sensitiveWords[word] = replacement;
            saveConfig(CONFIG);
            clearPrivacyCache();
            if (wordInput) wordInput.value = '';
            if (replacementInput) replacementInput.value = '';
            renderSensitiveList();
        });
    }
    renderSensitiveList();

    // 帮助弹出框（点击 ? 图标显示，点击其他地方关闭）
    modal.addEventListener('click', (e) => {
        const helpIcon = e.target.closest('.ds-help');
        if (helpIcon) {
            e.stopPropagation();
            const text = helpIcon.dataset.help || '';
            if (text) showHelpPopup(text, helpIcon);
        } else {
            hideHelpPopup();
        }
    });

    // 点击 label 文字也能切换 toggle
    modal.querySelectorAll('[data-toggle]').forEach(label => {
        label.addEventListener('click', (e) => {
            const id = label.dataset.toggle;
            const checkbox = modal.querySelector('#chk-' + id);
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                e.stopPropagation();
            }
        });
    });

    // 主题选择器
    const themeSelector = modal.querySelector('#theme-selector');
    themeSelector.addEventListener('click', (e) => {
        const target = e.target.closest('[data-theme]');
        if (!target) return;
        themeSelector.querySelectorAll('[data-theme]').forEach(el => el.style.borderColor = 'transparent');
        target.style.borderColor = 'var(--ds-primary)';
        themeSelector.dataset.selectedTheme = target.dataset.theme;
    });
    const currentTheme = CONFIG.themeColor || 'border';
    themeSelector.querySelectorAll('[data-theme]').forEach(el => {
        if (el.dataset.theme === currentTheme) el.style.borderColor = t.primary;
    });
    themeSelector.dataset.selectedTheme = currentTheme;

    // 预设添加
    const addBtn = modal.querySelector('#add-preset-btn');
    const nameInput = modal.querySelector('#preset-name');
    const promptInput = modal.querySelector('#preset-prompt');
    addBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const prompt = promptInput.value.trim();
        if (!name || !prompt) { alert('名称和提示词不能为空'); return; }
        const presets = CONFIG.presets || [];
        if (presets.some(p => p.name === name)) { alert('同名预设已存在'); return; }
        presets.push({ name, prompt });
        CONFIG.presets = presets;
        const container = modal.querySelector('#preset-list-container');
        container.innerHTML = buildPresetList();
        container.querySelectorAll('.ds-preset-delete').forEach(btn => btn.addEventListener('click', deleteHandler));
        nameInput.value = '';
        promptInput.value = '';
    });

    // 预设删除
    modal.querySelectorAll('.ds-preset-delete').forEach(btn => btn.addEventListener('click', deleteHandler));

    // 背景文件上传
    modal.querySelector('#bg-file-input').addEventListener('change', function(e) {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { modal.querySelector('#bg-image').value = ev.target.result; };
        reader.readAsDataURL(file);
        this.value = '';
    });

    // 透明度滑块
    const opacitySlider = modal.querySelector('#bg-opacity');
    const opacityLabel = modal.querySelector('#bg-opacity-label');
    opacitySlider.addEventListener('input', function() {
        opacityLabel.textContent = parseFloat(this.value).toFixed(2);
    });

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => { if (e.target === modal) hideSettings(); });

    return modal;
}

// ============================================================
// 显示/隐藏
// ============================================================

/**
 * 显示设置面板，同步所有控件状态到当前 CONFIG 值
 */
export function showSettings() {
    if (!settingsModal) settingsModal = createSettingsModal();
    settingsModal.style.display = 'flex';
    // 同步所有控件状态
    const ids = Object.keys(OPTION_CONFIG_KEYS);
    ids.forEach(id => {
        const el = document.getElementById('chk-' + id);
        if (el) {
            const key = OPTION_CONFIG_KEYS[id];
            el.checked = CONFIG[key] !== undefined ? CONFIG[key] : true;
        }
    });
    const txt = document.getElementById('title-list-text');
    if (txt) txt.value = (CONFIG.titleList || DEFAULTS.titleList).join('\n');
    const sel = document.getElementById('theme-selector');
    if (sel) {
        const theme = CONFIG.themeColor || 'border';
        const t = getThemeColors(theme) || { primary: '#793f82' };
        sel.querySelectorAll('[data-theme]').forEach(el => el.style.borderColor = el.dataset.theme === theme ? t.primary : 'transparent');
        sel.dataset.selectedTheme = theme;
    }
    const container = document.getElementById('preset-list-container');
    if (container) {
        container.innerHTML = buildPresetList();
        container.querySelectorAll('.ds-preset-delete').forEach(btn => btn.addEventListener('click', deleteHandler));
    }
    const fontFamily = document.getElementById('font-family');
    if (fontFamily) fontFamily.value = CONFIG.fontFamily || '';
    const fontUrl = document.getElementById('font-url');
    if (fontUrl) fontUrl.value = CONFIG.fontUrl || '';
    const bgImage = document.getElementById('bg-image');
    if (bgImage) bgImage.value = CONFIG.bgImage || '';
    const bgOpacity = document.getElementById('bg-opacity');
    if (bgOpacity) bgOpacity.value = CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5;
    const bgOpacityLabel = document.getElementById('bg-opacity-label');
    if (bgOpacityLabel) bgOpacityLabel.textContent = (CONFIG.bgOpacity !== undefined ? CONFIG.bgOpacity : 0.5).toFixed(2);
    const placeholderText = document.getElementById('placeholder-text');
    if (placeholderText) placeholderText.value = CONFIG.placeholderText || '';
    const defaultModeSelect = document.getElementById('default-mode-select');
    if (defaultModeSelect) defaultModeSelect.value = CONFIG.defaultMode || 'default';
}

/**
 * 隐藏设置面板并恢复被临时隐藏的浮动菜单容器
 */
export function hideSettings() {
    if (settingsModal) settingsModal.style.display = 'none';
    hideHelpPopup();
    // 恢复被临时隐藏的 DeepSeek 浮动菜单容器，否则下拉菜单将永久无法打开
    try { restoreFloatingWrappers(); } catch (e) {}
}

/**
 * 获取设置面板 modal 元素
 * @returns {HTMLElement|null}
 */
export function getSettingsModal() { return settingsModal; }

/**
 * 清除设置面板（移除 DOM 并重置引用）
 */
export function clearSettingsModal() {
    if (settingsModal) {
        settingsModal.remove();
        settingsModal = null;
    }
}

// ============================================================
// 保存/重置
// ============================================================

/**
 * 保存设置：读取所有控件值写入 CONFIG，保存后刷新页面
 */
function saveSettings() {
    // 读取所有 checkbox
    Object.keys(OPTION_CONFIG_KEYS).forEach(id => {
        const el = document.getElementById('chk-' + id);
        if (el) CONFIG[OPTION_CONFIG_KEYS[id]] = el.checked;
    });
    // 标题列表
    const titles = document.getElementById('title-list-text').value.split('\n').map(s => s.trim()).filter(Boolean);
    CONFIG.titleList = titles.length ? titles : DEFAULTS.titleList;
    // 主题
    const theme = document.getElementById('theme-selector').dataset.selectedTheme;
    if (theme) CONFIG.themeColor = theme;
    // 字体
    CONFIG.fontFamily = document.getElementById('font-family').value.trim();
    CONFIG.fontUrl = document.getElementById('font-url').value.trim();
    // 背景
    CONFIG.bgImage = document.getElementById('bg-image').value.trim();
    const bgOpacity = parseFloat(document.getElementById('bg-opacity').value);
    CONFIG.bgOpacity = isNaN(bgOpacity) ? 0.5 : Math.min(1, Math.max(0, bgOpacity));
    // 占位符文字
    CONFIG.placeholderText = document.getElementById('placeholder-text').value.trim() || '说点什么吧～';
    // 默认模式
    const modeSelect = document.getElementById('default-mode-select');
    if (modeSelect) CONFIG.defaultMode = modeSelect.value;
    // 提示词注入文本
    const promptTextArea = document.getElementById('prompt-inject-text');
    if (promptTextArea) CONFIG.promptText = promptTextArea.value.trim();
    // 清除隐私保护正则缓存（敏感词或大小写设置可能已变更）
    clearPrivacyCache();

    saveConfig(CONFIG);
    hideSettings();
    alert('✅ 设置已保存，正在刷新页面…');
    location.reload();
}

/**
 * 恢复默认设置并刷新页面
 */
function resetSettings() {
    saveConfig({ ...DEFAULTS });
    hideSettings();
    alert('✅ 已恢复默认设置，正在刷新页面…');
    location.reload();
}
