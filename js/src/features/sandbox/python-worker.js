/**
 * @module features/sandbox/python-worker
 *
 * Pyodide 懒加载器
 *
 * 模块职责：
 *   1. 在主线程按需从 CDN 加载 pyodide 运行时（约 10MB，必须懒加载）
 *   2. 通过注入 <script src="...pyodide.js"> 到 document.head 获取全局 loadPyodide 函数
 *   3. 调用 loadPyodide({ indexURL }) 初始化 WASM 运行时并返回实例
 *   4. 加载状态缓存：加载中返回同一 Promise，已加载返回缓存实例
 *   5. 加载进度回调 + window 自定义事件通知 UI
 *   6. 超时控制（默认 60s）、错误处理（CDN 不可达 / WASM 失败 / 内存不足）
 *   7. WebView 环境的 WASM 支持检测与降级提示
 *
 * 设计说明：
 *   - 参考实现 deepseek-pp/core/sandbox/python-worker.ts 使用 Web Worker + ES 模块导入 pyodide
 *   - 本项目运行在篡改猴 / Android WebView 注入环境，无法使用 ES 模块导入 pyodide，
 *     改为运行时注入 script 标签 + 使用全局 window.loadPyodide 函数
 *   - 模块导入时不加载 pyodide，首次调用 loadPyodide() 时才触发加载
 *
 * pyodide 版本：v0.26.2（固定，可通过 options.indexURL 切换 CDN/版本）
 */

// ============================================================
// 常量定义
// ============================================================

/** pyodide 版本号（固定，升级时同步修改） */
const PYODIDE_VERSION = 'v0.26.2';

/** pyodide CDN 基地址（jsdelivr） */
const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

/** 加载超时默认值（毫秒）：pyodide.js + WASM 合计约 10MB，60s 较为宽松 */
const DEFAULT_LOAD_TIMEOUT_MS = 60000;

/** 等待全局 loadPyodide 函数可用的轮询间隔（毫秒） */
const GLOBAL_POLL_INTERVAL_MS = 50;

/** 等待全局 loadPyodide 函数可用的最大时长（毫秒） */
const GLOBAL_POLL_TIMEOUT_MS = 5000;

// ============================================================
// 模块级状态（加载缓存）
// ============================================================

/** 已加载完成的 pyodide 实例（null 表示未加载） */
let pyodideInstance = null;

/** 加载中的 Promise（null 表示未在加载，非 null 表示正在加载） */
let pyodidePromise = null;

/** 加载错误（加载失败后缓存，便于诊断；再次调用时清空重试） */
let loadError = null;

// ============================================================
// 版本与配置查询
// ============================================================

/**
 * 获取当前固定的 pyodide 版本号
 * @returns {string} 版本号（如 'v0.26.2'）
 */
export function getPyodideVersion() {
    return PYODIDE_VERSION;
}

/**
 * 获取默认 pyodide CDN 基地址
 * @returns {string} CDN 基地址（以 / 结尾）
 */
export function getPyodideCdnBase() {
    return PYODIDE_CDN_BASE;
}

// ============================================================
// 加载状态查询
// ============================================================

/**
 * 判断 pyodide 是否已加载完成并可用
 * @returns {boolean} true 表示实例已就绪
 */
export function isPyodideLoaded() {
    return pyodideInstance !== null;
}

/**
 * 判断 pyodide 是否正在加载中
 * @returns {boolean} true 表示正在加载（尚未完成）
 */
export function isPyodideLoading() {
    return pyodidePromise !== null;
}

/**
 * 获取上一次加载错误（用于诊断与降级提示）
 * @returns {Error|null} 错误对象，无错误时返回 null
 */
export function getLoadError() {
    return loadError;
}

// ============================================================
// WebAssembly 支持检测
// ============================================================

/**
 * 检测当前环境是否支持 WebAssembly
 *
 * 旧版 Android WebView 可能不支持 WASM 或禁用了 WebAssembly，
 * 此时 pyodide 无法运行，需要降级提示用户。
 *
 * 检测策略：
 *   1. typeof WebAssembly !== 'undefined'
 *   2. WebAssembly.compile 是函数
 *   3. 尝试编译一个最小的 WASM 模块（magic + version 头）
 *
 * @returns {boolean} true 表示支持 WebAssembly
 */
export function isWebAssemblySupported() {
    try {
        if (typeof WebAssembly === 'undefined') return false;
        if (typeof WebAssembly.compile !== 'function') return false;
        if (typeof WebAssembly.Module !== 'function') return false;
        // 尝试编译最小 WASM 模块：magic number \0asm + version 1
        const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
        const mod = new WebAssembly.Module(bytes);
        return mod instanceof WebAssembly.Module;
    } catch (e) {
        return false;
    }
}

// ============================================================
// 加载进度通知
// ============================================================

