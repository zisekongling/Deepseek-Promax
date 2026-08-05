/**
 * @module memory-importer
 * 记忆导入工具模块
 *
 * 核心功能：
 *   1. 解析外部 JSON（DeepSeek++ 导出格式 / 单条记忆数组 / ChatGPT 导出 / Claude 等AI工作流）
 *      —— 复用 memory.js 的 previewMemoryImport 完成字段映射与精确去重，避免重复实现
 *   2. 预览卡片 UI：每条记忆一张卡片，显示标题/类型/标签/内容前 100 字
 *      —— 全选/全不选、总数与已选数、模糊相似度标记"可能重复"
 *   3. 选择性导入：用户确认后把选中记忆写入 memory store（调用 memory.js 的 addMemory）
 *      —— 不重复写入：完全相同的 title+content 跳过
 *   4. 文件读取：支持文件选择 / 粘贴 JSON 文本 / 拖拽文件到预览框
 *
 * 设计约束：
 *   - 不修改 memory.js / config.js / settings-panel.js
 *   - 仅调用 memory.js 暴露的公共 API（previewMemoryImport / addMemory / findSimilarMemory）
 *   - 模态框样式与 settings-panel 一致（深色/浅色主题跟随，复用 --ds-* CSS 变量命名）
 *
 * 对外 API：
 *   - initMemoryImporter()           幂等初始化，注册 window._dsMemoryImporter
 *   - importFromJson(jsonString)     从 JSON 字符串解析并弹出预览
 *   - importFromFile(file)           从 File 对象读取并解析
 *   - showImportPreview(memories, meta)  渲染预览模态框
 */
import { showToast } from '../ui/toast.js';
import { utils } from '../utils.js';
import { getThemeColors } from '../themes.js';
import { CONFIG as _CONFIG_SNAPSHOT } from '../config.js';
import {
    previewMemoryImport,
    addMemory,
    findSimilarMemory
} from './memory.js';

// ============================================================
// 配置读取（与 memory.js 的 _getConfigSafe 同款模式）
// ============================================================

/**
 * 安全获取最新的 CONFIG 引用
 * config.js 的 CONFIG 是 let 导出，直接 import 拿到的是导入时的快照
 * 这里通过 window 全局获取最新引用，回退到快照
 * @returns {{ CONFIG: Object }}
 */
function _getConfigSafe() {
    try {
        if (typeof window !== 'undefined' && window.__dsConfig) {
            return { CONFIG: window.__dsConfig };
        }
    } catch (e) {}
    return { CONFIG: _CONFIG_SNAPSHOT };
}

// ============================================================
// 常量定义
// ============================================================

/** 记忆分类中文标签映射（与 memory.js 内部 CATEGORY_LABELS 保持一致，用于预览卡片展示） */
const CATEGORY_LABELS = {
    preference: '偏好',
    context: '上下文',
    fact: '事实',
    instruction: '指令'
};

/** 记忆分类标签颜色映射（与 memory.js 内部 CATEGORY_COLORS 保持一致） */
const CATEGORY_COLORS = {
    preference: '#3b82f6',   // 蓝色
    context: '#22c55e',      // 绿色
    fact: '#f59e0b',         // 橙色
    instruction: '#8b5cf6'   // 紫色
};

/** 模糊去重相似度阈值：用于标记"可能重复"（低于此值不标记） */
const DUPLICATE_THRESHOLD = 0.7;

/** 导入时跳过的相似度阈值：达到此值视为重复，跳过写入 */
const SKIP_THRESHOLD = 0.85;

/** 内容预览最大字符数 */
const PREVIEW_MAX_CHARS = 100;

// ============================================================
// 内部状态
// ============================================================

/** 模块是否已初始化（initMemoryImporter 幂等标志） */
let _initialized = false;

/** 当前预览中的记忆列表（预览模态框打开时填充） */
let _previewMemories = [];

