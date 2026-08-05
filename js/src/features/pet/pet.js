/**
 * @file 小鲸鱼宠物核心渲染与状态联动
 *
 * 职责：
 *   1. DOM 注入：内联 SVG 绘制可爱鲸鱼（不依赖外部图片，适配油猴 CSP）
 *   2. 状态联动：通过 fetch-hub 的 registerCompletionHandler 监听 DeepSeek 请求生命周期，
 *      并通过包装 window._dsExecuteToolCall 感知工具调用
 *      - thinking     请求发出（onStart）
 *      - outputting   流式 chunk 到达（onChunk）
 *      - tool_running 工具执行（_dsExecuteToolCall 包装）
 *      - success      回复完成（onEnd，短暂）→ idle
 *      - error        请求失败/空响应（onEnd 且无内容，短暂）→ idle
 *   3. 台词气泡：在鲸鱼上方显示当前状态台词，按状态间隔定时轮播
 *   4. 拖动：mousedown/mousemove/mouseup + touch 三件套，松开后持久化绝对坐标
 *   5. 漂浮动画：floatAnimation 开启时上下轻微浮动
 *   6. 位置/尺寸/透明度按配置应用
 *
 * 状态联动采用现有回调机制（fetch-hub 的 registerCompletionHandler）与
 * window 全局回调包装（_dsExecuteToolCall），不直接耦合其他模块内部。
 */

import { registerCompletionHandler, unregisterCompletionHandler } from '../../utils/fetch-hub.js';
import { getPetConfig, savePetConfig, resolvePresetPosition, POSITION_MARGIN_VALUE } from './store.js';
import { getLine, getRotateInterval, PET_STATES } from './lines.js';

/**
 * 短暂状态停留后回到 idle 的时长（毫秒）
 * @type {Object<string, number>}
 */
const TRANSIENT_MS = {
    success: 1800,
    error: 2200
};

/** tool_running 兜底回退时长（毫秒），避免工具执行后无续跑导致卡死 */
const TOOL_RUNNING_FALLBACK_MS = 12000;

/** 单例实例 */
let instance = null;

/**
 * 小鲸鱼宠物类
 * 管理 DOM 渲染、状态联动、台词气泡、拖动与漂浮动画
 */
class WhalePet {
    /** 构造并初始化宠物 */
    constructor() {
        /** 当前状态 @type {string} */
        this.state = PET_STATES.IDLE;
        /** 当前台词 @type {string} */
        this.currentLine = '';
        /** 根容器元素 @type {HTMLElement} */
        this.root = null;
        /** 气泡元素 @type {HTMLElement} */
        this.bubble = null;
        /** 鲸鱼 SVG 元素 @type {SVGElement} */
        this.whaleEl = null;
        /** fetch-hub 处理器 ID @type {number|null} */
        this.fetchHandlerId = null;
        /** 台词轮播定时器 @type {number|null} */
        this.lineTimer = null;
        /** 短暂状态回退定时器 @type {number|null} */
        this.transientTimer = null;
        /** tool_running 兜底回退定时器 @type {number|null} */
        this.toolFallbackTimer = null;
        /** 是否正在拖动 @type {boolean} */
        this.dragging = false;
        /** 拖动起始偏移量 @type {{x:number,y:number}} */
        this._dragOffset = { x: 0, y: 0 };
        /** 是否已用 defineProperty 拦截 _dsExecuteToolCall @type {boolean} */
        this._toolCallHooked = false;
        /** 真实的工具执行函数（被包装前保存） @type {Function|null} */
        this._realExecuteToolCall = null;
        /** 缓存的包装后函数（避免每次 getter 调用 bind） @type {Function} */
        this._boundWrappedToolCall = null;
        /** 降级模式下的原始函数引用 @type {Function|null} */
        this._origExecuteToolCall = null;
        /** resize 监听器引用 @type {Function|null} */
        this._boundResize = null;

        // 预绑定事件处理器，便于移除
        this._boundDragStart = this._onDragStart.bind(this);
        this._boundDragMove = this._onDragMove.bind(this);
        this._boundDragEnd = this._onDragEnd.bind(this);
        this._boundOnStreamStart = this._onStreamStart.bind(this);
        this._boundOnStreamChunk = this._onStreamChunk.bind(this);
        this._boundOnStreamEnd = this._onStreamEnd.bind(this);

        this._init();
    }