/**
 * 派发加载进度事件（window 自定义事件，供 UI 监听）
 *
 * 事件名：ds-python-sandbox:progress
 * detail: { stage, message, version?, error? }
 *
 * stage 取值：
 *   - 'wasm_check'     WASM 支持检测
 *   - 'script_load'    正在加载 pyodide.js 脚本
 *   - 'runtime_init'   正在初始化 pyodide 运行时（加载 WASM）
 *   - 'loaded'         加载完成
 *   - 'error'          加载失败
 *
 * @param {string} stage - 阶段标识
 * @param {string} message - 人类可读的进度消息
 * @param {Object} [extra] - 附加字段
 */
function _dispatchProgress(stage, message, extra) {
    try {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
        const detail = { stage, message, ...(extra || {}) };
        window.dispatchEvent(new CustomEvent('ds-python-sandbox:progress', { detail }));
    } catch (e) {
        // 派发失败不影响主流程
    }
}

// ============================================================
// 脚本注入与全局函数等待
// ============================================================

/**
 * 等待全局 window.loadPyodide 函数可用（轮询）
 *
 * pyodide.js 脚本加载完成后会向 window 挂载 loadPyodide 函数，
 * 但脚本 onload 事件与全局赋值之间存在微小延迟，需轮询确认。
 *
 * @param {number} timeoutMs - 最大等待时长
 * @returns {Promise<void>} 函数可用时 resolve，超时 reject
 */
function _waitForGlobalLoadPyodide(timeoutMs) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (typeof window !== 'undefined' && typeof window.loadPyodide === 'function') {
                resolve();
                return;
            }
            if (Date.now() - start >= timeoutMs) {
                reject(new Error('等待 window.loadPyodide 全局函数超时（' + timeoutMs + 'ms），pyodide.js 可能未正确执行'));
                return;
            }
            setTimeout(check, GLOBAL_POLL_INTERVAL_MS);
        };
        check();
    });
}

/**
 * 注入 pyodide.js 脚本到 document.head 并等待全局 loadPyodide 可用
 *
 * 幂等：若已存在相同 src 的 script 标签，复用而不重复注入。
 *
 * @param {string} cdnBase - CDN 基地址（以 / 结尾）
 * @param {number} timeoutMs - 脚本加载超时（毫秒）
 * @returns {Promise<void>} 全局 loadPyodide 可用时 resolve
 */
function _injectPyodideScript(cdnBase, timeoutMs) {
    const scriptUrl = cdnBase + 'pyodide.js';
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            reject(new Error('document 不可用，无法注入 pyodide.js 脚本'));
            return;
        }

        // 复用已存在的 script 标签（避免重复注入）
        const existing = document.querySelector(`script[data-pyodide-script="${scriptUrl}"]`);
        if (existing) {
            if (typeof window !== 'undefined' && typeof window.loadPyodide === 'function') {
                resolve();
                return;
            }
            // 脚本已注入但全局函数尚未就绪，等待
            _waitForGlobalLoadPyodide(GLOBAL_POLL_TIMEOUT_MS).then(resolve, reject);
            return;
        }

        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.dataset.pyodideScript = scriptUrl;

        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('pyodide.js 脚本加载超时（' + timeoutMs + 'ms）：' + scriptUrl));
        }, timeoutMs);

        script.onload = () => {
            if (settled) return;
            _waitForGlobalLoadPyodide(GLOBAL_POLL_TIMEOUT_MS).then(() => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
            }, (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
        };
        script.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error('无法加载 pyodide.js（CDN 不可达或网络错误）：' + scriptUrl));
        };

        document.head.appendChild(script);
    });
}

// ============================================================
// 运行时初始化（带超时）
// ============================================================

/**
 * 调用全局 loadPyodide({ indexURL }) 初始化运行时（带超时控制）
 *
 * 此步骤会下载并编译 pyodide.asm.wasm（约 10MB），是耗时最长的阶段。
 * 使用 Promise.race 实现超时控制；超时后无法真正中断 WASM 编译，
 * 但会立即 reject 让调用方感知失败。
 *
 * @param {string} indexURL - pyodide 资源基址（用于加载 wasm 与内置包）
 * @param {number} timeoutMs - 初始化超时（毫秒）
 * @returns {Promise<Object>} pyodide 实例
 */
async function _initPyodideRuntime(indexURL, timeoutMs) {
    if (typeof window === 'undefined' || typeof window.loadPyodide !== 'function') {
        throw new Error('window.loadPyodide 不可用，pyodide.js 未正确加载');
    }

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('pyodide 运行时初始化超时（' + timeoutMs + 'ms），可能是网络过慢或 WASM 编译失败'));
        }, timeoutMs);
    });

    // 真正的初始化 Promise
    const initPromise = window.loadPyodide({ indexURL });

    // Promise.race 实现超时
    // 注意：超时后底层 WASM 编译可能仍在进行，无法真正中断（主线程限制）
    return Promise.race([initPromise, timeoutPromise]);
}

// ============================================================
// 主加载入口
// ============================================================

