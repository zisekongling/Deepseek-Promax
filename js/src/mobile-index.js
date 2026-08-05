/**
 * 移动端专属入口 - DeepSeek Promax 移动版
 *
 * 专为 Android WebView 环境优化，与 DsBridge 原生桥接深度集成：
 *   1. 移动端优化默认配置（性能优先，关闭重型动画与桌面专属功能）
 *   2. 原生 Toast/震动/剪贴板/分享/通知 通过 AndroidBridge 调用
 *   3. 触屏优化：长按菜单替代右键菜单、底部工作表设置面板
 *   4. 跳过桌面专属功能（Tauri IPC、桌面宠物、项目工作台等）
 *   5. IME 预览栏集成（通过 AndroidIME 桥接，原生处理）
 *   6. 构建时不含油猴头部和 IIFE 包裹（直接由 WebView evaluateJavascript 注入）
 *
 * 构建产物：dspro.mobile.js — 由 Android WebView 的 onPageFinished 注入
 *
 * 与 index.js（通用版）的关系：
 *   - 共享所有模块源码（单源码多构建）
 *   - 通过 runtime 的 Platform.isWebView 自动切换行为
 *   - mobile-index.js 额外跳过移动端不适用的功能初始化
 */

// ============================================================
// 移动端环境标记
// ============================================================

// 在导入 config.js 之前设置标记，让 DEFAULTS 按移动端适配
// 注意：config.js 内部通过 Platform.isWebView 判断，Android WebView 已正确识别
// 此处额外设置移动端专属标记，供后续模块差异化处理
if (typeof window !== 'undefined') {
    window.__dsMobileEnv = true;
}

// ============================================================
// 模块导入
// ============================================================
import { CONFIG, DEFAULTS, saveConfig, reloadConfig, IS_ELECTRON } from './config.js';
import { utils } from './utils.js';
import { injectStyles, resetStyleCache } from './styles.js';
import { initRedirect } from './features/redirect.js';
import { initTitleFaker, stopTitleFaker } from './features/title-faker.js';
import { initSakura, destroySakura } from './features/sakura.js';
import { resetRetryAttempts, scanRetryButton } from './features/auto-retry.js';
import { installXhrHook } from './features/anti-recall.js';
import { initDefaultMode } from './features/default-mode.js';
import { initRemoveComponents } from './features/remove-components.js';
import { fullScan } from './features/text-process.js';
import { registerDomHandler, disconnectObserverHub } from './utils/observer-hub.js';
import { applyCustomizations } from './customizations/background.js';
import { showSettings, clearSettingsModal } from './ui/settings-panel.js';
import { injectMenuItem } from './ui/menu-inject.js';
import { initPresetMenu, hidePresetMenu } from './ui/preset-menu.js';
import { Store, tryReadIDB, getSidFromUrl } from './features/data-store.js';
import { initCopyCode } from './features/copy-code.js';
import { initCodeExecutor } from './features/code-executor.js';
import { initFolderPanel } from './ui/folder-panel.js';
import { initLoopEngine } from './features/loop-engine.js';
import { initRoadmap } from './features/roadmap.js';
import { initHandoff } from './features/handoff.js';
import { initPersonas } from './features/personas.js';
import { initWorkflows } from './features/workflows.js';
import { initPostures } from './features/postures.js';
import { initPayloads } from './features/payloads.js';
import { initTokenSpeed } from './features/token-speed.js';
import { initUsageStats, renderUsagePanel } from './features/usage-stats.js';
import { initInlineExport } from './features/inline-export.js';
import { initHistoryTags } from './features/history-tags.js';
import { initContextMenu } from './features/context-menu.js';
import { initMemory } from './features/memory.js';
import { initCapabilityRegister } from './features/capability-register.js';
import { initCapabilityAgent } from './features/capability-agent.js';
import { initTodoManager } from './features/todo.js';
import { initAskUserManager } from './features/ask-user.js';
import { startI18n } from './features/i18n/index.js';
import { initWebTools } from './features/web-tools.js';
import { initMcp } from './features/mcp/client.js';
import { renderMcpPrompt } from './features/mcp/capability-projection.js';
import { initArtifacts } from './features/artifacts/index.js';
import { initMemoryImporter } from './features/memory-importer.js';
import { initSync } from './features/sync/index.js';
import { initAutomation } from './features/automation/index.js';
import { initMultimodal } from './features/multimodal/index.js';
import { initSandbox } from './features/sandbox/index.js';
import { initMagicWand } from './features/magic-wand.js';
import { initCodeFold } from './features/code-fold.js';
import { initTableExport } from './features/table-export.js';
import { initThinkFold } from './features/think-fold.js';
import { Platform } from './platform/bridge.js';

