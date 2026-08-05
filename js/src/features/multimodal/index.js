/**
 * @module multimodal/index
 * @description 多模态分析模块入口（OpenAI/Gemini 图片分析）
 *
 * 职责：
 *   - initMultimodal()：幂等初始化，合并 CONFIG 默认值、注入按钮、绑定粘贴监听、注册 window API
 *   - 在 DeepSeek 输入框旁注入"附加图片"按钮（识图模式开启时显示）
 *   - 监听粘贴事件自动捕获图片
 *   - 发送消息前：若有附加图片，先调 analyzer 分析，把分析结果并入本次消息 prompt 前缀
 *   - 注册 window._dsMultimodal 暴露 analyzeImages / pickImage / getAttachedImages / getConfig / saveConfig
 *
 * 与现有模块的关系：
 *   - 识图模式检测复用 default-mode.js 的 DOM 契约（[data-model-type="vision"] + aria-checked），
 *     不重复实现模式切换/观察逻辑
 *   - 不修改 config.js / settings-panel.js / fetch-hub.js（Phase 6 统一集成）
 *   - 发送前增强通过 window._dsMultimodal.augmentPrompt 暴露，
 *     Phase 6 在 fetch-hub.js 的请求拦截处调用此异步函数把分析结果并入 prompt
 *
 * CONFIG 默认值（参照 web-tools.js 模式，initMultimodal 时合并到运行时 CONFIG）：
 *   - multimodalEnabled (bool, 默认 false)：多模态总开关
 */

import { CONFIG as _CONFIG_SNAPSHOT } from '../../config.js';
import { getMultimodalConfig, saveMultimodalConfig, isMultimodalEnabled } from './settings.js';
import {
    pickImage,
    pasteImage,
    getAttachedImages,
    clearAttachedImages,
    removeImage,
    getAttachedCount
} from './media.js';
import { analyzeImages } from './analyzer.js';

// ============================================================
// CONFIG 默认值声明
// ============================================================

/**
 * 本模块新增的 CONFIG 默认值
 *
 * 不直接修改 config.js 的 DEFAULTS，而是在 initMultimodal() 中合并到运行时 CONFIG 对象。
 * Phase 6 统一集成时迁移到 config.js 的 DEFAULTS 中。
 *
 * @type {Object}
 */
const MULTIMODAL_DEFAULTS = {
    multimodalEnabled: false
};

/** 模块是否已初始化（幂等保护） */
let installed = false;

/** 按钮注入的 MutationObserver */
let buttonObserver = null;

/** 粘贴监听是否已绑定 */
let pasteBound = false;

/** 分析结果前缀标记（参考 deepseek-pp media.ts） */
const ANALYSIS_PROMPT_START = '[多模态图片分析]';
const ANALYSIS_PROMPT_END = '[/多模态图片分析]';

// ============================================================
// 识图模式检测（复用 default-mode.js 的 DOM 契约）
// ============================================================

/**
 * 检测 DeepSeek 是否处于识图（vision）模式
 *
 * 复用 default-mode.js 使用的 DOM 契约：[data-model-type="vision"] 按钮的 aria-checked。
 * 不重复实现模式切换 / 观察逻辑，仅在需要时读取当前状态。
 *
 * @returns {boolean} 识图模式是否激活
 */
function isVisionModeActive() {
    try {
        const btn = document.querySelector('[data-model-type="vision"]');
        return !!(btn && btn.getAttribute('aria-checked') === 'true');
    } catch (e) {
        return false;
    }
}

// ============================================================
// CONFIG 安全读取与合并
// ============================================================

/**
 * 将本模块的 CONFIG 默认值合并到运行时 CONFIG（不覆盖用户已设置的值）
 *
 * 参照 web-tools.js 的 initWebTools 模式。
 */
