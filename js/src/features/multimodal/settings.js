/**
 * @module multimodal/settings
 * @description 多模态 API 配置管理模块
 *
 * 职责：
 *   - 管理 OpenAI / Gemini 图片分析的 API 配置（provider、apiKey、model、baseUrl 等）
 *   - 配置持久化到 localStorage（key: ds_multimodal_config），仅本地存储，不同步
 *   - 暴露 getMultimodalConfig() / saveMultimodalConfig(patch) / isMultimodalEnabled()
 *
 * 安全约定：
 *   - API Key 仅存本地 localStorage，不进入主 CONFIG 同步流，不 console.log
 *   - 读取 Key 时只做内存传递，绝不打印到控制台
 *
 * 与主 CONFIG 的关系：
 *   - 主 CONFIG 新增键 multimodalEnabled（bool，默认 false），作为多模态总开关
 *     该键由 initMultimodal() 合并到运行时 CONFIG（参照 web-tools.js 模式），
 *     Phase 6 统一集成时迁移到 config.js 的 DEFAULTS
 *   - 本模块的 ds_multimodal_config 存放 provider/apiKey/model 等细节配置
 *
 * 参考实现：deepseek-pp/core/multimodal/settings.ts
 */

import { CONFIG } from '../../config.js';

// ============================================================
// 常量与默认值
// ============================================================

/** 多模态配置的 localStorage 键名（独立于主 CONFIG，仅本地） */
const STORAGE_KEY = 'ds_multimodal_config';

/**
 * 多模态配置默认值
 * @type {Object}
 */
const DEFAULTS = {
    // 模块内开关（与主 CONFIG.multimodalEnabled 共同决定是否启用，fail-closed）
    enabled: false,
    // 当前服务商：openai | gemini
    provider: 'openai',
    // OpenAI 配置
    openai: {
        apiKey: '',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.openai.com/v1'
    },
    // Gemini 配置
    gemini: {
        apiKey: '',
        model: 'gemini-2.5-flash',
        baseUrl: 'https://generativelanguage.googleapis.com'
    },
    // 单次最大图片数
    maxImages: 4,
    // 请求超时（毫秒），多图时按数量扩展
    timeout: 60000
};

/** 内存缓存（避免每次读取都 JSON.parse） */
let cache = null;
/** 缓存是否脏（需从 localStorage 重新读取） */
let cacheDirty = true;

// ============================================================
// 规范化与读取
// ============================================================

/**
 * 规范化配置对象：与默认值深合并，修正非法字段
 *
 * @param {*} value - 原始值（通常来自 JSON.parse）
 * @returns {Object} 规范化后的配置对象
 */
function normalizeConfig(value) {
    const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    const provider = (obj.provider === 'gemini') ? 'gemini' : 'openai';
    return {
        enabled: obj.enabled === true,
        provider,
        openai: normalizeProvider(obj.openai, DEFAULTS.openai),
        gemini: normalizeProvider(obj.gemini, DEFAULTS.gemini),
        maxImages: normalizeInt(obj.maxImages, DEFAULTS.maxImages, 1, 10),
        timeout: normalizeInt(obj.timeout, DEFAULTS.timeout, 5000, 300000)
    };
}

/**
 * 规范化单个服务商配置（openai / gemini）
 *
 * @param {*} value - 原始值
 * @param {Object} fallback - 默认值
 * @returns {{apiKey:string, model:string, baseUrl:string}}
 */
function normalizeProvider(value, fallback) {
    const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    return {
        apiKey: typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '',
        model: normalizeModel(obj.model, fallback.model),
        baseUrl: normalizeBaseUrl(obj.baseUrl, fallback.baseUrl)
    };
}

/**
 * 规范化模型名（非空字符串，否则用默认值）
 *
 * @param {*} value - 原始值
 * @param {string} fallback - 默认模型
 * @returns {string}
 */
function normalizeModel(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const t = value.trim();
    return t.length > 0 ? t : fallback;
}

/**
 * 规范化 baseUrl（去尾部斜杠，http(s) 校验，否则用默认值）
 *
 * @param {*} value - 原始值
 * @param {string} fallback - 默认 baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const t = value.trim().replace(/\/+$/, '');
    if (t.length === 0) return fallback;
    try {
        const u = new URL(t);
        if (u.protocol === 'http:' || u.protocol === 'https:') return t;
    } catch (e) {}
    return fallback;
}

/**
 * 规范化整数（限制在 [min, max] 区间）
 *
 * @param {*} value - 原始值
 * @param {number} fallback - 默认值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
function normalizeInt(value, fallback, min, max) {
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * 从 localStorage 加载配置并缓存
 *
 * @returns {Object} 规范化后的配置对象
 */
