/**
 * @file i18n 语言存储与翻译函数
 * @module i18n/store
 * @description
 *   油猴脚本 i18n 模块的核心存储与翻译层。
 *
 *   职责：
 *     - 管理 localStorage 中的语言设置（key: `ds_i18n_lang`）
 *     - 支持三态：'auto'（跟随浏览器 navigator.language）/ 'zh-CN' / 'en'
 *     - 提供 getLanguage() 返回有效语言（auto 时解析为 zh-CN 或 en）
 *     - 提供 setLanguage(lang) 持久化语言设置
 *     - 提供 t(key, params?) 翻译函数（按 dot path 取值、占位符替换、缓存）
 *     - 提供 initI18n() 幂等初始化
 *
 *   参考：deepseek-pp/core/i18n/index.ts 的 resolveLocalePreference / formatMessage。
 *   区别：油猴脚本使用 localStorage 而非 chrome.storage，且缓存已解析的 path。
 */

import zhCN from './resources/zh-CN.js';
import en from './resources/en.js';

/** 语言设置持久化的 localStorage 键名 */
const STORAGE_KEY = 'ds_i18n_lang';

/** 默认语言设置（三态之一） */
const DEFAULT_LANGUAGE = 'auto';

/** 受支持的语言偏好（三态） */
const SUPPORTED_PREFERENCES = ['auto', 'zh-CN', 'en'];

/** 受支持的已解析语言 */
const SUPPORTED_LOCALES = ['zh-CN', 'en'];

/** 默认已解析语言（auto 解析失败时的兜底） */
const DEFAULT_LOCALE = 'zh-CN';

/** 语言资源表（已解析语言 → 资源对象） */
const RESOURCES = {
    'zh-CN': zhCN,
    en,
};

/** 已解析语言（缓存，避免每次 t() 都读取 localStorage） */
let _resolvedLanguage = DEFAULT_LOCALE;

/** 当前语言偏好（缓存） */
let _preference = DEFAULT_LANGUAGE;

/** 是否已初始化（幂等标志） */
let _initialized = false;

/** dot path 解析缓存（key → 值，按语言分桶，避免重复 split 与属性查找） */
const _pathCache = {
    'zh-CN': new Map(),
    en: new Map(),
};

/** 命中过缺失告警的 key 集合（避免同一 key 重复 console.warn 刷屏） */
const _warnedKeys = new Set();

// ============================================================
// 语言偏好读写
// ============================================================

/**
 * 从 localStorage 读取语言偏好
 * @returns {string} 语言偏好（'auto' / 'zh-CN' / 'en'）
 */
function readPreference() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (typeof raw === 'string' && SUPPORTED_PREFERENCES.includes(raw)) {
            return raw;
        }
    } catch (e) {}
    return DEFAULT_LANGUAGE;
}

/**
 * 判断给定值是否为受支持的语言偏好
 * @param {unknown} value - 待校验值
 * @returns {boolean}
 */
function isPreference(value) {
    return typeof value === 'string' && SUPPORTED_PREFERENCES.includes(value);
}

/**
 * 将浏览器语言标签解析为受支持的语言
 * @param {string} language - 浏览器语言标签（如 'zh-CN'、'en-US'）
 * @returns {string|null} 解析后的语言（'zh-CN' 或 'en'），不匹配返回 null
 */
function localeFromLanguageTag(language) {
    const normalized = String(language || '').trim().replace(/_/g, '-').toLowerCase();
    if (!normalized) return null;
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
    if (
        normalized === 'zh' ||
        normalized.startsWith('zh-') ||
        normalized === 'cn' ||
        normalized.startsWith('cn-')
    ) {
        return 'zh-CN';
    }
    return null;
}

/**
 * 获取浏览器语言候选列表（navigator.languages 优先）
 * @returns {string[]}
 */
function getBrowserLanguageCandidates() {
    const candidates = [];
    if (typeof navigator !== 'undefined') {
        if (Array.isArray(navigator.languages)) {
            candidates.push(...navigator.languages.filter((l) => typeof l === 'string'));
        }
        if (typeof navigator.language === 'string') {
            candidates.push(navigator.language);
        }
    }
    // 去重
    return [...new Set(candidates.map((l) => l.trim()).filter(Boolean))];
}

/**
 * 将语言偏好解析为有效的已解析语言
 * 'auto' 时遍历浏览器语言列表，匹配不到则回退到默认语言
 * @param {string} preference - 语言偏好
 * @returns {string} 已解析语言（'zh-CN' 或 'en'）
 */
