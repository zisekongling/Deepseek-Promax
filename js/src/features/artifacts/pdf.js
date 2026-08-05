/**
 * PDF 导出模块
 *
 * 经浏览器打印对话框导出 PDF（油猴环境）或下载 HTML 后提示用户打印（WebView 环境）。
 *
 * 实现策略：
 *   1. 油猴/Web 环境：生成 HTML → Blob URL → window.open → 调用 window.print()
 *      - Blob URL 比 document.write 更 CSP 友好
 *      - 弹窗被拦截时降级为下载 HTML 文件，提示用户手动打开打印
 *   2. WebView 环境：调用 Platform.download() 保存 HTML 文件，Toast 提示用户
 *      用系统浏览器打开后选择"另存为 PDF"
 *
 * 文件名建议：deepseek-export-YYYYMMDD-HHmmss.pdf
 *   （实际 PDF 由浏览器打印对话框生成，用户在对话框中选择"另存为 PDF"并指定文件名）
 */

import { Platform } from '../../platform/bridge.js';
import { buildConversationHtml, buildSingleMessageHtml } from './html.js';
import { buildExportFilename } from './markdown.js';

/**
 * 在新窗口写入 HTML 并触发打印
 * 优先用 Blob URL（CSP 友好）；失败时降级 document.write
 * @param {string} html - 完整 HTML 文档
 * @param {string} filename - 建议保存文件名（仅用于日志，实际文件名由打印对话框决定）
 * @returns {Promise<boolean>} 是否成功打开打印窗口
 */
async function printViaNewWindow(html, filename) {
    let blobUrl = null;
    try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        blobUrl = URL.createObjectURL(blob);
    } catch (_e) {
        blobUrl = null;
    }

    const win = window.open(blobUrl || 'about:blank', '_blank');
    if (!win) {
        // 弹窗被拦截
        if (blobUrl) {
            setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_e) {} }, 1000);
        }
        return false;
    }

    if (blobUrl) {
        // Blob URL 模式：等加载完成后打印
        let printed = false;
        const doPrint = () => {
            if (printed) return;
            printed = true;
            try { win.focus(); win.print(); } catch (_e) {}
        };
        win.onload = doPrint;
        // 兜底：某些浏览器 onload 不触发，800ms 后强制打印
        setTimeout(doPrint, 800);
        // 延迟释放 Blob URL（保留足够时间让打印对话框完成加载）
        setTimeout(() => {
            try { URL.revokeObjectURL(blobUrl); } catch (_e) {}
        }, 60000);
    } else {
        // document.write 模式（Blob 创建失败时的降级）
        try {
            win.document.open();
            win.document.write(html);
            win.document.close();
            setTimeout(() => {
                try { win.focus(); win.print(); } catch (_e) {}
            }, 300);
        } catch (_e) {
            return false;
        }
    }
    return true;
}

/**
 * WebView 环境：用 Platform.download 保存 HTML 文件
 * @param {string} html - HTML 内容
 * @param {string} filename - 保存文件名（.html 后缀）
 * @returns {Promise<boolean>} 是否成功
 */
async function downloadHtmlForWebView(html, filename) {
    let url = null;
    try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        url = URL.createObjectURL(blob);
    } catch (_e) {
        // Blob 失败时降级 data URL（注意：大文件可能超出 URL 长度限制）
        url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }
    try {
        await Platform.download(url, filename);
        return true;
    } catch (_e) {
        return false;
    } finally {
        if (url && url.startsWith('blob:')) {
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_e) {} }, 2000);
        }
    }
}

/**
 * 根据当前环境触发打印流程
 * @param {string} html - 完整 HTML 文档
 * @param {string} filename - 建议的 PDF 文件名
 * @returns {Promise<boolean>} 是否成功触发
 */
async function triggerPrint(html, filename) {
    // WebView 环境：下载 HTML 并提示用户
    if (Platform.isWebView) {
        const htmlName = filename.replace(/\.pdf$/i, '.html');
        const ok = await downloadHtmlForWebView(html, htmlName);
        const tip = ok
            ? '已保存 HTML，请用浏览器打开后选择"另存为 PDF"'
            : 'PDF 导出失败，请尝试用浏览器打开此页面后手动打印';
        try { await Platform.toast(tip, true); } catch (_e) {}
        return ok;
    }

    // 油猴 / Web 环境：优先新窗口打印
    const ok = await printViaNewWindow(html, filename);
    if (ok) return true;

    // 弹窗被拦截 → 降级下载 HTML
    try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace(/\.pdf$/i, '.html');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        if (typeof console !== 'undefined') {
            console.warn('[artifacts] 弹窗被拦截，已降级下载 HTML，请手动打开后用浏览器打印为 PDF');
        }
        return true;
    } catch (_e) {
        return false;
    }
}

/**
 * 导出整对话为 PDF（打开打印对话框）
 * @param {Array} messages - 消息数组
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title] - 文档标题
 * @param {boolean} [options.darkMode] - 是否深色主题
 * @returns {Promise<boolean>} 是否成功触发打印
 */
export async function exportConversationPdf(messages, options = {}) {
    const filename = buildExportFilename('pdf');
    const html = buildConversationHtml(messages, options);
    return triggerPrint(html, filename);
}

/**
 * 导出单条消息为 PDF（打开打印对话框）
 * @param {Object} message - 消息对象
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title] - 文档标题
 * @param {boolean} [options.darkMode] - 是否深色主题
 * @returns {Promise<boolean>} 是否成功触发打印
 */
export async function exportSingleMessagePdf(message, options = {}) {
    const filename = buildExportFilename('pdf');
    const html = buildSingleMessageHtml(message, options);
    return triggerPrint(html, filename);
}
