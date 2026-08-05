/**
 * @file store.js
 * @module features/sync/store
 *
 * 同步配置与状态存储模块
 *
 * 管理同步功能的配置与运行时状态，持久化到 localStorage。
 *
 * 存储 key：ds_sync_config
 * 配置结构：
 *   {
 *     enabled: boolean,         // 是否启用同步
 *     server: string,           // WebDAV 服务器地址
 *     username: string,         // 用户名
 *     password: string,         // 密码（仅本地，不参与同步）
 *     basePath: string,         // 远程基础路径（如 dspro）
 *     lastUpload: number|null,  // 最近一次上传成功时间戳
 *     lastDownload: number|null,// 最近一次下载成功时间戳
 *     lastError: string|null,   // 最近一次错误信息（成功后清空）
 *     remoteGeneration: number  // 远端最新代次（单调递增）
 *   }
 *
 * 密码安全：
 *   - 密码仅存储在本地 localStorage（明文，受浏览器同源策略保护）
 *   - 不进入同步快照（snapshot 仅含业务数据）
 *   - 不输出到 console.log（避免日志泄露）
 *   - UI 保存密码时应提示用户风险（由设置面板负责，本模块仅做存储）
 *
 * 注意：localStorage 在某些环境（WebView 私有目录）会跨标签页共享，
 *   多设备共用同一 WebView 实例时密码会共享，请用户评估风险。
 */

/** localStorage 存储键名 */
const STORAGE_KEY = 'ds_sync_config';

/** 默认配置（首次使用或 localStorage 损坏时回退） */
const DEFAULT_CONFIG = {
    enabled: false,
    server: '',
    username: '',
    password: '',
    basePath: 'dspro',
    lastUpload: null,
    lastDownload: null,
    lastError: null,
    remoteGeneration: 0
};

/** 内存缓存（避免频繁读 localStorage，且保证一次操作内读到一致状态） */
let _cache = null;
let _cacheDirty = true;

// ============================================================
// 内部读写
// ============================================================

/**
 * 从 localStorage 加载配置（带内存缓存）
 * 合并默认值，保证字段完整
 * @returns {Object} 配置对象（内部引用，调用方不应直接修改）
 */
function _load() {
    if (!_cacheDirty && _cache) return _cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        _cache = raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
    } catch (e) {
        _cache = { ...DEFAULT_CONFIG };
    }
    _cacheDirty = false;
    return _cache;
}

/**
 * 将配置写入 localStorage（同步写入，确保状态立即持久化）
 * @param {Object} config - 配置对象
 */
function _persist(config) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        // 静默失败：localStorage 满或被禁用时仅忽略，避免阻塞主流程
    }
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 读取完整同步配置（含密码）
 * 返回副本，外部修改不影响内部缓存
 * @returns {Object} 配置对象副本
 */
export function getSyncConfig() {
    const cfg = _load();
    return { ...cfg };
}

/**
 * 保存同步配置（浅合并）
 * 仅合并 patch 中的字段，未提供的字段保留原值
 * @param {Object} patch - 待合并的字段对象
 * @returns {Object} 合并后的完整配置副本
 */
export function saveSyncConfig(patch) {
    if (!patch || typeof patch !== 'object') return getSyncConfig();
    const cfg = _load();
    const merged = { ...cfg, ...patch };
    _cache = merged;
    _cacheDirty = false;
    _persist(merged);
    return { ...merged };
}

/**
 * 获取同步状态（仅运行时状态，不含敏感配置如密码）
 * 供 UI 展示与 coordinator 转发
 * @returns {{lastUpload: number|null, lastDownload: number|null, lastError: string|null, remoteGeneration: number}}
 */
export function getSyncStatus() {
    const cfg = _load();
    return {
        lastUpload: cfg.lastUpload,
        lastDownload: cfg.lastDownload,
        lastError: cfg.lastError,
        remoteGeneration: cfg.remoteGeneration || 0
    };
}

/**
 * 记录一次同步操作的结果，更新运行时状态
 *
 * 更新规则：
 *   - ok=true：清除 lastError；若提供 generation 则更新 remoteGeneration；
 *     根据 type 更新对应时间戳（lastUpload/lastDownload）
 *   - ok=false：记录 lastError，不更新时间戳与代次
 *
 * @param {Object} result - 同步结果
 * @param {boolean} result.ok - 是否成功
 * @param {string} [result.error] - 错误信息（失败时提供）
 * @param {number} [result.generation] - 远端代次（成功时提供）
 * @param {'upload'|'download'} [result.type] - 同步类型，用于区分更新哪个时间戳
 */
export function recordSyncResult({ ok, error, generation, type }) {
    const cfg = _load();
    const now = Date.now();
    const patch = {};
    if (ok) {
        patch.lastError = null;
        if (typeof generation === 'number') {
            patch.remoteGeneration = generation;
        }
        if (type === 'upload') {
            patch.lastUpload = now;
        } else if (type === 'download') {
            patch.lastDownload = now;
        }
    } else {
        patch.lastError = error || '未知错误';
    }
    const merged = { ...cfg, ...patch };
    _cache = merged;
    _cacheDirty = false;
    _persist(merged);
}