/**
 * 加载 pyodide 运行时（懒加载 + 状态缓存）
 *
 * 调用流程：
 *   1. 已加载：直接返回缓存实例
 *   2. 加载中：返回同一 Promise（避免重复加载）
 *   3. 未加载：
 *      a. WASM 支持检测（不支持则直接 reject，不发起网络请求）
 *      b. 注入 pyodide.js 脚本到 document.head
 *      c. 等待全局 loadPyodide 函数就绪
 *      d. 调用 loadPyodide({ indexURL }) 初始化运行时
 *      e. 缓存实例并返回
 *   4. 任一阶段失败：缓存错误，reject 并派发 error 事件
 *
 * @param {Object} [options] - 加载选项
 * @param {string} [options.indexURL] - pyodide 资源基址（默认使用 CDN）
 * @param {number} [options.timeoutMs=60000] - 总加载超时（毫秒）
 * @param {(stage: string, message: string) => void} [options.onProgress] - 进度回调
 * @param {boolean} [options.forceReload=false] - 强制重新加载（忽略缓存）
 * @returns {Promise<Object>} pyodide 实例
 *
 * @throws {Error} WASM 不支持 / CDN 不可达 / WASM 编译失败 / 内存不足 / 超时
 */
export async function loadPyodide(options = {}) {
    // 1. 已加载：返回缓存实例
    if (pyodideInstance && !options.forceReload) {
        return pyodideInstance;
    }

    // 2. 加载中：返回同一 Promise（避免重复加载）
    if (pyodidePromise && !options.forceReload) {
        return pyodidePromise;
    }

    const indexURL = (typeof options.indexURL === 'string' && options.indexURL.trim())
        ? options.indexURL.trim()
        : PYODIDE_CDN_BASE;
    const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
        ? options.timeoutMs
        : DEFAULT_LOAD_TIMEOUT_MS;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    /** 内部进度通知：同时触发回调与 window 事件 */
    const notify = (stage, message, extra) => {
        if (onProgress) {
            try { onProgress(stage, message); } catch (e) { /* 回调异常不影响主流程 */ }
        }
        _dispatchProgress(stage, message, extra);
    };

    // 3. 未加载：启动加载流程
    pyodidePromise = (async () => {
        loadError = null;

        // 3a. WASM 支持检测
        notify('wasm_check', '检测 WebAssembly 支持...');
        if (!isWebAssemblySupported()) {
            const err = new Error('当前环境不支持 WebAssembly（旧版 Android WebView 可能被禁用），pyodide 无法运行');
            loadError = err;
            notify('error', err.message, { error: err.message });
            throw err;
        }

        // 3b. 注入 pyodide.js 脚本
        notify('script_load', '正在加载 pyodide.js 脚本（CDN: ' + indexURL + '）...');
        try {
            await _injectPyodideScript(indexURL, timeoutMs);
        } catch (err) {
            loadError = err;
            notify('error', 'pyodide.js 脚本加载失败：' + err.message, { error: err.message });
            throw err;
        }

        // 3c+d. 初始化运行时（加载 WASM）
        notify('runtime_init', '正在初始化 pyodide 运行时（下载并编译 WASM，约 10MB）...');
        let pyodide;
        try {
            pyodide = await _initPyodideRuntime(indexURL, timeoutMs);
        } catch (err) {
            loadError = err;
            // 区分内存不足与其他错误
            const msg = err && err.message ? err.message : String(err);
            const isOom = /out of memory|内存不足|OOM/i.test(msg);
            const friendly = isOom
                ? 'pyodide 运行时初始化失败：内存不足（WASM 编译需要较多内存）'
                : 'pyodide 运行时初始化失败：' + msg;
            const finalErr = isOom ? new Error(friendly) : err;
            loadError = finalErr;
            notify('error', friendly, { error: friendly });
            throw finalErr;
        }

        // 3e. 缓存实例
        pyodideInstance = pyodide;
        notify('loaded', 'pyodide 运行时加载完成（版本 ' + PYODIDE_VERSION + '）', { version: PYODIDE_VERSION });
        return pyodide;
    })();

    try {
        return await pyodidePromise;
    } finally {
        // 加载完成后清空加载中标记（无论成功失败）
        // 注意：失败时保留 pyodideInstance=null，便于下次重试
        pyodidePromise = null;
    }
}

// ============================================================
// 运行时重置
// ============================================================

/**
 * 重置 pyodide 运行时（释放实例，下次 loadPyodide 重新加载）
 *
 * 用途：
 *   - 执行环境被污染需要彻底清理
 *   - 安装了有问题的包需要恢复干净环境
 *   - 释放内存（pyodide 实例占用较多内存）
 *
 * 注意：重置后再次调用 pythonExec 会触发重新加载（耗时）。
 *       本函数不销毁已注入的 script 标签（pyodide.js 仍可用，只需重新 init）。
 *
 * @returns {void}
 */
export function resetPyodideRuntime() {
    pyodideInstance = null;
    pyodidePromise = null;
    loadError = null;
    _dispatchProgress('reset', 'pyodide 运行时已重置，下次调用将重新加载');
}

/**
 * 获取已加载的 pyodide 实例（不触发加载）
 *
 * 用于工具函数内部获取实例，避免在未加载时误触发加载。
 *
 * @returns {Object|null} pyodide 实例，未加载时返回 null
 */
export function getPyodideInstance() {
    return pyodideInstance;
}
