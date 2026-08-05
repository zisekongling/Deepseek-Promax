/**
 * DeepSeek 页面 DOM 选择器集中管理
 *
 * DeepSeek 前端使用 CSS Modules，类名是构建时生成的 hash（如 d29f3d7d、_4f9bf79），
 * 每次官方改版后 hash 可能变化。原先这些 hash 散落在多个文件中硬编码，
 * 改版时需要逐文件搜索替换，容易遗漏。
 *
 * 本模块集中管理所有 DeepSeek 专用 hash 类名，改版时只需修改此处。
 * 各模块通过 import { SELECTORS } from '../selectors.js' 引用。
 *
 * 命名约定：
 *   - 消息相关：messageXXX
 *   - 按钮相关：btnXXX
 *   - 容器相关：containerXXX
 *   - 值为 DeepSeek 生成的 hash 类名（不含点号前缀）
 */

/**
 * DeepSeek DOM 选择器常量
 * @type {Object}
 */
export const SELECTORS = {
    // ===== 消息容器 =====
    /** 用户消息的 .ds-message 元素始终包含此类 */
    messageUserMark: 'd29f3d7d',
    /** AI 助手消息的父容器类名 */
    messageAiContainer: '_4f9bf79',
    /** 用户消息的父容器类名（含 agent 续跑消息） */
    messageUserContainer: '_9663006',
    /** 消息内容容器（privacy-shield 作用域） */
    messageContent: '_63c77b1',
    /** 消息根元素类名（与 ds-message 配合使用） */
    messageRoot: 'ds-message',

    // ===== 需要移除的按钮 =====
    /** 转发按钮类名（与 btnForwardIcon 联合匹配） */
    btnForward: '_57370c5',
    /** 转发按钮图标类名（与 btnForward 联合匹配） */
    btnForwardIcon: '_5dedc1e',
    /** 分享/操作按钮类名 */
    btnShare: 'db183363',
    /** 下载应用入口容器类名 */
    containerDownloadApp: '_9579690',
    /** 下载应用按钮类名 */
    btnDownloadApp: 'ad8d4bfc',
    /** ds-button 图标标签样式类名（转发按钮辅助匹配） */
    dsButtonIconLabel: 'ds-button--iconLabelPrimary',

    // ===== 输入区域 =====
    /** 聊天输入框 textarea 的 placeholder 类名 */
    inputPlaceholder: 'bd1d2db',
};

/**
 * 构建联合选择器字符串（用于 querySelectorAll）
 * @param {...string} classNames - 类名列表
 * @returns {string} 如 '.a.b, .c'
 */
export function joinSelectors(...classNames) {
    return classNames.map(c => '.' + c).join(', ');
}

/**
 * 检查元素是否包含指定的全部类名
 * @param {Element} el - 待检查元素
 * @param {...string} classNames - 需要全部包含的类名
 * @returns {boolean}
 */
export function hasAllClasses(el, ...classNames) {
    if (!el || !el.classList) return false;
    return classNames.every(c => el.classList.contains(c));
}

/**
 * 判断 .ds-message 元素是否为用户消息
 * 用户消息的 .ds-message 始终包含 messageUserMark 类
 * @param {Element} messageEl - .ds-message 元素
 * @returns {boolean}
 */
export function isUserMessage(messageEl) {
    if (!messageEl || !messageEl.classList) return false;
    return messageEl.classList.contains(SELECTORS.messageUserMark);
}

/**
 * 判断 .ds-message 元素是否为 AI 助手消息
 * AI 消息不含 messageUserMark，且父容器是 messageAiContainer
 * @param {Element} messageEl - .ds-message 元素
 * @returns {boolean}
 */
export function isAiMessage(messageEl) {
    if (!messageEl || !messageEl.classList) return false;
    if (messageEl.classList.contains(SELECTORS.messageUserMark)) return false;
    const parent = messageEl.parentElement;
    return !!(parent && parent.classList.contains(SELECTORS.messageAiContainer));
}
