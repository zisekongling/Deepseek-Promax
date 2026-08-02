/**
 * 樱花动画模块
 *
 * 在页面顶层创建 Canvas，渲染飘落的樱花花瓣动画。
 * 支持暗色模式自适应、页面可见性暂停、DPR 缩放。
 */
import { CONFIG } from '../config.js';
import { utils } from '../utils.js';

let sakuraInstance = null;

/**
 * 樱花动画类：管理 Canvas 渲染循环与花瓣粒子
 */
class SakuraEffect {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.petals = [];
        this.running = true;
        this._animFrameId = null;
        this._boundAnimate = this._animate.bind(this);
        this._boundVisibility = this._onVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._boundVisibility);
        this._init();
        this._boundAnimate();
    }

    /** 初始化 Canvas 与花瓣粒子 */
    _init() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'sakura-canvas';
        this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        window.addEventListener('resize', utils.debounce(() => this._resize(), 200));
        const colors = ['rgba(255,183,197,0.85)', 'rgba(255,160,180,0.8)', 'rgba(255,200,210,0.75)'];
        for (let i = 0; i < 32; i++) {
            this.petals.push({
                x: Math.random() * innerWidth,
                y: Math.random() * innerHeight,
                size: 8 + Math.random() * 10,
                speed: 0.8 + Math.random() * 1.6,
                sway: 0.015 + Math.random() * 0.03,
                swayAmp: 20 + Math.random() * 50,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.04,
                opacity: 0.55 + Math.random() * 0.45,
                swayOff: Math.random() * Math.PI * 2,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }
    }

    /** 调整 Canvas 尺寸以匹配窗口 + DPR */
    _resize() {
        const dpr = Math.min(devicePixelRatio, 2);
        this.canvas.width = innerWidth * dpr;
        this.canvas.height = innerHeight * dpr;
        this.canvas.style.width = innerWidth + 'px';
        this.canvas.style.height = innerHeight + 'px';
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
    }

    /** 动画帧：更新花瓣位置并绘制 */
    _animate() {
        if (!this.running || !this.canvas) return;
        if (document.hidden) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
            return;
        }
        this.ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (let p of this.petals) {
            p.y += p.speed;
            p.swayOff += p.sway;
            p.x += Math.sin(p.swayOff) * p.swayAmp * 0.06;
            p.rot += p.rotSpeed;
            if (p.y > innerHeight + 30) { p.y = -30; p.x = Math.random() * innerWidth; }
            this.ctx.save();
            this.ctx.globalAlpha = p.opacity;
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rot);
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, p.size * 0.55, p.size * 0.35, 0, 0, Math.PI * 2);
            this.ctx.fillStyle = p.color;
            this.ctx.fill();
            this.ctx.restore();
        }
        this._animFrameId = requestAnimationFrame(this._boundAnimate);
    }

    /** 页面可见性变化时暂停/恢复动画 */
    _onVisibilityChange() {
        if (document.hidden) {
            if (this._animFrameId) {
                cancelAnimationFrame(this._animFrameId);
                this._animFrameId = null;
            }
        } else {
            if (this.running && !this._animFrameId) {
                this._animFrameId = requestAnimationFrame(this._boundAnimate);
            }
        }
    }

    /** 销毁实例：停止动画、移除 Canvas、清理事件 */
    destroy() {
        this.running = false;
        if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
        document.removeEventListener('visibilitychange', this._boundVisibility);
        if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
        this.canvas = null;
        this.ctx = null;
        this.petals = [];
    }
}

/**
 * 初始化（或销毁后重建）樱花动画实例
 */
export function initSakura() {
    if (sakuraInstance) { sakuraInstance.destroy(); sakuraInstance = null; }
    if (CONFIG.sakuraEnabled) sakuraInstance = new SakuraEffect();
}

/** 销毁樱花动画实例 */
export function destroySakura() {
    if (sakuraInstance) { sakuraInstance.destroy(); sakuraInstance = null; }
}