// ============================================================
// 工具函数
// ============================================================

/**
 * 转义 HTML 特殊字符，防止 XSS
 * @param {string} str - 待转义的字符串
 * @returns {string} 转义后的安全字符串
 */
function _escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 截取内容预览（超出部分用省略号代替）
 * @param {string} content - 原始内容
 * @param {number} [max=PREVIEW_MAX_CHARS] - 最大字符数
 * @returns {string} 截取后的预览文本
 */
function _previewContent(content, max = PREVIEW_MAX_CHARS) {
    const s = String(content || '');
    if (s.length <= max) return s;
    return s.slice(0, max) + '...';
}

/**
 * 检查单条记忆与现有记忆的相似度，判断是否"可能重复"
 * 复用 memory.js 的 findSimilarMemory（基于 title+content 的 Jaccard bigram 相似度）
 * @param {string} title - 待检查的标题
 * @param {string} content - 待检查的内容
 * @returns {boolean} 是否可能重复
 */
function _isLikelyDuplicate(title, content) {
    try {
        const match = findSimilarMemory(title, content, DUPLICATE_THRESHOLD);
        return !!match;
    } catch (e) {
        return false;
    }
}

// ============================================================
// CSS 样式（与 settings-panel 主题变量保持一致）
// ============================================================

/** 样式是否已注入 */
let _styleInjected = false;

/**
 * 注入导入模态框的 CSS 样式（仅一次）
 * 复用 settings-panel 的 --ds-* 变量命名，确保视觉一致
 */
