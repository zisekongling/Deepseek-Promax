/**
 * 右键场景模板模块
 *
 * 选中文本后在鼠标位置旁弹出菜单，支持总结、解释、翻译
 * 等内置场景以及用户自定义场景。点击菜单项后，将模板应用到
 * 选中文本生成 prompt，并插入到 DeepSeek 输入框。
 *
 * 实现要点：
 *   1. 监听 mouseup，检测 window.getSelection().toString()
 *   2. 仅当选中文本位于消息区域内时弹出菜单
 *   3. 菜单定位为 position: fixed，跟随鼠标位置
 *   4. 点击页面其他位置时关闭菜单
 *   5. 插入输入框时使用原生 setter 绕过 React 受控组件
 *   6. 自定义场景持久化到 localStorage（key: ds_custom_scenarios）
 */

/** 自定义场景存储 key */
const CUSTOM_STORAGE_KEY = 'ds_custom_scenarios';

/** 内联样式节点 ID */
const STYLE_ID = 'ds-context-menu-style';

/** 菜单容器 class */
const MENU_CLASS = 'ds-context-menu';

/** 菜单项 class */
const ITEM_CLASS = 'ds-context-menu-item';

/** 菜单分隔线 class */
const DIVIDER_CLASS = 'ds-context-menu-divider';

/** 自定义场景入口 class */
const CUSTOM_ITEM_CLASS = 'ds-context-menu-custom';

/** 内置场景模板（icon 使用单字符文字以避免 emoji）
 *
 * 场景数据已迁移到 features/scenario.js 统一管理（结构化存储 + CRUD）。
 * 此处保留 icon 字段（scenario 模块不关心 icon，纯 UI 层概念），
 * 通过 id 与 scenario 模块的场景关联。
 */
import { getAllScenarios, addCustomScenario, applyScenarioTemplate as scenarioApplyTemplate, deleteScenario as scenarioDelete } from './scenario.js';
import { CONFIG } from '../config.js';

/** icon 映射表（按 scenario id 索引，未匹配的用首字符） */
const SCENARIO_ICONS = {
    summarize: '总',
    explain: '解',
    translate: '译',
    rewrite: '润',
    expand: '扩'
};

/**
 * 获取场景的 icon 字符
 * @param {string} scenarioId
 * @param {string} label - 场景标签（兜底用首字符）
 * @returns {string}
 */
function getScenarioIcon(scenarioId, label) {
    return SCENARIO_ICONS[scenarioId] || (label ? label.charAt(0) : '·');
}

/**
 * 加载全部场景（内置 + 自定义），附加 icon 字段
 * 场景模板总开关关闭时返回空数组，右键菜单不显示场景项
 * @returns {Promise<Array>} 场景数组，每项含 { id, name, icon, template, builtIn, enabled }
 */
async function loadAllScenariosWithIcon() {
    // 场景模板总开关关闭时不加载任何场景
    if (!CONFIG.scenariosEnabled) return [];
    const scenarios = await getAllScenarios({ includeDisabled: false });
    return scenarios.map(s => ({
        id: s.id,
        name: s.label,
        icon: getScenarioIcon(s.id, s.label),
        template: s.template,
        builtIn: s.builtIn
    }));
}

/** 当前展示的菜单元素引用，便于全局关闭 */
let currentMenu = null;

