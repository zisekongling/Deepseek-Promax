/**
 * Token 估算器
 *
 * 基于 DeepSeek 官方公式估算文本 token 数：
 *   - CJK 字符（charCode > 0x7F）≈ 0.6 token
 *   - ASCII 字符 ≈ 0.3 token
 *
 * 参考来源：https://api-docs.deepseek.com/quick_start/token_usage
 */

/**
 * 估算文本的 token 数（浮点值，用于精确计算速度）
 * @param {string} text - 待估算的文本
 * @returns {number} 估算的 token 数（浮点）
 */
export function estimateTokenUnits(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const char of text) {
        tokens += char.charCodeAt(0) > 0x7F ? 0.6 : 0.3;
    }
    return tokens;
}

/**
 * 估算文本的 token 数（向上取整，用于显示）
 * @param {string} text - 待估算的文本
 * @returns {number} 估算的 token 数（整数）
 */
export function estimateTokens(text) {
    return Math.ceil(estimateTokenUnits(text));
}

/**
 * 格式化 token 数为可读字符串（如 1,234）
 * @param {number} tokens - token 数
 * @returns {string} 格式化后的字符串
 */
export function formatTokens(tokens) {
    return new Intl.NumberFormat('en-US').format(Math.round(tokens));
}

/**
 * 格式化 token 速度为可读字符串（如 56.7 tok/s）
 * @param {number} tokens - token 数
 * @param {number} elapsedMs - 耗时（毫秒）
 * @returns {string} 格式化后的速度字符串
 */
export function formatTokenSpeed(tokens, elapsedMs) {
    if (elapsedMs <= 0) return '0.0 tok/s';
    const speed = tokens / (elapsedMs / 1000);
    return `${speed.toFixed(1)} tok/s`;
}
