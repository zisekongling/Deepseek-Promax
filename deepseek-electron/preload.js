/**
 * Electron Preload 脚本
 *
 * 在页面脚本之前运行，通过 contextBridge 暴露 IPC 桥接。
 * 模拟 Tauri 的 __TAURI_INTERNALS__ 接口，使前端脚本无需修改。
 *
 * 安全策略：
 *   - contextIsolation: true → 使用 contextBridge 安全暴露 API
 *   - nodeIntegration: false → 页面无法直接访问 Node.js
 *   - 只暴露 invoke 函数，不暴露整个 ipcRenderer
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 暴露 Tauri 兼容的 IPC 桥接
 *
 * 前端 bridge.js 通过 window.__TAURI_INTERNALS__.invoke(cmd, args)
 * 调用后端命令，此处将其映射到 Electron 的 ipcRenderer.invoke。
 */
contextBridge.exposeInMainWorld('__TAURI_INTERNALS__', {
    /**
     * 调用后端 IPC 命令（兼容 Tauri invoke 接口）
     *
     * @param {string} cmd - 命令名（如 'ping', 'http_request', 'read_text_file'）
     * @param {Object} [args={}] - 命令参数
     * @returns {Promise<*>} 命令返回值
     */
    invoke: (cmd, args = {}) => {
        return ipcRenderer.invoke('tauri-cmd', { cmd, args });
    }
});

/**
 * 暴露 __TAURI__ 兼容接口（部分前端代码也检查 __TAURI__）
 */
contextBridge.exposeInMainWorld('__TAURI__', {
    core: {
        invoke: (cmd, args = {}) => {
            return ipcRenderer.invoke('tauri-cmd', { cmd, args });
        }
    }
});

// 环境标识
console.log('[Electron Preload] IPC 桥接已就绪（兼容 Tauri 接口）');