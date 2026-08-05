/**
 * 项目面板 - 侧边栏嵌入 UI
 *
 * 在 DeepSeek 侧边栏顶部嵌入项目管理面板（参考 ui/folder-panel.js 的注入方式），
 * 支持：
 *   - 项目列表展示
 *   - 创建项目（名称 / slug / 指令）
 *   - 编辑项目（名称 / slug / 指令 / 记忆）
 *   - 删除项目
 *   - 加入当前会话到项目 / 从项目移除会话
 *   - 项目记忆的增删改查
 *
 * 挂载策略（参考 folder-panel.js）：
 *   - 通过 findSidebar() 定位侧边栏容器
 *   - 使用 sidebar.prepend(panel) 插入到顶部
 *   - MutationObserver 等待侧边栏加载；setInterval 检查面板是否仍在 DOM 中
 *
 * React 兼容约束（项目硬约束）：
 *   - 只用 insertBefore / prepend 插入节点，绝不 removeChild React 节点
 *   - 隐藏原节点时使用 style.display='none'，不直接删除
 *   - 仅对本模块自己创建的节点使用 innerHTML 刷新
 */

import {
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    addSessionToProject,
    removeSessionFromProject,
    listProjectMemories,
    addProjectMemory,
    updateProjectMemory,
    deleteProjectMemory
} from './store.js';
import { findSidebar, getActiveConversation } from '../conversation-detector.js';
import { getSidFromUrl } from '../data-store.js';

// ============================================================
// 常量与状态
// ============================================================

const PANEL_ID = 'dspro-project-panel';
const STYLE_ID = 'dspro-project-panel-style';

/** 面板是否已挂载（幂等保护） */
let mounted = false;

/** 当前展开的项目 ID 集合（默认全部折叠） */
const _expandedSet = new Set();

/** 当前编辑中的项目记忆 ID（null 表示新增模式），格式：projectId:memId */
let _editingMemKey = null;

// ============================================================
// 样式注入
// ============================================================

/**
 * 注入面板样式（仅一次）
 */
