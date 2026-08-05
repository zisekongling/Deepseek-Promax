/**
 * AI 思考过程实时折叠模块
 *
 * 功能：
 *   1. CSS 预隐藏：思考内容从 DOM 插入瞬间即不可见，消除布局跳变
 *   2. 实时检测并折叠"已思考"区域（流式输出时即时生效）
 *   3. 用户点击展开时精确标记，不影响其他思考区域的折叠
 *   4. 通过 observer-hub 统一调度，参考 inline-export 的逐元素处理模式
 *
 * 适配自 dass.js 的思考过程折叠逻辑，接入项目统一的 observer-hub 实时机制
 */
import { CONFIG } from '../config.js';
import { registerDomHandler } from '../utils/observer-hub.js';

// ============================================================
// 状态
// ============================================================

let installed = false;
let domHandlerId = 0;
let _thinkHideStyle = null;
let _thinkCaptureAdded = false;

// 已处理标记（DOM dataset 去重，避免重复处理）
const PROCESSED_ATTR = 'data-ds-think-processed';

// 用户手动展开的标记（排除在 CSS 预隐藏规则之外）
const USER_EXPANDED_CLASS = 'ds-think-user-expanded';

// 祖先容器的持久标记（React 重渲染后 DOM 节点被替换，靠祖先标记恢复展开状态）
const ANCESTOR_EXPANDED_CLASS = 'ds-think-ancestor-expanded';

// ============================================================
// CSS 预隐藏
// ============================================================

/**
 * 预隐藏思考内容（CSS 拦截）
 * 注入 !important 样式使 .ds-think-content 从 DOM 插入瞬间即不可见
 * 这是实现"实时折叠"的关键：在元素渲染前就阻止其显示
 * 使用 :not() 排除用户手动展开的内容
 */
function setupThinkContentHiding() {
    if (_thinkHideStyle) return;
    _thinkHideStyle = document.createElement('style');
    _thinkHideStyle.id = 'ds-think-hide';
    // 使用 :not() 排除用户手动展开的思考内容，使其不受 CSS 预隐藏影响
    _thinkHideStyle.textContent = `.ds-think-content:not(.${USER_EXPANDED_CLASS}) { display: none !important; }`;
    document.head.appendChild(_thinkHideStyle);
}

/**
 * 查找思考内容对应的持久祖先容器（消息容器或 markdown 容器）
 * 用于在 React 重渲染后恢复展开状态
 * @param {Element} thinkContent - .ds-think-content 元素
 * @returns {Element|null}
 */
function findAncestorContainer(thinkContent) {
    // 优先找 .ds-markdown 容器（DeepSeek 消息渲染区）
    const md = thinkContent.closest('.ds-markdown');
    if (md) return md;
    // 回退：.ds-message 消息容器
    const msg = thinkContent.closest('.ds-message');
    if (msg) return msg;
    // 最后回退：父元素
    return thinkContent.parentElement;
}

/**
 * 用户点击思考区域箭头时的处理
 * 在 capture 阶段拦截，找到对应的 .ds-think-content 并标记为"用户展开"
 * 同时在祖先容器上添加持久标记，防止 React 重渲染后重复折叠
 * 不移除 CSS 样式节点，确保后续新增的思考内容仍被隐藏
 */
function setupThinkCapture() {
    if (_thinkCaptureAdded) return;
    _thinkCaptureAdded = true;
    document.addEventListener('click', function dsThinkCapture(e) {
        // 匹配思考区域标题栏的点击（用户点击箭头展开/折叠）
        const clickable = e.target.closest('[class*="_5ab5d64"], [class*="c2b72bb8"]');
        if (!clickable) return;

        // 向上查找对应的 .ds-think-content 元素
        let thinkContent = null;
        let parent = clickable.parentElement;
        while (parent && parent !== document.body) {
            thinkContent = parent.querySelector('.ds-think-content');
            if (thinkContent) break;
            // 也检查是否是 .ds-think-content 的兄弟节点
            const sibling = parent.querySelector('.ds-think-content');
            if (sibling) { thinkContent = sibling; break; }
            parent = parent.parentElement;
        }
        if (!thinkContent) return;

        // 1. 标记当前节点为用户展开（CSS 规则排除此元素）
        thinkContent.classList.add(USER_EXPANDED_CLASS);
        // 2. 在祖先容器上加持久标记（React 重渲染替换 DOM 节点后仍可恢复）
        const ancestor = findAncestorContainer(thinkContent);
        if (ancestor) {
            ancestor.classList.add(ANCESTOR_EXPANDED_CLASS);
        }
    }, true);
}

// ============================================================
// 思考区域处理
// ============================================================

