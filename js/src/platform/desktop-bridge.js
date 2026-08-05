/**
 * 桌面端专属桥接模块
 *
 * 在 Tauri 桌面端扩展 Platform 对象，提供原生文件系统访问、
 * 系统对话框（打开/保存文件）、系统信息等桌面端专属能力。
 *
 * 使用方式：
 *   import { DesktopPlatform } from './platform/desktop-bridge.js';
 *   // DesktopPlatform 继承 Platform 的所有 API，并添加桌面端专属方法
 *
 * 设计原则：
 *   1. 所有方法返回 Promise，调用方无需关心底层实现
 *   2. 通过 Tauri IPC（__TAURI_INTERNALS__.invoke）调用 Rust 命令
 *   3. 非 Tauri 环境调用时抛出友好错误提示
 *   4. 桌面端优先使用原生文件系统（绕过 localStorage 5MB 限制）
 */

import { Platform } from './bridge.js';

// ============================================================
// Tauri IPC 调用封装
// ============================================================

/**
 * 获取 Tauri invoke 函数（与 bridge.js 保持一致的逻辑）
 * @returns {Function|null}
 */
function getInvoke() {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    if (window.__TAURI__) {
        if (window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        }
        if (typeof window.__TAURI__.invoke === 'function') {
            return window.__TAURI__.invoke.bind(window.__TAURI__);
        }
    }
    return null;
}

/**
 * 调用 Tauri IPC 命令
 * @param {string} cmd - 命令名
 * @param {Object} [args={}] - 参数
 * @returns {Promise<*>}
 */
async function tauriInvoke(cmd, args = {}) {
    const invoke = getInvoke();
    if (!invoke) {
        throw new Error('Tauri IPC 不可用：请确保在桌面端运行');
    }
    return invoke(cmd, args);
}

// ============================================================
// 桌面端专属 API
// ============================================================

