/**
 * DeepSeek Electron 桌面客户端 - 主进程
 *
 * 功能：
 *   1. 创建 BrowserWindow 加载 chat.deepseek.com
 *   2. 注入 early-boot.js（在页面脚本之前 hook fetch/XHR）和 dspro.js（主脚本）
 *   3. 加载 Chrome 扩展（deepseek-plus-plus）
 *   4. 提供 IPC 命令处理（文件系统、HTTP 代理、对话框、终端等）
 *   5. 右键菜单注入
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// 启用远程调试端口（用于 DevTools 和扩展调试）
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// 将用户数据目录设置在 exe 同级目录，避免 asar 只读限制和沙箱 AppData 写入问题
app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'userdata'));

// ============================================================
// 常量
// ============================================================

/** DeepSeek 主页面 URL */
const DEEPSEEK_URL = 'https://chat.deepseek.com';

/** 扩展目录路径（打包后使用 process.resourcesPath，开发时使用 __dirname） */
const EXTENSION_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'extension')
  : path.join(__dirname, 'extension');

/** 资源目录（脚本文件） */
const RESOURCES_DIR = path.join(__dirname, 'resources');

// ============================================================
// 窗口管理
// ============================================================

/** @type {BrowserWindow|null} */
let mainWindow = null;

/** 扩展 ID（加载成功后填充） */
let extensionId = null;

/** 侧边栏窗口引用 */
let sidepanelWindow = null;

/**
 * ElectronChromeExtensions 实例
 *
 * 混合方案：electron-chrome-extensions 提供 chrome.action / chrome.tabs /
 * chrome.contextMenus 等 API polyfill，Electron 35 原生 startWorkerForScope
 * 负责显式启动扩展 Service Worker，两者互补。
 */
let chromeExtensions = null;

/**
 * 创建主窗口
 *
 * 加载 chat.deepseek.com，配置安全策略，注入脚本。
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'DeepSeek',
        icon: path.join(RESOURCES_DIR, 'icon.png'),
        show: false,
        webPreferences: {
            // preload 脚本在页面脚本之前运行，用于暴露 IPC 桥接
            preload: path.join(__dirname, 'preload.js'),
            // 安全策略
            contextIsolation: true,
            nodeIntegration: false,
            // sandbox: true 是 electron-chrome-extensions 的要求，preload 脚本仍可使用 contextBridge/ipcRenderer
            sandbox: true,
            // 允许在页面中使用 webRequest（扩展需要）
            webSecurity: true
        }
    });

    // F12 打开开发者工具
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    // 窗口准备好后显示（避免白屏闪烁）
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 将窗口注册到扩展系统（electron-chrome-extensions 要求）
    if (chromeExtensions) {
        chromeExtensions.addTab(mainWindow.webContents, mainWindow);
    }

    // 加载 DeepSeek
    mainWindow.loadURL(DEEPSEEK_URL);

    // 导航提交后立即注入 early-boot.js（hook fetch/XHR，在页面脚本之前）
    mainWindow.webContents.on('did-navigate', (event, url) => {
        if (url.startsWith(DEEPSEEK_URL)) {
            injectScript('early-boot.js');
        }
    });

    // 页面加载完成后注入 dspro.js 主脚本
    mainWindow.webContents.on('did-finish-load', () => {
        injectScript('dspro.js');

        // 启动时的刷新（使用 sessionStorage 防止循环）
        mainWindow.webContents.executeJavaScript(`
            (function() {
                if (!sessionStorage.getItem('__dsProRefreshed')) {
                    sessionStorage.setItem('__dsProRefreshed', '1');
                    console.log('[Electron] 首次启动，0.1秒后刷新页面...');
                    setTimeout(function() { location.reload(); }, 100);
                } else {
                    console.log('[Electron] 已刷新过，跳过');
                }
            })();
        `).catch(() => {});

        // IPC 连通性测试
        mainWindow.webContents.executeJavaScript(`
            (function() {
                console.log('[Electron IPC Test] === 开始 IPC 连通性测试 ===');
                if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
                    window.__TAURI_INTERNALS__.invoke('ping')
                        .then(function(r) { console.log('[Electron IPC Test] ping 成功:', r); })
                        .catch(function(e) { console.error('[Electron IPC Test] ping 失败:', e); });
                } else {
                    console.error('[Electron IPC Test] __TAURI_INTERNALS__ 不可用');
                }
                console.log('[Electron IPC Test] === 测试结束 ===');
            })();
        `).catch(() => {});
    });

    // 窗口关闭时清理引用
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * 注入脚本文件到页面
 *
 * 读取 resources 目录下的 JS 文件并执行。
 * 使用 dsProInjected 标记防止重复注入。
 *
 * @param {string} filename - 脚本文件名
 */
