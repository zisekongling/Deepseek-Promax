/**
 * @module features/sandbox
 *
 * Python 沙箱模块入口
 *
 * 模块职责：
 *   1. initSandbox() 幂等初始化：合并 CONFIG 默认值、暴露 window._dsPython 接口
 *   2. 注册 window._dsPython = { exec, installPackage, listInstalledPackages, isReady, loadPyodide }
 *   3. 导出 python_exec 工具描述符供 capability-register 集成（Phase 1.4 统一注册）
 *   4. 监听 pyodide 加载进度事件，经 toast 通知 UI
 *
 * 与其他模块的协作：
 *   - 不修改 config.js / capability-register.js / settings-panel.js（Phase 6 统一集成）
 *   - CONFIG 默认值在 initSandbox 中合并到运行时 CONFIG，不持久化到 localStorage
 *   - 工具描述符导出后，由 Phase 1.4 的 capability-register 统一注册到工具调用目录
 *
 * CONFIG 新增键：
 *   - pythonSandboxEnabled (bool, 默认 false)：Python 沙箱总开关
 *     启用后 AI 可经 python_exec 工具执行 Python 代码
 *     注意：pyodide 加载约 10MB，仅在用户显式启用时才尝试加载
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';
import { showToast } from '../../ui/toast.js';
import {
    loadPyodide,
    isPyodideLoaded,
    isPyodideLoading,
    isWebAssemblySupported,
    getPyodideVersion,
    getLoadError
} from './python-worker.js';
import {
    pythonExec,
    installPackage,
    listInstalledPackages,
    resetPythonEnv,
    isSandboxReady
} from './tool.js';

// ============================================================
// CONFIG 默认值声明
// ============================================================

/**
 * 本模块新增的 CONFIG 默认值
 *
 * 不直接修改 config.js 的 DEFAULTS，而是在 initSandbox() 中合并到运行时 CONFIG 对象。
 * Phase 6 统一集成时会迁移到 config.js 的 DEFAULTS 中。
 *
 * @type {Object}
 */
const SANDBOX_DEFAULTS = {
    /** Python 沙箱总开关（默认关闭，启用后 AI 可调用 python_exec 工具） */
    pythonSandboxEnabled: false
};

// ============================================================
// 工具描述符（供 Phase 1.4 capability-register 集成）
// ============================================================

/**
 * python_exec 工具描述符
 *
 * 遵循 tool-descriptors.js 的 ToolDescriptor 格式，
 * Phase 1.4 时由 capability-register 统一注册到工具调用目录。
 *
 * 工具行为：
 *   - 在 pyodide 沙箱中执行 Python 代码
 *   - 捕获 stdout/stderr 并返回结构化结果
 *   - 默认超时 10s，代码长度上限 100KB
 *   - 首次调用会触发 pyodide 加载（约 10MB，耗时数秒）
 *
 * @type {{ name: string, description: string, category: string, inputSchema: Object }}
 */
export const PYTHON_EXEC_TOOL_DESCRIPTOR = {
    name: 'python_exec',
    description: '在浏览器内置 Python 沙箱（pyodide）中执行 Python 代码，返回 stdout/stderr 与执行结果',
    category: 'sandbox',
    inputSchema: {
        type: 'object',
        properties: {
            code: {
                type: 'string',
                description: '要执行的 Python 代码（支持多行，默认上限 100KB）'
            },
            timeoutMs: {
                type: 'integer',
                description: '执行超时毫秒数（默认 10000，上限 15000）'
            },
            reset: {
                type: 'boolean',
                description: '是否在执行前清理用户全局命名空间（默认 false）'
            }
        },
        required: ['code']
    }
};

/** 模块是否已初始化（幂等保护） */
let installed = false;

// ============================================================
// CONFIG 安全读取
// ============================================================

/**
 * 安全获取最新的 CONFIG 引用，并合并本模块的默认值
 *
 * 优先读 window.__dsConfig（saveConfig 时会同步更新），
 * 回退到静态导入的 _CONFIG_SNAPSHOT。
 *
 * @returns {Object} 合并了 SANDBOX_DEFAULTS 的配置对象
 */
function _getConfigSafe() {
    let cfg;
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            cfg = window.__dsConfig;
        } else {
            cfg = _CONFIG_SNAPSHOT;
        }
    } catch (e) {
        cfg = _CONFIG_SNAPSHOT;
    }
    if (!cfg || typeof cfg !== 'object') cfg = {};
    // 合并本模块默认值（不覆盖用户已设置的值）
    return { ...SANDBOX_DEFAULTS, ...cfg };
}

// ============================================================
// 工具执行器包装（带 CONFIG 开关检查）
// ============================================================