    /**
     * 初始化：注入样式 → 构建 DOM → 应用配置 → 绑定事件 → 进入 idle 状态
     * @private
     */
    _init() {
        this._injectStyles();
        this._buildDom();
        this._applyConfig();
        this._bindEvents();
        this._setState(PET_STATES.IDLE);
    }

    /**
     * 注入样式（仅一次，幂等）
     * @private
     */
    _injectStyles() {
        if (document.getElementById('ds-whale-pet-style')) return;
        const style = document.createElement('style');
        style.id = 'ds-whale-pet-style';
        style.textContent = `
            .ds-whale-root {
                position: fixed;
                z-index: 99998;
                display: flex;
                flex-direction: column;
                align-items: center;
                pointer-events: none;
                user-select: none;
                -webkit-user-select: none;
                transition: opacity 0.25s ease;
            }
            .ds-whale-root.ds-whale-hidden {
                opacity: 0 !important;
                pointer-events: none;
            }
            .ds-whale-svg {
                pointer-events: auto;
                cursor: grab;
                display: block;
                filter: drop-shadow(0 4px 8px rgba(0,0,0,0.15));
                transition: transform 0.2s ease;
            }
            .ds-whale-svg:active { cursor: grabbing; }
            .ds-whale-svg .ds-whale-spray path { fill: #7dd3fc; opacity: 0.7; }
            .ds-whale-svg .ds-whale-spray circle { fill: #7dd3fc; opacity: 0.6; }
            .ds-whale-svg .ds-whale-tail path:nth-child(1) { fill: #3b82f6; }
            .ds-whale-svg .ds-whale-tail path:nth-child(2) { fill: #2563eb; }
            .ds-whale-svg .ds-whale-body { fill: #3b82f6; transition: fill 0.3s; }
            .ds-whale-svg .ds-whale-belly { fill: #93c5fd; transition: fill 0.3s; }
            .ds-whale-svg .ds-whale-eye circle:nth-child(1) { fill: #ffffff; }
            .ds-whale-svg .ds-whale-eye circle:nth-child(2) { fill: #1e3a8a; }
            .ds-whale-svg .ds-whale-mouth {
                stroke: #1e3a8a; stroke-width: 1.5; fill: none; stroke-linecap: round;
            }
            .ds-whale-svg .ds-whale-cheek { fill: #f9a8d4; opacity: 0.5; }
            /* 成功状态：变绿 */
            .ds-whale-root.state-success .ds-whale-body { fill: #22c55e; }
            .ds-whale-root.state-success .ds-whale-belly { fill: #86efac; }
            .ds-whale-root.state-success .ds-whale-tail path:nth-child(1) { fill: #22c55e; }
            .ds-whale-root.state-success .ds-whale-tail path:nth-child(2) { fill: #16a34a; }
            /* 错误状态：变红 */
            .ds-whale-root.state-error .ds-whale-body { fill: #ef4444; }
            .ds-whale-root.state-error .ds-whale-belly { fill: #fca5a5; }
            .ds-whale-root.state-error .ds-whale-tail path:nth-child(1) { fill: #ef4444; }
            .ds-whale-root.state-error .ds-whale-tail path:nth-child(2) { fill: #dc2626; }
            /* 漂浮动画（仅 idle 等非工作状态启用，避免与状态动画冲突） */
            .ds-whale-root.float-enabled.state-idle .ds-whale-svg {
                animation: ds-whale-float 2.4s ease-in-out infinite;
            }
            @keyframes ds-whale-float {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-6px); }
            }
            /* 思考状态：水柱跳动 */
            .ds-whale-root.state-thinking .ds-whale-spray {
                animation: ds-whale-spray 1.2s ease-in-out infinite;
                transform-origin: 60px 15px;
            }
            @keyframes ds-whale-spray {
                0%, 100% { transform: scaleY(1); opacity: 0.7; }
                50% { transform: scaleY(1.3); opacity: 1; }
            }
            /* 输出状态：轻微摇晃 */
            .ds-whale-root.state-outputting .ds-whale-svg {
                animation: ds-whale-wobble 1.6s ease-in-out infinite;
            }
            @keyframes ds-whale-wobble {
                0%, 100% { transform: rotate(0deg); }
                25% { transform: rotate(-3deg); }
                75% { transform: rotate(3deg); }
            }
            /* 工具运行状态：轻微抖动 */
            .ds-whale-root.state-tool_running .ds-whale-svg {
                animation: ds-whale-shake 0.6s ease-in-out infinite;
            }
            @keyframes ds-whale-shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-2px); }
                75% { transform: translateX(2px); }
            }
            /* 台词气泡 */
            .ds-whale-bubble {
                position: relative;
                pointer-events: none;
                margin-bottom: 8px;
                padding: 6px 12px;
                border-radius: 12px;
                background: rgba(255,255,255,0.95);
                color: #333;
                font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                    "PingFang SC", "Microsoft YaHei", sans-serif;
                box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                white-space: nowrap;
                max-width: 200px;
                text-overflow: ellipsis;
                overflow: hidden;
                opacity: 0;
                transform: translateY(4px);
                transition: opacity 0.2s, transform 0.2s;
            }
            .ds-whale-bubble.visible { opacity: 1; transform: translateY(0); }
            .ds-whale-bubble::after {
                content: '';
                position: absolute;
                bottom: -6px;
                left: 50%;
                transform: translateX(-50%);
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-top: 6px solid rgba(255,255,255,0.95);
            }
            body[data-ds-dark-theme] .ds-whale-bubble {
                background: rgba(40,40,40,0.95);
                color: #eee;
            }
            body[data-ds-dark-theme] .ds-whale-bubble::after {
                border-top-color: rgba(40,40,40,0.95);
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 构建 DOM：根容器 + 气泡 + 内联 SVG 鲸鱼
     * @private
     */
    _buildDom() {
        const root = document.createElement('div');
        root.className = 'ds-whale-root';
        root.id = 'ds-whale-pet';

        const bubble = document.createElement('div');
        bubble.className = 'ds-whale-bubble';
        root.appendChild(bubble);

        // 内联 SVG 鲸鱼：水柱 + 尾鳍 + 身体 + 腹部 + 眼睛 + 嘴 + 腮红
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('class', 'ds-whale-svg');
        svg.setAttribute('viewBox', '0 0 120 100');
        svg.setAttribute('width', '120');
        svg.setAttribute('height', '100');

        // 水柱（头顶喷水）
        const spray = document.createElementNS(svgNs, 'g');
        spray.setAttribute('class', 'ds-whale-spray');
        const sprayPath = document.createElementNS(svgNs, 'path');
        sprayPath.setAttribute('d', 'M60 15 Q58 8 60 2 Q62 8 60 15');
        const sprayC1 = document.createElementNS(svgNs, 'circle');
        sprayC1.setAttribute('cx', '56'); sprayC1.setAttribute('cy', '6'); sprayC1.setAttribute('r', '2');
        const sprayC2 = document.createElementNS(svgNs, 'circle');
        sprayC2.setAttribute('cx', '64'); sprayC2.setAttribute('cy', '4'); sprayC2.setAttribute('r', '1.5');
        spray.appendChild(sprayPath); spray.appendChild(sprayC1); spray.appendChild(sprayC2);

        // 尾鳍
        const tail = document.createElementNS(svgNs, 'g');
        tail.setAttribute('class', 'ds-whale-tail');
        const tail1 = document.createElementNS(svgNs, 'path');
        tail1.setAttribute('d', 'M95 50 Q110 35 112 45 Q110 55 95 60 Z');
        const tail2 = document.createElementNS(svgNs, 'path');
        tail2.setAttribute('d', 'M95 60 Q110 75 108 65 Q106 55 95 50 Z');
        tail.appendChild(tail1); tail.appendChild(tail2);

        // 身体
        const body = document.createElementNS(svgNs, 'ellipse');
        body.setAttribute('class', 'ds-whale-body');
        body.setAttribute('cx', '55'); body.setAttribute('cy', '55');
        body.setAttribute('rx', '42'); body.setAttribute('ry', '28');

        // 腹部
        const belly = document.createElementNS(svgNs, 'ellipse');
        belly.setAttribute('class', 'ds-whale-belly');
        belly.setAttribute('cx', '50'); belly.setAttribute('cy', '65');
        belly.setAttribute('rx', '30'); belly.setAttribute('ry', '15');

        // 眼睛
        const eye = document.createElementNS(svgNs, 'g');
        eye.setAttribute('class', 'ds-whale-eye');
        const eyeWhite = document.createElementNS(svgNs, 'circle');
        eyeWhite.setAttribute('cx', '40'); eyeWhite.setAttribute('cy', '48'); eyeWhite.setAttribute('r', '3');
        const eyePupil = document.createElementNS(svgNs, 'circle');
        eyePupil.setAttribute('cx', '41'); eyePupil.setAttribute('cy', '49'); eyePupil.setAttribute('r', '1.8');
        eye.appendChild(eyeWhite); eye.appendChild(eyePupil);

        // 嘴
        const mouth = document.createElementNS(svgNs, 'path');
        mouth.setAttribute('class', 'ds-whale-mouth');
        mouth.setAttribute('d', 'M35 60 Q42 66 50 60');

        // 腮红
        const cheek = document.createElementNS(svgNs, 'circle');
        cheek.setAttribute('class', 'ds-whale-cheek');
        cheek.setAttribute('cx', '32'); cheek.setAttribute('cy', '58'); cheek.setAttribute('r', '3');

        svg.appendChild(spray);
        svg.appendChild(tail);
        svg.appendChild(body);
        svg.appendChild(belly);
        svg.appendChild(eye);
        svg.appendChild(mouth);
        svg.appendChild(cheek);
        root.appendChild(svg);

        document.body.appendChild(root);
        this.root = root;
        this.bubble = bubble;
        this.whaleEl = svg;
    }

    /**
     * 从 store 读取配置并应用到 DOM（尺寸/透明度/动画/位置）
     * @private
     */
    _applyConfig() {
        const cfg = getPetConfig();
        // SVG viewBox 为 120x100，按 size 设置宽度，高度等比缩放
        const w = cfg.size;
        const h = Math.round(cfg.size * 100 / 120);
        this.whaleEl.style.width = w + 'px';
        this.whaleEl.style.height = h + 'px';
        this.root.style.opacity = String(cfg.opacity);
        this.root.classList.toggle('float-enabled', !!cfg.floatAnimation);
        this._applyPosition(cfg.position, w, h);
    }

    /**
     * 应用位置（预设字符串或绝对坐标），并 clamp 到 viewport 内
     * @param {string|{x:number,y:number}} position - 位置
     * @param {number} w - 渲染宽度
     * @param {number} h - 渲染高度
     * @private
     */
    _applyPosition(position, w, h) {
        let x, y;
        if (position && typeof position === 'object') {
            x = position.x;
            y = position.y;
        } else if (position === 'left-bottom') {
            const p = resolvePresetPosition('left-bottom', w, h);
            x = p.x; y = p.y;
        } else {
            // 默认 right-bottom
            const p = resolvePresetPosition('right-bottom', w, h);
            x = p.x; y = p.y;
        }
        // clamp 到 viewport 内，避免越界
        const maxX = Math.max(POSITION_MARGIN_VALUE, window.innerWidth - w - POSITION_MARGIN_VALUE);
        const maxY = Math.max(POSITION_MARGIN_VALUE, window.innerHeight - h - POSITION_MARGIN_VALUE);
        x = Math.min(maxX, Math.max(POSITION_MARGIN_VALUE, x));
        y = Math.min(maxY, Math.max(POSITION_MARGIN_VALUE, y));
        this.root.style.left = x + 'px';
        this.root.style.top = y + 'px';
        this.root.style.right = 'auto';
        this.root.style.bottom = 'auto';
    }

    /**
     * 绑定事件：fetch-hub 生命周期 + 工具调用 hook + 拖动 + 窗口 resize
     * @private
     */
    _bindEvents() {
        // 注册 fetch-hub 生命周期处理器（thinking / outputting / success / error）
        this.fetchHandlerId = registerCompletionHandler({
            onStart: this._boundOnStreamStart,
            onChunk: this._boundOnStreamChunk,
            onEnd: this._boundOnStreamEnd
        });

        // hook _dsExecuteToolCall 监听工具调用（tool_running）
        this._hookExecuteToolCall();

        // 拖动（鼠标 + 触摸，适配 Android WebView）
        this.whaleEl.addEventListener('mousedown', this._boundDragStart);
        this.whaleEl.addEventListener('touchstart', this._boundDragStart, { passive: false });

        // 窗口 resize：重新计算位置（预设与绝对坐标都需 clamp）
        this._boundResize = () => {
            const cfg = getPetConfig();
            const w = cfg.size;
            const h = Math.round(cfg.size * 100 / 120);
            this._applyPosition(cfg.position, w, h);
        };
        window.addEventListener('resize', this._boundResize);
    }

    /**
     * hook window._dsExecuteToolCall，用 Object.defineProperty 拦截赋值
     * 这样无论 pet 与 capability-register 的初始化顺序如何，都能正确包装
     * @private
     */
    _hookExecuteToolCall() {
        if (this._toolCallHooked) return;
        this._realExecuteToolCall = typeof window._dsExecuteToolCall === 'function'
            ? window._dsExecuteToolCall
            : null;
        this._boundWrappedToolCall = this._wrappedExecuteToolCall.bind(this);
        const self = this;
        try {
            Object.defineProperty(window, '_dsExecuteToolCall', {
                configurable: true,
                get() { return self._boundWrappedToolCall; },
                set(fn) { self._realExecuteToolCall = typeof fn === 'function' ? fn : null; }
            });
            this._toolCallHooked = true;
        } catch (e) {
            // 降级：直接替换为包装函数（无法拦截后续赋值，但功能仍可用）
            this._origExecuteToolCall = window._dsExecuteToolCall || null;
            window._dsExecuteToolCall = this._boundWrappedToolCall;
            this._toolCallHooked = true;
        }
    }

    /**
     * _dsExecuteToolCall 包装函数：进入 tool_running 状态后调用原函数
     * 工具执行完毕后不主动切状态，等下一次 onStreamStart 切 thinking，
     * 或兜底超时切回 idle
     * @param {string} name - 工具名
     * @param {Object} payload - 工具参数
     * @returns {Object} 工具执行结果
     * @private
     */
    _wrappedExecuteToolCall(name, payload) {
        this._setState(PET_STATES.TOOL_RUNNING);
        this._setToolFallback();
        try {
            if (typeof this._realExecuteToolCall === 'function') {
                return this._realExecuteToolCall.call(window, name, payload);
            }
            return { ok: false, summary: '工具未初始化' };
        } catch (e) {
            return { ok: false, summary: '工具执行异常', detail: String(e && e.message || e) };
        }
    }

    /**
     * 设置 tool_running 兜底回退定时器
     * 避免工具执行后无续跑请求导致宠物永久卡在 tool_running
     * @private
     */
    _setToolFallback() {
        if (this.toolFallbackTimer) clearTimeout(this.toolFallbackTimer);
        this.toolFallbackTimer = setTimeout(() => {
            this.toolFallbackTimer = null;
            if (this.state === PET_STATES.TOOL_RUNNING) {
                this._setState(PET_STATES.IDLE);
            }
        }, TOOL_RUNNING_FALLBACK_MS);
    }

    /**
     * fetch-hub onStart：DeepSeek 请求发出 → thinking
     * @param {Object} payload - { startTime, model, prompt, route, chatSessionId }
     * @private
     */
    _onStreamStart(payload) {
        // 新请求发出时清除可能残留的 tool_running 兜底
        if (this.toolFallbackTimer) {
            clearTimeout(this.toolFallbackTimer);
            this.toolFallbackTimer = null;
        }
        this._setState(PET_STATES.THINKING);
    }

    /**
     * fetch-hub onChunk：流式 chunk 到达 → outputting
     * 仅在 thinking/success 状态下切换，避免覆盖 tool_running
     * @param {Object} payload - { chunk, accumulatedText, elapsedMs, tokens, firstTokenMs, serverStats }
     * @private
     */
    _onStreamChunk(payload) {
        if (this.state === PET_STATES.THINKING || this.state === PET_STATES.SUCCESS) {
            this._setState(PET_STATES.OUTPUTTING);
        }
    }

    /**
     * fetch-hub onEnd：回复完成 → success（短暂）→ idle；空响应 → error → idle
     * @param {Object} payload - { tokens, tps, durationMs, model, accumulatedText, ... }
     * @private
     */
    _onStreamEnd(payload) {
        if (this.toolFallbackTimer) {
            clearTimeout(this.toolFallbackTimer);
            this.toolFallbackTimer = null;
        }
        // 简易成功判断：有生成 token 视为成功，否则视为错误
        const hasContent = payload && typeof payload.tokens === 'number' && payload.tokens > 0;
        if (hasContent) {
            this._setState(PET_STATES.SUCCESS);
            this._scheduleTransient(PET_STATES.IDLE, TRANSIENT_MS.success);
        } else {
            this._setState(PET_STATES.ERROR);
            this._scheduleTransient(PET_STATES.IDLE, TRANSIENT_MS.error);
        }
    }

    /**
     * 切换状态：更新视觉 class、台词、轮播定时器
     * @param {string} state - 状态枚举值
     * @private
     */
    _setState(state) {
        if (!state) return;
        // 清除短暂状态回退定时器与台词轮播定时器
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
            this.transientTimer = null;
        }
        this._stopLineRotation();

        this.state = state;
        // 更新状态 class
        const stateClasses = [
            'state-idle', 'state-thinking', 'state-outputting',
            'state-tool_running', 'state-success', 'state-error'
        ];
        this.root.classList.remove(...stateClasses);
        this.root.classList.add('state-' + state);

        // 更新台词并显示气泡
        this.currentLine = getLine(state, this.currentLine);
        this._showBubble(this.currentLine);

        // 启动台词轮播（短暂状态不轮播）
        this._startLineRotation(state);
    }

    /**
     * 显示或隐藏气泡文本
     * @param {string} text - 台词文本，为空则隐藏气泡
     * @private
     */
    _showBubble(text) {
        if (!text) {
            this.bubble.classList.remove('visible');
            this.bubble.textContent = '';
            return;
        }
        this.bubble.textContent = text;
        this.bubble.classList.add('visible');
    }

    /**
     * 启动台词轮播定时器（按状态间隔）
     * @param {string} state - 当前状态
     * @private
     */
    _startLineRotation(state) {
        const interval = getRotateInterval(state);
        if (!interval) return;
        this.lineTimer = setInterval(() => {
            this.currentLine = getLine(state, this.currentLine);
            this._showBubble(this.currentLine);
        }, interval);
    }

    /**
     * 停止台词轮播定时器
     * @private
     */
    _stopLineRotation() {
        if (this.lineTimer) {
            clearInterval(this.lineTimer);
            this.lineTimer = null;
        }
    }

    /**
     * 安排短暂状态后回到目标状态
     * @param {string} targetState - 目标状态（通常为 idle）
     * @param {number} ms - 停留毫秒数
     * @private
     */
    _scheduleTransient(targetState, ms) {
        if (this.transientTimer) clearTimeout(this.transientTimer);
        this.transientTimer = setTimeout(() => {
            this.transientTimer = null;
            this._setState(targetState);
        }, ms);
    }

    /**
     * 拖动开始（mousedown / touchstart）
     * @param {MouseEvent|TouchEvent} e - 事件对象
     * @private
     */
    _onDragStart(e) {
        this.dragging = true;
        const rect = this.root.getBoundingClientRect();
        const point = e.touches ? e.touches[0] : e;
        this._dragOffset.x = point.clientX - rect.left;
        this._dragOffset.y = point.clientY - rect.top;
        document.addEventListener('mousemove', this._boundDragMove);
        document.addEventListener('mouseup', this._boundDragEnd);
        document.addEventListener('touchmove', this._boundDragMove, { passive: false });
        document.addEventListener('touchend', this._boundDragEnd);
        if (e.preventDefault) e.preventDefault();
    }

    /**
     * 拖动移动（mousemove / touchmove）
     * @param {MouseEvent|TouchEvent} e - 事件对象
     * @private
     */
    _onDragMove(e) {
        if (!this.dragging) return;
        const point = e.touches ? e.touches[0] : e;
        const rect = this.root.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        let x = point.clientX - this._dragOffset.x;
        let y = point.clientY - this._dragOffset.y;
        // clamp 到 viewport 内
        x = Math.max(0, Math.min(window.innerWidth - w, x));
        y = Math.max(0, Math.min(window.innerHeight - h, y));
        this.root.style.left = x + 'px';
        this.root.style.top = y + 'px';
        if (e.preventDefault) e.preventDefault();
    }

    /**
     * 拖动结束（mouseup / touchend）：持久化绝对坐标
     * @private
     */
    _onDragEnd() {
        if (!this.dragging) return;
        this.dragging = false;
        document.removeEventListener('mousemove', this._boundDragMove);
        document.removeEventListener('mouseup', this._boundDragEnd);
        document.removeEventListener('touchmove', this._boundDragMove);
        document.removeEventListener('touchend', this._boundDragEnd);
        // 持久化拖动后的绝对坐标（相对 viewport）
        const rect = this.root.getBoundingClientRect();
        savePetConfig({
            position: {
                x: Math.round(rect.left),
                y: Math.round(rect.top)
            }
        });
    }

    /** 显示宠物（移除隐藏 class） */
    show() {
        if (this.root) this.root.classList.remove('ds-whale-hidden');
    }

    /** 隐藏宠物（保留 DOM，仅视觉隐藏） */
    hide() {
        if (this.root) this.root.classList.add('ds-whale-hidden');
    }

    /**
     * 对外状态切换接口（供 window._dsPet.setState 调用）
     * @param {string} state - 状态枚举值
     */
    setState(state) {
        this._setState(state);
    }

    /** 销毁：停止定时器、解绑事件、恢复 _dsExecuteToolCall、移除 DOM */
    destroy() {
        this._stopLineRotation();
        if (this.transientTimer) {
            clearTimeout(this.transientTimer);
            this.transientTimer = null;
        }
        if (this.toolFallbackTimer) {
            clearTimeout(this.toolFallbackTimer);
            this.toolFallbackTimer = null;
        }
        // 注销 fetch-hub 处理器
        if (this.fetchHandlerId) {
            unregisterCompletionHandler(this.fetchHandlerId);
            this.fetchHandlerId = null;
        }
        // 恢复 _dsExecuteToolCall
        this._restoreExecuteToolCall();
        // 移除拖动监听
        document.removeEventListener('mousemove', this._boundDragMove);
        document.removeEventListener('mouseup', this._boundDragEnd);
        document.removeEventListener('touchmove', this._boundDragMove);
        document.removeEventListener('touchend', this._boundDragEnd);
        if (this._boundResize) {
            window.removeEventListener('resize', this._boundResize);
            this._boundResize = null;
        }
        if (this.whaleEl) {
            this.whaleEl.removeEventListener('mousedown', this._boundDragStart);
            this.whaleEl.removeEventListener('touchstart', this._boundDragStart);
        }
        // 移除 DOM
        if (this.root && this.root.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
        this.root = null;
        this.bubble = null;
        this.whaleEl = null;
    }

    /**
     * 恢复 _dsExecuteToolCall 为原始函数
     * @private
     */
    _restoreExecuteToolCall() {
        if (!this._toolCallHooked) return;
        try {
            // 删除 defineProperty 定义的 getter/setter
            delete window._dsExecuteToolCall;
        } catch (e) {}
        // 恢复为普通数据属性
        if (typeof this._realExecuteToolCall === 'function') {
            try { window._dsExecuteToolCall = this._realExecuteToolCall; } catch (e) {}
        } else if (this._origExecuteToolCall) {
            try { window._dsExecuteToolCall = this._origExecuteToolCall; } catch (e) {}
        }
        this._toolCallHooked = false;
        this._realExecuteToolCall = null;
        this._origExecuteToolCall = null;
        this._boundWrappedToolCall = null;
    }
}

/**
 * 初始化宠物实例（单例，重复调用会先销毁旧实例）
 * @returns {WhalePet} 宠物实例
 */
export function initWhalePet() {
    if (instance) {
        instance.destroy();
        instance = null;
    }
    instance = new WhalePet();
    return instance;
}

/** 销毁宠物实例 */
export function destroyWhalePet() {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}

/**
 * 获取当前宠物实例
 * @returns {WhalePet|null}
 */
export function getWhalePet() {
    return instance;
}

export { PET_STATES };
