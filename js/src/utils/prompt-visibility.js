/**
 * Prompt 可见性标记（移植自 deepseek-pp/core/prompt/visibility.ts）
 *
 * 用注释标签包裹"用户可见的原始 prompt"，使脚本能在被注入了大量前缀的
 * 最终 prompt 中精确识别哪一段是用户真正输入的内容。
 *
 * 用途：
 *   1. anti-recall/history-cleanup 在刷新后从历史消息中恢复原始 prompt
 *   2. capability-agent 构建续跑 prompt 时提取原始用户任务
 *   3. token 估算时只统计用户输入部分
 *
 * 标记格式（HTML 注释，不会被 DeepSeek 渲染为可见文本）：
 *   <!--ds-visible-user-prompt-start-->
 *   用户原始输入
 *   <!--ds-visible-user-prompt-end-->
 *
 * metadata 行（附加在 prompt 前，含时间戳和长度，用于校验完整性）：
 *   <!--ds-prompt-metadata timestamp="1234567890" length="42"-->
 */

/** 起始标记 */
const VISIBLE_PROMPT_START = '<!--ds-visible-user-prompt-start-->';
/** 结束标记 */
const VISIBLE_PROMPT_END = '<!--ds-visible-user-prompt-end-->';

/** metadata 正则（用于解析校验） */
const METADATA_REGEX = /<!--ds-prompt-metadata timestamp="(\d+)" length="(\d+)"-->/;

/** 起始标记正则（全局） */
const START_REGEX = new RegExp(VISIBLE_PROMPT_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
/** 结束标记正则（全局） */
const END_REGEX = new RegExp(VISIBLE_PROMPT_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
/** 完整块正则（贪婪匹配 start...end） */
const FULL_BLOCK_REGEX = new RegExp(
    VISIBLE_PROMPT_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '([\\s\\S]*?)' +
    VISIBLE_PROMPT_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g'
);

/**
 * 生成 prompt metadata 行
 * @param {string} prompt - 用户原始 prompt
 * @returns {string} metadata 注释行（含时间戳和字符长度）
 */
export function markVisibleUserPromptMetadata(prompt) {
    const timestamp = Date.now();
    const length = typeof prompt === 'string' ? prompt.length : 0;
    return `<!--ds-prompt-metadata timestamp="${timestamp}" length="${length}"-->`;
}

/**
 * 用可见性标记包裹用户原始 prompt
 *
 * 在 prompt 前后添加 start/end 注释，使脚本能从被注入前缀的最终 prompt 中
 * 精确提取用户真正输入的内容。
 *
 * @param {string} prompt - 用户原始 prompt
 * @returns {string} 包裹后的 prompt（含 start + prompt + end）
 */
export function markVisibleUserPrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt) return prompt || '';
    return VISIBLE_PROMPT_START + prompt + VISIBLE_PROMPT_END;
}

/**
 * 从含标记的 prompt 中提取用户原始输入
 *
 * @param {string} prompt - 可能含可见性标记的 prompt
 * @returns {string|null} 用户原始 prompt；无标记时返回 null
 */
export function extractVisibleUserPrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt) return null;
    const match = new RegExp(FULL_BLOCK_REGEX).exec(prompt);
    if (!match) return null;
    return match[1];
}

/**
 * 检测 prompt 是否含可见性标记
 * @param {string} prompt
 * @returns {boolean}
 */
export function hasVisibleUserPromptMark(prompt) {
    if (typeof prompt !== 'string' || !prompt) return false;
    return prompt.includes(VISIBLE_PROMPT_START) && prompt.includes(VISIBLE_PROMPT_END);
}

/**
 * 解析 prompt metadata 行
 * @param {string} prompt
 * @returns {{timestamp: number, length: number}|null}
 */
export function parsePromptMetadata(prompt) {
    if (typeof prompt !== 'string' || !prompt) return null;
    const match = METADATA_REGEX.exec(prompt);
    if (!match) return null;
    return {
        timestamp: parseInt(match[1], 10),
        length: parseInt(match[2], 10)
    };
}

/**
 * 清理 prompt 中的所有可见性标记和 metadata 行
 *
 * 用于在 UI 显示前清除标记（如 history-cleanup 显示历史消息时）
 *
 * @param {string} prompt
 * @returns {string} 清理后的 prompt
 */
export function cleanVisibleUserPromptMarks(prompt) {
    if (typeof prompt !== 'string' || !prompt) return prompt;
    return prompt
        .replace(METADATA_REGEX, '')
        .replace(START_REGEX, '')
        .replace(END_REGEX, '')
        .replace(/^\s+|\s+$/g, ''); // 清理首尾空白
}

/**
 * 导出标记常量（供其他模块构建正则用）
 */
export {
    VISIBLE_PROMPT_START,
    VISIBLE_PROMPT_END
};