function _injectStyle() {
    if (_styleInjected) return;
    if (document.getElementById('ds-import-style')) {
        _styleInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = 'ds-import-style';
    style.textContent = `
        @keyframes dsImportFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsImportSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

        #ds-import-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
            display: none; justify-content: center; align-items: center;
            z-index: 1000000; font-family: -apple-system, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        #ds-import-modal.ds-import-show { display: flex; animation: dsImportFadeIn 0.2s ease; }

        #ds-import-modal .ds-import-panel {
            background: var(--ds-import-panel-bg);
            color: var(--ds-import-panel-text);
            border-radius: 20px; padding: 24px 28px;
            max-width: 680px; width: 92%; max-height: 85vh;
            overflow: hidden; display: flex; flex-direction: column;
            box-shadow: 0 24px 80px rgba(0,0,0,0.4);
            border: 1px solid var(--ds-import-panel-border);
            animation: dsImportSlideUp 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #ds-import-modal .ds-import-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 16px; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-title {
            margin: 0; font-size: 20px; font-weight: 800;
            background: linear-gradient(135deg, var(--ds-import-primary), var(--ds-import-accent));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text; letter-spacing: -0.3px;
        }
        #ds-import-modal .ds-import-close {
            background: var(--ds-import-card-bg); border: none; font-size: 22px;
            cursor: pointer; color: inherit; opacity: 0.6;
            transition: opacity 0.2s; padding: 4px 10px;
            border-radius: 8px; line-height: 1; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-close:hover { opacity: 1; }

        #ds-import-modal .ds-import-input-section {
            margin-bottom: 14px; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-textarea {
            width: 100%; box-sizing: border-box;
            padding: 10px 12px; border-radius: 10px;
            border: 1px solid var(--ds-import-input-border);
            background: var(--ds-import-input-bg);
            color: var(--ds-import-panel-text);
            font-size: 13px; font-family: 'SF Mono', 'Consolas', monospace;
            resize: vertical; min-height: 70px; max-height: 140px;
            transition: border-color 0.2s;
        }
        #ds-import-modal .ds-import-textarea:focus {
            outline: none; border-color: var(--ds-import-primary);
            box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
        }
        #ds-import-modal .ds-import-input-actions {
            display: flex; gap: 8px; margin-top: 8px; align-items: center;
        }
        #ds-import-modal .ds-import-file-btn {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 7px 14px; border-radius: 8px; cursor: pointer;
            background: var(--ds-import-card-bg); color: var(--ds-import-panel-text);
            border: 1px solid var(--ds-import-panel-border);
            font-size: 13px; font-weight: 600; transition: background 0.2s;
        }
        #ds-import-modal .ds-import-file-btn:hover { background: var(--ds-import-hover-bg); }
        #ds-import-modal .ds-import-parse-btn {
            padding: 7px 16px; border-radius: 8px; border: none; cursor: pointer;
            background: var(--ds-import-primary); color: #fff;
            font-size: 13px; font-weight: 600; transition: opacity 0.2s;
        }
        #ds-import-modal .ds-import-parse-btn:hover { opacity: 0.88; }
        #ds-import-modal .ds-import-drop-hint {
            font-size: 12px; color: var(--ds-import-section-color);
            margin-left: auto; opacity: 0.7;
        }
        #ds-import-modal.ds-import-dragover .ds-import-panel {
            border-color: var(--ds-import-primary);
            box-shadow: 0 0 0 3px rgba(0,0,0,0.06), 0 24px 80px rgba(0,0,0,0.4);
        }

        #ds-import-modal .ds-import-stats {
            display: flex; gap: 16px; font-size: 13px;
            color: var(--ds-import-section-color); margin-bottom: 10px; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-stats b {
            color: var(--ds-import-panel-text); font-weight: 700;
        }
        #ds-import-modal .ds-import-dup-info b { color: #f59e0b; }

        #ds-import-modal .ds-import-toolbar {
            display: flex; gap: 8px; margin-bottom: 8px; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-toolbar button {
            padding: 4px 12px; border-radius: 6px; border: 1px solid var(--ds-import-panel-border);
            background: transparent; color: var(--ds-import-section-color);
            font-size: 12px; cursor: pointer; transition: background 0.2s;
        }
        #ds-import-modal .ds-import-toolbar button:hover { background: var(--ds-import-hover-bg); }

        #ds-import-modal .ds-import-list {
            flex: 1; overflow-y: auto; min-height: 120px;
            padding-right: 4px;
        }
        #ds-import-modal .ds-import-list::-webkit-scrollbar { width: 6px; }
        #ds-import-modal .ds-import-list::-webkit-scrollbar-thumb {
            background: var(--ds-import-input-border); border-radius: 3px;
        }

        #ds-import-modal .ds-import-card {
            display: flex; gap: 10px; padding: 10px 12px; margin-bottom: 6px;
            border: 1px solid var(--ds-import-panel-border); border-radius: 10px;
            background: var(--ds-import-card-bg); transition: background 0.2s, border-color 0.2s;
        }
        #ds-import-modal .ds-import-card:hover { background: var(--ds-import-hover-bg); }
        #ds-import-modal .ds-import-card.ds-import-card-dup {
            border-color: rgba(245,158,11,0.4);
            background: rgba(245,158,11,0.04);
        }
        #ds-import-modal .ds-import-card-check {
            flex-shrink: 0; padding-top: 2px;
        }
        #ds-import-modal .ds-import-card-check input {
            width: 16px; height: 16px; cursor: pointer; accent-color: var(--ds-import-primary);
        }
        #ds-import-modal .ds-import-card-body { flex: 1; min-width: 0; }
        #ds-import-modal .ds-import-card-head {
            display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap;
        }
        #ds-import-modal .ds-import-card-title {
            font-weight: 600; font-size: 14px; color: var(--ds-import-panel-text);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
        }
        #ds-import-modal .ds-import-card-type {
            font-size: 11px; padding: 2px 8px; border-radius: 8px;
            color: #fff; font-weight: 600; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-card-dup-badge {
            font-size: 10px; padding: 2px 6px; border-radius: 6px;
            background: rgba(245,158,11,0.15); color: #f59e0b;
            font-weight: 600; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-card-content {
            font-size: 13px; color: var(--ds-import-section-color);
            line-height: 1.5; word-break: break-word; margin-bottom: 4px;
        }
        #ds-import-modal .ds-import-card-tags {
            display: flex; flex-wrap: wrap; gap: 4px;
        }
        #ds-import-modal .ds-import-tag {
            font-size: 11px; color: var(--ds-import-primary);
            background: var(--ds-import-card-bg); padding: 1px 6px; border-radius: 4px;
        }
        #ds-import-modal .ds-import-empty {
            color: var(--ds-import-section-color); font-size: 13px;
            padding: 24px; text-align: center;
            border: 1px dashed var(--ds-import-panel-border); border-radius: 12px;
        }

        #ds-import-modal .ds-import-footer {
            display: flex; gap: 10px; margin-top: 16px; flex-shrink: 0;
        }
        #ds-import-modal .ds-import-confirm {
            flex: 1; padding: 11px; border-radius: 12px; border: none;
            font-size: 14px; font-weight: 600; cursor: pointer; color: #fff;
            background: linear-gradient(135deg, var(--ds-import-primary), var(--ds-import-accent));
            box-shadow: 0 4px 16px var(--ds-import-glow);
            transition: opacity 0.2s, transform 0.2s;
        }
        #ds-import-modal .ds-import-confirm:hover { opacity: 0.88; transform: translateY(-1px); }
        #ds-import-modal .ds-import-confirm:disabled {
            opacity: 0.5; cursor: not-allowed; transform: none;
        }
        #ds-import-modal .ds-import-cancel {
            padding: 11px 20px; border-radius: 12px; cursor: pointer;
            background: transparent; border: 1px solid var(--ds-import-panel-border);
            color: var(--ds-import-panel-text); font-size: 14px; font-weight: 600;
            transition: background 0.2s;
        }
        #ds-import-modal .ds-import-cancel:hover { background: var(--ds-import-hover-bg); }

        @media (max-width: 480px) {
            #ds-import-modal .ds-import-panel {
                width: 100% !important; max-width: none !important;
                max-height: 90vh !important; padding: 16px 14px !important;
                border-radius: 16px 16px 0 0 !important;
            }
            #ds-import-modal { align-items: flex-end; }
        }
    `;
    document.head.appendChild(style);
    _styleInjected = true;
}

/**
 * 根据当前主题刷新模态框的 CSS 变量
 * 与 settings-panel 的 buildStylesCSS 使用相同的变量命名，确保视觉一致
 * @param {HTMLElement} modal - 模态框根元素
 */
function _applyThemeVars(modal) {
    const isDark = utils.isDarkMode();
    const t = getThemeColors(_getConfigSafe().CONFIG?.themeColor) || {
        primary: isDark ? '#7c8df4' : '#793f82',
        accent: isDark ? '#7c8df4' : '#9B7AA0',
        glow: 'rgba(121,63,130,0.35)'
    };
    const vars = {
        '--ds-import-primary': t.primary,
        '--ds-import-accent': t.accent,
        '--ds-import-glow': t.glow || 'rgba(121,63,130,0.35)',
        '--ds-import-panel-bg': isDark ? '#1e1e2e' : '#ffffff',
        '--ds-import-panel-text': isDark ? '#cdd6f4' : '#1a1a2e',
        '--ds-import-panel-border': isDark ? '#313244' : '#e8e8ef',
        '--ds-import-card-bg': isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
        '--ds-import-input-bg': isDark ? '#313244' : '#f5f5f7',
        '--ds-import-input-border': isDark ? '#45475a' : '#d8d8e0',
        '--ds-import-section-color': isDark ? '#7f849c' : '#888',
        '--ds-import-hover-bg': isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    };
    for (const [key, value] of Object.entries(vars)) {
        modal.style.setProperty(key, value);
    }
}

// ============================================================
// 模态框构建与事件绑定
// ============================================================

/** 当前模态框 DOM 引用（惰性创建，复用） */
let _modal = null;

/**
 * 创建导入模态框 DOM 元素并绑定事件
 * @returns {HTMLElement} 模态框根元素
 */
function _buildModal() {
    const modal = document.createElement('div');
    modal.id = 'ds-import-modal';
    modal.innerHTML = `
        <div class="ds-import-panel">
            <div class="ds-import-header">
                <h3 class="ds-import-title">📥 导入记忆</h3>
                <button class="ds-import-close" data-action="import-close">&times;</button>
            </div>

            <div class="ds-import-input-section">
                <textarea class="ds-import-textarea" id="ds-import-textarea"
                    placeholder="粘贴 JSON 文本（支持 DeepSeek++ 导出格式 / 记忆数组 / ChatGPT 导出等）..."></textarea>
                <div class="ds-import-input-actions">
                    <label class="ds-import-file-btn">
                        📂 选择文件
                        <input type="file" accept=".json,application/json" id="ds-import-file-input" hidden>
                    </label>
                    <button class="ds-import-parse-btn" data-action="import-parse">解析</button>
                    <span class="ds-import-drop-hint">💡 也可拖拽文件到此</span>
                </div>
            </div>

            <div class="ds-import-stats">
                <span>共 <b id="ds-import-total">0</b> 条</span>
                <span>已选 <b id="ds-import-selected">0</b> 条</span>
                <span class="ds-import-dup-info">可能重复 <b id="ds-import-dups">0</b> 条</span>
            </div>

            <div class="ds-import-toolbar">
                <button data-action="import-select-all">☑ 全选</button>
                <button data-action="import-deselect-all">☐ 全不选</button>
            </div>

            <div class="ds-import-list" id="ds-import-list">
                <div class="ds-import-empty">请在上方粘贴 JSON 或选择文件，解析后在此预览</div>
            </div>

            <div class="ds-import-footer">
                <button class="ds-import-cancel" data-action="import-cancel">取消</button>
                <button class="ds-import-confirm" data-action="import-confirm" disabled>导入选中</button>
            </div>
        </div>
    `;
    _applyThemeVars(modal);
    _bindModalEvents(modal);
    return modal;
}

/**
 * 绑定模态框内的所有事件（点击、文件选择、拖拽、勾选）
 * @param {HTMLElement} modal - 模态框根元素
 */
function _bindModalEvents(modal) {
    // 事件委托：处理所有 data-action 点击
    modal.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;

        switch (action) {
            case 'import-close':
            case 'import-cancel':
                _hideModal();
                break;
            case 'import-parse':
                _handleParse(modal);
                break;
            case 'import-select-all':
                _toggleAll(modal, true);
                break;
            case 'import-deselect-all':
                _toggleAll(modal, false);
                break;
            case 'import-confirm':
                _handleConfirm(modal);
                break;
        }
    });

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) _hideModal();
    });

    // 文件选择
    const fileInput = modal.querySelector('#ds-import-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) importFromFile(file);
            fileInput.value = '';
        });
    }

    // 拖拽文件
    modal.addEventListener('dragover', (e) => {
        e.preventDefault();
        modal.classList.add('ds-import-dragover');
    });
    modal.addEventListener('dragleave', (e) => {
        if (e.target === modal) modal.classList.remove('ds-import-dragover');
    });
    modal.addEventListener('drop', (e) => {
        e.preventDefault();
        modal.classList.remove('ds-import-dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) importFromFile(file);
    });

    // 卡片勾选 → 更新已选数
    const list = modal.querySelector('#ds-import-list');
    if (list) {
        list.addEventListener('change', (e) => {
            if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
                _updateSelectedCount(modal);
            }
        });
    }
}

