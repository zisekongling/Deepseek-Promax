/**
 * @file 宠物模块入口
 *
 * 职责：
 *   - 提供 initPet() 幂等初始化
 *   - 注册 window._dsPet 全局接口（setState / getLine / show / hide / getConfig / saveConfig）
 *   - 监听 CONFIG.petEnabled 总开关，切换宠物显示/隐藏
 *
 * 集成说明：
 *   CONFIG.petEnabled 键由 Phase 6 在 config.js 的 DEFAULTS 中新增（默认 false）。
 *   当前阶段 CONFIG.petEnabled 可能未定义，按 false 处理，不阻塞模块加载。
 *   由于 config.js 无配置变更事件，采用轮询（1.5s）检测 petEnabled 变化。
 */

import { CONFIG } from '../../config.js';
import { initWhalePet, destroyWhalePet, getWhalePet, PET_STATES } from './pet.js';
import { getPetConfig, savePetConfig, resetPetConfig } from './store.js';
import { getLine, getRotateInterval, getLinesForState } from './lines.js';

/** 模块是否已安装 */
let installed = false;
/** 上一次同步时的启用状态，用于检测变化 */
let lastEnabled = null;
/** 配置轮询定时器 */
let configWatchTimer = null;
/** 配置轮询间隔（毫秒） */
const CONFIG_WATCH_INTERVAL = 1500;

/**
 * 安全读取 CONFIG.petEnabled（容错未定义情况）
 * @returns {boolean}
 */
function readPetEnabled() {
    try {
        return !!(CONFIG && CONFIG.petEnabled === true);
    } catch (e) {
        return false;
    }
}

/**
 * 同步 CONFIG.petEnabled 与宠物实例可见性
 * 启用时创建实例，禁用时销毁实例
 */
function syncEnabled() {
    const enabled = readPetEnabled();
    if (enabled === lastEnabled) return;
    lastEnabled = enabled;
    if (enabled) {
        initWhalePet();
    } else {
        destroyWhalePet();
    }
}

/**
 * 初始化宠物模块（幂等）
 *
 * 注册 window._dsPet 全局接口，并根据 CONFIG.petEnabled 决定是否创建宠物实例。
 * 之后通过轮询监听 petEnabled 变化，自动切换显示/隐藏。
 */
export function initPet() {
    if (installed) return;
    installed = true;

    // 注册 window._dsPet 全局接口（供其他模块或控制台手动调用）
    if (typeof window !== 'undefined') {
        window._dsPet = {
            /**
             * 手动切换宠物状态
             * @param {string} state - 状态枚举值
             */
            setState(state) {
                const pet = getWhalePet();
                if (pet) pet.setState(state);
            },
            /**
             * 获取指定状态的台词
             * @param {string} state - 状态枚举值
             * @param {string} [lastLine] - 上次台词，避免重复
             * @returns {string}
             */
            getLine(state, lastLine) {
                return getLine(state, lastLine);
            },
            /** 显示宠物 */
            show() {
                const pet = getWhalePet();
                if (pet) pet.show();
            },
            /** 隐藏宠物 */
            hide() {
                const pet = getWhalePet();
                if (pet) pet.hide();
            },
            /** 获取当前宠物配置 */
            getConfig() {
                return getPetConfig();
            },
            /**
             * 保存宠物配置（合并 patch）
             * @param {Object} patch - 待合并字段
             * @returns {Object} 保存后的完整配置
             */
            saveConfig(patch) {
                return savePetConfig(patch);
            },
            /** 重置宠物配置为默认值 */
            resetConfig() {
                return resetPetConfig();
            }
        };
    }

    // 初次同步（根据 CONFIG.petEnabled 决定是否创建实例）
    syncEnabled();

    // 轮询监听 CONFIG.petEnabled 变化
    // config.js 无配置变更事件，采用轻量轮询；变更时切换实例
    configWatchTimer = setInterval(syncEnabled, CONFIG_WATCH_INTERVAL);

    // 页面卸载前销毁实例，避免内存泄漏
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', destroyPet);
    }
}

/**
 * 销毁宠物模块
 * 停止轮询、销毁实例、移除 window._dsPet 接口
 */
export function destroyPet() {
    if (!installed) return;
    installed = false;
    if (configWatchTimer) {
        clearInterval(configWatchTimer);
        configWatchTimer = null;
    }
    destroyWhalePet();
    lastEnabled = null;
    if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', destroyPet);
        if (window._dsPet) {
            try { delete window._dsPet; } catch (e) { window._dsPet = undefined; }
        }
    }
}

export { PET_STATES, getLine, getRotateInterval, getLinesForState, getPetConfig, savePetConfig, resetPetConfig };