function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${PANEL_ID} {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            padding: 8px;
            margin-bottom: 4px;
            border-bottom: 1px solid rgba(128,128,128,0.15);
            max-height: 320px;
            overflow-y: auto;
            flex-shrink: 0;
        }
        #${PANEL_ID}::-webkit-scrollbar { width: 4px; }
        #${PANEL_ID}::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 2px; }
        .pp-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 6px; padding: 0 2px;
        }
        .pp-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 4px; }
        .pp-actions { display: flex; gap: 4px; }
        .pp-btn {
            border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer;
            font-size: 12px; line-height: 1.4; background: transparent; color: inherit;
        }
        .pp-btn:hover { background: rgba(128,128,128,0.15); }
        .pp-project-row {
            display: flex; align-items: center; gap: 2px; padding: 3px 4px;
            border-radius: 4px; cursor: pointer; user-select: none;
        }
        .pp-project-row:hover { background: rgba(128,128,128,0.1); }
        .pp-project-row.active { background: rgba(128,128,128,0.15); }
        .pp-toggle { width: 14px; text-align: center; font-size: 10px; flex-shrink: 0; transition: transform 0.15s; }
        .pp-toggle.collapsed { transform: rotate(-90deg); }
        .pp-project-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-project-slug { font-size: 11px; color: rgba(128,128,128,0.6); margin-left: 4px; }
        .pp-project-ops { display: none; gap: 1px; flex-shrink: 0; }
        .pp-project-row:hover .pp-project-ops { display: flex; }
        .pp-project-ops button {
            border: none; background: transparent; cursor: pointer; padding: 1px 3px;
            font-size: 11px; border-radius: 3px; color: inherit; opacity: 0.7;
        }
        .pp-project-ops button:hover { background: rgba(128,128,128,0.2); opacity: 1; }
        .pp-children { margin-left: 16px; display: block; padding: 2px 0; }
        .pp-children.hidden { display: none; }
        .pp-section-label {
            font-size: 11px; color: rgba(128,128,128,0.7); margin: 6px 2px 2px;
            text-transform: uppercase; letter-spacing: 0.3px;
        }
        .pp-session-row {
            display: flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px;
            border-radius: 4px; font-size: 12px;
        }
        .pp-session-row:hover { background: rgba(128,128,128,0.08); }
        .pp-session-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-session-current { color: var(--dsw-alias-brand-primary, #007bff); font-weight: 600; font-size: 10px; }
        .pp-session-del { display: none; border: none; background: transparent; cursor: pointer; padding: 1px 3px; font-size: 11px; opacity: 0.7; color: inherit; }
        .pp-session-row:hover .pp-session-del { display: block; }
        .pp-session-del:hover { color: #ef4444; opacity: 1; }
        .pp-mem-card {
            border: 1px solid rgba(128,128,128,0.2); border-radius: 6px;
            padding: 4px 6px; margin: 2px 0; font-size: 12px;
        }
        .pp-mem-card.pp-mem-pinned { border-color: rgba(245,158,11,0.5); }
        .pp-mem-head { display: flex; align-items: center; gap: 4px; }
        .pp-mem-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-mem-ops { display: none; gap: 1px; flex-shrink: 0; }
        .pp-mem-card:hover .pp-mem-ops { display: flex; }
        .pp-mem-ops button {
            border: none; background: transparent; cursor: pointer; padding: 1px 3px;
            font-size: 11px; border-radius: 3px; color: inherit; opacity: 0.7;
        }
        .pp-mem-ops button:hover { background: rgba(128,128,128,0.2); opacity: 1; }
        .pp-mem-preview { color: rgba(128,128,128,0.8); margin: 2px 0; font-size: 11px; line-height: 1.4; word-break: break-word; }
        .pp-mem-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
        .pp-mem-tag { font-size: 10px; color: rgba(128,128,128,0.7); background: rgba(128,128,128,0.1); padding: 0 4px; border-radius: 3px; }
        .pp-empty { color: rgba(128,128,128,0.5); font-size: 12px; padding: 8px 4px; text-align: center; }
        .pp-add-current {
            display: flex; align-items: center; justify-content: center; gap: 4px;
            margin-top: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer;
            font-size: 12px; border: 1px dashed rgba(128,128,128,0.3); background: transparent; color: inherit;
        }
        .pp-add-current:hover { background: rgba(128,128,128,0.1); border-color: rgba(128,128,128,0.5); }
        .pp-mem-form {
            margin: 4px 0; padding: 6px; border: 1px solid rgba(128,128,128,0.2);
            border-radius: 6px; display: flex; flex-direction: column; gap: 4px;
        }
        .pp-mem-form input, .pp-mem-form textarea {
            width: 100%; padding: 4px 6px; border: 1px solid rgba(128,128,128,0.3);
            border-radius: 4px; font-size: 12px; background: transparent; color: inherit; box-sizing: border-box;
            font-family: inherit;
        }
        .pp-mem-form input:focus, .pp-mem-form textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #007bff); }
        .pp-mem-form textarea { resize: vertical; min-height: 40px; }
        .pp-mem-form-row { display: flex; gap: 4px; align-items: center; }
        .pp-mem-form-row label { font-size: 11px; display: flex; align-items: center; gap: 3px; cursor: pointer; }
        .pp-mem-form-actions { display: flex; gap: 4px; }
        .pp-mem-form-actions button {
            flex: 1; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;
        }
        .pp-mem-submit { background: var(--dsw-alias-brand-primary, #007bff); color: #fff; }
        .pp-mem-cancel { background: rgba(128,128,128,0.15); color: inherit; }
        .pp-dialog-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99998;
            background: transparent; display: flex; align-items: center; justify-content: center;
        }
        .pp-dialog {
            background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #333);
            border-radius: 12px; padding: 20px; min-width: 320px; max-width: 460px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 99999; max-height: 80vh; overflow-y: auto;
        }
        .pp-dialog h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
        .pp-dialog-field { margin-bottom: 10px; }
        .pp-dialog-field label { display: block; font-size: 12px; margin-bottom: 4px; color: rgba(128,128,128,0.8); }
        .pp-dialog-field input, .pp-dialog-field textarea {
            width: 100%; padding: 8px 12px; border: 1px solid rgba(128,128,128,0.3);
            border-radius: 6px; font-size: 13px; background: transparent; color: inherit; box-sizing: border-box;
            font-family: inherit;
        }
        .pp-dialog-field input:focus, .pp-dialog-field textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #007bff); }
        .pp-dialog-field textarea { resize: vertical; min-height: 80px; }
        .pp-dialog-actions { display: flex; gap: 8px; margin-top: 12px; }
        .pp-dialog-actions button {
            flex: 1; padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
        }
        .pp-dialog-confirm { background: var(--dsw-alias-brand-primary, #007bff); color: #fff; }
        .pp-dialog-cancel { background: rgba(128,128,128,0.15); color: inherit; }
    `;
    document.head.appendChild(style);
}

// ============================================================
// 工具函数
// ============================================================

/**
 * HTML 转义（参考 folder-panel.js 的 esc）
 * @param {string} text
 * @returns {string}
 */
function esc(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

/**
 * 截取内容预览
 * @param {string} content
 * @param {number} [max=60]
 * @returns {string}
 */
function _preview(content, max = 60) {
    const s = String(content || '').replace(/\r?\n/g, ' ');
    return s.length <= max ? s : s.slice(0, max) + '...';
}

/**
 * 判断项目是否展开
 * @param {string} projectId
 * @returns {boolean}
 */
function _isExpanded(projectId) {
    return _expandedSet.has(projectId);
}

// ============================================================
// 对话框
// ============================================================

/**
 * 显示项目编辑对话框（创建/编辑共用）
 * @param {string} title - 对话框标题
 * @param {Object} [defaults={}] - 默认值 { name, slug, instructions }
 * @returns {Promise<{name:string, slug:string, instructions:string}|null>}
 */
function showProjectDialog(title, defaults = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'pp-dialog-overlay';
        overlay.innerHTML = `
            <div class="pp-dialog">
                <h3>${esc(title)}</h3>
                <div class="pp-dialog-field">
                    <label>项目名称 *</label>
                    <input type="text" class="pp-input-name" value="${esc(defaults.name || '')}" placeholder="如：我的写作项目" />
                </div>
                <div class="pp-dialog-field">
                    <label>Slug（留空自动生成）</label>
                    <input type="text" class="pp-input-slug" value="${esc(defaults.slug || '')}" placeholder="如：writing-project" />
                </div>
                <div class="pp-dialog-field">
                    <label>项目指令（注入到会话首条消息前）</label>
                    <textarea class="pp-input-instructions" placeholder="如：请用简洁的中文回复，聚焦于写作任务...">${esc(defaults.instructions || '')}</textarea>
                </div>
                <div class="pp-dialog-actions">
                    <button class="pp-dialog-cancel">取消</button>
                    <button class="pp-dialog-confirm">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const nameInput = overlay.querySelector('.pp-input-name');
        const slugInput = overlay.querySelector('.pp-input-slug');
        const instrInput = overlay.querySelector('.pp-input-instructions');
        nameInput.focus();
        if (defaults.name) nameInput.select();

        const close = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('.pp-dialog-cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.pp-dialog-confirm').addEventListener('click', () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            close({
                name,
                slug: slugInput.value.trim(),
                instructions: instrInput.value
            });
        });
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                overlay.querySelector('.pp-dialog-confirm').click();
            }
            if (e.key === 'Escape') close(null);
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
}

// ============================================================
// 面板渲染
// ============================================================

/**
 * 渲染项目面板内容
 * @param {HTMLElement} container
 */
function renderPanel(container) {
    const projects = listProjects();
    let html = `
        <div class="pp-header">
            <span class="pp-title">📂 项目</span>
            <div class="pp-actions">
                <button class="pp-btn" data-action="new-project" title="新建项目">＋</button>
            </div>
        </div>
    `;

    if (projects.length === 0) {
        html += `<div class="pp-empty">暂无项目，点击 + 创建</div>`;
    } else {
        html += '<div class="pp-tree">';
        for (const project of projects) {
            html += renderProject(project);
        }
        html += '</div>';
    }

    container.innerHTML = html;
}

/**
 * 渲染单个项目
 * @param {Object} project - 项目对象
 * @returns {string}
 */
function renderProject(project) {
    const isExpanded = _isExpanded(project.id);
    const sessionCount = (project.sessionIds || []).length;
    const memCount = (project.memories || []).length;
    const hasChildren = sessionCount > 0 || memCount > 0;

    let html = `
        <div class="pp-project-row" data-project-id="${esc(project.id)}">
            <span class="pp-toggle ${isExpanded ? '' : 'collapsed'}" data-action="toggle" data-project-id="${esc(project.id)}">${hasChildren ? '▼' : '·'}</span>
            <span class="pp-project-name" data-action="toggle" data-project-id="${esc(project.id)}">📂 ${esc(project.name)}<span class="pp-project-slug">${esc(project.slug)}</span></span>
            <span class="pp-project-ops">
                <button data-action="edit-project" data-project-id="${esc(project.id)}" title="编辑">✏</button>
                <button data-action="delete-project" data-project-id="${esc(project.id)}" title="删除">🗑</button>
            </span>
        </div>
    `;

    if (isExpanded) {
        html += `<div class="pp-children" data-children-of="${esc(project.id)}">`;
        // 会话列表
        html += `<div class="pp-section-label">会话（${sessionCount}）</div>`;
        if (sessionCount === 0) {
            html += `<div class="pp-empty">暂无关联会话</div>`;
        } else {
            const currentSid = getSidFromUrl();
            for (const sid of project.sessionIds) {
                const isCurrent = sid === currentSid;
                html += `
                    <div class="pp-session-row" data-session-id="${esc(sid)}">
                        <span class="pp-session-title">💬 ${esc(sid.slice(0, 8))}...</span>
                        ${isCurrent ? '<span class="pp-session-current">当前</span>' : ''}
                        <button class="pp-session-del" data-action="remove-session" data-project-id="${esc(project.id)}" data-session-id="${esc(sid)}" title="移除">✕</button>
                    </div>
                `;
            }
        }

        // 加入当前会话按钮
        const active = getActiveConversation();
        if (active) {
            const alreadyIn = project.sessionIds.includes(active.id);
            html += `
                <button class="pp-add-current" data-action="add-current" data-project-id="${esc(project.id)}">
                    ${alreadyIn ? '✓ 当前会话已在项目' : '＋ 加入当前会话'}
                </button>
            `;
        }

        // 记忆列表
        html += `<div class="pp-section-label">项目记忆（${memCount}）</div>`;
        const memories = listProjectMemories(project.id);
        if (memories.length === 0) {
            html += `<div class="pp-empty">暂无项目记忆</div>`;
        } else {
            for (const mem of memories) {
                html += renderMemory(project.id, mem);
            }
        }

        // 添加记忆表单
        html += renderMemoryForm(project.id);

        html += `</div>`;
    }

    return html;
}

/**
 * 渲染单条项目记忆卡片
 * @param {string} projectId
 * @param {Object} mem
 * @returns {string}
 */
function renderMemory(projectId, mem) {
    const tagsHtml = (Array.isArray(mem.tags) && mem.tags.length > 0)
        ? `<div class="pp-mem-tags">${mem.tags.map(t => `<span class="pp-mem-tag">#${esc(t)}</span>`).join('')}</div>`
        : '';
    return `
        <div class="pp-mem-card${mem.pinned ? ' pp-mem-pinned' : ''}" data-mem-id="${esc(mem.id)}" data-project-id="${esc(projectId)}">
            <div class="pp-mem-head">
                ${mem.pinned ? '<span>📌</span>' : ''}
                <span class="pp-mem-title">${esc(mem.title)}</span>
                <span class="pp-mem-ops">
                    <button data-action="pin-mem" data-project-id="${esc(projectId)}" data-mem-id="${esc(mem.id)}" title="${mem.pinned ? '取消置顶' : '置顶'}">${mem.pinned ? '📍' : '📌'}</button>
                    <button data-action="edit-mem" data-project-id="${esc(projectId)}" data-mem-id="${esc(mem.id)}" title="编辑">✏</button>
                    <button data-action="delete-mem" data-project-id="${esc(projectId)}" data-mem-id="${esc(mem.id)}" title="删除">🗑</button>
                </span>
            </div>
            <div class="pp-mem-preview">${esc(_preview(mem.content))}</div>
            ${tagsHtml}
        </div>
    `;
}

/**
 * 渲染添加/编辑记忆的内联表单
 * @param {string} projectId
 * @returns {string}
 */
function renderMemoryForm(projectId) {
    const editingKey = _editingMemKey;
    const isEditingThis = editingKey && editingKey.startsWith(projectId + ':');
    let defaults = { title: '', content: '', tags: [], pinned: false };
    let submitLabel = '添加记忆';
    let formTitle = '添加新记忆';

    if (isEditingThis) {
        const memId = editingKey.split(':')[1];
        const project = getProject(projectId);
        const mem = project && Array.isArray(project.memories)
            ? project.memories.find(m => m.id === memId)
            : null;
        if (mem) {
            defaults = mem;
            submitLabel = '保存修改';
            formTitle = '编辑记忆';
        }
    }

    return `
        <div class="pp-mem-form" data-mem-form="${esc(projectId)}">
            <div class="pp-section-label">${esc(formTitle)}</div>
            <input type="text" class="pp-mem-input-title" placeholder="标题" value="${esc(defaults.title || '')}" />
            <textarea class="pp-mem-input-content" placeholder="记忆内容...">${esc(defaults.content || '')}</textarea>
            <input type="text" class="pp-mem-input-tags" placeholder="标签（逗号分隔）" value="${esc((defaults.tags || []).join(', '))}" />
            <div class="pp-mem-form-row">
                <label><input type="checkbox" class="pp-mem-input-pinned" ${defaults.pinned ? 'checked' : ''} /> 置顶</label>
            </div>
            <div class="pp-mem-form-actions">
                <button class="pp-mem-cancel" data-action="cancel-mem" data-project-id="${esc(projectId)}">取消</button>
                <button class="pp-mem-submit" data-action="submit-mem" data-project-id="${esc(projectId)}">${esc(submitLabel)}</button>
            </div>
        </div>
    `;
}

// ============================================================
// 事件处理（事件委托）
// ============================================================

/**
 * 处理面板内点击事件（事件委托，参考 folder-panel.js 的 handlePanelClick）
 * @param {Event} e
 */
function handlePanelClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const projectId = target.dataset.projectId;
    const memId = target.dataset.memId;
    const sessionId = target.dataset.sessionId;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    switch (action) {
        case 'toggle': {
            if (projectId) {
                if (_expandedSet.has(projectId)) _expandedSet.delete(projectId);
                else _expandedSet.add(projectId);
                renderPanel(panel);
            }
            break;
        }
        case 'new-project': {
            showProjectDialog('新建项目').then(result => {
                if (!result) return;
                const proj = createProject(result);
                if (proj) {
                    _expandedSet.add(proj.id);
                    renderPanel(panel);
                }
            });
            break;
        }
        case 'edit-project': {
            const project = getProject(projectId);
            if (!project) return;
            showProjectDialog('编辑项目', {
                name: project.name,
                slug: project.slug,
                instructions: project.instructions
            }).then(result => {
                if (!result) return;
                updateProject(projectId, result);
                renderPanel(panel);
            });
            break;
        }
        case 'delete-project': {
            const project = getProject(projectId);
            if (!project) return;
            if (confirm(`确定删除项目「${project.name}」？\n该项目下的 ${project.sessionIds.length} 个会话关联和 ${project.memories.length} 条记忆将被一并删除。`)) {
                deleteProject(projectId);
                _expandedSet.delete(projectId);
                renderPanel(panel);
            }
            break;
        }
        case 'add-current': {
            const active = getActiveConversation();
            if (active) {
                addSessionToProject(projectId, active.id);
                renderPanel(panel);
            }
            break;
        }
        case 'remove-session': {
            e.preventDefault();
            e.stopPropagation();
            removeSessionFromProject(projectId, sessionId);
            renderPanel(panel);
            break;
        }
        case 'pin-mem': {
            const project = getProject(projectId);
            const mem = project && Array.isArray(project.memories)
                ? project.memories.find(m => m.id === memId)
                : null;
            if (mem) {
                updateProjectMemory(projectId, memId, { pinned: !mem.pinned });
                renderPanel(panel);
            }
            break;
        }
        case 'edit-mem': {
            _editingMemKey = projectId + ':' + memId;
            renderPanel(panel);
            const form = panel.querySelector(`[data-mem-form="${projectId}"]`);
            if (form) {
                const titleInput = form.querySelector('.pp-mem-input-title');
                if (titleInput) titleInput.focus();
            }
            break;
        }
        case 'delete-mem': {
            if (confirm('确定删除这条项目记忆？')) {
                deleteProjectMemory(projectId, memId);
                if (_editingMemKey === projectId + ':' + memId) _editingMemKey = null;
                renderPanel(panel);
            }
            break;
        }
        case 'submit-mem': {
            const form = panel.querySelector(`[data-mem-form="${projectId}"]`);
            if (!form) return;
            const title = (form.querySelector('.pp-mem-input-title')?.value || '').trim();
            const content = (form.querySelector('.pp-mem-input-content')?.value || '').trim();
            const tagsStr = (form.querySelector('.pp-mem-input-tags')?.value || '').trim();
            const pinned = form.querySelector('.pp-mem-input-pinned')?.checked || false;
            if (!title || !content) {
                if (!title) form.querySelector('.pp-mem-input-title')?.focus();
                else form.querySelector('.pp-mem-input-content')?.focus();
                return;
            }
            const tags = tagsStr
                ? tagsStr.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean)
                : [];

            if (_editingMemKey && _editingMemKey.startsWith(projectId + ':')) {
                const editMemId = _editingMemKey.split(':')[1];
                updateProjectMemory(projectId, editMemId, { title, content, tags, pinned });
                _editingMemKey = null;
            } else {
                addProjectMemory(projectId, { title, content, tags, pinned });
            }
            renderPanel(panel);
            break;
        }
        case 'cancel-mem': {
            _editingMemKey = null;
            renderPanel(panel);
            break;
        }
    }
}

// ============================================================
// 挂载与生命周期
// ============================================================

/**
 * 挂载项目面板到侧边栏
 * @returns {boolean} 是否成功挂载
 */
function mountPanel() {
    const sidebar = findSidebar();
    if (!sidebar) return false;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        // 使用 prepend 插入到顶部（不删除任何已有 React 节点）
        sidebar.prepend(panel);
    }
    // 检查面板是否仍在 DOM 中（DeepSeek 可能重新渲染侧边栏）
    if (!document.contains(panel)) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.addEventListener('click', handlePanelClick);
        sidebar.prepend(panel);
    }
    renderPanel(panel);
    return true;
}

