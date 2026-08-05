/**
 * 桌面端专属入口 - DeepSeek Promax 桌面版
 *
 * 与 index.js 共享同一套源码，但针对 Tauri 桌面端优化：
 *   1. 使用 DesktopPlatform 替代 Platform（原生文件系统/对话框/系统信息）
 *   2. 跳过 GM_* 和篡改猴相关功能（无沙箱、无 unsafeWindow）
 *   3. 注册全局 window._dsDesktopPlatform 供控制台调试
 *   4. 桌面端专属初始化：IPC 测试、原生文件系统注册
 *   5. 构建时不含油猴头部和 IIFE 包裹（直接注入到 WebView2）
 *
 * 构建产物：dspro.desktop.js — 由 Tauri 的 on_page_load 注入到 WebView2
 */

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
import { initProject } from './features/project/index.js';
import { initPet } from './features/pet/index.js';
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

// 桌面端专属：使用 DesktopPlatform 替代 Platform（原生文件系统/对话框/系统信息）
import { DesktopPlatform } from './platform/desktop-bridge.js';

// ============================================================
// 桌面端专属：全局注册
// ============================================================

// 将 DesktopPlatform 挂载到 window，供控制台调试和内部模块使用
window._dsDesktopPlatform = DesktopPlatform;

// 同时保持 Platform 兼容性（其他模块 import { Platform } from bridge.js 仍可用）
// DesktopPlatform 继承 Platform 的所有 API，模块可逐步迁移到 DesktopPlatform
window._dsPlatform = DesktopPlatform;

// ============================================================
// 核心：应用所有功能（用于 reload）
// ============================================================

/**
 * 应用所有功能：样式注入、樱花动画、标题伪装、Observer、XHR 钩子、自定义项、全量扫描
 * 在 window.DSEnhance.reload() 中调用
 */
function applyAllFeatures() {
    injectStyles();
    initSakura();
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
// 桌面端专属初始化
// ============================================================

/**
 * 桌面端专属初始化：IPC 测试、原生文件系统预热
 */
async function initDesktop() {
    console.log('[Desktop] Tauri 桌面端专属初始化开始...');

    // 1. IPC 连通性测试
    try {
        const pong = await DesktopPlatform.getAppVersion();
        console.log('[Desktop] 应用版本:', pong);
    } catch (e) {
        console.warn('[Desktop] 获取版本号失败:', e);
    }

    // 2. 获取应用数据目录并缓存
    try {
        const dataDir = await DesktopPlatform.getAppDataDir();
        console.log('[Desktop] 应用数据目录:', dataDir);
        window._dsDesktopDataDir = dataDir;
    } catch (e) {
        console.warn('[Desktop] 获取数据目录失败:', e);
    }

    console.log('[Desktop] Tauri 桌面端专属初始化完成');
}

// ============================================================
// 主初始化
// ============================================================

/**
 * 主初始化函数（桌面端优化版）
 *
 * 与 index.js 的 init() 共享相同的模块初始化逻辑，
 * 但使用 DesktopPlatform 并添加桌面端专属初始化步骤。
 */
async function init() {
    // 防重入
    if (window._dsInitStarted) {
        console.log('[DS-Promax Desktop] init() 已执行过，跳过重复初始化');
        return;
    }
    window._dsInitStarted = true;

    // 脚本总开关
    if (!CONFIG.scriptEnabled) {
        console.log('[DS-Promax Desktop] 脚本总开关已关闭，仅注入设置入口');
        await domReady();
        window.__dsConfig = CONFIG;
        injectMenuItem();
        // 桌面端仍执行基础初始化
        await initDesktop();
        return;
    }

    // 1. 自动跳转
    if (!window.__dsEarlyBootDone) {
        initRedirect();
    }

    // 2. 等待 DOM 就绪
    await domReady();

    // 3. 桌面端专属初始化（IPC 测试、原生文件系统）
    await initDesktop();

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

    // 5. 第二批：UI 增强（下一帧执行）
    requestAnimationFrame(() => {
        initSakura();
        if (CONFIG.titleFakerEnabled) initTitleFaker();
        applyCustomizations();
        initPresetMenu();
        injectMenuItem();
        initDefaultMode();
        initCopyCode();
        initCodeExecutor();
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
        // Agent 系统（Electron 下由 DeepSeek++ 扩展提供，跳过初始化避免重复注册）
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

        // Phase 6 模块
        try { startI18n(); } catch (e) {}
        try { initWebTools(); } catch (e) {}
        try { initMcp(); } catch (e) {}
        try { initProject(); } catch (e) {}
        try { initPet(); } catch (e) {}
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

    // 6. 第三批：重任务（空闲时执行）
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

    // 7. 对话切换检测
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

    // 8. 暗色模式切换
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', utils.debounce(() => {
        resetStyleCache();
        injectStyles();
        clearSettingsModal();
        const standalone = document.getElementById('ds-standalone-settings');
        if (standalone) standalone.style.background = utils.isDarkMode() ? '#e895a8' : '#f08ca8';
        applyCustomizations();
    }, 300));

    // 9. 页面卸载清理
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

    console.log('🌸 DeepSeek Promax Desktop v5.0.0 | env:', DesktopPlatform.env,
        DesktopPlatform.isElectron ? '| Electron IPC: ready' : '');
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
    /** 重置为默认配置 */
    resetConfig() {
        saveConfig({ ...DEFAULTS });
        location.reload();
    }
};

// ============================================================
// 启动
// ============================================================

init();