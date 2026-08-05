/**
 * @file index.js
 * @module features/sync
 *
 * 同步模块入口
 *
 * 提供同步功能的初始化与对外 API 注册。
 *
 * 初始化：
 *   - initSync() 幂等：重复调用不会重复注册
 *   - 注册 window._dsSync 全局对象，供 UI / 设置面板 / 控制台调用
 *
 * 对外 API（window._dsSync）：
 *   - uploadSync()    上传本地数据到 WebDAV
 *   - downloadSync()  下载并应用远端快照
 *   - syncBoth()       双向同步（先下载后上传）
 *   - getSyncStatus()  获取同步运行时状态
 *   - getSyncConfig()  获取同步配置（含密码）
 *   - saveSyncConfig(patch)  保存同步配置（浅合并）
 *
 * 配置：同步配置存储在 localStorage 的 ds_sync_config key，
 *   与主 CONFIG 分离，避免污染主配置（Phase 6 统一集成时再合并）。
 */

import { uploadSync, downloadSync, syncBoth, getSyncStatus } from './coordinator.js';
import { getSyncConfig, saveSyncConfig } from './store.js';

/** 模块是否已初始化（幂等保护） */
let _initialized = false;

/**
 * 构建对外 API 对象
 * @returns {Object} 对外 API 集合
 */
function _buildApi() {
    return {
        uploadSync,
        downloadSync,
        syncBoth,
        getSyncStatus,
        getSyncConfig,
        saveSyncConfig
    };
}

/**
 * 初始化同步模块
 *
 * 幂等：重复调用直接返回已注册的 API，不会重复注册全局对象
 *
 * @returns {Object} 对外 API 对象（同时挂载到 window._dsSync）
 *   - uploadSync:    上传同步
 *   - downloadSync:  下载同步
 *   - syncBoth:      双向同步
 *   - getSyncStatus: 获取同步状态
 *   - getSyncConfig: 获取同步配置
 *   - saveSyncConfig: 保存同步配置
 */
export function initSync() {
    if (_initialized) {
        // 已初始化：返回已注册的全局对象（或重建一个）
        if (typeof window !== 'undefined' && window._dsSync) {
            return window._dsSync;
        }
        return _buildApi();
    }
    _initialized = true;

    const api = _buildApi();
    if (typeof window !== 'undefined') {
        window._dsSync = api;
    }
    return api;
}
