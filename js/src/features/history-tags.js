/**
 * 历史会话标签搜索增强模块
 *
 * 在 DeepSeek 官方历史搜索弹窗中注入标签过滤器，
 * 支持给历史会话打标签并按标签筛选。
 *
 * 性能优化：
 *   - 不再独立创建 MutationObserver 监听整个 body，改由 observer-hub 的 onDialogs
 *     只在检测到目标弹窗（role=dialog + searchbox + listbox）时触发
 *   - 弹窗内部 listbox 变化的 observer 保留（作用范围小，不阻塞主流程）
 *   - 标签数据加入内存缓存 + 防抖异步写入 localStorage
 */
import { registerDomHandler, unregisterDomHandler } from '../utils/observer-hub.js';

/** 标签持久化存储 key */
const STORAGE_KEY = 'ds_history_tags';

/** 注入样式节点 ID */
const STYLE_ID = 'ds-history-tags-css';

/** 注入容器 ID */
const ENHANCER_ID = 'ds-history-search-enhancer';

/** 已处理标记，避免重复初始化 */
const INIT_FLAG = 'ds-history-tags-init';

/** 历史行标签数据属性 */
const TAGS_ATTR = 'data-ds-history-tags';

/** 会话链接正则（适配 /chat/s/ 与 /a/chat/s/ 两种路径） */
const SESSION_RE = /\/(?:a\/)?chat\/s\/([a-f0-9-]{20,})/i;

let installed = false;
let domHandlerId = 0;

/** 内存缓存 + 防抖写入 */
let _cacheTags = null;
let _cacheDirty = true;
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 300;

/**
 * 读取所有标签数据（带内存缓存）
 * @returns {Object} { sessionId: [tag1, tag2, ...] }
 */
function loadTags() {
    if (!_cacheDirty && _cacheTags) return _cacheTags;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        _cacheTags = raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
        _cacheTags = {};
    }
    _cacheDirty = false;
    return _cacheTags;
}

/**
 * 防抖异步写入：将内存中的标签刷新到 localStorage
 */
function scheduleSaveTags() {
    if (_writeTimer) return;
    _writeTimer = setTimeout(() => {
        _writeTimer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_cacheTags || {}));
        } catch (e) {}
    }, WRITE_DEBOUNCE_MS);
}

/**
 * 保存标签数据（先更新内存缓存，再触发防抖写入）
 * @param {Object} tags - 标签数据
 */
function saveTags(tags) {
    _cacheTags = tags;
    _cacheDirty = false;
    scheduleSaveTags();
}