/**
 * 执行 python_exec 工具调用（带 CONFIG 开关检查）
 *
 * 供 capability-register.js 的 executeToolCall 集成时调用，
 * 返回与 capability-register 一致的 { ok, summary, detail? } 结构。
 *
 * 行为：
 *   1. 检查 CONFIG.pythonSandboxEnabled 开关（未启用时返回提示）
 *   2. 检查 WASM 支持（不支持时返回降级提示）
 *   3. 调用 pythonExec 执行代码
 *   4. 将结果转换为 capability-register 的返回格式
 *
 * @param {Object} payload - { code: string, timeoutMs?: number, reset?: boolean }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
export async function executePythonExecToolCall(payload) {
    const cfg = _getConfigSafe();

    // 1. 开关检查
    if (!cfg.pythonSandboxEnabled) {
        return {
            ok: false,
            summary: 'Python 沙箱未启用',
            detail: '请前往设置页开启 pythonSandboxEnabled（注意：pyodide 约 10MB，首次加载耗时）'
        };
    }

    // 2. WASM 支持检查
    if (!isWebAssemblySupported()) {
        return {
            ok: false,
            summary: '当前环境不支持 WebAssembly',
            detail: 'Python 沙箱依赖 WebAssembly，旧版 Android WebView 可能不支持。请升级 WebView 或更换环境。'
        };
    }

    // 3. 参数校验
    if (!payload || typeof payload.code !== 'string' || !payload.code.trim()) {
        return { ok: false, summary: '参数错误', detail: 'code 必须是非空字符串' };
    }

    // 4. 执行 Python 代码
    const options = {};
    if (typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0) {
        options.timeoutMs = Math.min(Math.floor(payload.timeoutMs), 15000);
    }
    if (payload.reset === true) {
        options.reset = true;
    }

    const result = await pythonExec(payload.code, options);

    // 5. 转换为 capability-register 返回格式
    if (result.ok) {
        const timeStr = typeof result.executionTime === 'number' ? '（耗时 ' + result.executionTime + 'ms）' : '';
        const resultStr = result.result ? '\n--- 结果 ---\n' + result.result : '';
        const truncatedStr = result.truncated ? '\n[输出已被截断]' : '';
        const detail = [
            '--- stdout ---',
            result.stdout || '（无输出）',
            result.stderr ? '\n--- stderr ---\n' + result.stderr : '',
            resultStr,
            truncatedStr,
            timeStr
        ].filter(Boolean).join('\n');
        return {
            ok: true,
            summary: 'Python 执行成功' + timeStr,
            detail
        };
    }

    // 失败
    const detail = [
        '--- stdout ---',
        result.stdout || '（无输出）',
        result.stderr ? '\n--- stderr ---\n' + result.stderr : '',
        '\n--- error ---\n' + (result.error || '未知错误')
    ].filter(Boolean).join('\n');
    return {
        ok: false,
        summary: 'Python 执行失败' + (result.error === 'sandbox_timeout' ? '（超时）' : ''),
        detail
    };
}

// ============================================================
// 加载进度 UI 通知
// ============================================================

/**
 * 监听 pyodide 加载进度事件，经 toast 通知 UI
 *
 * 事件来源：python-worker.js 派发的 'ds-python-sandbox:progress' 自定义事件
 * 仅在关键阶段显示 toast，避免频繁打扰用户：
 *   - script_load / runtime_init：提示用户正在加载（首次耗时）
 *   - loaded：加载完成
 *   - error：加载失败
 */
function _attachProgressListener() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    // 防止重复绑定
    if (window._dsPythonProgressBound) return;
    window._dsPythonProgressBound = true;

    let loadingToastShown = false;

    window.addEventListener('ds-python-sandbox:progress', (event) => {
        const detail = event && event.detail;
        if (!detail) return;
        const stage = detail.stage;
        const message = detail.message;

        try {
            switch (stage) {
                case 'script_load':
                case 'runtime_init':
                    // 仅在首次提示一次（避免重复 toast）
                    if (!loadingToastShown) {
                        loadingToastShown = true;
                        showToast('正在加载 Python 运行时（约 10MB，请稍候）...', { tone: 'info', duration: 5000 });
                    }
                    break;
                case 'loaded':
                    loadingToastShown = false;
                    showToast('Python 沙箱已就绪（pyodide ' + (detail.version || getPyodideVersion()) + '）', { tone: 'success', duration: 3000 });
                    break;
                case 'error':
                    loadingToastShown = false;
                    showToast('Python 沙箱加载失败：' + (detail.error || message || '未知错误'), { tone: 'error', duration: 6000 });
                    break;
                case 'reset':
                    loadingToastShown = false;
                    // reset 不弹 toast（静默操作）
                    break;
                default:
                    // wasm_check 等阶段不弹 toast
                    break;
            }
        } catch (e) {
            // toast 失败不影响主流程
        }
    });
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化 Python 沙箱模块（幂等）
 *
 * 执行内容：
 *   1. 将 SANDBOX_DEFAULTS 合并到运行时 CONFIG（不覆盖用户已设置的值）
 *   2. 同步到 window.__dsConfig（与 config.js 的 saveConfig 行为一致）
 *   3. 暴露 window._dsPython 接口（exec / installPackage / listInstalledPackages / isReady / loadPyodide）
 *   4. 暴露 window._dsExecutePythonExec 工具执行器（供 capability-register 集成调用，避免循环依赖）
 *   5. 暴露 window._dsPythonExecDescriptor 工具描述符（供 Phase 1.4 注册发现）
 *   6. 绑定 pyodide 加载进度事件监听（toast 通知 UI）
 *
 * 不修改 localStorage 持久化（Phase 6 统一集成时由 config.js 处理）。
 * 不修改 capability-register.js（Phase 1.4 统一注册工具描述符）。
 *
 * 重要：本函数不会立即加载 pyodide，仅在首次 pythonExec 调用时懒加载。
 *
 * @returns {void}
 */
