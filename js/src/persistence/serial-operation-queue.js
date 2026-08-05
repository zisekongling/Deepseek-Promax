/**
 * 串行操作队列（移植自 deepseek-pp/core/persistence/serial-operation-queue.ts）
 *
 * 保证传入的异步操作按 FIFO 顺序串行执行，后一个操作等待前一个完成后再开始。
 * 用于持久化层的写互斥：多个并发的 localStorage 写请求排队执行，避免竞态。
 *
 * 实现：基于 Promise 链式追加，无 chrome.* 依赖，纯 ES 代码零修改可移植。
 */

/**
 * 创建串行操作队列
 * @returns {{ run<T>(task: () => Promise<T>): Promise<T> }}
 *   run(fn) 将 fn 加入队列，返回 fn 的结果 Promise；fn 在前一个任务完成后才执行
 */
export function createSerialOperationQueue() {
    /** 尾部 Promise，新任务追加在其 then 链上 */
    let tail = Promise.resolve();

    /**
     * 将任务加入队列串行执行
     * @template T
     * @param {() => Promise<T>} task - 异步任务函数
     * @returns {Promise<T>} 任务结果
     */
    function run(task) {
        // 把当前任务接到 tail 后面，执行完后更新 tail
        const result = tail.then(task, task);
        // 无论成功失败，tail 都要推进到下一个任务，避免队列卡死
        tail = result.then(() => undefined, () => undefined);
        return result;
    }

    return { run };
}