/**
 * 注入菜单样式（单例）
 */
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .${MENU_CLASS} {
            position: fixed;
            z-index: 999999;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(8px);
            border-radius: 10px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
            padding: 4px;
            min-width: 120px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        .${ITEM_CLASS} {
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 6px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
            color: #1f2937;
            transition: background 0.15s ease;
        }
        .${ITEM_CLASS}:hover {
            background: rgba(59, 130, 246, 0.1);
        }
        .${ITEM_CLASS} .ds-context-menu-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            font-size: 13px;
            font-weight: 600;
            color: #3b82f6;
        }
        .${DIVIDER_CLASS} {
            height: 1px;
            background: rgba(0, 0, 0, 0.08);
            margin: 4px 8px;
        }
        .${CUSTOM_ITEM_CLASS} {
            color: #6b7280;
            font-size: 12px;
            font-style: italic;
        }
        body[data-ds-dark-theme] .${MENU_CLASS},
        [data-theme="dark"] .${MENU_CLASS} {
            background: rgba(45, 46, 52, 0.95);
        }
        body[data-ds-dark-theme] .${ITEM_CLASS},
        [data-theme="dark"] .${ITEM_CLASS} {
            color: #e0e0e0;
        }
        body[data-ds-dark-theme] .${DIVIDER_CLASS},
        [data-theme="dark"] .${DIVIDER_CLASS} {
            background: rgba(255, 255, 255, 0.08);
        }
        .ds-context-menu-prompt-wrap {
            padding: 6px 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .ds-context-menu-prompt-input {
            width: 220px;
            box-sizing: border-box;
            padding: 6px 8px;
            border: 1px solid rgba(0, 0, 0, 0.12);
            border-radius: 6px;
            font-size: 12px;
            outline: none;
            background: #fff;
            color: #1f2937;
        }
        .ds-context-menu-prompt-input:focus {
            border-color: #3b82f6;
        }
        .ds-context-menu-confirm {
            align-self: flex-end;
            padding: 4px 12px;
            border: none;
            border-radius: 6px;
            background: #3b82f6;
            color: #fff;
            font-size: 12px;
            cursor: pointer;
        }
        .ds-context-menu-confirm:hover {
            background: #2563eb;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 读取用户自定义场景（异步，从 scenario 模块加载）
 * @returns {Promise<Array>} 自定义场景数组（含 icon 字段）
 */
async function loadCustomScenarios() {
    const all = await loadAllScenariosWithIcon();
    return all.filter(s => !s.builtIn);
}

/**
 * 保存用户自定义场景（已废弃，保留空函数避免外部调用报错）
 * 自定义场景的增删改由 scenario 模块的 addCustomScenario/deleteScenario 负责
 * @param {Array} _scenarios - 未使用
 */
function saveCustomScenarios(_scenarios) {
    // 已迁移到 scenario 模块，此函数保留为空避免破坏外部调用
    console.warn('[context-menu] saveCustomScenarios 已废弃，请使用 scenario.addCustomScenario');
}

/**
 * 将场景模板应用到选中文本
 * 委托给 scenario 模块的 applyScenarioTemplate（只替换第一处 {text}）
 * @param {string} template - 含 {text} 占位符的模板
 * @param {string} selectedText - 选中文本
 * @returns {string}
 */
function applyScenarioTemplate(template, selectedText) {
    return scenarioApplyTemplate(template, selectedText);
}

/**
 * 将文本插入 DeepSeek 输入框
 * 使用原生 setter 设置 value 绕过 React 受控组件，
 * 随后派发 input + change 事件以触发状态同步
 * @param {string} text - 待插入文本
 */
function insertTextIntoPrompt(text) {
    const textarea = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
    if (!textarea) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) {
        setter.call(textarea, text);
    } else {
        textarea.value = text;
    }
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.focus();
}

/**
 * 判断选区是否位于消息区域内
 * 通过 anchorNode 向上查找 .ds-message / 消息容器
 * @returns {boolean}
 */
function isSelectionInMessage() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const node = sel.anchorNode;
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    // 多组消息容器选择器，适配 DeepSeek 不同版本
    return !!el.closest(
        '.ds-message, [data-message-id], .bd9893a8, .ds-markdown, [class*="markdown"], [class*="message"]'
    );
}

/**
 * 关闭当前菜单并清理引用
 */
function closeMenu() {
    if (currentMenu && currentMenu.parentNode) {
        currentMenu.parentNode.removeChild(currentMenu);
    }
    currentMenu = null;
}

/**
 * 创建单个菜单项元素
 * @param {Object} scenario - 场景对象 { id, name, icon, template }
 * @param {string} selectedText - 选中文本
 * @returns {HTMLElement}
 */
function createMenuItem(scenario, selectedText) {
    const item = document.createElement('div');
    item.className = ITEM_CLASS;
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `<span class="ds-context-menu-icon">${scenario.icon || ''}</span><span>${scenario.name || ''}</span>`;
    // 使用 capture 阶段并阻止冒泡，避免触发 DeepSeek 自身的事件处理
    item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, true);
    item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const prompt = applyScenarioTemplate(scenario.template, selectedText);
        insertTextIntoPrompt(prompt);
        closeMenu();
    }, true);
    return item;
}

/**
 * 创建"自定义场景"输入区
 * 用户输入模板后回车即保存为自定义场景并应用
 * @param {string} selectedText - 选中文本
 * @returns {HTMLElement}
 */
