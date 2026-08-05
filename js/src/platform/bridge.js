/**
 * 平台桥接模块
 *
 * 提供跨环境的统一 API：在篡改猴环境中降级为 Web 实现/noop，
 * 在 Android WebView 环境中通过 window.AndroidBridge 调用原生能力。
 *
 * 设计原则：
 *   1. 所有 API 返回 Promise（同步 API 立即 resolve），调用方无需关心环境差异
 *   2. 原生端只需实现两个入口：invokeSync（同步返回字符串）+ invokeAsync（异步回调）
 *   3. 异步回调通过全局 window._dsBridgeCallback(id, success, resultJson) 派发
 *   4. 篡改猴环境对有 Web 等价物的 API 自动降级（clipboard/vibrate/share）
 *
 * 原生桥接协议：
 *   window.AndroidBridge.invokeSync(methodName, jsonArgsString) -> string
 *   window.AndroidBridge.invokeAsync(methodName, jsonArgsString, callbackId) -> void
 *   原生完成异步操作后调用：
 *     webView.evaluateJavascript(
 *       "window._dsBridgeCallback('" + callbackId + "', " + (ok?1:0) + ", " + resultJson + ")",
 *       null
 *     );
 */

// ============================================================
// 环境探测
// ============================================================

/**
 * 检测是否运行在 Android WebView 宿主中
 * 通过 window.AndroidBridge 是否存在判断
 * @type {boolean}
 */
const IS_WEBVIEW = (typeof window !== 'undefined') && !!window.AndroidBridge;

/**
 * 检测是否运行在 Electron 桌面端
 * Electron preload 脚本注入 window.__TAURI_INTERNALS__ 模拟 Tauri IPC 接口
 * 同时检查 window.__TAURI__（withGlobalTauri 注入的公开 API）作为兼容
 * @type {boolean}
 */
const IS_ELECTRON = (typeof window !== 'undefined') && !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

/**
 * @deprecated 使用 IS_ELECTRON 替代，保留别名以兼容旧代码
 * @type {boolean}
 */
const IS_TAURI = IS_ELECTRON;

/**
 * 获取 Tauri IPC invoke 函数
 * 按优先级尝试多个路径：__TAURI_INTERNALS__（内部桥）→ __TAURI__.core → __TAURI__ 顶层
 * @returns {Function|null} invoke 函数，不可用时返回 null
 */
function getTauriInvoke() {
    if (typeof window === 'undefined') return null;
    // 内部 IPC 桥（始终可用，无需 withGlobalTauri）
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        console.log('[bridge] getTauriInvoke: using __TAURI_INTERNALS__.invoke');
        return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    // 公开 API（withGlobalTauri 启用后可用）
    if (window.__TAURI__) {
        if (window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            console.log('[bridge] getTauriInvoke: using __TAURI__.core.invoke');
            return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        }
        if (typeof window.__TAURI__.invoke === 'function') {
            console.log('[bridge] getTauriInvoke: using __TAURI__.invoke');
            return window.__TAURI__.invoke.bind(window.__TAURI__);
        }
        // 调试：列出 __TAURI__ 上可用的属性
        console.log('[bridge] __TAURI__ keys:', Object.keys(window.__TAURI__));
    }
    // 调试：列出 __TAURI_INTERNALS__ 上可用的属性
    if (window.__TAURI_INTERNALS__) {
        console.log('[bridge] __TAURI_INTERNALS__ keys:', Object.keys(window.__TAURI_INTERNALS__));
        console.log('[bridge] __TAURI_INTERNALS__.invoke type:', typeof window.__TAURI_INTERNALS__.invoke);
    }
    return null;
}

/**
 * 检测是否运行在篡改猴环境
 * 在非 WebView/非 Tauri 环境下，通过 GM_info 或脚本管理器特征判断
 * @type {boolean}
 */
const IS_TAMPERMONKEY = !IS_WEBVIEW && !IS_ELECTRON && (typeof GM_info !== 'undefined');

/**
 * 当前运行环境标识
 * @type {'webview' | 'electron' | 'tampermonkey' | 'unknown'}
 */
const ENV = IS_WEBVIEW ? 'webview' : (IS_ELECTRON ? 'electron' : (IS_TAMPERMONKEY ? 'tampermonkey' : 'unknown'));

/**
 * 原生桥接是否可用（仅 WebView 环境可用）
 * @type {boolean}
 */
const BRIDGE_AVAILABLE = IS_WEBVIEW;