function mergeDefaultsToConfig() {
    try {
        const targetCfg = (typeof window !== 'undefined' && window.__dsConfig) ? window.__dsConfig : _CONFIG_SNAPSHOT;
        if (targetCfg && typeof targetCfg === 'object') {
            let modified = false;
            for (const k of Object.keys(MULTIMODAL_DEFAULTS)) {
                if (!(k in targetCfg) || targetCfg[k] === undefined) {
                    targetCfg[k] = MULTIMODAL_DEFAULTS[k];
                    modified = true;
                }
            }
            if (modified && typeof window !== 'undefined') {
                window.__dsConfig = targetCfg;
            }
        }
    } catch (e) {
        console.warn('[multimodal] merge config defaults failed:', e);
    }
}

// ============================================================
// 按钮注入
// ============================================================

/** 注入按钮的 id（用于去重与重新注入检测） */
const BUTTON_ID = 'ds-multimodal-attach-btn';

/**
 * 在 DeepSeek 输入框旁注入"附加图片"按钮
 *
 * 仅在以下条件同时满足时显示：
 *   1. 多模态功能已启用（isMultimodalEnabled()）
 *   2. 当前处于识图（vision）模式
 *
 * 按钮点击触发 pickImage() 选择图片。
 * 使用 MutationObserver 监听 DOM 重新渲染，确保按钮在 DeepSeek 重绘后自动恢复。
 */
function injectAttachButton() {
    if (typeof document === 'undefined') return;

    // 查找输入框（与 context-menu.js 一致：textarea#chat-input）
    const textarea = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
    if (!textarea) return;

    // 查找合适的挂载点：输入框的父容器（工具栏）
    const toolbar = findInputToolbar(textarea);
    if (!toolbar) return;

    // 已存在则更新可见性
    let btn = document.getElementById(BUTTON_ID);
    if (!btn) {
        btn = createAttachButton();
        // 插入到工具栏最前（输入框左侧）
        toolbar.insertBefore(btn, toolbar.firstChild);
    }

    // 根据状态控制显示
    const shouldShow = isMultimodalEnabled() && isVisionModeActive();
    btn.style.display = shouldShow ? 'flex' : 'none';
}

/**
 * 查找输入框所在的工具栏容器
 *
 * 从 textarea 向上查找包含上传/发送按钮的容器；找不到时回退到直接父节点。
 *
 * @param {HTMLTextAreaElement} textarea
 * @returns {HTMLElement|null}
 */
function findInputToolbar(textarea) {
    // 向上查找 3 层，找到一个包含按钮的容器
    let node = textarea.parentElement;
    for (let i = 0; i < 4 && node; i++) {
        if (node.querySelector('button') || node.getAttribute('role') === 'toolbar') {
            return node;
        }
        node = node.parentElement;
    }
    // 回退到直接父节点
    return textarea.parentElement;
}

/**
 * 创建"附加图片"按钮元素
 *
 * @returns {HTMLButtonElement}
 */
function createAttachButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = '附加图片（多模态分析）';
    btn.setAttribute('aria-label', '附加图片');
    // 内联样式（避免依赖外部样式表，DeepSeek 重绘后仍生效）
    btn.style.cssText = [
        'display:none',
        'align-items:center',
        'justify-content:center',
        'width:32px',
        'height:32px',
        'margin-right:6px',
        'padding:0',
        'border:none',
        'border-radius:8px',
        'background:transparent',
        'color:var(--ds-icon-color, #8a8f99)',
        'cursor:pointer',
        'flex-shrink:0',
        'transition:background 0.2s'
    ].join(';');
    // 图片图标（简洁的相册/图片 SVG）
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,0,0,0.06)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', onAttachButtonClick);
    return btn;
}

/**
 * "附加图片"按钮点击处理：触发文件选择
 */
async function onAttachButtonClick() {
    const cfg = getMultimodalConfig();
    try {
        const added = await pickImage({ maxImages: cfg.maxImages });
        if (added.length > 0) {
            _toast('已附加 ' + added.length + ' 张图片', 'success');
        }
    } catch (e) {
        _toast('附加图片失败：' + (e && e.message || e), 'error');
    }
}

// ============================================================
// 粘贴监听
// ============================================================