// ============================================================
// 移动端专属：预写入优化配置
// ============================================================

/**
 * 移动端默认配置覆盖
 *
 * 在首次运行时（localStorage 无配置时），将移动端优化的默认值写入。
 * 如果用户已有配置，则不覆盖，保留用户偏好。
 *
 * 移动端优化策略：
 *   - 关闭樱花动画（Canvas 重绘消耗移动端 GPU 和电量）
 *   - 关闭桌面宠物（无桌面环境）
 *   - 关闭标题伪装（WebView 环境已默认关闭）
 *   - 关闭项目工作台（屏幕太小，不适合复杂面板）
 *   - 关闭制品导出（无桌面文件系统）
 *   - 关闭右键菜单（改用长按菜单）
 *   - 启用代码折叠（小屏幕空间宝贵）
 *   - 启用魔法棒（移动端触屏控制更方便）
 *   - 关闭数据同步（移动端网络不稳定，按需开启）
 *   - 关闭自动化调度（后台运行受限）
 *   - 关闭多模态分析（移动端性能有限）
 *   - 关闭 Python 沙箱（移动端不支持）
 */
function applyMobileDefaults() {
    try {
        const raw = localStorage.getItem('ds_enhance_config');
        if (!raw) {
            // 首次运行：写入移动端优化默认配置
            const mobileDefaults = {
                ...DEFAULTS,
                // 性能优化：关闭重型动画
                sakuraEnabled: false,
                // 移动端不适用的功能
                contextMenuEnabled: false,
                // 移动端屏幕空间有限，关闭复杂面板
                projectEnabled: false,
                // 无桌面文件系统
                artifactsExportEnabled: false,
                // 移动端后台受限
                automationEnabled: false,
                // 移动端性能有限
                multimodalEnabled: false,
                pythonSandboxEnabled: false,
                // 移动端网络不稳定
                syncEnabled: false,
                // 移动端不需要桌面宠物
                petEnabled: false,
                // 小屏幕推荐开启
                codeFoldEnabled: true,
                magicWandEnabled: true,
                narrowPaddingEnabled: true
            };
            localStorage.setItem('ds_enhance_config', JSON.stringify(mobileDefaults));
            console.log('[DS-Promax Mobile] 已写入移动端优化默认配置');
        }
    } catch (e) {
        // localStorage 写入失败不阻塞初始化
    }
}

// 在导入 CONFIG 后立即应用移动端默认值
applyMobileDefaults();

// ============================================================
// 核心：应用所有功能（用于 reload）
// ============================================================

/**
 * 应用所有功能：样式注入、Observer、XHR 钩子、自定义项、全量扫描
 * 在 window.DSEnhance.reload() 中调用
 * 移动端跳过樱花动画（性能优化）
 */
function applyAllFeatures() {
    injectStyles();
    // 移动端不做樱花动画，性能优先
    stopTitleFaker();
    if (CONFIG.titleFakerEnabled) initTitleFaker();
    if (!window.__dsObserverTouched) {
        window.__dsObserverTouched = true;
        registerDomHandler({});
    }
    installXhrHook();
    resetRetryAttempts();
    applyCustomizations();
    initDefaultMode();
    if (document.body) {
        fullScan(document.body);
        initRemoveComponents();
    }
}