function resolveLanguage(preference) {
    const normalized = isPreference(preference) ? preference : DEFAULT_LANGUAGE;
    if (normalized !== 'auto') {
        return normalized;
    }
    // auto：跟随浏览器 navigator.language
    const candidates = getBrowserLanguageCandidates();
    for (const lang of candidates) {
        const locale = localeFromLanguageTag(lang);
        if (locale) return locale;
    }
    return DEFAULT_LOCALE;
}

/**
 * 获取当前生效的语言（已解析，'zh-CN' 或 'en'）
 * @returns {string} 已解析语言
 */
export function getLanguage() {
    return _resolvedLanguage;
}

/**
 * 设置语言偏好并持久化到 localStorage
 * 设置后会刷新内部缓存，使后续 t() 调用立即生效
 * @param {string} lang - 语言偏好（'auto' / 'zh-CN' / 'en'）
 * @returns {string} 设置后的已解析语言
 */
export function setLanguage(lang) {
    const preference = isPreference(lang) ? lang : DEFAULT_LANGUAGE;
    _preference = preference;
    try {
        localStorage.setItem(STORAGE_KEY, preference);
    } catch (e) {}
    _resolvedLanguage = resolveLanguage(preference);
    // 切换语言后清空 path 缓存，避免旧语言的结果残留
    _pathCache['zh-CN'].clear();
    _pathCache.en.clear();
    _warnedKeys.clear();
    return _resolvedLanguage;
}

// ============================================================
// 翻译函数
// ============================================================

/**
 * 按 dot path 从资源对象中取值（带缓存）
 * @param {string} key - 点分路径（如 'settings.toggle.sakura.label'）
 * @param {string} locale - 已解析语言
 * @returns {unknown} 取到的值；路径不存在返回 undefined
 */
function readResourcePath(key, locale) {
    const cache = _pathCache[locale];
    if (cache.has(key)) {
        return cache.get(key);
    }
    const resource = RESOURCES[locale] || RESOURCES[DEFAULT_LOCALE];
    let current = resource;
    const segments = key.split('.');
    for (const seg of segments) {
        if (!current || typeof current !== 'object' || !(seg in current)) {
            current = undefined;
            break;
        }
        current = current[seg];
    }
    cache.set(key, current);
    return current;
}

/**
 * 替换模板中的 {name} 占位符
 * @param {string} template - 含 {name} 占位符的模板字符串
 * @param {Object<string, *>} [params] - 占位符参数
 * @returns {string} 替换后的字符串
 */
function formatMessage(template, params) {
    if (typeof template !== 'string') return '';
    if (!params || typeof params !== 'object') return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
        if (Object.prototype.hasOwnProperty.call(params, name)) {
            return String(params[name]);
        }
        return match;
    });
}

/**
 * 翻译函数：按 dot path 取值并替换占位符
 *
 * 行为：
 *   - 按 key 从当前语言资源中取值
 *   - 支持 {name} 占位符替换（params 为键值对象）
 *   - key 不存在时返回 key 本身并 console.warn（同一 key 仅警告一次）
 *
 * @param {string} key - 点分资源 key（如 'menu.scriptSettings'）
 * @param {Object<string, *>} [params] - 占位符参数
 * @returns {string} 翻译后的文案
 */
export function t(key, params) {
    if (typeof key !== 'string' || !key) return '';
    const value = readResourcePath(key, _resolvedLanguage);
    if (typeof value === 'string') {
        return params ? formatMessage(value, params) : value;
    }
    // 缺失告警（去重，避免刷屏）
    if (!_warnedKeys.has(key)) {
        _warnedKeys.add(key);
        try {
            console.warn(`[i18n] missing key: ${key} (lang=${_resolvedLanguage})`);
        } catch (e) {}
    }
    return key;
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化 i18n 模块（幂等）
 *
 * 读取 localStorage 中的语言偏好并解析为有效语言。
 * 多次调用安全，仅首次执行实际初始化。
 * @returns {string} 初始化后的已解析语言
 */
export function initI18n() {
    if (_initialized) return _resolvedLanguage;
    _initialized = true;
    _preference = readPreference();
    _resolvedLanguage = resolveLanguage(_preference);
    return _resolvedLanguage;
}

// ============================================================
// 附加导出（供外部读取偏好状态）
// ============================================================

/**
 * 获取当前语言偏好（未解析，可能为 'auto'）
 * @returns {string} 语言偏好
 */
export function getLanguagePreference() {
    return _preference;
}