/**
 * 显示模态框（惰性创建 + 刷新主题变量）
 */
function _showModal() {
    if (!_modal) _modal = _buildModal();
    _applyThemeVars(_modal); // 每次打开刷新主题（适配运行时主题切换）
    document.body.appendChild(_modal);
    _modal.classList.add('ds-import-show');
}

/**
 * 隐藏模态框
 */
function _hideModal() {
    if (_modal) _modal.classList.remove('ds-import-show');
}

/**
 * 处理解析按钮点击：读取 textarea 内容并解析
 * @param {HTMLElement} modal - 模态框根元素
 */
function _handleParse(modal) {
    const textarea = modal.querySelector('#ds-import-textarea');
    const text = textarea ? textarea.value : '';
    if (!text.trim()) {
        showToast('请先粘贴 JSON 内容', { tone: 'warning' });
        return;
    }
    importFromJson(text);
}

/**
 * 处理确认导入按钮点击：将选中的记忆写入 memory store
 * @param {HTMLElement} modal - 模态框根元素
 */
function _handleConfirm(modal) {
    const list = modal.querySelector('#ds-import-list');
    if (!list) return;

    // 收集所有勾选的记忆（data-index 对应 _previewMemories 数组下标）
    const selectedIndexes = [];
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) {
            const idx = parseInt(cb.dataset.index, 10);
            if (!isNaN(idx)) selectedIndexes.push(idx);
        }
    });

    if (selectedIndexes.length === 0) {
        showToast('请至少选择一条记忆', { tone: 'warning' });
        return;
    }

    const result = _doImport(selectedIndexes);
    const parts = [];
    if (result.success > 0) parts.push(`成功 ${result.success} 条`);
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条（重复）`);
    const msg = parts.length > 0 ? parts.join('，') : '未导入任何记忆';
    showToast(msg, { tone: result.success > 0 ? 'success' : 'warning', duration: 4000 });

    if (result.success > 0) {
        _hideModal();
        // 刷新设置面板中的记忆列表（如果当前打开着）
        try {
            if (typeof window._dsRefreshMemoryPanel === 'function') {
                window._dsRefreshMemoryPanel();
            }
        } catch (e) {}
    }
}

/**
 * 执行批量导入：遍历选中的记忆，去重后写入 memory store
 * 去重策略：调用 findSimilarMemory 检查相似度 ≥ SKIP_THRESHOLD 的视为重复，跳过
 * @param {number[]} indexes - 选中的记忆在 _previewMemories 中的下标数组
 * @returns {{ success: number, skipped: number }} 导入结果统计
 */
function _doImport(indexes) {
    let success = 0;
    let skipped = 0;

    for (const idx of indexes) {
        const mem = _previewMemories[idx];
        if (!mem) continue;

        const title = (mem.title || '').trim();
        const content = (mem.content || '').trim();
        const category = mem.category || 'preference';
        const tags = Array.isArray(mem.tags) ? mem.tags : [];

        if (!title || !content) {
            skipped++;
            continue;
        }

        // 去重检查：相似度 ≥ SKIP_THRESHOLD 视为重复，跳过
        try {
            const dup = findSimilarMemory(title, content, SKIP_THRESHOLD);
            if (dup) {
                skipped++;
                continue;
            }
        } catch (e) {}

        // 写入 memory store
        try {
            const added = addMemory(title, content, category, { tags });
            if (added) {
                success++;
            } else {
                skipped++;
            }
        } catch (e) {
            skipped++;
        }
    }

    return { success, skipped };
}

/**
 * 全选 / 全不选
 * @param {HTMLElement} modal - 模态框根元素
 * @param {boolean} checked - 是否勾选
 */
function _toggleAll(modal, checked) {
    const list = modal.querySelector('#ds-import-list');
    if (!list) return;
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
    });
    _updateSelectedCount(modal);
}

/**
 * 更新已选数量显示，并同步确认按钮的启用状态
 * @param {HTMLElement} modal - 模态框根元素
 */
function _updateSelectedCount(modal) {
    const list = modal.querySelector('#ds-import-list');
    const selectedEl = modal.querySelector('#ds-import-selected');
    const confirmBtn = modal.querySelector('[data-action="import-confirm"]');
    if (!list || !selectedEl) return;
    const checked = list.querySelectorAll('input[type="checkbox"]:checked');
    selectedEl.textContent = checked.length;
    if (confirmBtn) confirmBtn.disabled = checked.length === 0;
}

// ============================================================
// 预览渲染
// ============================================================

/**
 * 渲染预览卡片列表 HTML
 * @param {Array<Object>} memories - 记忆数组（来自 previewMemoryImport 的输出）
 * @returns {string} 卡片列表的 HTML 字符串
 */
function _renderCards(memories) {
    if (!memories || memories.length === 0) {
        return '<div class="ds-import-empty">未解析到有效记忆</div>';
    }

    let dupCount = 0;
    const cards = memories.map((mem, idx) => {
        const title = mem.title || '导入的记忆';
        const content = mem.content || '';
        const category = mem.category || 'preference';
        const tags = Array.isArray(mem.tags) ? mem.tags : [];
        const label = CATEGORY_LABELS[category] || '偏好';
        const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.preference;

        // 模糊相似度检测：标记"可能重复"
        const isDup = _isLikelyDuplicate(title, content);
        if (isDup) dupCount++;

        const tagsHtml = tags.length > 0
            ? `<div class="ds-import-card-tags">${tags.map(t => `<span class="ds-import-tag">#${_escapeHtml(t)}</span>`).join('')}</div>`
            : '';
        const dupBadge = isDup ? '<span class="ds-import-card-dup-badge">可能重复</span>' : '';

        return `
            <div class="ds-import-card${isDup ? ' ds-import-card-dup' : ''}">
                <label class="ds-import-card-check">
                    <input type="checkbox" checked data-index="${idx}">
                </label>
                <div class="ds-import-card-body">
                    <div class="ds-import-card-head">
                        <span class="ds-import-card-title">${_escapeHtml(title)}</span>
                        <span class="ds-import-card-type" style="background:${color}">${_escapeHtml(label)}</span>
                        ${dupBadge}
                    </div>
                    <div class="ds-import-card-content">${_escapeHtml(_previewContent(content))}</div>
                    ${tagsHtml}
                </div>
            </div>
        `;
    }).join('');

    // 更新重复计数
    const dupEl = _modal?.querySelector('#ds-import-dups');
    if (dupEl) dupEl.textContent = dupCount;

    return cards;
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 从 JSON 字符串解析记忆并弹出预览模态框
 *
 * 解析逻辑复用 memory.js 的 previewMemoryImport，支持多种格式：
 *   - DeepSeek++ 自身导出格式：{ memories: [...] }
 *   - 单条记忆数组：[{ title, content, type, tags }]
 *   - ChatGPT 记忆导出：{ memories: [{ content, ... }] }
 *   - Claude / 其他 AI 工作流：尽力识别 title/content/tags 字段
 *
 * 字段映射（由 memory.js 的 _extractJsonMemories 完成）：
 *   - title：title / name / key / 取 content 首行
 *   - content：content / text / value
 *   - type→category：type / category，校验为 preference/context/fact/instruction 之一
 *   - tags：tags（数组）
 *   - description：description / summary
 *
 * @param {string} jsonString - JSON 字符串或纯文本
 */
export function importFromJson(jsonString) {
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.memoryImportEnabled === false) {
        showToast('记忆导入功能已禁用', { tone: 'warning' });
        return;
    }

    if (!jsonString || typeof jsonString !== 'string' || !jsonString.trim()) {
        showToast('JSON 内容为空', { tone: 'warning' });
        return;
    }

    // 复用 memory.js 的 previewMemoryImport 完成解析 + 精确去重
    let result;
    try {
        result = previewMemoryImport({ content: jsonString });
    } catch (e) {
        showToast('解析失败：' + (e.message || '未知错误'), { tone: 'error' });
        return;
    }

    if (!result.memories || result.memories.length === 0) {
        const parts = [];
        if (result.duplicates > 0) parts.push(`重复 ${result.duplicates} 条`);
        if (result.rejected > 0) parts.push(`无效 ${result.rejected} 条`);
        const hint = parts.length > 0 ? `（${parts.join('，')}）` : '';
        showToast('未解析到有效记忆' + hint, { tone: 'warning', duration: 4000 });
        return;
    }

    showImportPreview(result.memories, {
        duplicates: result.duplicates,
        rejected: result.rejected
    });
}

/**
 * 从 File 对象读取内容并解析
 * @param {File} file - 用户选择的文件
 */
export function importFromFile(file) {
    if (!file) {
        showToast('未选择文件', { tone: 'warning' });
        return;
    }

    // 简单校验文件类型
    const isJson = file.name.endsWith('.json') ||
                   file.type === 'application/json' ||
                   file.type === 'text/plain';
    if (!isJson) {
        showToast('请选择 .json 文件', { tone: 'warning' });
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        importFromJson(text);
    };
    reader.onerror = () => {
        showToast('文件读取失败', { tone: 'error' });
    };
    reader.readAsText(file);
}

/**
 * 渲染预览模态框，展示解析后的记忆卡片
 *
 * 每条记忆一张卡片，显示标题/类型/标签/内容前 100 字。
 * 卡片上有 checkbox 供用户选择是否导入，默认全选。
 * 与现有记忆模糊相似（相似度 ≥ 0.7）的卡片标记"可能重复"。
 *
 * @param {Array<Object>} memories - 记忆数组（每项含 title/content/category/tags）
 * @param {Object} [meta] - 额外统计信息
 * @param {number} [meta.duplicates=0] - 解析阶段已去除的精确重复数量
 * @param {number} [meta.rejected=0] - 解析阶段被拒绝的无效条目数量
 */
export function showImportPreview(memories, meta = {}) {
    if (!Array.isArray(memories)) {
        showToast('预览数据格式无效', { tone: 'error' });
        return;
    }

    // 检查功能开关
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.memoryImportEnabled === false) {
        showToast('记忆导入功能已禁用', { tone: 'warning' });
        return;
    }

    _injectStyle();
    _showModal();

    // 缓存当前预览的记忆列表（供导入时按下标取值）
    _previewMemories = memories.slice();

    // 渲染卡片
    const listEl = _modal.querySelector('#ds-import-list');
    if (listEl) {
        listEl.innerHTML = _renderCards(memories);
    }

    // 更新统计数字
    const totalEl = _modal.querySelector('#ds-import-total');
    if (totalEl) totalEl.textContent = memories.length;

    // _renderCards 内部会更新 dups 计数，这里兜底刷新一次
    _updateSelectedCount(_modal);

    // 可选：在 textarea 区域提示解析阶段的重复/拒绝数
    if (meta.duplicates > 0 || meta.rejected > 0) {
        const hint = [];
        if (meta.duplicates > 0) hint.push(`已去除精确重复 ${meta.duplicates} 条`);
        if (meta.rejected > 0) hint.push(`已拒绝无效条目 ${meta.rejected} 条`);
        showToast(hint.join('，'), { tone: 'info', duration: 3500 });
    }
}

/**
 * 初始化记忆导入工具模块（幂等）
 *
 * 执行内容：
 *   1. 注入 CSS 样式（仅一次）
 *   2. 注册 window._dsMemoryImporter 全局对象，供外部（如设置面板按钮）调用
 */
export function initMemoryImporter() {
    if (_initialized) return;
    _initialized = true;

    _injectStyle();

    // 注册全局 API，供设置面板 / 控制台 / 其他模块调用
    if (typeof window !== 'undefined') {
        window._dsMemoryImporter = {
            importFromJson,
            importFromFile,
            showImportPreview
        };
    }
}
