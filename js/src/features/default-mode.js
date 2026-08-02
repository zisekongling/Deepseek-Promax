/**
 * 默认模式自动切换模块
 *
 * 通过检测模式选择器（.e362e944 中的 radiogroup）是否重置为快速模式
 * 来判断新对话开始，自动点击用户配置的模式按钮（快速/专家/识图）。
 *
 * 快速模式（default）是 DeepSeek 原生默认，无需点击。
 *
 * 日志前缀：[DS-Mode] 便于在控制台过滤
 */
import { CONFIG } from '../config.js';

const LOG = '[DS-Mode]';
let observer = null;
let pollTimer = null;
let cooldown = false;
let wasModeSelectorVisible = false;
let lastIndex = -1;

/**
 * 检测模式选择器是否重置为快速模式（新对话标志）
 * 逻辑：
 *   - radiogroup 从"不存在"变为"存在"（新对话页面加载）
 *   - 或 --selected-index 从非0值变回0（用户在对话中切换了模式后开新对话）
 * @returns {boolean}
 */
function detectNewConversation() {
    const radiogroup = document.querySelector('[role="radiogroup"]');
    if (!radiogroup) {
        wasModeSelectorVisible = false;
        return false;
    }

    // 检查 radiogroup 是否在模式选择器容器内（排除设置弹窗等）
    const container = radiogroup.closest('.e362e944');
    if (!container) return false;

    // 获取当前选中索引
    const selectedIndex = parseInt(radiogroup.style.getPropertyValue('--selected-index') || '0');

    let detected = false;

    // 场景1：从不可见变为可见 → 新对话
    if (!wasModeSelectorVisible) {
        console.log(`${LOG} 模式选择器出现，selectedIndex=${selectedIndex}`);
        detected = true;
    }

    // 场景2：索引从非0值变回0 → 新对话重置
    if (lastIndex > 0 && selectedIndex === 0) {
        console.log(`${LOG} 索引重置 ${lastIndex} → ${selectedIndex}，判定为新对话`);
        detected = true;
    }

    wasModeSelectorVisible = true;
    lastIndex = selectedIndex;
    return detected;
}

/**
 * 查找 DOM 元素上的 React 内部 props
 * @param {Element} el
 * @returns {Object|null}
 */
function getReactProps(el) {
    const keys = Object.getOwnPropertyNames(el);
    for (const key of keys) {
        if (key.startsWith('__reactProps') || key.startsWith('__reactEventHandlers')) {
            return el[key];
        }
    }
    return null;
}

/**
 * 强制触发模式切换（每次只尝试一种方法，避免方法间互相冲突）
 * React 的 DOM 更新是异步的，同步检查 aria-checked 无意义
 * @param {string} targetMode - 目标模式：default / expert / vision
 * @param {number} methodIndex - 使用哪种方法（0=React, 1=click, 2=鼠标事件, 3=键盘）
 */
