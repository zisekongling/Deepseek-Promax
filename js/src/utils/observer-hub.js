/**
 * 统一的 DOM 变化调度中心 (MutationObserver Hub)
 *
 * 替代各模块独立创建的 MutationObserver，避免：
 *   1. 多个独立 observer 监听同一 document.body 产生重复回调
 *   2. 每个 observer 内部又各自做相同的 querySelectorAll 扫描
 *   3. 流式响应期间每个模块独立的防抖逻辑重复触发
 *
 * 模块通过 registerDomHandler(callbacks) 注册处理器：
 *   - onElements(elements): 本轮新增的元素节点数组（防抖合并后批量交付）
 *   - onTextNodes(nodes):  本轮变化的文本节点数组（防抖合并后批量交付）
 *   - onDialogs(elements): 新增的 [role="dialog"] 节点数组（弹窗专用，单独防抖）
 *
 * 各回调都带 try/catch 包装，单个处理器异常不影响其他模块。
 */

import { utils } from '../utils.js';
import { CONFIG } from '../config.js';
import { fullScan, processTextNode } from '../features/text-process.js';
import { scanRetryButton } from '../features/auto-retry.js';
import { removeUnwantedComponents } from '../features/remove-components.js';

let observer = null;
let installed = false;

/** 已注册的处理器 Map: id -> { onElements?, onTextNodes?, onDialogs? } */
const handlers = new Map();
let nextId = 1;

// ============================================================
// 防抖批次：elements 与 textNodes 分别独立合并
// ============================================================

const ELEMENT_DEBOUNCE_MS = 200;
const TEXT_DEBOUNCE_MS = 300;
const DIALOG_DEBOUNCE_MS = 350;
const RETRY_DEBOUNCE_MS = 500;

/** elements 批次 */
let pendingElements = new Set();
let elementTimer = null;

/** textNodes 批次 */
let pendingTextNodes = new Set();
let textTimer = null;

/** dialogs 批次（单独合并，因为弹窗检测较少） */
let pendingDialogs = new Set();
let dialogTimer = null;

/** retry 扫描定时器 */
let retryTimer = null;

/**
 * 交付 elements 批次给所有 onElements 处理器
 * 同时复用 observer.js 原有的 fullScan + removeUnwantedComponents 统一处理
 */
function flushElements() {
    elementTimer = null;
    const batch = pendingElements;
    pendingElements = new Set();
    if (batch.size === 0) return;
    const elements = Array.from(batch);

    // 原有 observer.js 的统一批量处理：fullScan + 组件移除
    for (const el of elements) {
        if (utils.isNodeAttached(el)) {
            try { fullScan(el); } catch (e) {}
            try { removeUnwantedComponents(el); } catch (e) {}
        }
    }

    // 分发给注册的 onElements 处理器
    if (handlers.size > 0) {
        for (const h of handlers.values()) {
            if (!h.onElements) continue;
            try { h.onElements(elements); } catch (e) {}
        }
    }
}

/**
 * 交付 textNodes 批次给所有 onTextNodes 处理器
 * 同时复用 observer.js 原有的 processTextNode 统一处理
 */
function flushTextNodes() {
    textTimer = null;
    const batch = pendingTextNodes;
    pendingTextNodes = new Set();
    if (batch.size === 0) return;
    const nodes = Array.from(batch);

    // 原有 observer.js 的统一文本处理
    for (const tn of nodes) {
        if (utils.isNodeAttached(tn)) {
            try { processTextNode(tn); } catch (e) {}
        }
    }

    // 分发给注册的 onTextNodes 处理器
    if (handlers.size > 0) {
        for (const h of handlers.values()) {
            if (!h.onTextNodes) continue;
            try { h.onTextNodes(nodes); } catch (e) {}
        }
    }
}

/**
 * 交付 dialogs 批次给所有 onDialogs 处理器
 * 仅当存在 onDialogs 处理器时才启用检测与合并
 */
function flushDialogs() {
    dialogTimer = null;
    const batch = pendingDialogs;
    pendingDialogs = new Set();
    if (batch.size === 0) return;
    const dialogs = Array.from(batch);
    for (const h of handlers.values()) {
        if (!h.onDialogs) continue;
        try { h.onDialogs(dialogs); } catch (e) {}
    }
}

/**
 * 防抖扫描重试按钮
 */
