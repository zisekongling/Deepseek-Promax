/**
 * MutationObserver 扫描模块
 *
 * 监听 DOM 变化，对新添加的节点和文本变化执行：
 *   - characterData 变化：收集文本节点，防抖批量处理（避免流式响应时逐 token 处理）
 *   - childList 变化：元素节点防抖批量扫描
 *   - 重试按钮扫描：独立防抖，避免每次 mutation 都全文档查询
 *   - 无用组件移除：集成到批量扫描，避免独立 observer
 */
import { utils } from './utils.js';
import { fullScan, processTextNode } from './features/text-process.js';
import { scanRetryButton } from './features/auto-retry.js';
import { removeUnwantedComponents } from './features/remove-components.js';
import { CONFIG } from './config.js';

let observer = null;

// childList 批量扫描状态
let pendingElements = new Set();
let scanTimer = null;
const SCAN_DEBOUNCE = 200; // 元素扫描防抖时间

// characterData 批量处理状态
let pendingTextNodes = new Set();
let textScanTimer = null;
const TEXT_DEBOUNCE = 300; // 文本节点防抖时间（流式响应时收集后批量处理）

// 重试按钮扫描防抖状态
let retryTimer = null;
const RETRY_DEBOUNCE = 500;

/**
 * 防抖扫描：收集待处理元素，延迟批量执行 fullScan + 组件移除
 * @param {Element[]} elements - 新添加的元素节点列表
 */
function scheduleScan(elements) {
    for (let el of elements) {
        if (el.nodeType === 1) pendingElements.add(el);
    }
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        const batch = pendingElements;
        pendingElements = new Set();
        scanTimer = null;
        for (let el of batch) {
            if (utils.isNodeAttached(el)) {
                try { fullScan(el); } catch (e) {}
                try { removeUnwantedComponents(el); } catch (e) {}
            }
        }
    }, SCAN_DEBOUNCE);
}

/**
 * 防抖处理 characterData 变化的文本节点
 * 流式响应时收集所有变化的文本节点，停止更新后批量处理
 * @param {Text} node - 文本节点
 */
function scheduleTextProcess(node) {
    pendingTextNodes.add(node);
    if (textScanTimer) clearTimeout(textScanTimer);
    textScanTimer = setTimeout(() => {
        const batch = pendingTextNodes;
        pendingTextNodes = new Set();
        textScanTimer = null;
        for (let tn of batch) {
            if (utils.isNodeAttached(tn)) {
                try { processTextNode(tn); } catch (e) {}
            }
        }
    }, TEXT_DEBOUNCE);
}

/**
 * 防抖扫描重试按钮
 * 避免每次 mutation 都执行全文档 querySelectorAll
 */
function scheduleRetryScan() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
        retryTimer = null;
        try { scanRetryButton(); } catch (e) {}
    }, RETRY_DEBOUNCE);
}

/**
 * MutationObserver 回调：处理 characterData 和 childList 变化
 * 使用防抖策略，避免流式响应时频繁处理
 * @param {MutationRecord[]} mutations
 */
function handleMutations(mutations) {
    let hasChildList = false;
    let hasRetry = false;

    for (const mut of mutations) {
        if (mut.type === 'characterData') {
            const node = mut.target;
            if (node.nodeType === 3 && utils.isNodeAttached(node)) {
                scheduleTextProcess(node);
            }
        } else if (mut.type === 'childList') {
            hasChildList = true;
            for (const node of mut.addedNodes) {
                if (node.nodeType === 3) {
                    if (utils.isNodeAttached(node)) scheduleTextProcess(node);
                } else if (node.nodeType === 1) {
                    scheduleScan([node]);
                }
            }
        }
    }

    // 防抖扫描重试按钮（仅在配置启用时）
    if (CONFIG.autoRetryEnabled && (hasChildList || hasRetry)) {
        scheduleRetryScan();
    }
}

/**
 * 设置 MutationObserver 监听 document.body 的子节点和文本变化
 * 先断开旧 observer 避免重复监听
 */
export function setupObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(handleMutations);

    const observe = () => {
        if (!document.body) return;
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    };

    if (document.body) {
        observe();
    } else {
        requestAnimationFrame(observe);
    }
}

/**
 * 断开 MutationObserver 并清理所有待处理状态
 */
export function disconnectObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    // 清理所有待处理的防抖定时器
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (textScanTimer) { clearTimeout(textScanTimer); textScanTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    pendingElements.clear();
    pendingTextNodes.clear();
}
