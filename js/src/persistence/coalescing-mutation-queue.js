/**
 * 合并变更队列（移植自 deepseek-pp/core/persistence/coalescing-mutation-queue.ts）
 *
 * 在高频写入场景下（如 usage 模块每条消息都记录 token 用量），
 * 将多个快速连续的写请求合并为一次实际写入，减少 localStorage I/O。
 *
 * 工作原理：
 *   1. 第一个 mutate 调用立即执行
 *   2. 执行期间到达的 mutate 调用排队等待，并标记"有待处理的变更"
 *   3. 当前执行完成后，若标记为 true，则再执行一次（用最后一个 mutate 的参数）
 *   4. 如此循环直到无待处理变更
 *
 * 无 chrome.* 依赖，纯 ES 代码零修改可移植。
 */

import { createSerialOperationQueue } from './serial-operation-queue.js';

/**
 * 创建合并变更队列
 *
 * @template T
 * @param {(value: T) => Promise<void>} apply - 实际写入函数
 * @returns {{ mutate(value: T): Promise<void> }}
 *   mutate(value) 提交一次变更；多次快速调用会合并为较少的实际写入
 */
export function createCoalescingMutationQueue(apply) {
    /** 底层串行队列，保证写入互斥 */
    const queue = createSerialOperationQueue();
    /** 待处理的最新值（合并窗口内只保留最后一个） */
    let pendingValue = undefined;
    /** 是否有待处理的变更 */
    let hasPending = false;

    /**
     * 提交一次变更
     * @param {T} value
     * @returns {Promise<void>}
     */
    function mutate(value) {
        pendingValue = value;
        hasPending = true;
        return queue.run(async () => {
            if (!hasPending) return;
            // 取出待处理值并清除标记，允许 mutate 在 apply 期间再次设置新值
            const v = pendingValue;
            hasPending = false;
            await apply(v);
        });
    }

    return { mutate };
}