/**
 * 注入样式（标签过滤区 + 徽章样式）
 * 单例注入，重复调用会被忽略
 */
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${ENHANCER_ID} {
            padding: 8px 12px;
            border-bottom: 1px solid rgba(0, 0, 0, 0.06);
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        #${ENHANCER_ID} .ds-tag-input {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 10px;
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s ease;
            background: #fff;
            color: #1f2937;
        }
        #${ENHANCER_ID} .ds-tag-input:focus {
            border-color: #3b82f6;
        }
        #${ENHANCER_ID} .ds-tag-status {
            font-size: 11px;
            color: #6b7280;
            min-height: 14px;
        }
        body[data-ds-dark-theme] #${ENHANCER_ID},
        [data-theme="dark"] #${ENHANCER_ID} {
            border-bottom-color: rgba(255, 255, 255, 0.08);
        }
        body[data-ds-dark-theme] #${ENHANCER_ID} .ds-tag-input,
        [data-theme="dark"] #${ENHANCER_ID} .ds-tag-input {
            background: #2d2e34;
            color: #e0e0e0;
            border-color: rgba(255, 255, 255, 0.1);
        }
        [${TAGS_ATTR}]::after {
            content: attr(${TAGS_ATTR});
            display: inline-block;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 10px;
            background: rgba(59, 130, 246, 0.1);
            color: #3b82f6;
            margin-left: 6px;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 从 URL 路径中解析 sessionId
 * @param {string} href - 链接 href
 * @returns {string|null}
 */
function parseSessionId(href) {
    if (!href) return null;
    const match = SESSION_RE.exec(href);
    return match ? match[1] : null;
}

/**
 * 获取当前页面对应的 sessionId
 * 优先从 URL 解析，其次从页面内的会话链接中提取
 * @returns {string|null}
 */
function getCurrentSessionId() {
    const fromUrl = parseSessionId(location.pathname);
    if (fromUrl) return fromUrl;
    const link = document.querySelector('a[href*="/chat/s/"]');
    return link ? parseSessionId(link.getAttribute('href')) : null;
}

/**
 * 为单条历史行打标签数据属性
 * 从历史行内的会话链接解析 sessionId，并查表写入标签
 * @param {Element} optionEl - [role="option"] 历史行
 * @param {Object} tags - 标签数据
 */
function tagOption(optionEl, tags) {
    if (!optionEl) return;
    const link = optionEl.querySelector('a[href*="/chat/s/"]');
    if (!link) return;
    const sid = parseSessionId(link.getAttribute('href'));
    if (!sid) return;
    // 缓存 sessionId 到 dataset，便于后续过滤
    optionEl.dataset.dsSessionId = sid;
    const tagArr = tags[sid];
    if (tagArr && tagArr.length > 0) {
        optionEl.setAttribute(TAGS_ATTR, tagArr.join(', '));
    } else {
        optionEl.removeAttribute(TAGS_ATTR);
    }
}

/**
 * 根据标签过滤输入框的值，显隐历史行
 * 同时保留官方搜索框自身的文本过滤结果
 * @param {Element} dialog - 搜索弹窗
 * @param {string} filterText - 标签过滤关键词（小写）
 * @param {Object} tags - 标签数据
 * @returns {{total: number, matched: number}}
 */
function applyFilter(dialog, filterText, tags) {
    const options = dialog.querySelectorAll('[role="option"]');
    let total = 0;
    let matched = 0;
    options.forEach(opt => {
        // 若官方逻辑已将其隐藏，则跳过
        if (opt.hidden) return;
        total++;
        if (!filterText) {
            opt.hidden = false;
            matched++;
            return;
        }
        const sid = opt.dataset.dsSessionId;
        const tagArr = sid ? (tags[sid] || []) : [];
        const hit = tagArr.some(t => String(t).toLowerCase().includes(filterText));
        opt.hidden = !hit;
        if (hit) matched++;
    });
    return { total, matched };
}

/**
 * 更新状态栏文本
 * @param {Element} statusEl - 状态栏元素
 * @param {number} matched - 匹配数量
 * @param {number} total - 总数
 * @param {string} filterText - 当前过滤关键词
 */
function updateStatus(statusEl, matched, total, filterText) {
    if (!statusEl) return;
    if (!filterText) {
        statusEl.textContent = `共 ${total} 条历史会话`;
    } else {
        statusEl.textContent = `标签"${filterText}"匹配 ${matched} / ${total} 条`;
    }
}

/**
 * 为当前会话添加标签
 * 读取当前会话标签输入框的值，按逗号/顿号分隔后写入存储
 * @param {Element} tagInput - 当前会话标签输入框
 * @param {Element} statusEl - 状态栏元素
 * @param {Element} dialog - 搜索弹窗（用于刷新历史行）
 * @returns {boolean} 是否成功添加
 */
function addTagForCurrentSession(tagInput, statusEl, dialog) {
    const raw = (tagInput.value || '').trim();
    if (!raw) return false;
    const sid = getCurrentSessionId();
    if (!sid) {
        updateStatus(statusEl, 0, 0, '');
        statusEl.textContent = '未检测到当前会话，无法添加标签';
        return false;
    }
    // 支持中英文逗号、顿号分隔
    const newTags = raw.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    if (newTags.length === 0) return false;
    const tags = loadTags();
    const existing = Array.isArray(tags[sid]) ? tags[sid] : [];
    // 合并去重
    const merged = [...new Set([...existing, ...newTags])];
    tags[sid] = merged;
    saveTags(tags);
    tagInput.value = '';
    // 刷新历史行标签
    dialog.querySelectorAll('[role="option"]').forEach(opt => tagOption(opt, tags));
    updateStatus(statusEl, 0, 0, '');
    statusEl.textContent = `已为当前会话添加标签：${newTags.join(', ')}`;
    return true;
}

/**
 * 初始化搜索弹窗内的标签增强 UI
 * 注入过滤区容器、两个输入框与状态栏，并绑定事件
 * @param {Element} dialog - 搜索弹窗节点
 */
function setupDialog(dialog) {
    if (!dialog || dialog.dataset[INIT_FLAG] === '1') return;
    dialog.dataset[INIT_FLAG] = '1';

    const tags = loadTags();

    // 创建增强容器
    const section = document.createElement('section');
    section.id = ENHANCER_ID;

    // 标签过滤输入框
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'ds-tag-input';
    filterInput.placeholder = '按标签筛选...';

    // 当前会话标签输入框
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.className = 'ds-tag-input';
    tagInput.placeholder = '给当前会话添加标签...';

    // 状态栏
    const statusEl = document.createElement('div');
    statusEl.className = 'ds-tag-status';

    section.appendChild(filterInput);
    section.appendChild(tagInput);
    section.appendChild(statusEl);

    // 插入到弹窗最顶部（早于官方搜索框）
    dialog.insertBefore(section, dialog.firstChild);

    // 给所有历史行打标签
    const refreshAll = () => {
        dialog.querySelectorAll('[role="option"]').forEach(opt => tagOption(opt, tags));
    };
    refreshAll();

    // 标签过滤输入：实时筛选
    filterInput.addEventListener('input', () => {
        const filterText = filterInput.value.trim().toLowerCase();
        const { total, matched } = applyFilter(dialog, filterText, tags);
        updateStatus(statusEl, matched, total, filterText);
    });

    // 当前会话标签输入：回车提交
    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            addTagForCurrentSession(tagInput, statusEl, dialog);
        }
    });

    // 初始化状态栏
    const { total } = applyFilter(dialog, '', tags);
    updateStatus(statusEl, total, total, '');

    // 监听弹窗内 listbox 变化（新加载的历史行）
    const listbox = dialog.querySelector('[role="listbox"]');
    if (listbox) {
        const listObserver = new MutationObserver(() => {
            refreshAll();
            // 重新应用当前过滤条件
            const filterText = filterInput.value.trim().toLowerCase();
            const { total: t, matched: m } = applyFilter(dialog, filterText, tags);
            updateStatus(statusEl, m, t, filterText);
        });
        listObserver.observe(listbox, { childList: true, subtree: true });
    }
}

