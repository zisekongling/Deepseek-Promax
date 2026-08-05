/**
 * DeepSeek 输入框 DOM 操作（参考 loop-engine.js 的 injectText / getSendBtn）
 *
 * 封装对 DeepSeek 输入框、发送按钮、停止按钮的查找和操作逻辑。
 * 支持桌面端和手机端（含 Android WebView），通过 isMobileDevice() 自适应。
 *
 * 文本注入策略：
 *   - 桌面端：原生 setter + Event('input') + Event('change')
 *   - 手机端 P0：execCommand('insertText') — 走浏览器底层输入路径
 *   - 手机端 P1：React Fiber 直调 onChange + 原生 setter（unsafeWindow 原型）
 *   - 手机端 P2：原生 setter + compositionend + InputEvent（最终兜底）
 */

/** 输入框选择器（参考 loop-engine.js） */
const INPUT_SELECTOR = 'textarea#chat-input, textarea[placeholder], textarea';

/**
 * 发送按钮选择器列表（按优先级排序）
 *
 * 桌面端：class 中包含 "send" 的按钮
 * 手机端：DeepSeek 设计系统的圆形主按钮（ds-button--primary + ds-button--circle）
 */
const SEND_BTN_SELECTORS = [
    'div[class*="send"] > div[role="button"]',
    'div[role="button"][class*="send"]',
    'button[class*="send"]',
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle'
];

/** 停止按钮选择器（用于检测 AI 是否正在生成）
 *  注意：必须排除脚本自己的停止按钮（.ds-agent-stop-btn） */
const STOP_BTN_SELECTOR = 'div[class*="stop"] > div[role="button"]:not(.ds-agent-stop-btn), div[role="button"][class*="stop"]:not(.ds-agent-stop-btn), button[class*="stop"]:not(.ds-agent-stop-btn)';

/**
 * 获取输入框元素
 * @returns {Element|null}
 */
export function getInput() {
    try { return document.querySelector(INPUT_SELECTOR); } catch (e) { return null; }
}

/**
 * 获取发送按钮（支持桌面端和手机端）
 *
 * 查找策略（按优先级）：
 *   1. 用 "send" class selector 查找（桌面端首选）
 *   2. 用 ds-button 设计系统类名查找（手机端）
 *   3. 通过发送图标 SVG path 特征查找（最终兜底）
 *
 * @returns {Element|null}
 */
export function getSendBtn() {
    try {
        // 方式1：用 "send" class selector 查找（桌面端）
        for (const selector of SEND_BTN_SELECTORS) {
            try {
                const btn = document.querySelector(selector);
                if (btn) return btn;
            } catch (e) {}
        }

        // 方式2：查找所有 ds-button 圆形主按钮，选择最靠近输入框的
        const circleBtnSelectors = [
            'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle',
            'div[role="button"].ds-button--primary.ds-button--circle',
            'div[role="button"].ds-button--circle',
            'button.ds-button--primary',
            'button.ds-button--circle'
        ];
        let circleBtns = [];
        for (const sel of circleBtnSelectors) {
            try {
                circleBtns = document.querySelectorAll(sel);
                if (circleBtns.length > 0) break;
            } catch (e) {}
        }
        if (circleBtns.length > 0) {
            const visibleBtns = [...circleBtns].filter(btn => {
                const rect = btn.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            if (visibleBtns.length === 1) {
                return visibleBtns[0];
            }
            if (visibleBtns.length > 1) {
                const input = getInput();
                if (input) {
                    const inputRect = input.getBoundingClientRect();
                    let bestBtn = null;
                    let bestDist = Infinity;
                    for (const btn of visibleBtns) {
                        const rect = btn.getBoundingClientRect();
                        const dx = rect.left - inputRect.left;
                        const dy = rect.top - inputRect.top;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestBtn = btn;
                        }
                    }
                    if (bestBtn) return bestBtn;
                }
                return visibleBtns.reduce((bottom, btn) => {
                    return btn.getBoundingClientRect().top > bottom.getBoundingClientRect().top
                        ? btn : bottom;
                });
            }
        }

        // 方式3：Android 专用 — 输入框同级容器内的 button 元素
        const input = getInput();
        if (input) {
            let container = input.parentElement;
            for (let i = 0; i < 4 && container; i++) {
                const btn = container.querySelector('button:not([disabled]), div[role="button"]');
                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return btn;
                    }
                }
                container = container.parentElement;
            }
        }

        // 方式4：通过发送图标 SVG path 特征查找（向上箭头）
        const sendPath = document.querySelector('div[role="button"] svg path[d^="M8.3125"]');
        if (sendPath) {
            let el = sendPath.parentElement;
            while (el && el !== document.body) {
                if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON') {
                    return el;
                }
                el = el.parentElement;
            }
        }

        return null;
    } catch (e) { return null; }
}