// ============================================================
// 异步回调机制
// ============================================================

/** 待处理的异步回调 Map: callbackId -> { resolve, reject } */
const pendingCallbacks = new Map();

/** 自增的 callbackId，用于配对原生回调 */
let nextCallbackId = 1;

/**
 * 全局回调入口：原生完成异步操作后通过 evaluateJavascript 调用本函数
 * @param {string|number} id - callbackId
 * @param {number} success - 1 成功，0 失败
 * @param {*} result - 成功时为结果值（已 JSON.parse），失败时为错误消息字符串
 */
if (typeof window !== 'undefined') {
    // 注意：原生端可能以字符串或数字形式传入 id，统一转 string 比对
    window._dsBridgeCallback = function (id, success, result) {
        const key = String(id);
        const cb = pendingCallbacks.get(key);
        if (!cb) return;
        pendingCallbacks.delete(key);
        if (success) {
            cb.resolve(result);
        } else {
            cb.reject(new Error(typeof result === 'string' ? result : JSON.stringify(result)));
        }
    };
}

// ============================================================
// 原生调用封装
// ============================================================

/**
 * 同步调用原生方法（适用于 toast/vibrate/setClipboard 等可同步完成的操作）
 * @param {string} method - 方法名
 * @param {Object} args - 参数对象
 * @returns {*} 原生返回值（已 JSON.parse）；环境不支持时返回 null
 */
function callNativeSync(method, args) {
    if (!BRIDGE_AVAILABLE) return null;
    try {
        const raw = window.AndroidBridge.invokeSync(method, JSON.stringify(args));
        if (raw == null || raw === '') return null;
        // 原生约定：返回值是 JSON 字符串；非 JSON 字符串原样返回
        try { return JSON.parse(raw); } catch (e) { return raw; }
    } catch (e) {
        console.warn('[bridge] invokeSync failed:', method, e);
        return null;
    }
}

/**
 * 异步调用原生方法（适用于 http/文件读写/checkUpdate 等需要异步等待的操作）
 * @param {string} method - 方法名
 * @param {Object} args - 参数对象
 * @returns {Promise<*>} 原生完成后 resolve 结果；环境不支持或失败时 reject
 */
function callNativeAsync(method, args) {
    return new Promise((resolve, reject) => {
        if (!BRIDGE_AVAILABLE) {
            reject(new Error('Native bridge not available'));
            return;
        }
        const id = String(nextCallbackId++);
        pendingCallbacks.set(id, { resolve, reject });
        try {
            const jsonStr = JSON.stringify(args);
            // 调试日志：输出 JSON 字符串长度，确认是否在传递给原生端时被截断
            if (method === 'http') {
                console.log('[bridge.callNativeAsync] method=http, jsonStrLength=' + jsonStr.length);
            }
            window.AndroidBridge.invokeAsync(method, jsonStr, id);
        } catch (e) {
            pendingCallbacks.delete(id);
            reject(e);
        }
        // 超时保护：60 秒未回调自动 reject，避免 Promise 永久挂起
        setTimeout(() => {
            if (pendingCallbacks.has(id)) {
                pendingCallbacks.delete(id);
                reject(new Error('Native call timeout: ' + method));
            }
        }, 60000);
    });
}

// ============================================================
// 篡改猴环境 Web 降级实现
// ============================================================

/**
 * 篡改猴环境下的剪贴板降级：优先 navigator.clipboard，回退 textarea
 * @param {string} text - 要复制的文本
 * @returns {Promise<void>}
 */
async function webClipboardCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    // 老浏览器降级：临时 textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
}

/**
 * 篡改猴环境下的震动降级：直接用 navigator.vibrate
 * @param {number|number[]} pattern - 震动模式
 * @returns {Promise<boolean>} 是否成功
 */
async function webVibrate(pattern) {
    if (navigator.vibrate) {
        return Promise.resolve(navigator.vibrate(pattern));
    }
    return Promise.resolve(false);
}

/**
 * 篡改猴环境下的分享降级：使用 Web Share API
 * @param {string} text - 分享文本
 * @param {string} [title] - 分享标题
 * @returns {Promise<void>}
 */
async function webShare(text, title) {
    if (navigator.share) {
        await navigator.share({ text, title: title || '' });
        return;
    }
    // 不支持 Web Share 时降级为复制到剪贴板
    await webClipboardCopy(text);
}

// ============================================================
// 对外统一 API
// ============================================================

