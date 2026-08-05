/**
 * 版本化仓库（移植自 deepseek-pp/core/persistence/versioned-repository.ts）
 *
 * 提供"读-改-写"原子操作 + 编解码校验 + 串行互斥的持久化抽象。
 * 业务模块通过 createVersionedRepository 创建仓库实例，
 * 无需直接操作 localStorage，也无需关心加锁与编解码。
 *
 * 三层抽象：
 *   1. StorageSlotPort：存储槽（读/写/删），由 createLocalStorageSlot 实现
 *   2. VersionedValueCodec：编解码器（decode 校验 + encode 序列化）
 *   3. VersionedRepository：仓库（read/replace/write，内置串行锁）
 *
 * localStorage 替换 chrome.storage.local 的关键差异：
 *   - localStorage 同步、单标签页、5-10MB 上限
 *   - chrome.storage.local 异步、跨标签页自动同步、10MB 上限
 *   - 接口签名保持 Promise 返回，便于未来切换到 indexedDB
 */

import { createSerialOperationQueue } from './serial-operation-queue.js';

// ============================================================
// 存储槽
// ============================================================

/**
 * localStorage 存储槽实现（替代 deepseek-pp 的 createChromeStorageSlot）
 *
 * @param {string} key - localStorage 键名
 * @returns {StorageSlotPort}
 */
export function createLocalStorageSlot(key) {
    return {
        /**
         * 读取存储槽
         * @returns {Promise<{present: boolean, value?: unknown}>}
         *   present=false 表示键不存在或解析失败；present=true 时 value 为已解析的值
         */
        async read() {
            const raw = localStorage.getItem(key);
            if (raw === null) return { present: false };
            try {
                return { present: true, value: JSON.parse(raw) };
            } catch (e) {
                // JSON 解析失败视为不存在，避免损坏数据阻塞读取
                console.warn(`[versioned-repository] localStorage key "${key}" JSON parse failed:`, e);
                return { present: false };
            }
        },

        /**
         * 写入存储槽
         * @param {unknown} value - 任意可序列化值
         */
        async write(value) {
            localStorage.setItem(key, JSON.stringify(value));
        },

        /**
         * 删除存储槽
         */
        async remove() {
            localStorage.removeItem(key);
        }
    };
}

// ============================================================
// 版本化仓库
// ============================================================

/**
 * 创建版本化仓库
 *
 * @template T
 * @param {Object} options
 * @param {string} options.label - 仓库标签（用于日志）
 * @param {() => T} options.createDefault - 创建默认值（存储槽不存在时）
 * @param {import('./versioned-repository.js').VersionedValueCodec<T>} options.codec - 编解码器
 * @param {StorageSlotPort} options.storage - 存储槽
 * @returns {VersionedRepository<T>}
 */
export function createVersionedRepository({ label, createDefault, codec, storage }) {
    /** 串行队列，保证 read-modify-write 原子性 */
    const queue = createSerialOperationQueue();

    /**
     * 不加锁读取（供已加锁的代码路径调用）
     * @returns {Promise<T>}
     */
    async function readAlreadyLocked() {
        const slot = await storage.read();
        if (!slot.present) return createDefault();
        return codec.decode(slot.value, label);
    }

    /**
     * 不加锁写入（直接覆盖，不先读）
     * @param {T} value
     */
    async function writeAfterReadAlreadyLocked(value) {
        await storage.write(codec.encode(value));
    }

    /**
     * 不加锁替换（强制先读后写，防止用合法值覆盖损坏值）
     * @param {T} value
     */
    async function replaceAlreadyLocked(value) {
        await readAlreadyLocked();
        await writeAfterReadAlreadyLocked(value);
    }

    return {
        /**
         * 加锁读取（通过串行队列保证读期间无并发写）
         * @returns {Promise<T>}
         */
        async read() {
            return queue.run(readAlreadyLocked);
        },
        readAlreadyLocked,
        replaceAlreadyLocked,
        writeAfterReadAlreadyLocked
    };
}

// ============================================================
// 类型定义（JSDoc，供 IDE 提示）
// ============================================================

/**
 * @typedef {Object} RawStorageSlot
 * @property {boolean} present - 是否有值
 * @property {unknown} [value] - 值（present=true 时存在）
 */

/**
 * @typedef {Object} StorageSlotPort
 * @property {() => Promise<RawStorageSlot>} read
 * @property {(value: unknown) => Promise<void>} write
 * @property {() => Promise<void>} remove
 */

/**
 * @typedef {Object} VersionedValueCodec
 * @property {(value: unknown, path: string) => any} decode
 * @property {(value: any) => unknown} encode
 */

/**
 * @typedef {Object} VersionedRepository
 * @property {() => Promise<any>} read
 * @property {() => Promise<any>} readAlreadyLocked
 * @property {(value: any) => Promise<void>} replaceAlreadyLocked
 * @property {(value: any) => Promise<void>} writeAfterReadAlreadyLocked
 */
