/**
 * WebView 早注入 stub
 *
 * 由 DeepSeekClient 在 onPageStarted 阶段通过 evaluateJavascript 注入，
 * 在 DeepSeek 网页的任何业务脚本加载前，抢先安装关键 hook：
 *   1. 跳转检查（redirect）
 *   2. XHR hook（防撤回 + Agent 请求拦截，依赖 anti-recall.js）
 *   3. fetch hook（Agent 请求注入系统提示词与记忆 + 流式观察，依赖 fetch-hub.js）
 *
 * 安装完成后设置 window.__dsEarlyBootDone 标记，
 * 后续主脚本（dspro.js 在 onPageFinished 注入）会检测该标记并跳过 hook 重复安装。
 *
 * 设计原则：
 *   - 极简：只装必须在 document-start 阶段生效的 hook，不初始化任何 UI
 *   - 容错：每个 hook 安装独立 try/catch，任一失败不影响其他
 *   - 幂等：通过 __dsEarlyBootDone 防止重复注入（如 WebView 刷新场景）
 *   - 无 DOM 依赖：所有 hook 只覆写 XMLHttpRequest.prototype / window.fetch，
 *     不访问 document.body，因此可在 body 尚未生成时安全运行
 *   - 单文件：使用静态 import 让 webpack 打包为单文件，确保 WebView evaluateJavascript
 *     注入时无需额外加载异步 chunk（WebView 内无 webpack dev server）
 */

// 静态导入：webpack 会将这些模块及其依赖打包进同一个 dspro.early-boot.js
import { initRedirect } from './features/redirect.js';
import { installXhrHook } from './features/anti-recall.js';
import { installFetchHook } from './utils/fetch-hub.js';

// 防重入：同一页面实例只装一次
if (typeof window !== 'undefined' && !window.__dsEarlyBootDone) {
    window.__dsEarlyBootDone = true;
    // 标记当前为 WebView 早注入环境，供主脚本识别
    window.__dsEarlyBootEnv = 'webview';

    // 1. 跳转检查：www.deepseek.com → chat.deepseek.com
    try {
        initRedirect();
    } catch (e) {
        console.warn('[early-boot] redirect failed:', e);
    }

    // 2. XHR hook：防撤回 + Agent 请求拦截
    try {
        installXhrHook();
    } catch (e) {
        console.warn('[early-boot] xhr hook failed:', e);
    }

    // 3. fetch hook：Agent 请求注入 + 流式观察
    try {
        installFetchHook();
    } catch (e) {
        console.warn('[early-boot] fetch hook failed:', e);
    }

    console.log('[dspro] early-boot hooks installed (webview)');
}