/**
 * 扫描整个文档，查找已出现的搜索弹窗并初始化
 */
function scanExistingDialogs() {
    document.querySelectorAll('[role="dialog"]').forEach(d => {
        // 判定条件：同时包含 searchbox 与 listbox（与 observer-hub 内 extractDialogs 保持一致）
        if (d.querySelector('input[role="searchbox"]') && d.querySelector('[role="listbox"]')) {
            try { setupDialog(d); } catch (e) {}
        }
    });
}

/**
 * 处理 observer-hub 分发的 dialog 批次
 * @param {Element[]} dialogs
 */
function handleDialogs(dialogs) {
    for (const d of dialogs) {
        try { setupDialog(d); } catch (e) {}
    }
}

/**
 * 初始化历史会话标签搜索增强模块
 * 注入样式、扫描已有弹窗，并向 observer-hub 注册 dialog 处理器
 */
export function initHistoryTags() {
    if (installed) return;
    installed = true;
    injectStyles();
    // 预热缓存
    loadTags();
    // 扫描已存在的弹窗
    scanExistingDialogs();
    // 后续变化由 observer-hub 分发（只处理匹配条件的 dialog）
    domHandlerId = registerDomHandler({ onDialogs: handleDialogs });
}

/**
 * 清理历史标签模块（对外暴露的可选接口）
 */
export function destroyHistoryTags() {
    if (!installed) return;
    installed = false;
    if (domHandlerId) unregisterDomHandler(domHandlerId);
    domHandlerId = 0;
    // flush 待写入的数据
    if (_writeTimer) {
        clearTimeout(_writeTimer);
        _writeTimer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_cacheTags || {}));
        } catch (e) {}
    }
}
