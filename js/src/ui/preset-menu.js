/**
 * 消息预设菜单 + 消息历史记录模块
 *
 * 功能：
 *   1. 在输入框中输入 '/' 时触发预设菜单，支持上下键切换、Enter 确认、Esc 关闭
 *   2. 上下键切换历史消息（仅 TEXTAREA），Enter 发送时记录历史
 *
 * 与原始脚本一致：使用 document 级委托事件监听，剪贴板方式插入预设。
 */
import { CONFIG, saveConfig } from '../config.js';

// ============================================================
// 模块级状态
// ============================================================
let presetMenuElement = null;
let presetMenuVisible = false;
let presetSelectedIndex = -1;

// 消息历史状态
let messageHistory = CONFIG.messageHistory || [];
let historyIndex = -1;
let currentInputValue = '';

// ============================================================
// 输入框查找
// ============================================================

/**
 * 查找 DeepSeek 的消息输入框
 * @returns {HTMLTextAreaElement|null}
 */
function getMessageInput() {
    return document.querySelector('textarea._27c9245');
}

// ============================================================
// 预设菜单 DOM
// ============================================================

/**
 * 创建预设菜单元素（单例）
 * @returns {HTMLDivElement}
 */
function createPresetMenu() {
    if (presetMenuElement) return presetMenuElement;
    const menu = document.createElement('div');
    menu.id = 'anime-preset-menu';
    menu.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 0;
        background: var(--anime-card-bg, #fff);
        border: 1px solid var(--anime-msg-bubble-border, #ddd);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        min-width: 180px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 99999;
        display: none;
        padding: 6px 0;
        font-size: 14px;
        backdrop-filter: blur(4px);
    `;
    document.body.appendChild(menu);
    presetMenuElement = menu;
    return menu;
}

/**
 * 清除菜单中所有项的高亮
 * @param {HTMLElement} menu
 */
function clearMenuHighlight(menu) {
    if (!menu) return;
    const items = menu.querySelectorAll('div');
    items.forEach(el => el.style.background = 'transparent');
}

// ============================================================
// 核心插入函数：剪贴板 + 粘贴（多级降级）
// ============================================================

/**
 * 将预设文本插入到输入框中
 * 策略：剪贴板写入 → execCommand paste → ClipboardEvent → 直接修改 value
 * @param {HTMLTextAreaElement} inputEl - 输入框元素
 * @param {string} prompt - 待插入的预设文本
 */
async function insertPresetIntoInput(inputEl, prompt) {
    if (!inputEl) return;
    // 确保输入框获得焦点
    inputEl.focus();

    // 1. 保存当前剪贴板内容（仅文本）
    let previousClipboard = '';
    try {
        previousClipboard = await navigator.clipboard.readText().catch(() => '');
    } catch (e) {
        // 可能权限问题，忽略
    }

    // 2. 写入预设内容到剪贴板
    try {
        await navigator.clipboard.writeText(prompt);
    } catch (e) {
        // 如果剪贴板写入失败，降级使用 execCommand('insertText')
        try {
            if (document.execCommand('insertText', false, prompt)) {
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
        } catch (err) {}
        // 最后降级：直接修改 value + 触发事件
        const val = inputEl.value;
        const start = inputEl.selectionStart;
        const end = inputEl.selectionEnd;
        const before = val.substring(0, start);
        const after = val.substring(end);
        inputEl.value = before + prompt + after;
        const newPos = start + prompt.length;
        inputEl.selectionStart = inputEl.selectionEnd = newPos;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    // 3. 执行粘贴操作
    try {
        // 方法A：使用 execCommand('paste')，需要用户手势，但点击事件已触发
        if (document.execCommand('paste')) {
            await new Promise(r => requestAnimationFrame(r));
            if (previousClipboard) {
                navigator.clipboard.writeText(previousClipboard).catch(() => {});
            }
            return;
        }
    } catch (e) {
        // execCommand 可能不支持或被拒绝
    }

    // 方法B：手动触发 paste 事件
    try {
        const dt = new DataTransfer();
        dt.setData('text/plain', prompt);
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
        });
        inputEl.dispatchEvent(pasteEvent);
        await new Promise(r => setTimeout(r, 50));
        if (inputEl.value.includes(prompt)) {
            if (previousClipboard) {
                navigator.clipboard.writeText(previousClipboard).catch(() => {});
            }
            return;
        }
    } catch (e) {}

    // 方法C：直接修改 value 作为最后手段
    const val = inputEl.value;
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const before = val.substring(0, start);
    const after = val.substring(end);
    inputEl.value = before + prompt + after;
    const newPos = start + prompt.length;
    inputEl.selectionStart = inputEl.selectionEnd = newPos;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    // 恢复剪贴板
    if (previousClipboard) {
        navigator.clipboard.writeText(previousClipboard).catch(() => {});
    }
}

// ============================================================
// 菜单显示/隐藏
// ============================================================

/**
 * 显示预设菜单（定位在输入框上方）
 * @param {HTMLTextAreaElement} inputEl
 */
function showPresetMenu(inputEl) {
    const menu = createPresetMenu();
    const presets = CONFIG.presets || [];
    if (presets.length === 0) {
        menu.style.display = 'none';
        presetMenuVisible = false;
        presetSelectedIndex = -1;
        return;
    }

    menu.innerHTML = '';
    presets.forEach((p, idx) => {
        const item = document.createElement('div');
        item.textContent = p.name || '未命名';
        item.dataset.index = idx;
        item.style.cssText = `
            padding: 6px 16px;
            cursor: pointer;
            transition: background 0.15s;
            color: var(--anime-text-primary, #333);
        `;
        item.addEventListener('mouseenter', () => {
            clearMenuHighlight(menu);
            item.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
            presetSelectedIndex = idx;
        });
        item.addEventListener('mouseleave', () => {
            if (presetSelectedIndex !== idx) {
                item.style.background = 'transparent';
            }
        });
        // 点击菜单项：调用异步插入函数
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentInput = getMessageInput();
            if (currentInput) {
                await insertPresetIntoInput(currentInput, p.prompt);
            }
            hidePresetMenu();
        });
        menu.appendChild(item);
    });

    const rect = inputEl.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    menu.style.display = 'block';
    presetMenuVisible = true;
    presetSelectedIndex = -1;
}

/**
 * 隐藏预设菜单
 */
function hidePresetMenu() {
    if (presetMenuElement) {
        presetMenuElement.style.display = 'none';
        clearMenuHighlight(presetMenuElement);
    }
    presetMenuVisible = false;
    presetSelectedIndex = -1;
}

// ============================================================
// 事件处理（document 级委托）
// ============================================================

/**
 * input 事件：检测 '/' 触发菜单
 * @param {InputEvent} e
 */
function handleInput(e) {
    const input = e.target;
    if (!input || input.tagName !== 'TEXTAREA' || !input.classList.contains('_27c9245')) {
        return;
    }
    const val = input.value;
    const start = input.selectionStart;
    if (start > 0 && val[start - 1] === '/') {
        showPresetMenu(input);
    } else {
        hidePresetMenu();
    }
}

/**
 * keydown 事件：菜单导航 + 历史切换 + 发送记录
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
    const input = e.target;
    if (!input || input.tagName !== 'TEXTAREA' || !input.classList.contains('_27c9245')) {
        return;
    }
    const key = e.key;

    // 发送消息时记录历史
    if (key === 'Enter' && !e.shiftKey) {
        const val = input.value.trim();
        if (val) {
            messageHistory.push(val);
            if (messageHistory.length > 100) messageHistory.shift();
            CONFIG.messageHistory = messageHistory;
            saveConfig(CONFIG);
            historyIndex = -1;
            currentInputValue = '';
        }
        return;
    }

    // 预设菜单键盘控制
    if (presetMenuVisible && presetMenuElement) {
        const items = presetMenuElement.querySelectorAll('div');
        const total = items.length;
        if (total === 0) return;

        if (key === 'ArrowUp' || key === 'ArrowDown') {
            e.preventDefault();
            clearMenuHighlight(presetMenuElement);
            if (key === 'ArrowUp') {
                presetSelectedIndex = (presetSelectedIndex - 1 + total) % total;
            } else {
                presetSelectedIndex = (presetSelectedIndex + 1) % total;
            }
            const target = items[presetSelectedIndex];
            if (target) {
                target.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
                target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            return;
        }

        if (key === 'Enter') {
            e.preventDefault();
            if (presetSelectedIndex >= 0 && presetSelectedIndex < total) {
                const prompt = CONFIG.presets[presetSelectedIndex].prompt;
                insertPresetIntoInput(input, prompt);
                hidePresetMenu();
            }
            return;
        }

        if (key === 'Escape') {
            e.preventDefault();
            hidePresetMenu();
            return;
        }
        return;
    }

    // 历史切换（菜单未显示时）
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        if (messageHistory.length === 0) return;

        if (key === 'ArrowUp') {
            if (historyIndex === -1) {
                currentInputValue = input.value;
                historyIndex = messageHistory.length - 1;
            } else if (historyIndex > 0) {
                historyIndex--;
            } else {
                return;
            }
            input.value = messageHistory[historyIndex];
        } else if (key === 'ArrowDown') {
            if (historyIndex === -1) {
                return;
            } else if (historyIndex < messageHistory.length - 1) {
                historyIndex++;
                input.value = messageHistory[historyIndex];
            } else {
                historyIndex = -1;
                input.value = currentInputValue;
                currentInputValue = '';
            }
        }
        input.selectionStart = input.selectionEnd = input.value.length;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * document click 事件：点击菜单外部时关闭菜单
 * @param {MouseEvent} e
 */
function handleDocumentClick(e) {
    if (presetMenuElement && presetMenuVisible) {
        const input = getMessageInput();
        if (input && (input.contains(e.target) || presetMenuElement.contains(e.target))) {
            return;
        }
        hidePresetMenu();
    }
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化预设菜单 + 消息历史：注册 document 级委托事件监听
 * 使用委托方式，无需等待输入框出现即可生效。
 */
export function initPresetMenu() {
    document.addEventListener('input', handleInput);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('click', handleDocumentClick);
    window.addEventListener('scroll', () => {
        if (presetMenuVisible) hidePresetMenu();
    }, true);
}

/**
 * 初始化消息历史记录（兼容旧接口，实际逻辑已在 initPresetMenu 中完成）
 */
export function initMessageHistory() {
    // 消息历史的键盘处理已集成在 handleKeydown 中
    // 此函数保留为空以兼容 index.js 的调用
}

/**
 * 导出 hidePresetMenu 供 beforeunload 调用
 */
export { hidePresetMenu };