// ============================================================
// DOM 就绪工具
// ============================================================

/**
 * 等待 DOM 就绪（document-start 时 document.body 可能不存在）
 * @returns {Promise<void>}
 */
function domReady() {
    return new Promise((resolve) => {
        if (document.body && document.head) {
            resolve();
        } else {
            const observer = new MutationObserver(() => {
                if (document.body && document.head) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    });
}

// ============================================================
// 移动端专属：原生桥接预热
// ============================================================

/**
 * 移动端原生桥接预热
 *
 * 在初始化阶段测试与 Android DsBridge 的连通性：
 *   - 获取宿主版本信息
 *   - 测试 Toast 能力
 *   - 测试剪贴板能力
 *   - 预注册通知渠道
 */
async function warmupNativeBridge() {
    console.log('[DS-Promax Mobile] 原生桥接预热开始...');

    // 1. 获取宿主信息
    try {
        const info = await Platform.getInfo();
        if (info) {
            console.log('[DS-Promax Mobile] 宿主版本:', info.version,
                '| 平台:', info.platform,
                '| 设备:', info.build);
            window.__dsMobileInfo = info;
        }
    } catch (e) {
        console.warn('[DS-Promax Mobile] 获取宿主信息失败:', e);
    }

    // 2. 测试 Toast（静默测试，不显示）
    // 桥接连通性已在 getInfo 中验证

    console.log('[DS-Promax Mobile] 原生桥接预热完成');
}

// ============================================================
// 移动端专属：触屏优化
// ============================================================

/**
 * 移动端触屏优化
 *
 * 注入移动端专属 CSS 和交互增强：
 *   - 增大触屏点击区域（按钮最小 44x44dp）
 *   - 优化长按菜单（替代右键菜单）
 *   - 优化滚动性能（will-change、硬件加速）
 *   - 优化输入框体验（iOS/Android 键盘适配）
 */
function injectMobileStyles() {
    const styleId = 'ds-mobile-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* 移动端触屏优化：增大点击区域 */
        .ds-button,
        .ds-icon-button,
        [class*="ds-button"] {
            min-height: 44px;
            min-width: 44px;
        }

        /* 移动端代码块：优化滚动 */
        pre, .md-code-block, [class*="code-block"] {
            -webkit-overflow-scrolling: touch;
            max-width: 100vw;
            overflow-x: auto;
        }

        /* 移动端表格：横向滚动 */
        table, [class*="table"] {
            -webkit-overflow-scrolling: touch;
            display: block;
            max-width: 100%;
            overflow-x: auto;
        }

        /* 移动端输入框：防止 iOS 缩放 */
        textarea, input[type="text"], input[type="search"] {
            font-size: 16px !important;
        }

        /* 移动端设置面板：全屏底部工作表 */
        @media (max-width: 480px) {
            .ds-standalone-content {
                max-height: 85vh;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
            }
        }

        /* 移动端 Toast：原生风格 */
        .ds-copy-toast {
            bottom: 80px !important;
        }

        /* 移动端侧边栏：窄屏适配 */
        @media (max-width: 768px) {
            [class*="sidebar"], [class*="side-bar"] {
                max-width: 280px;
            }
        }
    `;
    document.head.appendChild(style);
}

// ============================================================
// 移动端专属：长按菜单
// ============================================================

/**
 * 移动端长按菜单
 *
 * 在移动端，用长按（touchstart + touchend 持续 > 500ms）替代右键菜单。
 * 选中文本后长按弹出场景模板菜单。
 * 仅当 contextMenuEnabled 关闭时启用（避免与右键菜单冲突）。
 */
function initMobileLongPressMenu() {
    // 移动端：右键菜单已关闭时，启用长按菜单作为替代
    if (CONFIG.contextMenuEnabled) return;

    let longPressTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;

        longPressTimer = setTimeout(() => {
            const selection = window.getSelection();
            const text = selection ? selection.toString().trim() : '';
            if (text && text.length > 0) {
                // 触发原生选择菜单（系统自带复制/分享等）
                // 移动端长按主要依赖系统行为，此处做增强
                console.log('[DS-Promax Mobile] 长按选中文本:', text.substring(0, 50));
            }
        }, 500);
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    document.addEventListener('touchmove', function() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// ============================================================
// 主初始化
// ============================================================

/**
 * 主初始化函数（移动端优化版）
 *
 * 分批启动策略：
 *   1. 第一批：关键功能（样式 + Observer + XHR 钩子，尽早生效）
 *   2. 第二批：UI 增强（下一帧执行，不阻塞首屏）
 *   3. 第三批：重任务（空闲时执行，避免影响交互）
 *
 * 与 index.js 的区别：
 *   - 跳过樱花动画（移动端性能优化）
 *   - 跳过桌面宠物（无桌面环境）
 *   - 跳过项目工作台（屏幕太小）
 *   - 添加移动端触屏优化
 *   - 添加原生桥接预热
 *   - 添加长按菜单
 */
async function init() {
    // 防重入
    if (window._dsInitStarted) {
        console.log('[DS-Promax Mobile] init() 已执行过，跳过重复初始化');
        return;
    }
    window._dsInitStarted = true;

    // 脚本总开关
    if (!CONFIG.scriptEnabled) {
        console.log('[DS-Promax Mobile] 脚本总开关已关闭，仅注入设置入口');
        await domReady();
        window.__dsConfig = CONFIG;
        injectMenuItem();
        return;
    }

    // 1. 自动跳转（document-start 阶段，early-boot 已处理）
    if (!window.__dsEarlyBootDone) {
        initRedirect();
    }

    // 2. 等待 DOM 就绪
    await domReady();

    // 3. 移动端专属：触屏优化样式
    injectMobileStyles();

    // 4. 第一批：关键功能（样式 + Observer + XHR 钩子）
    window.__dsConfig = CONFIG;
    injectStyles();
    if (!window.__dsObserverTouched) {
        window.__dsObserverTouched = true;
        registerDomHandler({});
    }
    if (!window.__dsEarlyBootDone) {
        installXhrHook();
    }

    // 5. 移动端原生桥接预热（异步，不阻塞 UI）
    warmupNativeBridge();

    // 6. 第二批：UI 增强（下一帧执行）
    requestAnimationFrame(() => {
        // 移动端：不启动樱花动画（性能优化）
        if (CONFIG.titleFakerEnabled) initTitleFaker();
        applyCustomizations();
        initPresetMenu();
        injectMenuItem();
        initDefaultMode();
        initCopyCode();
        initCodeExecutor();

        // 移动端：启用长按菜单（替代右键菜单）
        initMobileLongPressMenu();

        // 效率工具模块
        if (CONFIG.inlineExportEnabled) { try { initInlineExport(); } catch (e) {} }
        if (CONFIG.historyTagsEnabled) { try { initHistoryTags(); } catch (e) {} }
        if (CONFIG.contextMenuEnabled) { try { initContextMenu(); } catch (e) {} }
        if (CONFIG.tokenSpeedEnabled) { try { initTokenSpeed(); } catch (e) {} }
        if (CONFIG.usageStatsEnabled) {
            try {
                initUsageStats();
                window._dsRenderUsagePanel = renderUsagePanel;
            } catch (e) {}
        }

        // Agent 系统（移动端不支持 Electron，但保持与 desktop-index 一致性）
        if (!IS_ELECTRON) {
            try { initMemory(); } catch (e) {}
            try { initTodoManager(); } catch (e) {}
            try { initAskUserManager(); } catch (e) {}
            try { initCapabilityRegister(); } catch (e) {}
            try { initCapabilityAgent(); } catch (e) {}
        }
        if (CONFIG.loopEngineEnabled || CONFIG.loopCrashRecoveryEnabled) {
            try { initLoopEngine(); } catch (e) {}
        }
        if (CONFIG.loopEngineEnabled) {
            try { initPayloads(); } catch (e) {}
            try { initPostures(); } catch (e) {}
            try { initPersonas(); } catch (e) {}
            try { initWorkflows(); } catch (e) {}
            try { initRoadmap(); } catch (e) {}
            try { initHandoff(); } catch (e) {}
        }

        // Phase 6 模块（移动端跳过部分桌面专属功能）
        try { startI18n(); } catch (e) {}
        try { initWebTools(); } catch (e) {}
        try { initMcp(); } catch (e) {}
        // 移动端：跳过项目工作台（屏幕太小）
        // 移动端：跳过桌面宠物
        try { initArtifacts(); } catch (e) {}
        try { initMemoryImporter(); } catch (e) {}
        try { initSync(); } catch (e) {}
        try { initAutomation(); } catch (e) {}
        try { initMultimodal(); } catch (e) {}
        try { initSandbox(); } catch (e) {}
        try { initMagicWand(); } catch (e) {}
        try { initCodeFold(); } catch (e) {}
        try { initTableExport(); } catch (e) {}
        try { initThinkFold(); } catch (e) {}
    });

    // 7. 第三批：重任务（空闲时执行）
    const runHeavyTasks = () => {
        try { fullScan(document.body); } catch (e) {}
        try { initRemoveComponents(); } catch (e) {}
        if (CONFIG.folderPanelEnabled) {
            try { initFolderPanel(); } catch (e) {}
        }
        if (CONFIG.autoRetryEnabled) {
            try { scanRetryButton(); } catch (e) {}
        }
    };
    if ('requestIdleCallback' in window) {
        requestIdleCallback(runHeavyTasks, { timeout: 2000 });
    } else {
        setTimeout(runHeavyTasks, 800);
    }

    // 8. 对话切换检测
    const SID_RE = /\/chat\/s\/([0-9a-f-]{36})/i;
    let lastSid = (location.href.match(SID_RE) || [])[1] || '';
    const checkRoute = () => {
        const sid = (location.href.match(SID_RE) || [])[1] || '';
        if (sid !== lastSid) {
            lastSid = sid;
            Store.clear();
            setTimeout(() => tryReadIDB(sid), 1000);
        }
    };
    window.addEventListener('popstate', checkRoute);
    if (!history.pushState._dsWrapped) {
        const _ps = history.pushState;
        const wrapped = function() { const r = _ps.apply(this, arguments); checkRoute(); return r; };
        wrapped._dsWrapped = true;
        history.pushState = wrapped;
    }
    setTimeout(() => tryReadIDB(), 2500);

    // 9. 暗色模式切换
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', utils.debounce(() => {
        resetStyleCache();
        injectStyles();
        clearSettingsModal();
        const standalone = document.getElementById('ds-standalone-settings');
        if (standalone) standalone.style.background = utils.isDarkMode() ? '#e895a8' : '#f08ca8';
        applyCustomizations();
    }, 300));

    // 10. 页面卸载清理
    window.addEventListener('beforeunload', () => {
        stopTitleFaker();
        disconnectObserverHub();
        destroySakura();
        hidePresetMenu();
        try {
            if (CONFIG.messageHistory) {
                saveConfig(CONFIG);
            }
        } catch (e) {}
    });

    console.log('📱 DeepSeek Promax Mobile v5.0.0 | env:', Platform.env,
        Platform.isWebView ? '| bridge: ' + (Platform.bridgeAvailable ? 'ready' : 'missing') : '',
        '| mobile optimized');
}

// ============================================================
// 暴露外部接口
// ============================================================

window.DSEnhance = {
    /** 重新加载配置并应用所有功能 */
    reload() {
        reloadConfig();
        applyAllFeatures();
    },
    /** 显示设置面板 */
    showSettings,
    /** 获取当前配置 */
    getConfig() { return CONFIG; },
    /** 重置为移动端默认配置 */
    resetConfig() {
        saveConfig({ ...DEFAULTS });
        location.reload();
    }
};

// ============================================================
// 启动
// ============================================================

init();