export const Platform = {
    // -------- 环境信息 --------

    /** 当前环境标识 */
    env: ENV,
    /** 是否在 Android WebView 中 */
    isWebView: IS_WEBVIEW,
    /** 是否在 Electron 桌面端 */
    isElectron: IS_ELECTRON,
    /** @deprecated 使用 isElectron 替代 */
    isTauri: IS_ELECTRON,
    /** 是否在篡改猴中 */
    isTampermonkey: IS_TAMPERMONKEY,
    /** 原生桥接是否可用 */
    bridgeAvailable: BRIDGE_AVAILABLE,

    /**
     * 获取宿主版本信息
     * @returns {Promise<{version: string, build: string, platform: string} | null>}
     */
    async getInfo() {
        if (!BRIDGE_AVAILABLE) return null;
        return callNativeSync('getInfo', {});
    },

    // -------- 基础能力 --------

    /**
     * 显示原生 Toast
     * @param {string} msg - 消息内容
     * @param {boolean} [long=false] - 是否长时间显示
     * @returns {Promise<void>}
     */
    async toast(msg, long = false) {
        if (BRIDGE_AVAILABLE) {
            callNativeSync('toast', { msg: String(msg), long: !!long });
        } else {
            // 篡改猴/未知环境无 Toast，控制台提示
            console.log('[toast]', msg);
        }
    },

    /**
     * 震动反馈
     * @param {number|number[]} pattern - 震动模式（毫秒数或数组）
     * @returns {Promise<void>}
     */
    async vibrate(pattern = 30) {
        if (BRIDGE_AVAILABLE) {
            callNativeSync('vibrate', { pattern });
        } else {
            await webVibrate(pattern);
        }
    },

    /**
     * 复制文本到剪贴板
     * @param {string} text - 要复制的文本
     * @returns {Promise<boolean>} 是否成功
     */
    async setClipboard(text) {
        if (BRIDGE_AVAILABLE) {
            const r = callNativeSync('setClipboard', { text: String(text) });
            return r !== false && r !== null;
        }
        try {
            await webClipboardCopy(text);
            return true;
        } catch (e) {
            return false;
        }
    },

    /**
     * 调用系统分享面板
     * @param {string} text - 分享文本
     * @param {string} [title] - 分享标题
     * @returns {Promise<boolean>} 是否成功分享（用户取消返回 false）
     */
    async share(text, title) {
        if (BRIDGE_AVAILABLE) {
            try {
                await callNativeAsync('share', { text: String(text), title: title || '' });
                return true;
            } catch (e) {
                return false;
            }
        }
        try {
            await webShare(text, title);
            return true;
        } catch (e) {
            return false;
        }
    },

    // -------- 文件能力 --------

    /**
     * 读取应用私有目录下的文件文本
     * @param {string} path - 相对路径（相对于应用私有目录）
     * @returns {Promise<string>} 文件内容
     */
    async readFile(path) {
        return callNativeAsync('readFile', { path });
    },

    /**
     * 写入文本到应用私有目录下的文件
     * @param {string} path - 相对路径
     * @param {string} content - 文件内容
     * @returns {Promise<boolean>} 是否成功
     */
    async writeFile(path, content) {
        await callNativeAsync('writeFile', { path, content: String(content) });
        return true;
    },

    /**
     * 下载 URL 到用户可见的下载目录
     * @param {string} url - 下载地址
     * @param {string} filename - 保存文件名
     * @returns {Promise<string>} 保存路径
     */
    async download(url, filename) {
        return callNativeAsync('download', { url, filename });
    },

    /**
     * 通过 SAF 选择文件并返回其内容
     * @returns {Promise<{name: string, content: string}>} 文件名与内容
     */
    async pickFile() {
        return callNativeAsync('pickFile', {});
    },

    // -------- 网络能力 --------

    /**
     * 通过原生发起 HTTP 请求，绕过 WebView 的 CORS 限制
     * @param {string} method - HTTP 方法
     * @param {string} url - 请求地址
     * @param {Object} [headers] - 请求头
     * @param {string} [body] - 请求体
     * @returns {Promise<{status: number, headers: Object, body: string}>} 响应
     */
    async http(method, url, headers = {}, body = '') {
        // 调试日志：输出 URL 长度，确认是否在传递给原生端时被截断
        console.log('[bridge.http] method=' + method + ', urlLength=' + (url ? url.length : 0) + ', url=' + (url || ''));
        // Android WebView 环境：通过 AndroidBridge 异步调用原生 HTTP
        if (BRIDGE_AVAILABLE) {
            return callNativeAsync('http', { method, url, headers, body });
        }
        // Electron 桌面端：通过 IPC 调用 Rust/Node http_request 命令绕过 CORS
        if (IS_ELECTRON) {
            const invoke = getTauriInvoke();
            if (!invoke) {
                throw new Error('Tauri IPC invoke not available');
            }
            console.log('[bridge.http] Tauri IPC: method=' + method + ', urlLength=' + (url ? url.length : 0));
            return invoke('http_request', { method, url, headers, body });
        }
        throw new Error('No native HTTP transport available');
    },

    // -------- 系统能力 --------

    /**
     * 检查应用更新
     * @returns {Promise<{hasUpdate: boolean, version: string, url: string, note: string} | null>}
     */
    async checkUpdate() {
        if (!BRIDGE_AVAILABLE) return null;
        return callNativeAsync('checkUpdate', {});
    },

    /**
     * 发送系统通知
     * @param {string} title - 通知标题
     * @param {string} body - 通知正文
     * @returns {Promise<void>}
     */
    async notify(title, body) {
        if (BRIDGE_AVAILABLE) {
            callNativeSync('notify', { title: String(title), body: String(body) });
        } else if ('Notification' in window) {
            // 篡改猴环境用 Web Notification 降级
            if (Notification.permission === 'granted') {
                new Notification(title, { body });
            } else if (Notification.permission !== 'denied') {
                const perm = await Notification.requestPermission();
                if (perm === 'granted') new Notification(title, { body });
            }
        }
    },

    /**
     * 切换沉浸式全屏模式
     * @param {boolean} enabled - 是否启用沉浸式全屏
     * @returns {Promise<void>}
     */
    async setImmersive(enabled) {
        if (BRIDGE_AVAILABLE) {
            callNativeSync('setImmersive', { enabled: !!enabled });
        }
        // 篡改猴环境无此能力，noop
    },

    /**
     * 退出应用（仅 WebView）
     * @returns {Promise<void>}
     */
    async exitApp() {
        if (BRIDGE_AVAILABLE) {
            callNativeSync('exitApp', {});
        }
    },

    /**
     * 在终端中执行代码（Android → Termux，Tauri 桌面端 → cmd/powershell）
     * @param {string} terminalId - 终端标识（cmd/powershell/termux）
     * @param {string} codeText - 要执行的代码
     * @returns {Promise<void>}
     */
    async execInTerminal(terminalId, codeText) {
        if (BRIDGE_AVAILABLE) {
            // Android: 通过 AndroidBridge 异步调用 Termux
            await callNativeAsync('execInTermux', {
                terminal: String(terminalId),
                code: String(codeText)
            });
            return;
        }
        if (IS_ELECTRON) {
            // Electron 桌面端：通过 IPC 调用命令执行 cmd/powershell
            const invoke = getTauriInvoke();
            if (!invoke) {
                throw new Error('Tauri IPC invoke not available');
            }
            try {
                await invoke('exec_in_terminal', {
                    terminal: String(terminalId),
                    code: String(codeText)
                });
            } catch (e) {
                // Tauri IPC 错误可能是字符串或对象，统一转为 Error
                const msg = (e && typeof e === 'object') ? (e.message || String(e)) : String(e || '');
                console.error('[bridge] execInTerminal IPC error:', e);
                throw new Error(msg || 'Tauri IPC 调用失败');
            }
            return;
        }
        // 其他环境：不支持
        throw new Error('Native bridge not available');
    },

    /**
     * 打开 HTML 预览容器（Android WebView → HtmlViewerActivity）
     *
     * 将 HTML 代码写入临时文件，然后通过 Intent 启动 HtmlViewerActivity
     * 加载并展示该 HTML 文件。HtmlViewerActivity 提供全屏 WebView 和关闭按钮。
     *
     * @param {string} htmlContent - 完整的 HTML 代码字符串
     * @returns {Promise<void>}
     */
    async openHtmlViewer(htmlContent) {
        if (BRIDGE_AVAILABLE) {
            // Android: 通过 AndroidBridge 异步打开 HtmlViewerActivity
            await callNativeAsync('openHtmlViewer', {
                html: String(htmlContent)
            });
            return;
        }
        throw new Error('Native bridge not available');
    }
};

// ============================================================
// 模块自检日志（便于调试时确认环境识别正确）
// ============================================================
if (typeof console !== 'undefined') {
    console.log('[bridge] env =', ENV, '| bridgeAvailable =', BRIDGE_AVAILABLE);
}