export function forceSelectMode(targetMode, methodIndex = 0) {
    const btn = document.querySelector(`[data-model-type="${targetMode}"]`);
    if (!btn) {
        console.log(`${LOG} forceSelectMode: 未找到 [data-model-type="${targetMode}"] 按钮`);
        return;
    }

    const methods = ['React onClick', 'btn.click()', '鼠标事件序列', '键盘箭头键'];
    const methodName = methods[methodIndex] || methods[0];
    console.log(`${LOG} forceSelectMode("${targetMode}") 方法${methodIndex}: ${methodName}`);

    if (methodIndex === 0) {
        // 方法0：查找 React 内部 props 并调用 onClick
        let el = btn;
        let foundReactProps = false;
        while (el && el !== document.body) {
            const props = getReactProps(el);
            if (props) {
                foundReactProps = true;
                const handlerNames = Object.keys(props).filter(k => k.startsWith('on'));
                console.log(`${LOG} 在 ${el.tagName}.${el.className.split(' ')[0]||''} 上找到 React props，handlers: [${handlerNames.join(', ')}]`);
                const synthEvent = {
                    target: btn, currentTarget: el,
                    preventDefault() {}, stopPropagation() {},
                    nativeEvent: new MouseEvent('click'),
                    type: 'click', bubbles: true,
                };
                if (typeof props.onClick === 'function') {
                    try {
                        console.log(`${LOG}   调用 onClick()...`);
                        props.onClick(synthEvent);
                    } catch (e) {
                        console.log(`${LOG}   onClick() 异常:`, e.message);
                    }
                }
            }
            el = el.parentElement;
        }
        if (!foundReactProps) {
            console.log(`${LOG} 未找到 React props，btn 的 __ 属性:`, Object.getOwnPropertyNames(btn).filter(k => k.startsWith('__')));
        }
    } else if (methodIndex === 1) {
        // 方法1：直接 click()
        try { btn.click(); } catch (e) { console.log(`${LOG} click() 异常:`, e.message); }
    } else if (methodIndex === 2) {
        // 方法2：完整鼠标事件序列
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        console.log(`${LOG} 鼠标事件 @ (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            try {
                btn.dispatchEvent(new MouseEvent(type, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: cx, clientY: cy,
                }));
            } catch (e) {}
        }
    } else if (methodIndex === 3) {
        // 方法3：键盘箭头键（精确按下所需的次数）
        const modes = ['default', 'expert', 'vision'];
        const targetIndex = modes.indexOf(targetMode);
        const radiogroup = document.querySelector('[role="radiogroup"]');
        if (radiogroup && targetIndex !== -1) {
            const selectedIndex = parseInt(radiogroup.style.getPropertyValue('--selected-index') || '0');
            const diff = targetIndex - selectedIndex;
            console.log(`${LOG} 键盘: 当前 index=${selectedIndex}, 目标 index=${targetIndex}, diff=${diff}`);
            if (diff !== 0) {
                try { radiogroup.focus(); } catch (e) {}
                const key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
                const presses = Math.abs(diff);
                for (let i = 0; i < presses; i++) {
                    try {
                        radiogroup.dispatchEvent(new KeyboardEvent('keydown', {
                            key, code: key,
                            keyCode: key === 'ArrowRight' ? 39 : 37,
                            which: key === 'ArrowRight' ? 39 : 37,
                            bubbles: true, cancelable: true,
                        }));
                    } catch (e) {}
                }
            }
        }
    }

    console.log(`${LOG} 方法${methodIndex}(${methodName}) 完成`);
}

/**
 * 检查目标模式是否已选中（异步验证，React 重渲染后生效）
 * @param {string} targetMode
 * @returns {boolean}
 */
function isModeSelected(targetMode) {
    const btn = document.querySelector(`[data-model-type="${targetMode}"]`);
    const checked = btn && btn.getAttribute('aria-checked') === 'true';
    console.log(`${LOG} isModeSelected("${targetMode}"): ${checked}`);
    return checked;
}

/**
 * 应用默认模式：每次重试轮换不同方法，避免方法间冲突
 */
function applyDefaultMode() {
    const targetMode = CONFIG.defaultMode || 'default';
    if (targetMode === 'default') {
        console.log(`${LOG} applyDefaultMode: 目标是 default，无需切换`);
        return;
    }

    console.log(`${LOG} applyDefaultMode: 目标模式=${targetMode}`);
    let attempts = 0;
    const tryClick = () => {
        // 已经是目标模式，无需切换
        if (isModeSelected(targetMode)) {
            console.log(`${LOG} ✅ 已是目标模式，停止重试`);
            return;
        }

        // 每次重试轮换方法（0=React, 1=click, 2=鼠标, 3=键盘）
        const methodIndex = attempts % 4;
        console.log(`${LOG} 第 ${attempts + 1} 次尝试，方法 ${methodIndex}`);
        forceSelectMode(targetMode, methodIndex);

        // 等待 React 重渲染后验证
        setTimeout(() => {
            if (isModeSelected(targetMode)) {
                console.log(`${LOG} ✅ 切换成功（方法 ${methodIndex}）`);
                return;
            }
            console.log(`${LOG} ❌ 第 ${attempts + 1} 次失败（方法 ${methodIndex}）`);
            if (++attempts < 8) {
                setTimeout(tryClick, 300);
            } else {
                console.log(`${LOG} 🔴 达到最大重试次数，放弃`);
            }
        }, 500);
    };
    setTimeout(tryClick, 300);
}

/**
 * 手动触发新对话检测（由按钮点击或快捷键调用）
 * 延迟等待新对话页面渲染后应用默认模式
 */
function manualTrigger() {
    console.log(`${LOG} 🔔 手动触发（按钮/快捷键），等待页面渲染...`);
    cooldown = true;
    // 延迟等待新对话页面加载
    setTimeout(() => {
        applyDefaultMode();
        setTimeout(() => {
            cooldown = false;
            console.log(`${LOG} 冷却结束，恢复检测`);
        }, 3000);
    }, 800);
}

/**
 * 检测新对话并应用默认模式（带冷却避免重复触发）
 */
function checkAndApply() {
    if (cooldown) return;
    if (!detectNewConversation()) return;

    console.log(`${LOG} 🔔 检测到新对话，开始应用默认模式`);
    cooldown = true;
    applyDefaultMode();

    // 5 秒后重置冷却，允许检测下一次新对话
    setTimeout(() => {
        cooldown = false;
        console.log(`${LOG} 冷却结束，恢复检测`);
    }, 5000);
}

/**
 * 初始化默认模式功能
 * MutationObserver 监听 DOM 变化 + 按钮点击 + 快捷键 + 轮询兜底
 */
export function initDefaultMode() {
    console.log(`${LOG} initDefaultMode() 被调用, defaultModeEnabled=${CONFIG.defaultModeEnabled}, defaultMode=${CONFIG.defaultMode}`);
    if (!CONFIG.defaultModeEnabled) return;

    console.log(`${LOG} 初始化，配置: defaultMode=${CONFIG.defaultMode}, enabled=${CONFIG.defaultModeEnabled}`);

    // 首次检查
    setTimeout(checkAndApply, 500);

    // MutationObserver 监听 DOM 变化（仅 childList，不需要 characterData）
    // characterData 会在流式响应时频繁触发，而模式选择器变化是 childList 变化
    observer = new MutationObserver(() => {
        checkAndApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 轮询兜底（每 2 秒检查一次，降低频率减少开销）
    pollTimer = setInterval(checkAndApply, 2000);

    // 监听"开启新对话"按钮点击（事件委托）
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target) return;
        // 匹配包含"开启新对话"文本的按钮，或类名 a084f19e
        const btn = target.closest('.a084f19e');
        if (btn) {
            console.log(`${LOG} 检测到点击"开启新对话"按钮`);
            manualTrigger();
            return;
        }
        // 兜底：检查文本内容
        const el = target.closest('[tabindex]');
        if (el && el.textContent && el.textContent.includes('开启新对话')) {
            console.log(`${LOG} 检测到点击"开启新对话"按钮（文本匹配）`);
            manualTrigger();
        }
    }, true);

    // 监听 Ctrl+J 快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === 'j' || e.key === 'J')) {
            console.log(`${LOG} 检测到 Ctrl+J 快捷键`);
            manualTrigger();
        }
    });

    console.log(`${LOG} 监听已启动（Observer + 按钮 + Ctrl+J + 轮询）`);
}