function createCustomSection(selectedText) {
    const wrap = document.createElement('div');
    wrap.className = 'ds-context-menu-prompt-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ds-context-menu-prompt-input';
    input.placeholder = '自定义模板（{text} 为选中文本）';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ds-context-menu-confirm';
    confirmBtn.textContent = '应用';

    const apply = () => {
        const tpl = (input.value || '').trim();
        if (!tpl) return;
        // 保存为自定义场景（名称取模板前 6 字符）
        // 通过 scenario 模块的 addCustomScenario 持久化
        const label = tpl.slice(0, 6) + (tpl.length > 6 ? '...' : '');
        addCustomScenario(label, tpl).catch(e => {
            console.warn('[context-menu] addCustomScenario failed:', e);
        });
        const prompt = applyScenarioTemplate(tpl, selectedText);
        insertTextIntoPrompt(prompt);
        closeMenu();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            apply();
        }
    });
    confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        apply();
    });

    wrap.appendChild(input);
    wrap.appendChild(confirmBtn);
    return wrap;
}

/**
 * 在指定坐标处显示场景菜单
 * @param {number} x - 鼠标 clientX
 * @param {number} y - 鼠标 clientY
 * @param {string} selectedText - 选中文本
 */
function showMenu(x, y, selectedText) {
    // 先关闭旧菜单
    closeMenu();

    const menu = document.createElement('div');
    menu.className = MENU_CLASS;
    menu.setAttribute('role', 'menu');

    // 异步加载全部场景（内置 + 自定义），渲染时按 builtIn 分组
    // 先渲染一个 loading 占位项，加载完成后替换
    const loadingItem = document.createElement('div');
    loadingItem.className = ITEM_CLASS;
    loadingItem.style.opacity = '0.5';
    loadingItem.textContent = '加载场景中…';
    menu.appendChild(loadingItem);

    loadAllScenariosWithIcon().then(allScenarios => {
        menu.removeChild(loadingItem);
        // 内置场景项
        const builtinScenarios = allScenarios.filter(s => s.builtIn);
        const customScenarios = allScenarios.filter(s => !s.builtIn);

        builtinScenarios.forEach(s => {
            menu.appendChild(createMenuItem(s, selectedText));
        });

        // 已保存的自定义场景
        if (customScenarios.length > 0) {
            const divider = document.createElement('div');
            divider.className = DIVIDER_CLASS;
            menu.appendChild(divider);
            customScenarios.forEach(s => {
                menu.appendChild(createMenuItem(s, selectedText));
            });
        }

        // 自定义场景输入区分隔线 + 输入区
        const inputDivider = document.createElement('div');
        inputDivider.className = DIVIDER_CLASS;
        menu.appendChild(inputDivider);
        menu.appendChild(createCustomSection(selectedText));
    }).catch(e => {
        loadingItem.textContent = '加载场景失败';
        console.warn('[context-menu] loadAllScenariosWithIcon failed:', e);
    });

    // 自定义场景输入区已在上面的异步回调中追加，此处无需重复添加

    document.body.appendChild(menu);
    currentMenu = menu;

    // 边界检测：避免菜单超出视口
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
    if (top + rect.height > vh - 8) top = Math.max(8, vh - rect.height - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // 阻止菜单内部点击事件冒泡到 document，避免立即关闭
    menu.addEventListener('mousedown', (e) => e.stopPropagation(), true);
}

/**
 * mouseup 事件处理函数
 * 检测选中文本，若位于消息区域则显示菜单
 * @param {MouseEvent} e
 */
function handleMouseUp(e) {
    // 忽略菜单元素内的 mouseup
    if (currentMenu && currentMenu.contains(e.target)) return;

    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) {
        // 无选中文本时关闭菜单
        closeMenu();
        return;
    }
    if (!isSelectionInMessage()) {
        closeMenu();
        return;
    }
    // 延迟一帧以确保浏览器完成 selection 调整
    requestAnimationFrame(() => {
        showMenu(e.clientX, e.clientY, text);
    });
}

/**
 * 全局点击/keyup 关闭菜单
 * @param {Event} e
 */
function handleDismiss(e) {
    if (!currentMenu) return;
    if (currentMenu.contains(e.target)) return;
    closeMenu();
}



/**
 * 初始化右键场景模板模块
 * 注入样式并绑定全局事件监听
 */
export function initContextMenu() {
    injectStyles();
    // mouseup 检测选中文本
    document.addEventListener('mouseup', handleMouseUp, true);
    
    // 点击菜单外区域关闭菜单
    document.addEventListener('mousedown', handleDismiss, true);
    // 按 Escape 关闭菜单
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Escape') closeMenu();
    }, true);
    // 滚动或窗口失焦时关闭菜单，避免定位错乱
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('blur', closeMenu, true);
}