/**
 * 获取停止按钮
 * @returns {Element|null}
 */
export function getStopBtn() {
    try { return document.querySelector(STOP_BTN_SELECTOR); } catch (e) { return null; }
}

/**
 * 检测当前是否为手机端设备（含 Android WebView）
 * @returns {boolean}
 */
export function isMobileDevice() {
    try {
        const ua = (navigator.userAgent || '');
        const uaLower = ua.toLowerCase();

        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
            if (navigator.maxTouchPoints > 0) return true;
        }

        if (/Android/i.test(ua)) {
            if (/;\s*wv\)/.test(ua) || /;\s*wv;/.test(ua)) return true;
            if (/Version\/4\.0\s+Chrome\//.test(ua)) return true;
        }

        if (/MQQBrowser.*TBS\/\d+|MicroMessenger\/|UCBrowser|UCWeb|baiduboxapp|AliApp\(DingTalk\)/.test(ua)) {
            return true;
        }

        if (/mobile|android|iphone|ipad|ipod|windows phone/i.test(uaLower)) return true;

        return false;
    } catch (e) {
        return false;
    }
}

/**
 * 获取页面真实的 window 对象（绕过油猴沙箱代理）
 * @returns {Window} 页面真实 window
 */
export function getRealWindow() {
    try {
        if (typeof unsafeWindow !== 'undefined') {
            return unsafeWindow;
        }
    } catch (e) {}
    return window;
}

/**
 * 通过 React Fiber 直接调用元素上的 onChange 回调
 *
 * 手机端专用方案：绕开事件派发的 IME 状态、isTrusted 检查、事件冒泡时序问题。
 *
 * @param {Element} el - 目标元素（textarea/input）
 * @param {string} text - 要注入的文本
 * @returns {boolean} 是否成功调用 React onChange
 */
function injectViaReactFiber(el, text) {
    try {
        const propsKey = Object.getOwnPropertyNames(el).find(k =>
            typeof k === 'string' && (k.indexOf('__reactProps$') === 0 || k.indexOf('__reactEventHandlers$') === 0)
        );
        if (!propsKey) return false;
        const props = el[propsKey];
        if (!props || typeof props.onChange !== 'function') return false;

        const realWindow = getRealWindow();
        const proto = (el.tagName && el.tagName.toUpperCase() === 'TEXTAREA')
            ? realWindow.HTMLTextAreaElement.prototype
            : realWindow.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const setter = desc && desc.set;
        if (setter) {
            setter.call(el, text);
        } else {
            el.value = text;
        }

        const fakeEvent = {
            target: el,
            currentTarget: el,
            nativeEvent: new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: text,
                isComposing: false
            }),
            isTrusted: true,
            isDefaultPrevented: () => false,
            isPropagationStopped: () => false,
            preventDefault: () => {},
            stopPropagation: () => {},
            persist: () => {},
            type: 'change'
        };

        props.onChange(fakeEvent);
        return true;
    } catch (e) {
        console.warn('[CapabilityAgent] React Fiber 注入失败:', e);
        return false;
    }
}

/**
 * 通过 document.execCommand('insertText') 注入文本
 *
 * Android WebView 中最可靠的方案：走浏览器底层输入路径。
 *
 * @param {Element} el - 目标 textarea/input
 * @param {string} text - 要注入的文本
 * @returns {boolean} 是否注入成功
 */
function injectViaExecCommand(el, text) {
    try {
        el.focus();
        if (typeof el.select === 'function') {
            el.select();
        } else if (typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(0, (el.value || '').length);
        }

        if (typeof document.queryCommandSupported === 'function' &&
            !document.queryCommandSupported('insertText')) {
            return false;
        }

        const ok = document.execCommand('insertText', false, text);
        return !!ok;
    } catch (e) {
        console.warn('[CapabilityAgent] execCommand 注入失败:', e);
        return false;
    }
}

/**
 * 检查 AI 是否正在生成回复
 * @returns {boolean}
 */