function injectScript(filename) {
    if (!mainWindow) return;
    const filePath = path.join(RESOURCES_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.warn(`[Electron] 脚本文件不存在: ${filePath}`);
        return;
    }
    const code = fs.readFileSync(filePath, 'utf-8');

    if (filename === 'dspro.js') {
        // dspro.js 需要防重复注入
        mainWindow.webContents.executeJavaScript(`
            if (!window.__dsProInjected) {
                window.__dsProInjected = true;
                ${code}
            }
        `).catch(err => console.error(`[Electron] 注入 ${filename} 失败:`, err));
    } else {
        mainWindow.webContents.executeJavaScript(code)
            .catch(err => console.error(`[Electron] 注入 ${filename} 失败:`, err));
    }
}

// ============================================================
// Chrome 扩展加载
// ============================================================

/**
 * 加载 Chrome 扩展（deepseek-plus-plus）
 *
 * 混合方案：electron-chrome-extensions 提供 chrome.action / tabs / contextMenus 等 API polyfill，
 * Electron 35 原生 session.loadExtension() 加载扩展并支持 Service Worker，
 * 加载后通过 startWorkerForScope 显式启动 Service Worker 以确保通信正常。
 */
async function loadExtension() {
    console.log('[Electron] EXTENSION_PATH:', EXTENSION_PATH);
    console.log('[Electron] EXTENSION_PATH 是否存在:', fs.existsSync(EXTENSION_PATH));
    if (fs.existsSync(EXTENSION_PATH)) {
        console.log('[Electron] manifest.json 存在:', fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json')));
    }

    if (!fs.existsSync(EXTENSION_PATH)) {
        console.warn('[Electron] 扩展目录不存在，跳过扩展加载:', EXTENSION_PATH);
        return;
    }

    try {
        const ext = await session.defaultSession.loadExtension(EXTENSION_PATH, {
            allowFileAccess: true
        });
        extensionId = ext.id;
        console.log('[Electron] 扩展加载成功:', ext.id, ext.name);

        // 显式启动扩展的 Service Worker（Electron 35 原生 API）
        await startExtensionServiceWorker(ext.id);
    } catch (err) {
        console.error('[Electron] 扩展加载失败:', err.message);
    }
}

/**
 * 显式启动扩展的 Service Worker（带健康检查和自动恢复）
 *
 * Electron 35 提供了 session.serviceWorkers.startWorkerForScope() API，
 * 可以主动唤醒扩展的 Service Worker，确保 chrome.runtime.onMessage 等监听器就绪。
 *
 * 修复 "Could not establish connection. Receiving end does not exist." 问题：
 *   1. 轮询验证 SW 真正就绪（替代固定等待1秒）
 *   2. 定期心跳保活（防止 SW 被闲置终止）
 *   3. 崩溃自动恢复（监听 SW 终止事件并重启）
 *
 * @param {string} extId - 扩展 ID
 */
async function startExtensionServiceWorker(extId) {
    try {
        const swSes = session.defaultSession.serviceWorkers;
        if (!swSes) {
            console.log('[Electron] Service Workers API 不可用');
            return;
        }

        const scope = `chrome-extension://${extId}/`;
        console.log('[Electron] 尝试启动 Service Worker, scope:', scope);

        // 监听 Service Worker 运行状态变化
        swSes.on('running-status-changed', (event, details) => {
            console.log('[Electron] SW 状态变化:', JSON.stringify(details));
            // 如果 SW 意外停止，自动重启
            if (details && details.status === 'stopped' && details.scope === scope) {
                console.log('[Electron] 检测到 SW 意外停止，自动重启...');
                restartServiceWorker(scope);
            }
        });

        // 显式启动 Service Worker 并等待真正就绪
        await startAndWaitForReady(swSes, scope);

        // 启动定期心跳保活（每30秒 ping 一次，防止 SW 被闲置终止）
        startHeartbeat(extId);
    } catch (e) {
        console.error('[Electron] Service Worker 启动失败:', e.message);
        // 如果 startWorkerForScope 不可用，尝试回退到旧方法
        console.log('[Electron] 回退：等待 Service Worker 自动启动...');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

/**
 * 启动 SW 并轮询等待其真正就绪
 *
 * 替换固定等待1秒的方案，改为每500ms轮询 getAllRunning()，
 * 确认 SW 在运行列表中且稳定后再继续。
 *
 * @param {ServiceWorkers} swSes - Service Workers 会话
 * @param {string} scope - SW 的 scope URL
 */
async function startAndWaitForReady(swSes, scope) {
    await swSes.startWorkerForScope(scope);
    console.log('[Electron] startWorkerForScope 调用完成, scope:', scope);

    // 轮询等待 SW 真正进入运行状态（最多等待 30 秒）
    const maxWaitMs = 30000;
    const pollIntervalMs = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const registrations = await swSes.getAllRunning();
            const found = registrations.some(r => r.scope === scope);
            if (found) {
                console.log(`[Electron] SW 就绪确认 (耗时 ${Date.now() - startTime}ms)`, JSON.stringify(registrations));
                // 就绪后再等 500ms 确保 IndexedDB 等初始化完成
                await new Promise(resolve => setTimeout(resolve, 500));
                return;
            }
        } catch (e) {
            console.log('[Electron] 轮询 SW 状态异常:', e.message);
        }
        console.log(`[Electron] SW 尚未就绪，等待中... (已等待 ${Date.now() - startTime}ms)`);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    // 超时后记录警告但不阻塞启动流程
    console.warn(`[Electron] SW 就绪等待超时 (${maxWaitMs}ms)，继续启动流程`);
}

/**
 * 定期心跳保活：通过 chrome.runtime.sendMessage 发送 ping
 * 防止 Service Worker 被 Electron 闲置终止
 *
 * @param {string} extId - 扩展 ID
 */
function startHeartbeat(extId) {
    const HEARTBEAT_INTERVAL = 30000; // 每30秒

    const intervalId = setInterval(async () => {
        try {
            // 通过扩展的 background script 发送 ping
            // 如果 SW 已死，sendMessage 会失败并触发自动恢复
            const swSes = session.defaultSession.serviceWorkers;
            const scope = `chrome-extension://${extId}/`;
            const registrations = await swSes.getAllRunning();
            const isRunning = registrations.some(r => r.scope === scope);

            if (isRunning) {
                console.log('[Electron] SW 心跳: 运行中');
            } else {
                console.warn('[Electron] SW 心跳: 未运行，尝试重启');
                restartServiceWorker(scope);
            }
        } catch (e) {
            console.warn('[Electron] SW 心跳检查异常:', e.message);
        }
    }, HEARTBEAT_INTERVAL);

    // 窗口关闭时清理心跳定时器
    if (mainWindow) {
        mainWindow.on('closed', () => {
            clearInterval(intervalId);
        });
    }
}

/**
 * 自动重启 Service Worker
 *
 * 当检测到 SW 意外停止时调用，带重试次数限制防止无限循环。
 *
 * @param {string} scope - SW 的 scope URL
 */
async function restartServiceWorker(scope) {
    const swSes = session.defaultSession.serviceWorkers;
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
        retries++;
        console.log(`[Electron] SW 重启尝试 ${retries}/${maxRetries}...`);
        try {
            await swSes.startWorkerForScope(scope);
            // 等待就绪
            await startAndWaitForReady(swSes, scope);
            console.log(`[Electron] SW 重启成功 (尝试 ${retries} 次)`);
            return;
        } catch (e) {
            console.error(`[Electron] SW 重启尝试 ${retries} 失败:`, e.message);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.error(`[Electron] SW 重启失败，已达最大重试次数 (${maxRetries})`);
}

// ============================================================
// 侧边栏管理
// ============================================================

/**
 * 打开 DeepSeek++ 扩展的侧边栏
 *
 * 通过 chrome-extension:// URL 加载扩展的 sidepanel.html，
 * 以独立 popup 窗口形式展示。
 */
function openSidepanel() {
    console.log('[Electron] openSidepanel() 被调用, extensionId:', extensionId);
    console.log('[Electron] mainWindow 存在:', !!mainWindow, 'sidepanelWindow 存在:', !!sidepanelWindow);

    if (!extensionId) {
        console.warn('[Electron] 扩展未加载，无法打开侧边栏');
        return;
    }

    // 如果侧边栏窗口已存在，聚焦并显示
    if (sidepanelWindow && !sidepanelWindow.isDestroyed()) {
        console.log('[Electron] 侧边栏窗口已存在，聚焦显示');
        sidepanelWindow.show();
        sidepanelWindow.focus();
        return;
    }

    const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
    console.log('[Electron] 准备创建侧边栏窗口, URL:', sidepanelUrl);

    sidepanelWindow = new BrowserWindow({
        width: 420,
        height: 700,
        minWidth: 360,
        minHeight: 500,
        title: 'DeepSeek++',
        parent: mainWindow,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    console.log('[Electron] 侧边栏 BrowserWindow 已创建, id:', sidepanelWindow.id);

    // 监听加载事件
    sidepanelWindow.webContents.on('did-start-loading', () => {
        console.log('[Electron] 侧边栏开始加载...');
    });
    sidepanelWindow.webContents.on('did-finish-load', () => {
        console.log('[Electron] 侧边栏加载完成! URL:', sidepanelWindow.webContents.getURL());
    });
    sidepanelWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('[Electron] 侧边栏加载失败!', { errorCode, errorDescription, validatedURL });
    });
    sidepanelWindow.webContents.on('did-fail-provisional-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('[Electron] 侧边栏预加载失败!', { errorCode, errorDescription, validatedURL });
    });
    sidepanelWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[SidePanelConsole] ${message}`);
    });

    sidepanelWindow.loadURL(sidepanelUrl);

    // 窗口关闭时清理引用
    sidepanelWindow.on('closed', () => {
        console.log('[Electron] 侧边栏窗口关闭');
        sidepanelWindow = null;
    });
}

// ============================================================
// IPC 命令处理（兼容 Tauri 命令接口）
// ============================================================

/**
 * 注册所有 IPC 处理器
 *
 * 通过 ipcMain.handle 处理来自渲染进程的 invoke 调用。
 * 命令名与 Tauri 保持一致，前端无需修改。
 */
function registerIpcHandlers() {
    // ---- 基础命令 ----

    // ping：IPC 连通性测试
    ipcMain.handle('tauri-cmd', async (event, { cmd, args }) => {
        switch (cmd) {
            case 'ping':
                return 'pong';

            case 'open_devtools':
                if (mainWindow) mainWindow.webContents.openDevTools();
                return null;

            case 'open_sidepanel':
                console.log('[Electron IPC] 收到 open_sidepanel 命令');
                openSidepanel();
                return null;

            case 'get_app_version':
                return app.getVersion();

            case 'get_app_data_dir':
                return path.dirname(process.execPath);

            // ---- 终端执行 ----

            case 'exec_in_terminal': {
                const { terminal, code } = args;
                const shell = terminal === 'powershell' ? 'powershell' : 'cmd';
                const shellArg = terminal === 'powershell' ? '-Command' : '/C';
                try {
                    const result = execSync(`"${shell}" ${shellArg} "${code}"`, {
                        encoding: 'utf-8',
                        timeout: 30000,
                        maxBuffer: 10 * 1024 * 1024
                    });
                    return result.trim() || '命令执行完成（无输出）';
                } catch (e) {
                    throw new Error(e.stderr || e.message || '命令执行失败');
                }
            }

            // ---- 文件系统 ----

            case 'read_text_file': {
                const { path: filePath } = args;
                return fs.readFileSync(filePath, 'utf-8');
            }

            case 'write_text_file': {
                const { path: filePath, content } = args;
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(filePath, content, 'utf-8');
                return null;
            }

            case 'list_dir': {
                const { path: dirPath } = args;
                return fs.readdirSync(dirPath);
            }

            case 'path_exists': {
                const { path: checkPath } = args;
                return fs.existsSync(checkPath);
            }

            case 'delete_path': {
                const { path: deletePath } = args;
                const stat = fs.statSync(deletePath);
                if (stat.isDirectory()) {
                    fs.rmdirSync(deletePath);
                } else {
                    fs.unlinkSync(deletePath);
                }
                return null;
            }

            // ---- 文件对话框 ----

            case 'pick_file_dialog': {
                const result = await dialog.showOpenDialog(mainWindow, {
                    title: '选择文件',
                    properties: ['openFile']
                });
                return result.canceled ? null : result.filePaths[0];
            }

            case 'pick_folder_dialog': {
                const result = await dialog.showOpenDialog(mainWindow, {
                    title: '选择文件夹',
                    properties: ['openDirectory']
                });
                return result.canceled ? null : result.filePaths[0];
            }

            case 'save_file_dialog': {
                const { defaultName, content } = args;
                const result = await dialog.showSaveDialog(mainWindow, {
                    title: '保存文件',
                    defaultPath: defaultName
                });
                if (result.canceled) return null;
                fs.writeFileSync(result.filePath, content, 'utf-8');
                return result.filePath;
            }

            // ---- HTTP 代理（Node.js 原生，绕过浏览器 CORS） ----

            case 'http_request': {
                return handleHttpRequest(args);
            }

            default:
                throw new Error(`未知命令: ${cmd}`);
        }
    });
}

/**
 * 处理 HTTP 代理请求
 *
 * 使用 Node.js 原生 http/https 模块发起请求，
 * 绕过浏览器 CORS 限制，用于 web_search / web_fetch 等场景。
 *
 * @param {Object} args - { method, url, headers, body }
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
function handleHttpRequest(args) {
    return new Promise((resolve, reject) => {
        const { method = 'GET', url, headers = {}, body = '' } = args;
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const transport = isHttps ? https : http;

        const defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        const mergedHeaders = { ...defaultHeaders, ...headers };

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: method.toUpperCase(),
            headers: mergedHeaders,
            rejectUnauthorized: false
        };

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: data,
                    headers: res.headers
                });
            });
        });

        req.on('error', (err) => reject(new Error(`HTTP 请求失败: ${err.message}`)));

        if (body && method.toUpperCase() !== 'GET') {
            req.write(body);
        }
        req.end();
    });
}

// ============================================================
// 右键菜单
// ============================================================

/**
 * 设置应用右键菜单（包含扩展菜单项）
 *
 * 通过 electron-chrome-extensions 的 getContextMenuItems() 获取扩展注册的菜单项，
 * 与内置菜单（开发者工具、刷新页面）合并显示。
 */
function setupContextMenu() {
    if (!mainWindow) return;

    mainWindow.webContents.on('context-menu', (event, params) => {
        const template = [];

        // 扩展注册的右键菜单项（通过 electron-chrome-extensions）
        if (chromeExtensions) {
            const extensionItems = chromeExtensions.getContextMenuItems(mainWindow.webContents, params);
            if (extensionItems && extensionItems.length > 0) {
                template.push(...extensionItems);
                template.push({ type: 'separator' });
            }
        }

        // 内置菜单
        template.push({
            label: '刷新页面',
            click: () => mainWindow.webContents.reload()
        });

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: mainWindow });
    });
}

// ============================================================
// 应用生命周期
// ============================================================

/**
 * 混合方案：electron-chrome-extensions 提供 API polyfill + Electron 35 原生启动 Service Worker
 */
app.whenReady().then(async () => {
    // 1. 初始化 ElectronChromeExtensions（polyfill chrome.action / tabs / contextMenus 等 API）
    chromeExtensions = new ElectronChromeExtensions({
        license: 'GPL-3.0',
        session: session.defaultSession,
        createWindow(details) {
            const popupWindow = new BrowserWindow({
                width: details.width || 420,
                height: details.height || 600,
                parent: mainWindow,
                webPreferences: {
                    sandbox: true,
                    contextIsolation: true
                }
            });
            return popupWindow;
        }
    });

    // 2. 加载 Chrome 扩展（内部会调用 Electron 35 原生 startWorkerForScope 启动 SW）
    await loadExtension();

    // 3. 注册 IPC 处理器
    registerIpcHandlers();

    // 4. 创建主窗口
    createWindow();

    // 5. 捕获扩展的 Service Worker 控制台输出（调试用）
    try {
        const extSes = session.defaultSession;
        const extWorker = extSes.serviceWorkers;
        if (extWorker) {
            extWorker.on('console-message', (event) => {
                console.log(`[SW-${event.versionId}] ${event.message}`);
            });
        }
    } catch (e) {
        console.log('[Electron] Service Worker 日志监听设置失败:', e.message);
    }

    // 6. 设置右键菜单
    setupContextMenu();

    // macOS: 点击 dock 图标时重新创建窗口
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 防止多实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}