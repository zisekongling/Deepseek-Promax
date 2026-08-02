/**
 * 入口文件 - DeepSeek Promax 油猴脚本
 *
 * 负责编排所有模块的初始化顺序：
 *   1. 自动跳转检查（document-start 阶段）
 *   2. 等待 DOM 就绪
 *   3. 注入样式、启动樱花动画、标题伪装
 *   4. 设置 MutationObserver、XHR 钩子、输入监听
 *   5. 应用自定义字体/背景
 *   6. 注入菜单项
 *   7. 延迟全量扫描 + 重试按钮扫描
 *   8. 监听暗色模式切换
 *
 * 暴露 window.DSEnhance 供外部调用。
 */

// ============================================================
// 模块导入
// ============================================================
import { CONFIG, DEFAULTS, saveConfig, reloadConfig } from './config.js';
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
import { setupObserver, disconnectObserver } from './observer.js';
import { applyCustomizations } from './customizations/background.js';
import { showSettings, clearSettingsModal } from './ui/settings-panel.js';
import { injectMenuItem } from './ui/menu-inject.js';
import { initPresetMenu, hidePresetMenu } from './ui/preset-menu.js';
import { Store, tryReadIDB, getSidFromUrl } from './features/data-store.js';
import { initCopyCode } from './features/copy-code.js';
import { initFolderPanel } from './ui/folder-panel.js';
import { initLoopEngine } from './features/loop-engine.js';
import { initRoadmap } from './features/roadmap.js';
import { initHandoff } from './features/handoff.js';
import { initPersonas } from './features/personas.js';
import { initWorkflows } from './features/workflows.js';
import { initPostures } from './features/postures.js';
import { initPayloads } from './features/payloads.js';

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
    setupObserver();
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
// 初始化
// ============================================================

/**
 * 主初始化函数
 * 分批启动：关键功能优先，非关键功能延迟到空闲时
 * 包含防重入保护：使用 window 全局变量，确保跨脚本实例（油猴重复加载）不会重复初始化
 */
async function init() {
    // 防重入：使用 window 全局变量，跨脚本实例共享
    if (window._dsInitStarted) {
        console.log('[DS-Promax] init() 已执行过，跳过重复初始化');
        return;
    }
    window._dsInitStarted = true;

    // 1. 自动跳转（document-start 阶段立即执行）
    initRedirect();

    // 2. 等待 DOM 就绪
    await domReady();

    // 3. 第一批：关键功能（样式 + Observer + XHR 钩子，必须尽早生效）
    injectStyles();
    setupObserver();
    installXhrHook();

    // 4. 第二批：UI 增强（下一帧执行，不阻塞首屏）
    requestAnimationFrame(() => {
        initSakura();
        if (CONFIG.titleFakerEnabled) initTitleFaker();
        applyCustomizations();
        initPresetMenu();
        injectMenuItem();
        initDefaultMode();
        initCopyCode();
        if (CONFIG.loopEngineEnabled || CONFIG.loopCrashRecoveryEnabled) {
            try { initLoopEngine(); } catch (e) {}
        }
        if (CONFIG.loopEngineEnabled) {
            // 顺序很重要：payloads/postures/personas/workflows 必须先于 roadmap/handoff
            // 因为 roadmap/handoff 会读取这些模块的状态/标签
            try { initPayloads(); } catch (e) {}
            try { initPostures(); } catch (e) {}
            try { initPersonas(); } catch (e) {}
            try { initWorkflows(); } catch (e) {}
            try { initRoadmap(); } catch (e) {}
            try { initHandoff(); } catch (e) {}
        }
    });

    // 5. 第三批：全量扫描 + 组件移除 + 文件夹面板（延迟到空闲时，避免阻塞首屏交互）
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

    // 6. 对话切换检测：重置 Store 并尝试从 IndexedDB 恢复数据
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
    // 覆写 pushState：添加标记防止多次覆写导致递归栈溢出
    if (!history.pushState._dsWrapped) {
        const _ps = history.pushState;
        const wrapped = function() { const r = _ps.apply(this, arguments); checkRoute(); return r; };
        wrapped._dsWrapped = true;
        history.pushState = wrapped;
    }
    setTimeout(() => tryReadIDB(), 2500);

    // 7. 监听暗色模式切换
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', utils.debounce(() => {
        resetStyleCache();
        injectStyles();
        clearSettingsModal();
        const standalone = document.getElementById('ds-standalone-settings');
        if (standalone) standalone.style.background = utils.isDarkMode() ? '#e895a8' : '#f08ca8';
        applyCustomizations();
    }, 300));

    // 8. 页面卸载前清理 + 保存消息历史
    window.addEventListener('beforeunload', () => {
        stopTitleFaker();
        disconnectObserver();
        destroySakura();
        hidePresetMenu();
        try {
            if (CONFIG.messageHistory) {
                saveConfig(CONFIG);
            }
        } catch (e) {}
    });

    console.log('🌸 DeepSeek Promax 已激活 v4.0.0');
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
