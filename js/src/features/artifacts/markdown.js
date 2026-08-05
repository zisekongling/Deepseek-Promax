/**
 * Markdown 导出共享模块
 *
 * 把消息数组或单条消息导出为 Markdown 字符串。
 * 提取自 inline-export.js 的 buildMarkdown / safeFilename / normalizeRole 逻辑，
 * 使其可在 artifacts 模块（html / pdf / service）之间复用，避免逻辑重复。
 *
 * 数据契约：
 *   消息对象：{ role: 'user'|'assistant', content: string, attachments?: Array, timestamp?, thinking? }
 *   附件对象：{ id?, fileName?, name?, size?, sizeBytes?, status?, mimeType? }
 *
 * 与 inline-export.js 的关系：
 *   - 本模块不修改 inline-export.js，仅复用其函数思路
 *   - Phase 6 集成时，inline-export.js 可改为复用本模块（保持向后兼容）
 */

/**
 * 净化字符串为安全文件名
 * 把非 [\w.-] 字符替换为 -，截断到 80 字符，空值兜底为 message
 * （参考 inline-export.js:89-95 的 safeFilename 与 deepseek-pp/secondary-artifacts.ts:107-109）
 * @param {string} value - 待净化的字符串
 * @returns {string} 净化后的安全文件名
 */
export function safeFilename(value) {
    const cleaned = String(value || '')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return cleaned || 'message';
}

/**
 * 规范化消息角色（参考 inline-export.js:102-109 的 normalizeRole）
 * @param {string|undefined} value - 原始角色字符串
 * @returns {'user'|'assistant'|'system'|'tool'|'unknown'} 规范化后的角色
 */
export function normalizeRole(value) {
    const lower = String(value || '').toLowerCase();
    if (lower === 'user' || lower === 'human') return 'user';
    if (lower === 'assistant' || lower === 'ai' || lower === 'bot') return 'assistant';
    if (lower === 'system') return 'system';
    if (lower === 'tool') return 'tool';
    return 'unknown';
}

/**
 * 格式化日期为 YYYY-MM-DD HH:mm:ss
 * @param {Date|number|string} [date] - 日期对象/时间戳/可解析字符串，缺省为当前时间
 * @returns {string} 格式化后的时间字符串
 */
export function formatTimestamp(date) {
    const d = date ? new Date(date) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 格式化字节大小为人类可读字符串
 * @param {number} bytes - 字节数
 * @returns {string} 形如 "1.2 KB"，无法解析时返回空字符串
 */
export function formatBytes(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 生成导出文件名 deepseek-export-YYYYMMDD-HHmmss.ext
 * @param {string} [ext='md'] - 扩展名（不带点）
 * @returns {string} 形如 deepseek-export-20240101-120000.md
 */
export function buildExportFilename(ext = 'md') {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
               `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `deepseek-export-${ts}.${ext}`;
}

/**
 * 把附件列表渲染为 Markdown 片段
 * @param {Array} attachments - 附件数组
 * @returns {string} Markdown 文本（含"附件:"标题），无附件时返回空字符串
 */
function renderAttachmentsMarkdown(attachments) {
    if (!attachments || attachments.length === 0) return '';
    const lines = ['', '**附件:**'];
    for (const att of attachments) {
        const name = att.fileName || att.name || att.id || 'unknown';
        const size = formatBytes(att.sizeBytes != null ? att.sizeBytes : att.size);
        const status = att.status || '';
        const meta = [size, status].filter(Boolean).join(', ');
        lines.push(meta ? `- ${name} (${meta})` : `- ${name}`);
    }
    return lines.join('\n');
}

/**
 * 把单条消息转为 Markdown 文本
 * @param {Object} message - 消息对象 { role, content, attachments?, timestamp?, thinking? }
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title] - 可选的顶级标题（单消息导出时使用）
 * @returns {string} Markdown 文本
 */
export function buildMessageMarkdown(message, options = {}) {
    if (!message) return '';
    const role = normalizeRole(message.role);
    const roleLabel = role === 'user' ? '👤 用户'
                    : role === 'assistant' ? '🤖 DeepSeek'
                    : role;
    const ts = message.timestamp ? formatTimestamp(message.timestamp) : formatTimestamp();

    const parts = [];
    if (options.title) {
        parts.push(`# ${options.title}`, '');
    }
    parts.push(`### ${roleLabel}`);
    parts.push(`*${ts}*`);
    parts.push('');

    if (message.thinking) {
        parts.push('> 💭 思考过程:');
        parts.push('> ' + String(message.thinking).replace(/\n/g, '\n> '));
        parts.push('');
    }

    parts.push(message.content || '_No text content_');

    const attMd = renderAttachmentsMarkdown(message.attachments);
    if (attMd) {
        parts.push('', attMd);
    }
    return parts.join('\n');
}

/**
 * 把消息数组转为 Markdown 文档
 * @param {Array} messages - 消息数组
 * @param {Object} [options={}] - 选项
 * @param {string} [options.title='DeepSeek 对话'] - 文档标题
 * @returns {string} 完整 Markdown 文档
 */
export function buildConversationMarkdown(messages, options = {}) {
    const title = options.title || 'DeepSeek 对话';
    const parts = [];
    parts.push(`# ${title}`);
    parts.push('');
    parts.push(`> 导出时间: ${formatTimestamp()}`);
    parts.push('');
    parts.push('---');
    parts.push('');

    if (!messages || messages.length === 0) {
        parts.push('_No messages_');
        return parts.join('\n');
    }

    for (const msg of messages) {
        parts.push(buildMessageMarkdown(msg));
        parts.push('', '---', '');
    }
    return parts.join('\n');
}