/**
 * 初始化项目面板
 *
 * 使用 MutationObserver 监听侧边栏加载（参考 folder-panel.js），
 * 挂载成功后用 setInterval 周期检查面板是否仍在 DOM 中（DeepSeek 会重渲染侧边栏）。
 * @returns {void}
 */
export function initProjectPanel() {
    if (mounted) return;
    mounted = true;
    injectStyle();

    if (!mountPanel()) {
        // 侧边栏可能尚未加载，使用 observer 等待
        const bodyObserver = new MutationObserver(() => {
            if (mountPanel()) {
                bodyObserver.disconnect();
                observeSidebarChanges();
            }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
        // 10 秒后停止重试
        setTimeout(() => bodyObserver.disconnect(), 10000);
        return;
    }

    observeSidebarChanges();
}

/**
 * 监听面板是否仍在 DOM 中（DeepSeek 会重新渲染侧边栏，导致面板被移除）
 * 周期检查并重新挂载。间隔较长以减少开销（与 folder-panel 错开避免同时重渲染）。
 */
function observeSidebarChanges() {
    setInterval(() => {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || !panel.isConnected) {
            mountPanel();
        }
    }, 3500);
}

/**
 * 刷新面板（外部调用，用于数据变更后强制刷新视图）
 */
export function refreshProjectPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) renderPanel(panel);
}
