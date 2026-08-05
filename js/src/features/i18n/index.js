/**
 * @file i18n 模块入口
 * @module i18n
 * @description
 *   DeepSeek 油猴脚本 i18n（中英文）模块入口。
 *
 *   职责：
 *     - 启动时初始化语言（initI18n），根据存储的语言设置生效
 *     - 注册全局接口 window._dsI18n = { t, getLanguage, setLanguage }
 *
 *   集成说明：
 *     Phase 6 统一将各模块中的硬编码中文文案替换为 window._dsI18n.t(key) 调用。
 *     本文件仅负责初始化与全局注册，不修改现有业务文件。
 */

import { initI18n, t, getLanguage, setLanguage, getLanguagePreference } from './store.js';

/**
 * 启动 i18n 模块：初始化语言并注册全局接口
 *
 * 执行步骤：
 *   1. 调用 initI18n() 读取 localStorage 中的语言偏好并解析为有效语言
 *   2. 将 { t, getLanguage, setLanguage } 注册到 window._dsI18n
 *
 * 该函数幂等，多次调用安全。
 * @returns {string} 启动后生效的已解析语言
 */
export function startI18n() {
    const language = initI18n();
    if (typeof window !== 'undefined') {
        window._dsI18n = {
            t,
            getLanguage,
            setLanguage,
            getLanguagePreference,
        };
    }
    return language;
}

// 模块导入时自动启动，使全局 window._dsI18n 立即可用
startI18n();

// 默认导出核心接口，便于其他模块按需 import
export { t, getLanguage, setLanguage, getLanguagePreference, initI18n };