/**
 * 绑定粘贴事件监听（捕获图片自动加入附件列表）
 *
 * 仅在多模态启用且识图模式开启时生效，避免在非识图模式下干扰用户粘贴文本。
 * 绑定到 document（capture 阶段），覆盖整个页面粘贴。
 */
function bindPasteListener() {
    if (pasteBound) return;
    pasteBound = true;
    document.addEventListener('paste', onPaste, true);
}

/**
 * 粘贴事件处理
 *
 * @param {ClipboardEvent} event
 */
async function onPaste(event) {
    // 非识图模式或未启用时，不处理（让默认粘贴行为生效）
    if (!isMultimodalEnabled() || !isVisionModeActive()) return;
    // 没有图片项时不处理
    if (!event.clipboardData || !event.clipboardData.items) return;
    let hasImage = false;
    for (let i = 0; i < event.clipboardData.items.length; i++) {
        if (event.clipboardData.items[i].kind === 'file' && event.clipboardData.items[i].type.startsWith('image/')) {
            hasImage = true;
            break;
        }
    }
    if (!hasImage) return;

    // 有图片：阻止默认粘贴（避免插入图片占位符），加入附件列表
    event.preventDefault();
    const cfg = getMultimodalConfig();
    try {
        const added = await pasteImage(event, { maxImages: cfg.maxImages });
        if (added.length > 0) {
            _toast('已从粘贴板附加 ' + added.length + ' 张图片', 'success');
        } else {
            _toast('粘贴板中的图片已附加或已达数量上限', 'info');
        }
    } catch (e) {
        _toast('粘贴图片失败：' + (e && e.message || e), 'error');
    }
}

// ============================================================
// 发送前增强（Phase 6 由 fetch-hub 调用）
// ============================================================

/**
 * 发送消息前增强：若有附加图片，先调 analyzer 分析，把分析结果并入 prompt 前缀
 *
 * 这是异步函数，Phase 6 在 fetch-hub.js 的请求拦截处 await 调用：
 *   const finalPrompt = await window._dsMultimodal.augmentPrompt(originalPrompt);
 *
 * 流程：
 *   1. 无附加图片 / 未启用 / 非识图模式 → 原样返回 originalPrompt
 *   2. 调用 analyzeImages 获取分析结果
 *   3. 用 [多模态图片分析]...[/多模态图片分析] 标签包裹分析结果，作为 prompt 前缀
 *   4. 分析成功后清空附件列表（一次性消费）
 *
 * @param {string} originalPrompt - 用户原始 prompt
 * @returns {Promise<string>} 增强后的 prompt（无图片时原样返回）
 */
export async function augmentPrompt(originalPrompt) {
    const prompt = typeof originalPrompt === 'string' ? originalPrompt : '';
    // 无图片直接返回
    const images = getAttachedImages();
    if (images.length === 0) return prompt;
    // 未启用或非识图模式：不增强（保留原图，但不清空附件以便用户后续手动处理）
    if (!isMultimodalEnabled() || !isVisionModeActive()) return prompt;

    // 调用分析
    const result = await analyzeImages(images, buildAnalysisPrompt(prompt));
    if (!result.ok || !result.analysis) {
        // 分析失败：把错误信息作为前缀提示，并清空附件
        clearAttachedImages();
        const errMsg = (result.error || '未知错误');
        return wrapAnalysisText('（图片分析失败：' + errMsg + '）') + '\n\n' + prompt;
    }

    // 分析成功：清空附件，把分析结果作为前缀
    clearAttachedImages();
    return wrapAnalysisText(result.analysis) + '\n\n' + prompt;
}

/**
 * 构建发送给 vision 模型的分析 prompt
 *
 * @param {string} userPrompt - 用户原始 prompt
 * @returns {string}
 */
function buildAnalysisPrompt(userPrompt) {
    const base = '请分析以下图片，提取关键信息并描述其内容。';
    if (userPrompt && userPrompt.trim()) {
        return base + '用户具体需求：' + userPrompt.trim();
    }
    return base;
}