function loadConfig() {
    if (!cacheDirty && cache) return cache;
    let raw = null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        raw = null;
    }
    let parsed = {};
    if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = {}; }
    }
    cache = normalizeConfig(parsed);
    cacheDirty = false;
    return cache;
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 获取多模态配置（含默认值合并）
 *
 * 返回深拷贝，调用方修改不会影响内部缓存。
 * 注意：返回值包含 apiKey，请勿 console.log 整个对象。
 *
 * @returns {Object} 配置对象
 */
export function getMultimodalConfig() {
    return deepClone(loadConfig());
}

/**
 * 保存多模态配置（patch 合并写入）
 *
 * 仅写入 localStorage，不进入主 CONFIG 同步流。
 * Key 仅本地存储。
 *
 * @param {Object} patch - 待合并的字段（支持 enabled / provider / openai / gemini / maxImages / timeout）
 * @returns {Object} 保存后的完整配置（不含 apiKey 的安全视图）
 */
export function saveMultimodalConfig(patch) {
    const current = loadConfig();
    const next = normalizeConfig(mergePatch(current, patch || {}));
    cache = next;
    cacheDirty = false;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
        // 写入失败（如隐私模式），配置仍保留在内存缓存中，本次会话可用
    }
    // 返回安全视图（移除 apiKey 明文），避免调用方误打印
    return toSafeView(next);
}

/**
 * 判断多模态功能是否启用
 *
 * 同时满足两个条件才视为启用（fail-closed）：
 *   1. 主 CONFIG.multimodalEnabled === true（总开关，Phase 6 在设置面板暴露）
 *   2. 本模块配置 enabled === true
 *
 * @returns {boolean}
 */
export function isMultimodalEnabled() {
    // 优先读 window.__dsConfig（最新），回退到 import 快照
    let master = false;
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            master = window.__dsConfig.multimodalEnabled === true;
        } else {
            master = CONFIG.multimodalEnabled === true;
        }
    } catch (e) {
        master = false;
    }
    if (!master) return false;
    return loadConfig().enabled === true;
}

/**
 * 判断当前选定的 provider 是否已配置完整（apiKey 非空）
 *
 * @returns {boolean}
 */
export function isProviderConfigured() {
    const cfg = loadConfig();
    const p = cfg.provider === 'gemini' ? cfg.gemini : cfg.openai;
    return p.apiKey.length > 0;
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 将 patch 合并到 current（支持 openai/gemini 子对象浅合并）
 *
 * @param {Object} current - 当前配置
 * @param {Object} patch - 待合并字段
 * @returns {Object} 合并后的对象（未规范化）
 */
function mergePatch(current, patch) {
    const out = { ...current };
    if (patch.enabled !== undefined) out.enabled = patch.enabled;
    if (patch.provider !== undefined) out.provider = patch.provider;
    if (patch.maxImages !== undefined) out.maxImages = patch.maxImages;
    if (patch.timeout !== undefined) out.timeout = patch.timeout;
    if (patch.openai && typeof patch.openai === 'object') {
        out.openai = { ...current.openai, ...patch.openai };
    }
    if (patch.gemini && typeof patch.gemini === 'object') {
        out.gemini = { ...current.gemini, ...patch.gemini };
    }
    return out;
}

/**
 * 深拷贝配置对象
 *
 * @param {Object} cfg
 * @returns {Object}
 */
function deepClone(cfg) {
    return {
        enabled: cfg.enabled,
        provider: cfg.provider,
        openai: { ...cfg.openai },
        gemini: { ...cfg.gemini },
        maxImages: cfg.maxImages,
        timeout: cfg.timeout
    };
}

/**
 * 生成不含 apiKey 明文的安全视图（用于返回给调用方/日志）
 *
 * @param {Object} cfg
 * @returns {Object}
 */
function toSafeView(cfg) {
    return {
        enabled: cfg.enabled,
        provider: cfg.provider,
        openai: { model: cfg.openai.model, baseUrl: cfg.openai.baseUrl, apiKeyConfigured: cfg.openai.apiKey.length > 0 },
        gemini: { model: cfg.gemini.model, baseUrl: cfg.gemini.baseUrl, apiKeyConfigured: cfg.gemini.apiKey.length > 0 },
        maxImages: cfg.maxImages,
        timeout: cfg.timeout
    };
}
