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
// Agent 系统（统一入口，替代 capability-register + capability-agent）
import { initAgentSystem } from './agent/index.js';
import { initTodoManager } from './features/todo.js';
import { initAskUserManager } from './features/ask-user.js';
// === Phase 6 新增模块导入 ===
// i18n：导入即自动初始化（startI18n 在模块加载时执行），显式导入 startI18n 以便初始化流程中调用
import { startI18n } from './features/i18n/index.js';
// Web 工具（web_search / web_fetch）
import { initWebTools } from './features/web-tools.js';
// MCP 客户端（含 renderMcpPrompt 供能力投影调用）
import { initMcp } from './features/mcp/client.js';
import { renderMcpPrompt } from './features/mcp/capability-projection.js';
// 项目管理工作台
import { initProject } from './features/project/index.js';
// 桌面宠物
import { initPet } from './features/pet/index.js';
// 制品导出
import { initArtifacts } from './features/artifacts/index.js';
// 记忆导入
import { initMemoryImporter } from './features/memory-importer.js';
// 数据同步（WebDAV）
import { initSync } from './features/sync/index.js';
// 自动化调度
import { initAutomation } from './features/automation/index.js';
// 多模态分析
import { initMultimodal } from './features/multimodal/index.js';
// 专家模式文件上传
import { initFileUpload } from './features/file-upload.js';
// Python 沙箱
import { initSandbox } from './features/sandbox/index.js';
// 页面缩略控制
import { initMagicWand } from './features/magic-wand.js';
// 代码块折叠
import { initCodeFold } from './features/code-fold.js';
// 表格优化导出
import { initTableExport } from './features/table-export.js';
// AI思考过程自动折叠
import { initThinkFold } from './features/think-fold.js';
// 平台桥接：导入即注册 window._dsBridgeCallback 并完成环境探测（webview/tampermonkey）
// 各模块按需 import { Platform } from './platform/bridge.js' 调用原生能力
import { Platform } from './platform/bridge.js';

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
    // observer.js 已删除，直接调用 observer-hub 的 registerDomHandler 触发 install
    // 传入空对象作为占位处理器，实际业务由各模块自行 registerDomHandler
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

    // 脚本总开关：关闭后仅注入设置面板入口，不执行任何功能增强
    // 仍保留 window.DSEnhance 和设置菜单，让用户可以重新开启
    if (!CONFIG.scriptEnabled) {
        console.log('[DS-Promax] 脚本总开关已关闭，仅注入设置入口');
        await domReady();
        window.__dsConfig = CONFIG;
        injectMenuItem();
        return;
    }

    // 1. 自动跳转（document-start 阶段立即执行）
    // WebView 环境：early-boot stub 已在 onPageStarted 处理跳转，此处跳过避免重复
    if (!window.__dsEarlyBootDone) {
        initRedirect();
    }

    // 2. 等待 DOM 就绪
    await domReady();

    // 3. 第一批：关键功能（样式 + Observer + XHR 钩子，必须尽早生效）
    // 暴露 CONFIG 到 window，供需要动态读取最新配置的模块使用
    window.__dsConfig = CONFIG;
    injectStyles();
    // observer.js 已删除，直接调用 observer-hub 的 registerDomHandler 触发 install
    if (!window.__dsObserverTouched) {
        window.__dsObserverTouched = true;
        registerDomHandler({});
    }
    // WebView 环境：early-boot stub 已安装 XHR hook（幂等保护也已生效），此处跳过仅为语义清晰
    // 篡改猴环境：document-start 阶段首次安装
    if (!window.__dsEarlyBootDone) {
        installXhrHook();
    }

    // 4. 第二批：UI 增强（下一帧执行，不阻塞首屏）
    requestAnimationFrame(() => {
        initSakura();
        if (CONFIG.titleFakerEnabled) initTitleFaker();
        applyCustomizations();
        initPresetMenu();
        injectMenuItem();
        initDefaultMode();
        initCopyCode();
        initCodeExecutor();
        // 效率工具模块初始化
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
            try { initAgentSystem(); } catch (e) {}
        }
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

        // Phase 6 新模块初始化（按依赖顺序，每个 try-catch 独立，失败不阻塞其他模块）
        // 1. i18n 最先：其他模块可能调用 window._dsI18n.t()（导入时已自动初始化，此处显式调用确保幂等）
        try { startI18n(); } catch (e) {}
        // 2. Web 工具：注册 window._dsExecuteWebSearch / _dsExecuteWebFetch
        try { initWebTools(); } catch (e) {}
        // 3. MCP 客户端：注册 window._dsMcp 接口
        try { initMcp(); } catch (e) {}
        // 4. 项目管理工作台：注册 window._dsProject，内部按开关决定是否初始化面板
        try { initProject(); } catch (e) {}
        // 5. 桌面宠物：注册 window._dsPet，内部按 CONFIG.petEnabled 决定是否显示
        try { initPet(); } catch (e) {}
        // 6. 制品导出
        try { initArtifacts(); } catch (e) {}
        // 7. 记忆导入
        try { initMemoryImporter(); } catch (e) {}
        // 8. 数据同步（WebDAV）
        try { initSync(); } catch (e) {}
        // 9. 自动化调度
        try { initAutomation(); } catch (e) {}
        // 10. 多模态分析
        try { initMultimodal(); } catch (e) {}
        // 10.5. 专家模式文件上传
        try { initFileUpload(); } catch (e) {}
        // 11. Python 沙箱
        try { initSandbox(); } catch (e) {}
        // 12. 页面缩略控制
        try { initMagicWand(); } catch (e) {}
        // 13. 代码块折叠
        try { initCodeFold(); } catch (e) {}
        // 14. 表格优化导出
        try { initTableExport(); } catch (e) {}
        // 15. AI思考过程自动折叠
        try { initThinkFold(); } catch (e) {}
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
        disconnectObserverHub();
        destroySakura();
        hidePresetMenu();
        try {
            if (CONFIG.messageHistory) {
                saveConfig(CONFIG);
            }
        } catch (e) {}
    });

    console.log('🌸 DeepSeek Promax 已激活 v5.0.0 | env:', Platform.env,
        Platform.isWebView ? '| bridge: ' + (Platform.bridgeAvailable ? 'ready' : 'missing') : '');
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
