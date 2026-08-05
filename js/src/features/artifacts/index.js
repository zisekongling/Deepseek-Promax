/**
 * Artifacts 模块入口
 *
 * 初始化（幂等）并暴露 window._dsArtifacts 全局 API，供油猴菜单、设置面板、
 * 内联按钮等调用方使用。
 *
 * 暴露的 API：
 *   window._dsArtifacts = {
 *     exportConversation,   // (format, messages, options?) => Promise<boolean>
 *     exportSingleMessage,  // (format, message, conversationTitle?) => Promise<boolean>
 *     exportHtml,           // (messages, options?) => Promise<boolean>  等价 exportConversation('html', ...)
 *     exportPdf,            // (messages, options?) => Promise<boolean>  等价 exportConversation('pdf', ...)
 *     exportMarkdown,       // (messages, options?) => Promise<boolean>  等价 exportConversation('markdown', ...)
 *     // 底层工具函数（供高级用法 / 调试）：
 *     buildConversationHtml, buildSingleMessageHtml, renderMessageHtml, renderMarkdownToHtml,
 *     buildConversationMarkdown, buildMessageMarkdown, buildExportFilename,
 *     exportConversationPdf, exportSingleMessagePdf
 *   }
 *
 * Phase 6 集成：
 *   - 在主入口（src/index.js）调用 initArtifacts()
 *   - 在 settings-panel.js 添加 artifactsExportEnabled 开关
 *   - 在 config.js DEFAULTS 添加 artifactsExportEnabled: true
 */

import { exportConversation, exportSingleMessage } from './service.js';
import {
    buildConversationHtml,
    buildSingleMessageHtml,
    renderMessageHtml,
    renderMarkdownToHtml
} from './html.js';
import {
    buildConversationMarkdown,
    buildMessageMarkdown,
    buildExportFilename
} from './markdown.js';
import { exportConversationPdf, exportSingleMessagePdf } from './pdf.js';

/** 是否已初始化（幂等保护，防止重复注册 window._dsArtifacts） */
let initialized = false;

/**
 * 初始化 Artifacts 模块（幂等）
 * 注册 window._dsArtifacts 全局 API；重复调用安全无副作用
 * @returns {boolean} 本次调用是否真正执行了初始化（false 表示此前已初始化）
 */
export function initArtifacts() {
    if (initialized) return false;
    initialized = true;

    if (typeof window !== 'undefined') {
        window._dsArtifacts = {
            // 高层 API：格式快捷方式
            exportHtml: (messages, options) => exportConversation('html', messages, options),
            exportPdf: (messages, options) => exportConversation('pdf', messages, options),
            exportMarkdown: (messages, options) => exportConversation('markdown', messages, options),

            // 高层 API：通用入口
            exportConversation,
            exportSingleMessage,

            // 底层工具函数（供高级用法 / 调试）
            buildConversationHtml,
            buildSingleMessageHtml,
            renderMessageHtml,
            renderMarkdownToHtml,
            buildConversationMarkdown,
            buildMessageMarkdown,
            buildExportFilename,
            exportConversationPdf,
            exportSingleMessagePdf
        };
    }
    return true;
}

// 导出各模块的具名 API，便于其他模块按需 import
export { exportConversation, exportSingleMessage } from './service.js';
export {
    buildConversationHtml,
    buildSingleMessageHtml,
    renderMessageHtml,
    renderMarkdownToHtml,
    escapeHtml
} from './html.js';
export {
    buildConversationMarkdown,
    buildMessageMarkdown,
    buildExportFilename,
    formatTimestamp,
    formatBytes,
    safeFilename,
    normalizeRole
} from './markdown.js';
export { exportConversationPdf, exportSingleMessagePdf } from './pdf.js';
