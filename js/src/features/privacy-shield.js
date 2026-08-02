/**
 * 隐私保护模块（敏感词替换）
 *
 * 将页面文本中的敏感词替换为指定的替代文本。
 * 直接修改 textContent，不改变 DOM 结构，避免 React removeChild 错误。
 * 相比原始 DeepSeek Privacy 脚本的改进：
 *   1. 正则特殊字符转义（修复原脚本 bug）
 *   2. 集成到 processTextNode，避免全文档 TreeWalker 遍历
 *   3. 缓存编译后的正则，提升性能
 */
import { CONFIG } from '../config.js';

/** 编译后的正则缓存（避免每次重新编译） */
let _regexCache = null;
let _cacheKey = '';

/**
 * 转义正则特殊字符
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 获取编译后的正则数组（带缓存）
 * @returns {Array<{regex: RegExp, replacement: string}>}
 */
function getCompiledRegexes() {
    const words = CONFIG.sensitiveWords || {};
    const keys = Object.keys(words).sort().join('\u0001') + '|' + (CONFIG.caseSensitive ? '1' : '0');
    if (_cacheKey === keys && _regexCache) return _regexCache;
    _cacheKey = keys;
    _regexCache = [];
    for (const [word, replacement] of Object.entries(words)) {
        if (!word) continue;
        try {
            const regex = new RegExp(escapeRegExp(word), CONFIG.caseSensitive ? "g" : "gi");
            _regexCache.push({ regex, replacement });
        } catch(e) {}
    }
    return _regexCache;
}

/** 清除正则缓存（配置变更时调用） */
export function clearPrivacyCache() {
    _regexCache = null;
    _cacheKey = '';
}

/**
 * 替换文本节点中的敏感词
 * 直接修改 textContent，不改变 DOM 结构
 * @param {Text} textNode
 */
export function replaceSensitiveData(textNode) {
    if (!CONFIG.privacyShieldEnabled) return;
    // 仅处理 DeepSeek 消息容器内的文本节点，避免替换侧边栏、设置面板等非消息区域
    const msgEl = textNode.parentElement?.closest('.ds-message');
    if (!msgEl) return;
    const regexes = getCompiledRegexes();
    if (regexes.length === 0) return;

    const text = textNode.textContent;
    if (!text || text.length < 1) return;

    let modified = text;
    let changed = false;
    for (const { regex, replacement } of regexes) {
        regex.lastIndex = 0;
        const newText = modified.replace(regex, replacement);
        if (newText !== modified) {
            modified = newText;
            changed = true;
        }
    }
    if (changed) {
        textNode.textContent = modified;
    }
}