function scheduleRetryScan() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        try { scanRetryButton(); } catch (e) {}
    }, RETRY_DEBOUNCE_MS);
}

// ============================================================
// 调度中心的 MutationObserver 回调
// ============================================================

/**
 * 判断节点是否为 [role="dialog"] 或内部包含 dialog
 * @param {Element} el
 * @returns {Element[]} 命中的 dialog 元素列表（含自身）
 */
function extractDialogs(el) {
    if (!el || el.nodeType !== 1 || !el.querySelectorAll) return [];
    const results = [];
    if (el.matches && el.matches('[role="dialog"]')) {
        // 额外条件：同时包含 searchbox 与 listbox，才认为是历史搜索弹窗（避免误触发普通 dialog）
        if (el.querySelector('input[role="searchbox"]') && el.querySelector('[role="listbox"]')) {
            results.push(el);
        }
    }
    const inner = el.querySelectorAll('[role="dialog"]');
    inner.forEach(d => {
        if (d.querySelector('input[role="searchbox"]') && d.querySelector('[role="listbox"]')) {
            results.push(d);
        }
    });
    return results;
}

/**
 * 是否存在 onDialogs 处理器（用于跳过昂贵的 dialog 扫描）
 */
function hasDialogHandlers() {
    for (const h of handlers.values()) {
        if (h.onDialogs) return true;
    }
    return false;
}

/**
 * 统一的 MutationObserver 回调
 * 将 childList / characterData 变化分类收集并触发对应防抖批次
 * @param {MutationRecord[]} mutations
 */
function handleMutations(mutations) {
    let hasChildList = false;
    let hasDialogHandlers_ = hasDialogHandlers();

    for (const mut of mutations) {
        if (mut.type === 'characterData') {
            const node = mut.target;
            if (node.nodeType === 3 && utils.isNodeAttached(node)) {
                pendingTextNodes.add(node);
                if (!textTimer) {
                    textTimer = setTimeout(flushTextNodes, TEXT_DEBOUNCE_MS);
                }
            }
        } else if (mut.type === 'childList') {
            hasChildList = true;
            for (const node of mut.addedNodes) {
                if (node.nodeType === 3) {
                    if (utils.isNodeAttached(node)) {
                        pendingTextNodes.add(node);
                        if (!textTimer) {
                            textTimer = setTimeout(flushTextNodes, TEXT_DEBOUNCE_MS);
                        }
                    }
                } else if (node.nodeType === 1) {
                    pendingElements.add(node);
                    if (!elementTimer) {
                        elementTimer = setTimeout(flushElements, ELEMENT_DEBOUNCE_MS);
                    }
                    if (hasDialogHandlers_) {
                        const dlgArr = extractDialogs(node);
                        if (dlgArr.length > 0) {
                            dlgArr.forEach(d => pendingDialogs.add(d));
                            if (!dialogTimer) {
                                dialogTimer = setTimeout(flushDialogs, DIALOG_DEBOUNCE_MS);
                            }
                        }
                    }
                }
            }
        }
    }

    // 防抖扫描重试按钮（仅在配置启用时）
    if (CONFIG.autoRetryEnabled && hasChildList) {
        scheduleRetryScan();
    }
}

// ============================================================
// Observer 生命周期
// ============================================================

/**
 * 安装统一的 MutationObserver（单例）
 * 监听 document.body 的 childList + subtree + characterData
 */
function installObserver() {
    if (installed) return;
    installed = true;

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

// ============================================================
// 对外接口
// ============================================================

/**
 * 注册一个 DOM 变化处理器
 * @param {Object} callbacks - { onElements?, onTextNodes?, onDialogs? }
 * @returns {number} 处理器 ID，用于 unregister
 */
export function registerDomHandler(callbacks) {
    installObserver();
    const id = nextId++;
    handlers.set(id, callbacks || {});
    return id;
}

/**
 * 注销指定 ID 的处理器
 * @param {number} id
 */
export function unregisterDomHandler(id) {
    handlers.delete(id);
}

/**
 * 断开 observer 并清理所有待处理状态
 * （供 beforeunload / disconnectObserver 外部调用）
 */
export function disconnectObserverHub() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    installed = false;
    if (elementTimer) { clearTimeout(elementTimer); elementTimer = null; }
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    if (dialogTimer) { clearTimeout(dialogTimer); dialogTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    pendingElements.clear();
    pendingTextNodes.clear();
    pendingDialogs.clear();
}