export function isGenerating() {
    const stop = getStopBtn();
    if (!stop) return false;
    const style = window.getComputedStyle(stop);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (stop.offsetWidth === 0 || stop.offsetHeight === 0) return false;
    return true;
}

/**
 * 向输入框注入文本（React 兼容方式，桌面端/手机端自适应）
 *
 * @param {Element} input - 输入框元素
 * @param {string} text - 要注入的文本
 * @returns {boolean} 是否注入成功
 */
export function injectText(input, text) {
    if (!input) return false;
    try {
        const tag = input.tagName.toUpperCase();
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
            // =====手机端专用路径=====
            if (isMobileDevice()) {
                console.log('[CapabilityAgent] (mobile) 开始注入文本，长度:', text.length);

                try { input.focus(); } catch (e) {}

                // P0：execCommand('insertText')
                if (injectViaExecCommand(input, text)) {
                    console.log('[CapabilityAgent] (mobile) P0 execCommand 注入成功');
                    return true;
                }
                console.warn('[CapabilityAgent] (mobile) P0 execCommand 失败，尝试 P1');

                // P1：React Fiber 直调 onChange
                if (injectViaReactFiber(input, text)) {
                    console.log('[CapabilityAgent] (mobile) P1 React Fiber 注入成功');
                    _dispatchMobileInputEvents(input, text);
                    return true;
                }
                console.warn('[CapabilityAgent] (mobile) P1 React Fiber 失败，尝试 P2');

                // P2：原生 setter + compositionend + InputEvent
                const realWindow = getRealWindow();
                const proto = (tag === 'TEXTAREA')
                    ? realWindow.HTMLTextAreaElement.prototype
                    : realWindow.HTMLInputElement.prototype;
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value') &&
                    Object.getOwnPropertyDescriptor(proto, 'value').set;

                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(input, text);
                } else {
                    input.value = text;
                }
                _dispatchMobileInputEvents(input, text);

                console.log('[CapabilityAgent] (mobile) P2 原生 setter + InputEvent 注入完成');
                return true;
            }

            // =====桌面端原逻辑=====
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            )?.set || Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            )?.set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(input, text);
            } else {
                input.value = text;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        // contenteditable 元素
        input.focus();
        input.textContent = text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        return true;
    } catch (e) {
        console.error('[CapabilityAgent] injectText 异常:', e);
        return false;
    }
}

/**
 * 派发手机端专用的输入事件序列（compositionend + InputEvent + change）
 *
 * @param {Element} input - 输入框元素
 * @param {string} text - 注入的文本
 */
function _dispatchMobileInputEvents(input, text) {
    try {
        input.dispatchEvent(new CompositionEvent('compositionend', {
            bubbles: true,
            data: text
        }));
    } catch (e) {}
    try {
        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text,
            isComposing: false
        }));
    } catch (e) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * 点击发送按钮（React/PointerEvent/TouchEvent 兼容，桌面端/手机端自适应）
 *
 * @returns {boolean} 是否点击成功（事件已派发）
 */
export function clickSendButton() {
    const btn = getSendBtn();
    if (!btn) {
        console.warn('[CapabilityAgent] 未找到发送按钮');
        return false;
    }
    try {
        // 手机端：先 focus 再 click()
        if (isMobileDevice()) {
            try { btn.focus(); } catch (e) {}
            btn.click();
            console.log('[CapabilityAgent] (mobile) 发送按钮已点击（focus + click）');
            return true;
        }

        // 桌面端：完整指针事件序列
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const commonOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

        try { btn.dispatchEvent(new PointerEvent('pointerdown', commonOpts)); } catch (e) {}
        btn.dispatchEvent(new MouseEvent('mousedown', commonOpts));
        try { btn.dispatchEvent(new PointerEvent('pointerup', commonOpts)); } catch (e) {}
        btn.dispatchEvent(new MouseEvent('mouseup', commonOpts));
        btn.dispatchEvent(new MouseEvent('click', commonOpts));
        return true;
    } catch (e) {
        console.warn('[CapabilityAgent] 点击发送按钮失败:', e);
        return false;
    }
}

/**
 * 通过 Enter 键发送消息（备用机制）
 *
 * @param {Element} input - 输入框元素
 * @returns {boolean} 是否触发成功
 */
export function sendViaEnterKey(input) {
    if (!input) return false;
    try {
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true
        }));
        return true;
    } catch (e) {
        return false;
    }
}