/**
 * 用分析标签包裹文本
 *
 * @param {string} text
 * @returns {string}
 */
function wrapAnalysisText(text) {
    return ANALYSIS_PROMPT_START + '\n' + text + '\n' + ANALYSIS_PROMPT_END;
}

// ============================================================
// Toast（轻量实现，避免与 ui/toast.js 强耦合）
// ============================================================

/**
 * 显示轻量 Toast 提示
 *
 * 优先使用项目内 ui/toast.js 的 showToast；若未加载则降级到 console。
 *
 * @param {string} msg - 消息
 * @param {'info'|'success'|'error'|'warning'} [tone='info'] - 语气
 */
function _toast(msg, tone = 'info') {
    try {
        if (typeof window !== 'undefined' && typeof window.DSEnhance !== 'undefined') {
            // toast.js 通过 settings-panel 间接可用；这里用 console 降级即可
        }
    } catch (e) {}
    // 降级到 console，避免循环依赖 ui/toast.js
    const prefix = tone === 'error' ? '[multimodal][错误]' : (tone === 'success' ? '[multimodal][成功]' : '[multimodal]');
    console.log(prefix, msg);
}

// ============================================================
// MutationObserver：保持按钮存活
// ============================================================

/**
 * 启动 MutationObserver 监听 DOM 变化，确保按钮在 DeepSeek 重绘后自动恢复
 */
function startButtonObserver() {
    if (buttonObserver) return;
    buttonObserver = new MutationObserver(() => {
        injectAttachButton();
    });
    buttonObserver.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// 初始化（幂等）
// ============================================================

/**
 * 初始化多模态分析模块（幂等）
 *
 * 执行内容：
 *   1. 合并 multimodalEnabled 默认值到运行时 CONFIG
 *   2. 注入"附加图片"按钮（识图模式开启时显示）
 *   3. 绑定粘贴事件监听
 *   4. 启动 MutationObserver 保持按钮存活
 *   5. 注册 window._dsMultimodal API
 *
 * 不修改 localStorage 持久化（Phase 6 统一集成时由 config.js 处理）
 */
export function initMultimodal() {
    if (installed) return;
    installed = true;

    // 1. 合并默认值到运行时 CONFIG
    mergeDefaultsToConfig();

    // 2. 注入按钮 + 启动观察器
    if (typeof document !== 'undefined') {
        // 首次注入（DOM 可能尚未就绪，延迟到下一帧）
        requestAnimationFrame(() => {
            injectAttachButton();
            startButtonObserver();
        });
    }

    // 3. 绑定粘贴监听
    bindPasteListener();

    // 4. 注册 window API
    registerWindowApi();

    console.log('[multimodal] initialized');
}

// ============================================================
// window API 注册
// ============================================================

/**
 * 注册 window._dsMultimodal API
 *
 * 暴露的方法：
 *   - analyzeImages(images, prompt?)：分析图片
 *   - pickImage(opts?)：选择图片
 *   - getAttachedImages()：获取附件列表
 *   - getConfig()：获取多模态配置
 *   - saveConfig(patch)：保存配置
 *   - augmentPrompt(prompt)：发送前增强（Phase 6 由 fetch-hub 调用）
 *   - clearAttachedImages()：清空附件
 *   - removeImage(id)：移除指定附件
 *   - isEnabled()：是否启用
 */
function registerWindowApi() {
    if (typeof window === 'undefined') return;
    window._dsMultimodal = {
        // 核心分析
        analyzeImages,
        // 附件管理
        pickImage,
        pasteImage,
        getAttachedImages,
        clearAttachedImages,
        removeImage,
        getAttachedCount,
        // 配置
        getConfig: getMultimodalConfig,
        saveConfig: saveMultimodalConfig,
        isEnabled: isMultimodalEnabled,
        // 发送前增强（Phase 6 集成入口）
        augmentPrompt
    };
}

// ============================================================
// 模块加载时自动注册 window API（即使未显式 init 也可用）
// ============================================================
if (typeof window !== 'undefined') {
    registerWindowApi();
}
