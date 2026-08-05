/**
 * Artifacts 导出统一入口
 *
 * 提供三种格式的导出，并自动选择对应实现：
 *   - html     → html.js（单文件 HTML，内联 CSS）
 *   - pdf      → pdf.js（浏览器打印对话框）
 *   - markdown → markdown.js（纯 Markdown 文本）
 *
 * 同时支持整对话导出与单消息导出。
 * 下载触发：
 *   - html / markdown：Blob + URL.createObjectURL + <a download> 点击
 *   - pdf：由 pdf.js 打开打印对话框，用户在对话框中选择"另存为 PDF"
 *
 * 配置开关：
 *   读取 CONFIG.artifactsExportEnabled（Phase 6 在 config.js DEFAULTS 中添加）
 *   未定义时默认 true（ARTIFACTS_EXPORT_DEFAULT），保证当前阶段可用
 */

import { CONFIG } from '../../config.js';
import { showToast } from '../../ui/toast.js';
import { buildConversationHtml, buildSingleMessageHtml } from './html.js';
import { exportConversationPdf, exportSingleMessagePdf } from './pdf.js';
import {
    buildConversationMarkdown,
    buildMessageMarkdown,
    buildExportFilename
} from './markdown.js';

/** Artifacts 导出功能默认开关（CONFIG.artifactsExportEnabled 未定义时使用） */
const ARTIFACTS_EXPORT_DEFAULT = true;

/**
 * 读取 artifacts 导出开关
 * Phase 6 集成到 config.js 后，CONFIG.artifactsExportEnabled 会被定义
 * @returns {boolean} 是否启用
 */
function isArtifactsEnabled() {
    if (CONFIG && typeof CONFIG.artifactsExportEnabled === 'boolean') {
        return CONFIG.artifactsExportEnabled;
    }
    return ARTIFACTS_EXPORT_DEFAULT;
}

/**
 * 触发文本文件下载（Blob + a 标签点击）
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME 类型
 */
function downloadText(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 延迟释放 ObjectURL，避免下载未完成就被回收
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 导出整对话
 * @param {'html'|'pdf'|'markdown'} format - 导出格式
 * @param {Array} messages - 消息数组 [{ role, content, attachments?, timestamp? }]
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title] - 文档标题
 * @returns {Promise<boolean>} 是否成功
 */
export async function exportConversation(format, messages, options = {}) {
    if (!isArtifactsEnabled()) {
        showToast('Artifacts 导出已禁用', { tone: 'warning' });
        return false;
    }
    try {
        if (format === 'markdown') {
            const md = buildConversationMarkdown(messages, options);
            downloadText(md, buildExportFilename('md'), 'text/markdown;charset=utf-8');
            showToast('已导出 Markdown', { tone: 'success' });
            return true;
        }
        if (format === 'html') {
            const html = buildConversationHtml(messages, options);
            downloadText(html, buildExportFilename('html'), 'text/html;charset=utf-8');
            showToast('已导出 HTML', { tone: 'success' });
            return true;
        }
        if (format === 'pdf') {
            const ok = await exportConversationPdf(messages, options);
            if (ok) showToast('已打开打印对话框', { tone: 'success' });
            else showToast('PDF 导出失败', { tone: 'error' });
            return ok;
        }
        showToast('不支持的格式: ' + format, { tone: 'error' });
        return false;
    } catch (e) {
        showToast('导出失败：' + (e && e.message ? e.message : '未知错误'), { tone: 'error' });
        return false;
    }
}

/**
 * 导出单条消息
 * @param {'html'|'pdf'|'markdown'} format - 导出格式
 * @param {Object} message - 消息对象 { role, content, attachments?, timestamp? }
 * @param {string} [conversationTitle] - 所属对话标题（可选，用于文档标题）
 * @returns {Promise<boolean>} 是否成功
 */
export async function exportSingleMessage(format, message, conversationTitle) {
    if (!isArtifactsEnabled()) {
        showToast('Artifacts 导出已禁用', { tone: 'warning' });
        return false;
    }
    const options = conversationTitle ? { title: conversationTitle } : {};
    try {
        if (format === 'markdown') {
            const md = buildMessageMarkdown(message, options);
            downloadText(md, buildExportFilename('md'), 'text/markdown;charset=utf-8');
            showToast('已导出该条消息 Markdown', { tone: 'success' });
            return true;
        }
        if (format === 'html') {
            const html = buildSingleMessageHtml(message, options);
            downloadText(html, buildExportFilename('html'), 'text/html;charset=utf-8');
            showToast('已导出该条消息 HTML', { tone: 'success' });
            return true;
        }
        if (format === 'pdf') {
            const ok = await exportSingleMessagePdf(message, options);
            if (ok) showToast('已打开打印对话框', { tone: 'success' });
            else showToast('PDF 导出失败', { tone: 'error' });
            return ok;
        }
        showToast('不支持的格式: ' + format, { tone: 'error' });
        return false;
    } catch (e) {
        showToast('导出失败：' + (e && e.message ? e.message : '未知错误'), { tone: 'error' });
        return false;
    }
}
