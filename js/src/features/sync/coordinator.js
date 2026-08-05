/**
 * @file coordinator.js
 * @module features/sync/coordinator
 *
 * 同步协调器模块
 *
 * 协调 WebDAV 客户端、快照、本地应用三个子模块，提供完整的同步流程：
 *   - uploadSync()：收集本地 → 创建快照 → PUT 到 WebDAV + 更新 latest 指针
 *   - downloadSync()：GET latest 指针 → GET 最新快照 → 校验 → applySnapshot
 *   - syncBoth()：先下载应用远端，再上传本地合并结果
 *
 * 远程文件布局：
 *   {basePath}/snapshot-{generation}.json   # 历史快照（按代次归档，便于回溯）
 *   {basePath}/latest.json                  # 指向最新代次的指针
 *
 * latest.json 结构：
 *   { generation: number, timestamp: number, file: string }
 *
 * 冲突策略：以远端为准（last-write-wins on remote），本地新增项保留。
 *   详见 apply-journal.js 的合并策略。
 *
 * 状态记录：每次操作后通过 store.recordSyncResult 更新 lastUpload/lastDownload/lastError/remoteGeneration。
 */

import { createWebdavClient } from './webdav-client.js';
import { serializeSnapshot, deserializeSnapshot, verifySnapshot } from './snapshot.js';
import { collectLocalSnapshot, applySnapshot } from './apply-journal.js';
import {
    getSyncConfig,
    saveSyncConfig,
    recordSyncResult,
    getSyncStatus as _getStoreStatus
} from './store.js';

/** latest 指针文件名（相对 basePath） */
const LATEST_FILE = 'latest.json';

/**
 * 生成指定代次的快照文件名
 * @param {number} generation - 代次号
 * @returns {string} 形如 snapshot-42.json
 */
function snapshotFileName(generation) {
    return `snapshot-${generation}.json`;
}

/**
 * 基于 sync 配置创建 WebDAV 客户端
 * @returns {{client: Object, config: Object} | null}
 *   配置未启用或必填字段缺失时返回 null
 */
function _getClient() {
    const config = getSyncConfig();
    if (!config.enabled) return null;
    if (!config.server || !config.username || !config.password) return null;
    const client = createWebdavClient({
        server: config.server,
        username: config.username,
        password: config.password,
        basePath: config.basePath || 'dspro'
    });
    return { client, config };
}

// ============================================================
// 上传同步
// ============================================================

/**
 * 上传同步：收集本地数据 → 创建快照 → 上传到 WebDAV
 *
 * 上传两个文件：
 *   1. snapshot-{generation}.json：本次快照内容（历史归档）
 *   2. latest.json：指针，指向最新代次
 *
 * 代次机制：每次上传生成新代次（remoteGeneration + 1），单调递增。
 * PUT 操作幂等，重复上传同一文件不报错（覆盖旧内容）。
 *
 * @returns {Promise<{ok: boolean, generation?: number, error?: string}>}
 */
export async function uploadSync() {
    const ctx = _getClient();
    if (!ctx) {
        return { ok: false, error: '同步未启用或配置不完整' };
    }
    const { client, config } = ctx;

    try {
        // 1. 计算新代次（单调递增）
        const generation = (config.remoteGeneration || 0) + 1;

        // 2. 收集本地数据并创建快照
        const snapshot = await collectLocalSnapshot(generation);

        // 3. 上传快照文件（幂等：重复 PUT 同一文件不报错）
        const snapFile = snapshotFileName(generation);
        await client.put(snapFile, serializeSnapshot(snapshot));

        // 4. 更新 latest 指针
        const pointer = {
            generation,
            timestamp: snapshot.timestamp,
            file: snapFile
        };
        await client.put(LATEST_FILE, JSON.stringify(pointer));

        // 5. 记录同步结果（type=upload 更新 lastUpload 时间戳）
        recordSyncResult({ ok: true, generation, type: 'upload' });

        return { ok: true, generation };
    } catch (e) {
        recordSyncResult({ ok: false, error: e.message, type: 'upload' });
        return { ok: false, error: e.message };
    }
}