/**
 * 处理单个思考内容元素
 * 参考 inline-export 的 mountMessageDownload 模式：针对单个元素处理
 * CSS 预隐藏已确保内容不可见，此处：
 *   1. 做 DOM 属性去重标记
 *   2. 检查祖先容器是否有持久展开标记（React 重渲染后恢复展开状态）
 * @param {Element} thinkContent - .ds-think-content 元素
 */
function processThinkContent(thinkContent) {
    // 排除代码块内的文本（避免脚本源码中的误匹配）
    if (thinkContent.closest('pre, .md-code-block')) return;
    // DOM 属性去重
    if (thinkContent.hasAttribute(PROCESSED_ATTR)) return;
    thinkContent.setAttribute(PROCESSED_ATTR, 'true');

    // 检查祖先容器是否有持久展开标记（用户之前手动展开过）
    // 若有，自动恢复 ds-think-user-expanded，防止 React 重渲染后重复折叠
    const ancestor = findAncestorContainer(thinkContent);
    if (ancestor && ancestor.classList.contains(ANCESTOR_EXPANDED_CLASS)) {
        thinkContent.classList.add(USER_EXPANDED_CLASS);
    }
}

/**
 * 从元素中收集所有 .ds-think-content 并处理
 * 参考 inline-export 的 collectMessageNodes 模式
 * @param {Element} root - 根元素
 * @returns {Element[]} 收集到的思考内容元素
 */
function collectThinkContents(root) {
    const matches = [];
    // 自身是否匹配
    if (root.classList && root.classList.contains('ds-think-content')) {
        matches.push(root);
    }
    // 内部子元素
    if (root.querySelectorAll) {
        matches.push(...Array.from(root.querySelectorAll('.ds-think-content')));
    }
    return matches;
}

// ============================================================
// 实时 DOM 处理（接入 observer-hub）
// ============================================================

/**
 * 处理 observer-hub 分发的元素批次
 * 参考 inline-export 的 handleDomElements 模式：逐元素处理，不做全量扫描
 * 实时响应流式输出中新增的思考内容
 * CSS 预隐藏样式已确保思考内容从插入瞬间即不可见
 * @param {Element[]} elements - 本轮新增的元素节点数组
 */
function handleNewElements(elements) {
    for (const el of elements) {
        if (!el || el.nodeType !== 1) continue;
        // 排除代码块内的节点
        if (el.closest && el.closest('pre, .md-code-block')) continue;

        // 收集该元素内所有思考内容并逐个处理
        const thinkContents = collectThinkContents(el);
        for (const tc of thinkContents) {
            try { processThinkContent(tc); } catch (e) {}
        }
    }
}

// ============================================================
// 全量扫描（仅用于初始化和设置变更）
// ============================================================

/**
 * 处理所有已有思考区域（初始全量扫描）
 */
function processAllThinkingSections() {
    document.querySelectorAll('.ds-think-content').forEach(thinkContent => {
        try { processThinkContent(thinkContent); } catch (e) {}
    });
}

/**
 * 重新应用思考折叠（设置变更时调用）
 */
export function reapplyThinkingSections() {
    // 清除已处理标记
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => {
        el.removeAttribute(PROCESSED_ATTR);
    });
    // 重新注入 CSS（如果之前被移除）
    if (!_thinkHideStyle || !document.contains(_thinkHideStyle)) {
        _thinkHideStyle = null;
        setupThinkContentHiding();
    }
    // 重新扫描所有思考区域
    processAllThinkingSections();
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化 AI 思考过程实时折叠模块
 * 注入 CSS 预隐藏样式、扫描已有思考区域，并向 observer-hub 注册实时 DOM 处理器
 *
 * 实时折叠原理（参考 inline-export 的 observer-hub 模式）：
 *   1. CSS 预隐藏：`.ds-think-content:not(.ds-think-user-expanded) { display: none !important; }`
 *      确保思考内容从 DOM 插入瞬间即不可见
 *   2. observer-hub 实时分发：每 200ms 将新增元素批次交付给 handleNewElements
 *   3. handleNewElements 逐元素收集思考内容并处理（不做全量扫描）
 *   4. 用户点击展开时，capture 阶段添加 ds-think-user-expanded 类，CSS 规则排除该元素
 */
export function initThinkFold() {
    if (installed) return;
    installed = true;

    if (!CONFIG.thinkFoldEnabled) return;

    // 1. 注入 CSS 预隐藏样式（最关键：在元素渲染前就阻止显示）
    setupThinkContentHiding();
    // 2. 注册用户点击展开的 capture 拦截
    setupThinkCapture();
    // 3. 先处理当前已存在的思考区域（一次全量扫描）
    processAllThinkingSections();
    // 4. 后续变化由 observer-hub 实时分发（与 inline-export 等模块共享同一调度中心）
    domHandlerId = registerDomHandler({ onElements: handleNewElements });
}