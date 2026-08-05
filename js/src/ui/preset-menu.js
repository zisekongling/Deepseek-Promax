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
import { getAllPresets, savePreset } from '../features/preset.js';
import { getAllSkills } from '../features/skill.js';

// ============================================================
// 数据迁移：从 CONFIG.presets（旧格式）迁移到 features/preset.js（新格式）
// ============================================================

/** 迁移是否已执行（避免重复迁移） */
let migrationDone = false;

/**
 * 将 CONFIG.presets（旧格式 {name, prompt}）迁移到 features/preset.js（新格式 {name, content}）
 * 仅在 CONFIG.presets 有数据且新系统为空时执行一次
 */
async function migratePresets() {
    if (migrationDone) return;
    migrationDone = true;
    const oldPresets = CONFIG.presets;
    if (!oldPresets || oldPresets.length === 0) return;
    try {
        const existingPresets = await getAllPresets();
        if (existingPresets.length > 0) return; // 新系统已有数据，不覆盖
        for (const p of oldPresets) {
            if (p.name && p.prompt) {
                await savePreset({ name: p.name, content: p.prompt });
            }
        }
        // 迁移完成后清除旧数据，避免下次重复迁移
        CONFIG.presets = [];
        saveConfig(CONFIG);
    } catch (e) {
        // 迁移失败不影响主流程
        console.warn('[preset-menu] 预设迁移失败:', e);
        migrationDone = false; // 允许下次重试
    }
}

// ============================================================
// 模块级状态
// ============================================================
let presetMenuElement = null;
let presetMenuVisible = false;
let presetSelectedIndex = -1;

// 技能侧边栏状态
let skillMenuElement = null;
let skillMenuVisible = false;
let skillSelectedIndex = -1;
/** 当前过滤后的技能列表 */
let filteredSkills = [];

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
// 技能侧边栏 DOM
// ============================================================

/**
 * 创建技能菜单元素（单例）
 * @returns {HTMLDivElement}
 */
function createSkillMenu() {
    if (skillMenuElement) return skillMenuElement;
    const menu = document.createElement('div');
    menu.id = 'anime-skill-menu';
    menu.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 0;
        background: var(--anime-card-bg, #fff);
        border: 1px solid var(--anime-msg-bubble-border, #ddd);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        min-width: 180px;
        max-height: 280px;
        overflow-y: auto;
        z-index: 99998;
        display: none;
        padding: 6px 0;
        font-size: 14px;
        backdrop-filter: blur(4px);
    `;
    document.body.appendChild(menu);
    skillMenuElement = menu;
    return menu;
}

/**
 * 获取技能来源徽章文本
 * @param {string} source
 * @returns {string}
 */
function getSkillSourceBadge(source) {
    switch (source) {
        case 'builtin': return '内置';
        case 'remote': return '远程';
        case 'custom': return '自定义';
        default: return '';
    }
}

/**
 * 显示技能菜单（定位在预设菜单右侧）
 * @param {HTMLTextAreaElement} inputEl
 * @param {string} filterText - 过滤文本（/ 后面输入的内容）
 */
async function showSkillMenu(inputEl, filterText = '') {
    const menu = createSkillMenu();
    const skills = await getAllSkills({ includeDisabled: false });
    const enabledSkills = skills.filter(s => s.enabled !== false);
    if (enabledSkills.length === 0) {
        menu.style.display = 'none';
        skillMenuVisible = false;
        skillSelectedIndex = -1;
        return;
    }

    // 模糊搜索过滤：匹配 name 和 description
    const filter = filterText.toLowerCase().trim();
    filteredSkills = filter
        ? enabledSkills.filter(s =>
            (s.name || '').toLowerCase().includes(filter) ||
            (s.description || '').toLowerCase().includes(filter)
        )
        : enabledSkills;

    if (filteredSkills.length === 0) {
        menu.innerHTML = `<div style="padding:8px 16px;color:#999;font-size:13px;">无匹配技能</div>`;
        const rect = inputEl.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        menu.style.width = Math.min(rect.width * 0.5, 280) + 'px';
        menu.style.display = 'block';
        skillMenuVisible = true;
        skillSelectedIndex = -1;
        return;
    }

    menu.innerHTML = '';
    // 技能分区标题
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 16px;font-size:11px;color:var(--anime-text-secondary, #999);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
    header.textContent = '⚡ 技能';
    menu.appendChild(header);

    filteredSkills.forEach((s, idx) => {
        const item = document.createElement('div');
        item.dataset.index = idx;
        item.dataset.skillName = s.name;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            transition: background 0.15s;
            color: var(--anime-text-primary, #333);
            border-radius: 6px;
            margin: 2px 4px;
        `;
        // 技能名 + 来源徽章
        const nameSpan = document.createElement('span');
        const badge = getSkillSourceBadge(s.source);
        nameSpan.innerHTML = `<code style="font-weight:600;font-size:13px;">/${escapeHtml(s.name)}</code>` +
            (badge ? ` <span style="font-size:10px;color:#999;background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:3px;">${badge}</span>` : '');
        nameSpan.style.display = 'block';
        item.appendChild(nameSpan);
        // description 预览
        if (s.description) {
            const descSpan = document.createElement('span');
            descSpan.textContent = s.description.substring(0, 50) + (s.description.length > 50 ? '...' : '');
            descSpan.style.cssText = 'font-size:11px;color:#999;display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            item.appendChild(descSpan);
        }
        item.addEventListener('mouseenter', () => {
            clearMenuHighlight(menu);
            item.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
            skillSelectedIndex = idx;
        });
        item.addEventListener('mouseleave', () => {
            if (skillSelectedIndex !== idx) {
                item.style.background = 'transparent';
            }
        });
        // 点击技能项：插入 "/技能名 " 到输入框
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentInput = getMessageInput();
            if (currentInput) {
                insertPresetIntoInput(currentInput, `/${s.name} `, slashPosition);
            }
            hideSkillMenu();
            hidePresetMenu();
        });
        menu.appendChild(item);
    });

    // 定位：默认跟在预设菜单右侧，若无预设菜单则独立显示
    const rect = inputEl.getBoundingClientRect();
    // 预设菜单宽度与 showPresetMenu 保持一致（Math.min(rect.width * 0.5, 280)）
    const presetWidth = presetMenuVisible
        ? Math.min(rect.width * 0.5, 280)
        : 0;
    const skillWidth = Math.min(rect.width * 0.45, 260);
    if (presetWidth > 0) {
        menu.style.left = (rect.left + presetWidth + 8) + 'px';
    } else {
        menu.style.left = rect.left + 'px';
    }
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    menu.style.width = skillWidth + 'px';
    menu.style.display = 'block';
    skillMenuVisible = true;
    skillSelectedIndex = -1;
}