// ============================================================
// 下载同步
// ============================================================

/**
 * 下载同步：GET latest 指针 → GET 最新快照 → 校验 → applySnapshot
 *
 * 流程：
 *   1. GET latest.json 指针，解析得到最新代次与快照文件名
 *   2. GET 快照文件，反序列化为快照对象
 *   3. 校验 checksum（applySnapshot 内部也会校验，这里提前校验避免无谓应用）
 *   4. applySnapshot 合并写入本地各 store
 *
 * @returns {Promise<{ok: boolean, applied?: number, skipped?: number, errors?: Array<string>, generation?: number, error?: string}>}
 */
export async function downloadSync() {
    const ctx = _getClient();
    if (!ctx) {
        return { ok: false, error: '同步未启用或配置不完整' };
    }
    const { client } = ctx;

    try {
        // 1. 获取 latest 指针
        const pointerStr = await client.get(LATEST_FILE);
        if (!pointerStr) {
            return { ok: false, error: '远端无 latest 指针，请先上传' };
        }
        let pointer;
        try {
            pointer = JSON.parse(pointerStr);
        } catch (e) {
            return { ok: false, error: 'latest 指针解析失败' };
        }
        if (!pointer || !pointer.file || typeof pointer.generation !== 'number') {
            return { ok: false, error: 'latest 指针结构无效' };
        }

        // 2. 下载最新快照
        const snapshotStr = await client.get(pointer.file);
        if (!snapshotStr) {
            return { ok: false, error: `快照 ${pointer.file} 不存在` };
        }
        const snapshot = deserializeSnapshot(snapshotStr);
        if (!snapshot) {
            return { ok: false, error: '快照反序列化失败' };
        }

        // 3. 提前校验 checksum（applySnapshot 内部会再校验一次）
        const checksumOk = await verifySnapshot(snapshot);
        if (!checksumOk) {
            recordSyncResult({ ok: false, error: '远端快照 checksum 校验失败', type: 'download' });
            return { ok: false, error: '远端快照 checksum 校验失败' };
        }

        // 4. 应用到本地
        const result = await applySnapshot(snapshot);

        // 5. 记录同步结果（远端代次已下载，无论 apply 是否完全成功）
        recordSyncResult({
            ok: result.ok,
            error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
            generation: pointer.generation,
            type: 'download'
        });

        return {
            ok: result.ok,
            applied: result.applied,
            skipped: result.skipped,
            errors: result.errors,
            generation: pointer.generation
        };
    } catch (e) {
        recordSyncResult({ ok: false, error: e.message, type: 'download' });
        return { ok: false, error: e.message };
    }
}

// ============================================================
// 双向同步
// ============================================================

/**
 * 双向同步：先下载应用远端，再上传本地合并结果
 *
 * 流程：
 *   1. downloadSync()：下载并应用远端快照（远端覆盖本地同 ID 项，本地新增保留）
 *   2. uploadSync()：上传本地合并后的数据（生成新代次）
 *
 * 即使下载失败（如远端无指针首次同步），仍会尝试上传本地数据。
 *
 * @returns {Promise<{ok: boolean, download?: Object, upload?: Object}>}
 */
export async function syncBoth() {
    // 1. 先下载应用远端（失败不阻断后续上传）
    const download = await downloadSync();
    // 2. 再上传本地合并后的数据
    const upload = await uploadSync();
    return {
        // 整体成功以 upload 为准（download 失败如"远端无指针"属于正常首次同步情况）
        ok: upload.ok,
        download,
        upload
    };
}

// ============================================================
// 状态查询
// ============================================================

/**
 * 获取同步状态（转发到 store 模块）
 * @returns {{lastUpload: number|null, lastDownload: number|null, lastError: string|null, remoteGeneration: number}}
 */
export function getSyncStatus() {
    return _getStoreStatus();
}