export function initSandbox() {
    if (installed) return;
    installed = true;

    // 1. 合并默认值到运行时 CONFIG（不覆盖用户已设置的值）
    try {
        const targetCfg = (typeof window !== 'undefined' && window.__dsConfig) ? window.__dsConfig : _CONFIG_SNAPSHOT;
        if (targetCfg && typeof targetCfg === 'object') {
            let modified = false;
            for (const k of Object.keys(SANDBOX_DEFAULTS)) {
                if (!(k in targetCfg) || targetCfg[k] === undefined) {
                    targetCfg[k] = SANDBOX_DEFAULTS[k];
                    modified = true;
                }
            }
            // 同步到 window.__dsConfig（不调 saveConfig 以免触发持久化）
            if (modified && typeof window !== 'undefined') {
                window.__dsConfig = targetCfg;
            }
        }
    } catch (e) {
        if (typeof console !== 'undefined') {
            console.warn('[sandbox] init merge defaults failed:', e);
        }
    }

    // 2. 暴露 window._dsPython 接口
    if (typeof window !== 'undefined') {
        /**
         * Python 沙箱公开接口
         * @memberof window
         * @namespace _dsPython
         */
        window._dsPython = {
            /** 执行 Python 代码（首次调用触发懒加载） */
            exec: pythonExec,
            /** 安装纯 Python 包（经 micropip） */
            installPackage: installPackage,
            /** 列出已安装包 */
            listInstalledPackages: listInstalledPackages,
            /** 判断沙箱是否已就绪（pyodide 已加载） */
            isReady: function () { return isSandboxReady(); },
            /** 主动加载 pyodide（可选，不调用则首次 exec 时懒加载） */
            loadPyodide: loadPyodide,
            /** 重置执行环境（释放 pyodide 实例，下次重新加载） */
            reset: resetPythonEnv,
            /** 查询 pyodide 版本 */
            getVersion: getPyodideVersion,
            /** 检测 WebAssembly 支持 */
            isWebAssemblySupported: isWebAssemblySupported
        };

        // 3. 暴露工具执行器（供 capability-register 集成调用，避免 ES Module 循环依赖）
        if (typeof window._dsExecutePythonExec !== 'function') {
            window._dsExecutePythonExec = executePythonExecToolCall;
        }

        // 4. 暴露工具描述符（供 Phase 1.4 capability-register 发现与注册）
        if (!window._dsPythonExecDescriptor) {
            window._dsPythonExecDescriptor = PYTHON_EXEC_TOOL_DESCRIPTOR;
        }

        // 5. 暴露加载状态查询（供 UI 显示加载中状态）
        if (!window._dsPythonStatus) {
            window._dsPythonStatus = function () {
                return {
                    loaded: isPyodideLoaded(),
                    loading: isPyodideLoading(),
                    wasmSupported: isWebAssemblySupported(),
                    version: getPyodideVersion(),
                    error: getLoadError() ? (getLoadError().message || String(getLoadError())) : null
                };
            };
        }
    }

    // 6. 绑定加载进度事件监听（toast 通知 UI）
    _attachProgressListener();

    if (typeof console !== 'undefined') {
        console.log('[sandbox] initialized (pyodide ' + getPyodideVersion() + ', lazy-loaded on first exec)');
    }
}

// ============================================================
// 导出（供外部模块使用）
// ============================================================

export {
    loadPyodide,
    isPyodideLoaded,
    isPyodideLoading,
    isWebAssemblySupported,
    getPyodideVersion,
    getLoadError,
    pythonExec,
    installPackage,
    listInstalledPackages,
    resetPythonEnv,
    isSandboxReady
};