/** @type {Object} 桌面端扩展方法集合 */
const desktopMethods = {
    // -------- 文件系统 --------

    /**
     * 读取本地文本文件
     *
     * 桌面端可直接读取任意路径的文件，不受浏览器沙箱限制。
     * 用于导入本地 Markdown、JSON 配置、代码文件等。
     *
     * @param {string} path - 文件绝对路径
     * @returns {Promise<string>} 文件文本内容
     */
    async readTextFile(path) {
        return tauriInvoke('read_text_file', { path });
    },

    /**
     * 写入文本到本地文件
     *
     * 自动创建父目录。用于导出对话记录、保存配置、写入代码文件等。
     *
     * @param {string} path - 文件绝对路径
     * @param {string} content - 要写入的文本内容
     * @returns {Promise<void>}
     */
    async writeTextFile(path, content) {
        return tauriInvoke('write_text_file', { path, content });
    },

    /**
     * 列出目录下的文件和子目录
     *
     * @param {string} path - 目录路径
     * @returns {Promise<string[]>} 文件名列表
     */
    async listDir(path) {
        return tauriInvoke('list_dir', { path });
    },

    /**
     * 检查路径是否存在
     *
     * @param {string} path - 要检查的路径
     * @returns {Promise<boolean>}
     */
    async pathExists(path) {
        return tauriInvoke('path_exists', { path });
    },

    /**
     * 删除文件或空目录
     *
     * @param {string} path - 要删除的路径
     * @returns {Promise<void>}
     */
    async deletePath(path) {
        return tauriInvoke('delete_path', { path });
    },

    // -------- 系统文件对话框 --------

    /**
     * 打开系统"选择文件"对话框
     *
     * 弹出 Windows 原生文件选择器，支持选择单个文件。
     * 用户取消时返回 null。
     *
     * @returns {Promise<string|null>} 选中文件的绝对路径，取消返回 null
     */
    async pickFile() {
        return tauriInvoke('pick_file_dialog');
    },

    /**
     * 打开系统"选择文件夹"对话框
     *
     * @returns {Promise<string|null>} 选中文件夹的绝对路径，取消返回 null
     */
    async pickFolder() {
        return tauriInvoke('pick_folder_dialog');
    },

    /**
     * 打开系统"保存文件"对话框并写入内容
     *
     * 弹出原生保存对话框，用户选择路径后自动写入文件内容。
     *
     * @param {string} defaultName - 默认文件名
     * @param {string} content - 要保存的文件内容
     * @returns {Promise<string|null>} 保存的文件路径，取消返回 null
     */
    async saveFile(defaultName, content) {
        return tauriInvoke('save_file_dialog', { defaultName, content });
    },

    // -------- 系统信息 --------

    /**
     * 获取应用数据目录（可执行文件所在目录）
     *
     * 桌面端脚本可将持久化数据（配置、缓存、历史记录等）存储在此目录，
     * 替代 localStorage 的 5MB 限制。
     *
     * @returns {Promise<string>} 应用目录路径
     */
    async getAppDataDir() {
        return tauriInvoke('get_app_data_dir');
    },

    /**
     * 获取应用版本号
     *
     * @returns {Promise<string>} 版本号字符串（如 "0.1.0"）
     */
    async getAppVersion() {
        return tauriInvoke('get_app_version');
    },

    // -------- 开发者工具 --------

    /**
     * 打开 WebView2 开发者工具
     */
    async openDevtools() {
        return tauriInvoke('open_devtools');
    },

    // -------- 便捷方法 --------

    /**
     * 将数据持久化到应用数据目录下的 JSON 文件
     *
     * 用于替代 localStorage 存储大量结构化数据（如对话历史、技能库、配置等），
     * 突破浏览器 localStorage 5MB 限制。
     *
     * @param {string} filename - 文件名（如 "config.json"）
     * @param {*} data - 要存储的数据（会被 JSON.stringify）
     * @returns {Promise<void>}
     */
    async saveJson(filename, data) {
        const dir = await this.getAppDataDir();
        const path = `${dir}\\${filename}`;
        const content = JSON.stringify(data, null, 2);
        return this.writeTextFile(path, content);
    },

    /**
     * 从应用数据目录读取 JSON 文件
     *
     * @param {string} filename - 文件名（如 "config.json"）
     * @returns {Promise<*>} 解析后的 JSON 数据，文件不存在返回 null
     */
    async loadJson(filename) {
        try {
            const dir = await this.getAppDataDir();
            const path = `${dir}\\${filename}`;
            const text = await this.readTextFile(path);
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    },

    /**
     * 将 Markdown 内容导出到本地文件
     *
     * 弹出保存对话框，默认文件名基于当前时间戳。
     *
     * @param {string} markdownContent - Markdown 文本
     * @param {string} [title=''] - 标题（用于生成默认文件名）
     * @returns {Promise<string|null>} 保存路径，取消返回 null
     */
    async exportMarkdown(markdownContent, title = '') {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeTitle = (title || 'export').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
        const defaultName = `${safeTitle}_${ts}.md`;
        return this.saveFile(defaultName, markdownContent);
    }
};

// ============================================================
// 合并导出：DesktopPlatform = Platform + desktopMethods
// ============================================================

/**
 * 桌面端扩展平台对象
 *
 * 继承 Platform 的所有跨平台 API（toast/vibrate/clipboard/share 等），
 * 并添加桌面端专属方法（文件系统/对话框/系统信息等）。
 *
 * 在非 Tauri 环境中调用桌面端专属方法会抛出错误。
 */
export const DesktopPlatform = {
    ...Platform,
    ...desktopMethods
};

// 模块自检日志
if (typeof console !== 'undefined' && Platform.isElectron) {
    console.log('[desktop-bridge] Electron 桌面端桥接已就绪，可用方法:',
        Object.keys(desktopMethods).join(', '));
}