/**
 * 隐藏技能菜单
 */
function hideSkillMenu() {
    if (skillMenuElement) {
        skillMenuElement.style.display = 'none';
        clearMenuHighlight(skillMenuElement);
    }
    skillMenuVisible = false;
    skillSelectedIndex = -1;
}

/**
 * HTML 转义
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// ============================================================
// 核心插入函数：原生 setter + React value tracker 失效
// ============================================================

/**
 * 将预设文本插入到输入框中（替换从 / 到光标的内容）
 * 策略：清除 / 触发字符 → 使用原生 setter绕过 React → 派发 input/change 事件
 * @param {HTMLTextAreaElement} inputEl - 输入框元素
 * @param {string} prompt - 待插入的预设文本
 * @param {number} slashStart - / 字符的位置（用于替换）
 */
function insertPresetIntoInput(inputEl, prompt, slashStart = -1) {
    if (!inputEl) return;
    inputEl.focus();

    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? start;

    // 如果指定了 / 的位置，替换从 / 到当前光标的内容
    let before, after;
    if (slashStart >= 0) {
        before = inputEl.value.substring(0, slashStart);
        after = inputEl.value.substring(end);
    } else {
        before = inputEl.value.substring(0, start);
        after = inputEl.value.substring(end);
    }

    const nextValue = before + prompt + after;

    // 失效 React 的 value tracker，确保 React 检测到变化
    const tracker = inputEl._valueTracker;
    if (tracker) tracker.setValue('');

    // 使用原生 setter 绕过 React 的受控组件机制
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(inputEl, nextValue);
    } else {
        inputEl.value = nextValue;
    }

    // 设置光标位置到插入文本末尾
    const caret = before.length + prompt.length;
    inputEl.selectionStart = inputEl.selectionEnd = caret;

    // 派发 input + change 事件触发 React 更新
    if (typeof InputEvent === 'function') {
        inputEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertFromPaste',
            data: prompt,
        }));
    } else {
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}

// ============================================================
// 菜单显示/隐藏
// ============================================================

/** 当前 / 字符在输入框中的位置（用于替换） */
let slashPosition = -1;

/** 当前过滤后的预设列表 */
let filteredPresets = [];

/** 当前激活的预设 ID（同步缓存，供键盘事件使用） */
let activePresetId = null;

/**
 * 显示预设菜单（定位在输入框上方），支持模糊搜索过滤
 * 数据源为 features/preset.js（与设置面板统一）
 * @param {HTMLTextAreaElement} inputEl
 * @param {string} filterText - 过滤文本（/ 后面输入的内容）
 */
