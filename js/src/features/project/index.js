/**
 * 项目模块入口（Project Module Entry）
 *
 * 职责：
 *   - 提供 initProject() 幂等初始化入口
 *   - 注册 window._dsProject 供外部调用（store API + injector API）
 *   - 安装项目注入器（注册 window._dsProjectInjector 回调）
 *   - 初始化侧栏项目面板
 *   - 集成 injector 到会话切换检测（监听 URL 变化，参考 conversation-detector.js）
 *
 * 集成说明（Phase 6 统一集成）：
 *   - 本模块不修改 config.js / settings-panel.js / 主 index.js
 *   - CONFIG.projectEnabled 在 Phase 6 添加到 config.js 的 DEFAULTS（默认 false）
 *   - 注入器通过 window._dsProjectInjector 暴露，由 Phase 6 接线到
 *     utils/prompt-augmentation.js 的 buildPromptPrefix
 *   - 在 CONFIG.projectEnabled 为 false 时，所有注入与面板初始化均不执行，
 *     确保不影响未启用该功能的用户
 *
 * 不破坏现有 Agent 闭环：
 *   - 不覆写 window._dsMemoryInjector / window._dsCapabilityInjector
 *   - URL 监听使用独立的历史包装标记（_dsProjectWrapped），与 folder-panel 错开
 */

import {
    isProjectEnabled,
    flushProjects,
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    addSessionToProject,
    removeSessionFromProject,
    listProjectMemories,
    addProjectMemory,
    updateProjectMemory,
    deleteProjectMemory
} from './store.js';
import {
    installProjectInjector,
    uninstallProjectInjector,
    getProjectContextForSession
} from './injector.js';
import { initProjectPanel, refreshProjectPanel } from './panel.js';
import { getSidFromUrl } from '../data-store.js';

// ============================================================
// 内部状态
// ============================================================

/** 模块是否已初始化（幂等保护） */
let initialized = false;

/** URL 变化监听定时器 */
let _urlWatchTimer = null;

/** 最近一次检测到的 URL（用于检测会话切换） */
let _lastUrl = '';

/** 最近一次注入使用的 sessionId（避免同一会话重复查询） */
let _lastSid = null;

// ============================================================
// 会话切换检测（参考 folder-panel.js 的 URL 监听）
// ============================================================

/**
 * 处理会话切换：刷新面板视图
 *
 * 当 URL 变化时（用户切换会话），项目面板需要刷新以更新
 * "当前会话"标记与"加入当前会话"按钮状态。
 *
 * 注意：注入器本身不依赖 URL 监听——它在 fetch 请求发出时被调用，
 * 届时 getSidFromUrl() 已能返回新会话的 ID。这里监听 URL 仅用于面板视图刷新。
 */
function onUrlChange() {
    if (location.href === _lastUrl) return;
    _lastUrl = location.href;
    // 面板刷新（更新当前会话标记）
    refreshProjectPanel();
    // 记录当前 sessionId，供调试/外部查询
    const sid = getSidFromUrl();
    if (sid !== _lastSid) {
        _lastSid = sid;
    }
}

/**
 * 安装 URL 变化监听
 *
 * 采用 setInterval 轮询 + popstate 监听的方式（与 folder-panel.js 错开，
 * 避免与已有的 history.pushState/replaceState 包装产生冲突）。
 * 轮询间隔 2000ms，开销可忽略。
 */
function installUrlWatcher() {
    if (_urlWatchTimer) return;
    _lastUrl = location.href;
    _lastSid = getSidFromUrl();

    window.addEventListener('popstate', onUrlChange);
    _urlWatchTimer = setInterval(onUrlChange, 2000);
}

/**
 * 卸载 URL 变化监听
 */
function uninstallUrlWatcher() {
    if (_urlWatchTimer) {
        clearInterval(_urlWatchTimer);
        _urlWatchTimer = null;
    }
    window.removeEventListener('popstate', onUrlChange);
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 构建 store 层 API 映射（用于挂载到 window._dsProject，供外部调用）
 * @returns {Object} store API 对象
 */
function _buildStoreApi() {
    return {
        listProjects,
        getProject,
        createProject,
        updateProject,
        deleteProject,
        addSessionToProject,
        removeSessionFromProject,
        listProjectMemories,
        addProjectMemory,
        updateProjectMemory,
        deleteProjectMemory
    };
}

/**
 * 初始化项目模块（幂等）
 *
 * 执行流程：
 *   1. 幂等检查：已初始化则直接返回
 *   2. 安装项目注入器（注册 window._dsProjectInjector）
 *   3. 初始化侧栏项目面板（注入到 DeepSeek 历史侧栏）
 *   4. 安装 URL 变化监听（用于面板视图刷新）
 *   5. 注册 window._dsProject 供外部调用
 *
 * 当 CONFIG.projectEnabled 为 false 时：
 *   - 仍注册 window._dsProjectInjector（内部会检查开关，返回空串）
 *   - 不初始化面板，不安装 URL 监听
 *   - 这样 Phase 6 接线后，开关切换无需重新初始化即可生效
 *
 * @returns {void}
 */
export function initProject() {
    if (initialized) return;
    initialized = true;

    // 1. 安装注入器（始终安装，内部按开关决定是否返回注入文本）
    installProjectInjector();

    // 2. 注册 window._dsProject 供外部调用
    if (typeof window !== 'undefined') {
        // 延迟引入 store CRUD，避免循环依赖并保持 window 对象精简
        const storeApi = _buildStoreApi();
        window._dsProject = {
            // 模块状态
            isEnabled: isProjectEnabled,

            // 初始化与生命周期
            init: initProject,
            reinit: reinitProject,
            destroy: destroyProject,
            refreshPanel: refreshProjectPanel,

            // 注入器 API
            getContextForSession: getProjectContextForSession,
            installInjector: installProjectInjector,
            uninstallInjector: uninstallProjectInjector,

            // 存储层 API（re-export，方便外部调试与集成）
            flush: flushProjects,
            ...storeApi
        };
    }

    // 3. 仅在启用时初始化面板与 URL 监听
    if (!isProjectEnabled()) {
        return;
    }

    initProjectPanel();
    installUrlWatcher();

    // 页面卸载前 flush 待写入数据
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', flushProjects);
    }
}

/**
 * 重新初始化项目模块（用于配置变更后重新装配面板）
 *
 * 场景：用户在设置面板中开启 projectEnabled 后，需要挂载面板。
 * 此时调用 reinitProject 即可挂载面板与 URL 监听，无需重新注册注入器。
 */
export function reinitProject() {
    if (!isProjectEnabled()) return;
    initProjectPanel();
    installUrlWatcher();
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', flushProjects);
    }
}

/**
 * 销毁项目模块（对外暴露的可选接口，用于卸载）
 */
export function destroyProject() {
    if (!initialized) return;
    initialized = false;
    uninstallProjectInjector();
    uninstallUrlWatcher();
    flushProjects();
}

// 默认导出 initProject，便于主入口按需调用
export default initProject;
