/**
 * @file 宠物配置存储模块
 *
 * 负责小鲸鱼宠物的配置 CRUD，持久化到 localStorage（key: ds_pet_config）。
 *
 * 配置结构：
 *   {
 *     enabled: boolean,                 // 是否启用（受 CONFIG.petEnabled 总开关统一下发）
 *     position: 'left-bottom'           // 预设位置：左下
 *              | 'right-bottom'         // 预设位置：右下（默认）
 *              | { x: number, y: number }, // 绝对坐标（拖动后持久化）
 *     size: number,                     // 鲸鱼尺寸（像素，宽）
 *     opacity: number,                  // 整体透明度 0~1
 *     floatAnimation: boolean           // 是否开启上下漂浮动画
 *   }
 *
 * 设计要点：
 *   - 位置字段支持预设字符串与绝对坐标对象两种形态，便于拖动后保存精确坐标
 *   - 所有字段在读取时做规范化与范围 clamp，避免脏数据导致渲染异常
 *   - 内存缓存避免频繁 JSON.parse，写入时同步更新缓存
 */

/** localStorage 存储键 */
const STORAGE_KEY = 'ds_pet_config';

/** 默认配置 */
const DEFAULTS = {
    enabled: false,
    position: 'right-bottom',
    size: 120,
    opacity: 0.9,
    floatAnimation: true
};

/** 尺寸范围（像素） */
const MIN_SIZE = 80;
const MAX_SIZE = 200;
/** 透明度范围 */
const MIN_OPACITY = 0.4;
const MAX_OPACITY = 1;
/** 预设位置距 viewport 边缘的留白 */
const POSITION_MARGIN = 24;

/** 内存缓存（避免每次读取都 JSON.parse） */
let _cache = null;

/**
 * 将尺寸值 clamp 到合法范围
 * @param {*} value - 任意输入值
 * @returns {number} 合法尺寸（整数像素）
 */
function clampSize(value) {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULTS.size;
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

/**
 * 将透明度值 clamp 到合法范围
 * @param {*} value - 任意输入值
 * @returns {number} 合法透明度 0~1
 */
function clampOpacity(value) {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULTS.opacity;
    return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, n));
}

/**
 * 规范化位置字段
 * 接受预设字符串（'left-bottom' / 'right-bottom'）或绝对坐标对象 {x, y}
 * 非法值回退到默认预设
 * @param {*} value - 原始位置值
 * @returns {{x:number,y:number}|string} 预设字符串或坐标对象
 */
function normalizePosition(value) {
    if (value === 'left-bottom' || value === 'right-bottom') return value;
    if (value && typeof value === 'object') {
        const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : null;
        const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : null;
        if (x !== null && y !== null) {
            return { x: Math.round(x), y: Math.round(y) };
        }
    }
    return DEFAULTS.position;
}

/**
 * 规范化整份配置（合并默认值 + 字段校验）
 * @param {Object|null|undefined} config - 原始配置
 * @returns {Object} 规范化后的配置对象
 */
function normalizeConfig(config) {
    if (!config || typeof config !== 'object') return { ...DEFAULTS };
    return {
        enabled: config.enabled === true,
        position: normalizePosition(config.position),
        size: clampSize(config.size),
        opacity: clampOpacity(config.opacity),
        floatAnimation: config.floatAnimation !== false
    };
}

/**
 * 深拷贝配置（position 对象也独立拷贝，避免外部修改污染缓存）
 * @param {Object} cfg - 缓存中的配置
 * @returns {Object} 独立的配置副本
 */
function cloneConfig(cfg) {
    const result = { ...cfg };
    if (result.position && typeof result.position === 'object') {
        result.position = { ...result.position };
    }
    return result;
}

/**
 * 读取宠物配置（带内存缓存）
 * @returns {Object} 配置对象副本（外部修改不影响缓存）
 */
export function getPetConfig() {
    if (!_cache) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            _cache = normalizeConfig(raw ? JSON.parse(raw) : null);
        } catch (e) {
            _cache = normalizeConfig(null);
        }
    }
    return cloneConfig(_cache);
}

/**
 * 保存配置（合并 patch 后写入 localStorage，同步更新缓存）
 * @param {Object} patch - 待合并的字段对象
 * @returns {Object} 保存后的完整配置（副本）
 */
export function savePetConfig(patch) {
    const current = _cache ? cloneConfig(_cache) : getPetConfig();
    const merged = normalizeConfig({ ...current, ...(patch || {}) });
    _cache = merged;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {}
    return cloneConfig(merged);
}

/**
 * 重置配置为默认值并清除 localStorage
 * @returns {Object} 默认配置（副本）
 */
export function resetPetConfig() {
    _cache = { ...DEFAULTS };
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    return cloneConfig(_cache);
}

/**
 * 计算预设位置在当前 viewport 下的绝对坐标
 * 供渲染层在应用预设时统一换算
 * @param {'left-bottom'|'right-bottom'} preset - 预设位置
 * @param {number} width - 鲸鱼渲染宽度
 * @param {number} height - 鲸鱼渲染高度
 * @returns {{x:number,y:number}} 绝对坐标
 */
export function resolvePresetPosition(preset, width, height) {
    if (preset === 'left-bottom') {
        return {
            x: POSITION_MARGIN,
            y: Math.max(POSITION_MARGIN, window.innerHeight - height - POSITION_MARGIN)
        };
    }
    // 默认 right-bottom
    return {
        x: Math.max(POSITION_MARGIN, window.innerWidth - width - POSITION_MARGIN),
        y: Math.max(POSITION_MARGIN, window.innerHeight - height - POSITION_MARGIN)
    };
}

/** 导出尺寸留白，供渲染层 clamp 时复用 */
export const POSITION_MARGIN_VALUE = POSITION_MARGIN;