async function showPresetMenu(inputEl, filterText = '') {
    const menu = createPresetMenu();
    const [presets, activeId] = await Promise.all([getAllPresets(), getActivePresetId()]);
    activePresetId = activeId; // 同步缓存，供键盘事件使用
    if (presets.length === 0) {
        menu.style.display = 'none';
        presetMenuVisible = false;
        presetSelectedIndex = -1;
        return;
    }

    // 模糊搜索过滤：同时匹配 name 和 content
    const filter = filterText.toLowerCase().trim();
    filteredPresets = filter
        ? presets.filter(p =>
            (p.name || '').toLowerCase().includes(filter) ||
            (p.content || '').toLowerCase().includes(filter)
        )
        : presets;

    if (filteredPresets.length === 0) {
        menu.innerHTML = `<div style="padding:8px 16px;color:#999;font-size:13px;">无匹配预设</div>`;
        const rect = inputEl.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        menu.style.display = 'block';
        presetMenuVisible = true;
        presetSelectedIndex = -1;
        return;
    }

    menu.innerHTML = '';
    filteredPresets.forEach((p, idx) => {
        const isActive = p.id === activeId;
        const item = document.createElement('div');
        item.dataset.index = idx;
        item.dataset.id = p.id;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: ${isActive ? 'default' : 'pointer'};
            transition: background 0.15s;
            color: var(--anime-text-primary, #333);
            border-radius: 6px;
            margin: 2px 4px;
            opacity: ${isActive ? '0.6' : '1'};
        `;
        // 预设名称 + 已激活标记
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name || '未命名';
        nameSpan.style.cssText = 'font-weight:500;display:block;';
        if (isActive) {
            const badge = document.createElement('span');
            badge.textContent = ' ◀ 已激活（自动注入中）';
            badge.style.cssText = 'font-size:11px;color:var(--ds-primary, #793f82);font-weight:400;';
            nameSpan.appendChild(badge);
        }
        item.appendChild(nameSpan);
        // content 预览（截取前 40 字符）
        if (p.content) {
            const previewSpan = document.createElement('span');
            previewSpan.textContent = p.content.substring(0, 40) + (p.content.length > 40 ? '...' : '');
            previewSpan.style.cssText = 'font-size:11px;color:#999;display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            item.appendChild(previewSpan);
        }
        item.addEventListener('mouseenter', () => {
            if (isActive) return;
            clearMenuHighlight(menu);
            item.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
            presetSelectedIndex = idx;
        });
        item.addEventListener('mouseleave', () => {
            if (isActive) return;
            if (presetSelectedIndex !== idx) {
                item.style.background = 'transparent';
            }
        });
        // 点击菜单项：仅未激活的预设可注入
        if (!isActive) {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentInput = getMessageInput();
                if (currentInput) {
                    insertPresetIntoInput(currentInput, p.content, slashPosition);
                }
                hidePresetMenu();
            });
        }
        menu.appendChild(item);
    });

    const rect = inputEl.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    menu.style.width = Math.min(rect.width * 0.5, 280) + 'px';
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
 * input 事件：检测 '/' 触发菜单，支持持续输入过滤
 * 解析 / 后面的文本作为搜索关键词，实时过滤预设列表和技能列表
 * @param {InputEvent} e
 */
function handleInput(e) {
    const input = e.target;
    if (!input || input.tagName !== 'TEXTAREA' || !input.classList.contains('_27c9245')) {
        return;
    }
    const val = input.value;
    const cursor = input.selectionStart;

    // 从光标位置向前查找 / 字符
    let slashIdx = -1;
    for (let i = cursor - 1; i >= 0; i--) {
        if (val[i] === '/') {
            slashIdx = i;
            break;
        }
        // 遇到空格或换行则停止（说明 / 不在当前词中）
        if (val[i] === ' ' || val[i] === '\n') break;
    }

    if (slashIdx >= 0) {
        // 提取 / 后面的文本作为过滤关键词
        const filterText = val.substring(slashIdx + 1, cursor);
        // 只有当 / 后面没有空格时才显示菜单
        if (!filterText.includes(' ') && !filterText.includes('\n')) {
            slashPosition = slashIdx;
            showPresetMenu(input, filterText);
            // 技能侧边栏：仅在技能系统总开关和侧边栏开关均开启时显示
            if (CONFIG.skillEnabled && CONFIG.skillSidebarEnabled !== false) {
                showSkillMenu(input, filterText);
            }
            return;
        }
    }
    hidePresetMenu();
    hideSkillMenu();
}

/**
 * keydown 事件：菜单导航 + 历史切换 + 发送记录
 * 支持预设菜单和技能菜单的键盘导航：
 *   - Tab：在预设菜单和技能菜单之间切换焦点
 *   - 上下键：在已聚焦的菜单中导航
 *   - Enter：选择当前高亮的菜单项
 *   - Esc：关闭所有菜单
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

    // 技能菜单键盘控制（优先于预设菜单，因为技能菜单在右侧）
    if (skillMenuVisible && skillMenuElement) {
        const items = skillMenuElement.querySelectorAll('div[data-index]');
        const total = items.length;

        if (key === 'Escape') {
            e.preventDefault();
            hideSkillMenu();
            hidePresetMenu();
            return;
        }

        if (total > 0 && (key === 'ArrowUp' || key === 'ArrowDown')) {
            e.preventDefault();
            clearMenuHighlight(skillMenuElement);
            if (key === 'ArrowUp') {
                skillSelectedIndex = (skillSelectedIndex - 1 + total) % total;
            } else {
                skillSelectedIndex = (skillSelectedIndex + 1) % total;
            }
            const target = items[skillSelectedIndex];
            if (target) {
                target.style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
                target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            return;
        }

        // Tab 切换焦点到预设菜单
        if (key === 'Tab' && presetMenuVisible && presetMenuElement) {
            e.preventDefault();
            skillSelectedIndex = -1;
            clearMenuHighlight(skillMenuElement);
            // 聚焦预设菜单第一项
            const presetItems = presetMenuElement.querySelectorAll('div[data-index]');
            if (presetItems.length > 0) {
                clearMenuHighlight(presetMenuElement);
                presetSelectedIndex = 0;
                presetItems[0].style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
                presetItems[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            return;
        }

        // Enter 选择技能
        if (key === 'Enter') {
            if (skillSelectedIndex >= 0 && skillSelectedIndex < filteredSkills.length) {
                e.preventDefault();
                const skill = filteredSkills[skillSelectedIndex];
                insertPresetIntoInput(input, `/${skill.name} `, slashPosition);
                hideSkillMenu();
                hidePresetMenu();
            }
            return;
        }
        return;
    }

    // 预设菜单键盘控制
    if (presetMenuVisible && presetMenuElement) {
        const items = presetMenuElement.querySelectorAll('div[data-index]');
        const total = items.length;
        if (total === 0) return;

        if (key === 'Escape') {
            e.preventDefault();
            hidePresetMenu();
            hideSkillMenu();
            return;
        }

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

        // Tab 切换焦点到技能菜单
        if (key === 'Tab' && skillMenuVisible && skillMenuElement) {
            e.preventDefault();
            presetSelectedIndex = -1;
            clearMenuHighlight(presetMenuElement);
            // 聚焦技能菜单第一项
            const skillItems = skillMenuElement.querySelectorAll('div[data-index]');
            if (skillItems.length > 0) {
                clearMenuHighlight(skillMenuElement);
                skillSelectedIndex = 0;
                skillItems[0].style.background = 'var(--anime-msg-bubble-bg, #f0f0f0)';
                skillItems[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            return;
        }

        // Tab 和 Enter 都可以选择预设（已激活的跳过）
        if (key === 'Enter' || key === 'Tab') {
            if (presetSelectedIndex >= 0 && presetSelectedIndex < filteredPresets.length) {
                e.preventDefault();
                const selectedPreset = filteredPresets[presetSelectedIndex];
                // 已激活的预设不注入（自动注入中，无需手动插入）
                if (selectedPreset.id !== activePresetId) {
                    insertPresetIntoInput(input, selectedPreset.content, slashPosition);
                }
                hidePresetMenu();
                hideSkillMenu();
            }
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
 * document click 事件：点击菜单外部时关闭所有菜单
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
    if (skillMenuElement && skillMenuVisible) {
        const input = getMessageInput();
        if (input && (input.contains(e.target) || skillMenuElement.contains(e.target))) {
            return;
        }
        hideSkillMenu();
    }
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 初始化预设菜单 + 消息历史：注册 document 级委托事件监听
 * 使用委托方式，无需等待输入框出现即可生效。
 * 首次调用时自动执行旧格式数据迁移（CONFIG.presets → features/preset.js）。
 */
export function initPresetMenu() {
    // 首次初始化时执行数据迁移（异步，不阻塞事件注册）
    migratePresets();
    document.addEventListener('input', handleInput);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('click', handleDocumentClick);
    window.addEventListener('scroll', () => {
        if (presetMenuVisible) hidePresetMenu();
        if (skillMenuVisible) hideSkillMenu();
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
 * 导出 hidePresetMenu 和 hideSkillMenu 供 beforeunload 调用
 */
export { hidePresetMenu, hideSkillMenu };
