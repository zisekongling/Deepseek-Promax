/**
 * 记忆操作工具集（Execution 类）
 *
 * 将原 capability-register.js 中 16 个 memory_* 执行器提取为独立模块。
 * 每个工具都是纯函数，接收 payload 返回 ToolResult，不依赖 DOM。
 *
 * 工具分类（参考《AI Agent 实战》指南）：
 *   - CRUD 类：save / update / delete / replace / get / clear
 *   - 检索类：search / list / recall
 *   - 管理类：merge / review / pin / stats / export / archive / import_preview
 *
 * 设计原则：
 *   - 参数校验失败返回 { ok: false }，不抛异常
 *   - 去重命中返回 { ok: true, skipped: true }
 *   - 边界条件在工具描述中明确说明
 */

import {
    addMemory, updateMemory, deleteMemory, getMemories,
    findSimilarMemory, findMemoryById, isMemoryDeleted,
    previewMemoryImport, mergeMemories, touchMemories,
    togglePinMemory, archiveStaleMemories, exportMemories,
    getMemoryById, clearMemoriesByScope, replaceMemory
} from '../../features/memory.js';

// ============================================================
// 工具描述符
// ============================================================

/** @type {import('../core/tool-registry.js').ToolDescriptor[]} */
export const MEMORY_TOOL_DESCRIPTORS = [
    // --- CRUD 类 ---
    {
        name: 'memory_save',
        description: '保存一条新的长期记忆。当用户透露全新偏好/事实/身份时调用。禁止保存密钥/密码/PII/临时指令/闲聊。',
        category: 'execution',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '记忆类型：preference（偏好）/ context（背景）/ fact（事实）/ instruction（指令）' },
                name: { type: 'string', description: '简短标题' },
                content: { type: 'string', description: '要保存的内容' },
                tags: { type: 'array', items: { type: 'string' }, description: '标签列表' }
            },
            required: ['type', 'name', 'content']
        },
        boundaryNote: '不需要提供 id 字段，系统会自动生成。不保存密钥/密码/PII/临时指令/闲聊。',
        examples: ['{"type":"preference","name":"用户技术栈","content":"主要使用 React 和 TypeScript","tags":["前端","React"]}']
    },
    {
        name: 'memory_get',
        description: '按 ID 读取单条记忆的完整字段（含历史版本）。需要查看记忆详情时调用。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '记忆 ID，必须来自 [系统记忆] 或工具返回结果中的实际 id' }
            },
            required: ['id']
        },
        boundaryNote: 'id 必须来自 [系统记忆] 中显示的实际 id，不能自己编造。'
    },
    {
        name: 'memory_update',
        description: '更新已有记忆的部分字段。修正已有记忆时调用。',
        category: 'execution',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '记忆 ID' },
                type: { type: 'string', description: '记忆类型' },
                name: { type: 'string', description: '新标题' },
                content: { type: 'string', description: '新内容' },
                tags: { type: 'array', items: { type: 'string' }, description: '新标签' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_replace',
        description: '覆盖式更新记忆：用新内容完全替换旧内容，旧内容进入历史。用户偏好已变化时调用。',
        category: 'execution',
        riskLevel: 'medium',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '记忆 ID' },
                content: { type: 'string', description: '新内容（完全替换旧内容）' },
                title: { type: 'string', description: '新标题' },
                tags: { type: 'array', items: { type: 'string' }, description: '新标签' },
                reason: { type: 'string', description: '替换原因' }
            },
            required: ['id', 'content']
        },
        boundaryNote: '与 memory_update 的区别：replace 完全替换并保留历史轨迹，update 仅修改部分字段。'
    },
    {
        name: 'memory_delete',
        description: '删除指定记忆。记忆过时/错误/冗余时调用。',
        category: 'execution',
        riskLevel: 'high',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '记忆 ID' },
                name: { type: 'string', description: '记忆标题（便于识别）' }
            },
            required: ['id']
        },
        boundaryNote: '删除不可逆。id 必须来自 [系统记忆] 中的实际 id。'
    },
    {
        name: 'memory_clear',
        description: '批量清空指定作用域的记忆。需要 confirm:true 确认。',
        category: 'execution',
        riskLevel: 'high',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', description: '清空范围：global/project/all' },
                confirm: { type: 'boolean', description: '必须为 true 才执行' },
                includePinned: { type: 'boolean', description: '是否一并清空置顶记忆（默认 false）' }
            },
            required: ['scope', 'confirm']
        },
        boundaryNote: '删除单条记忆用 memory_delete，不要用 clear。'
    },

    // --- 检索类 ---
    {
        name: 'memory_search',
        description: '主动搜索记忆库。当 [系统记忆] 注入的内容不够时使用。支持关键词和相似度两种模式。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词或语义查询' },
                limit: { type: 'integer', description: '返回结果上限（默认 10，最大 50）' },
                threshold: { type: 'number', description: '相似度阈值 0-1（>0 时启用相似度模式）' },
                category: { type: 'string', description: '按分类筛选' }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_list',
        description: '列出记忆库中的记忆，支持按分类/标签筛选和分页。比 memory_review 更轻量。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: '按分类筛选' },
                tag: { type: 'string', description: '按标签筛选' },
                limit: { type: 'integer', description: '每页数量（默认 20）' },
                offset: { type: 'integer', description: '偏移量（默认 0）' },
                includeDisabled: { type: 'boolean', description: '是否包含已禁用记忆' }
            }
        }
    },
    {
        name: 'memory_recall',
        description: '报告你在当前回复中参考了哪些已有记忆。被报告的记忆会自动增加访问次数。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                memoryIds: { type: 'array', items: { type: 'string' }, description: '本次参考的记忆 ID 列表' }
            },
            required: ['memoryIds']
        },
        boundaryNote: '仅在确实参考了 [系统记忆] 中的内容时调用。此工具不触发 Agent 续跑。'
    },

    // --- 管理类 ---
    {
        name: 'memory_merge',
        description: '将多条有关联的记忆融合为一条。融合后原记忆被删除，新记忆继承标签和访问统计。',
        category: 'execution',
        riskLevel: 'medium',
        inputSchema: {
            type: 'object',
            properties: {
                memoryIds: { type: 'array', items: { type: 'string' }, description: '待融合的记忆 ID 数组（至少 2 条）' },
                name: { type: 'string', description: '新记忆标题' },
                content: { type: 'string', description: '新记忆内容（应整合所有原记忆的关键信息）' },
                type: { type: 'string', description: '新记忆类型' },
                tags: { type: 'array', items: { type: 'string' }, description: '新记忆标签' }
            },
            required: ['memoryIds', 'name', 'content']
        },
        boundaryNote: '只能融合确实有关联的记忆。融合不可逆。禁止盲目合并无关记忆。'
    },
    {
        name: 'memory_review',
        description: '审查并整理记忆库，返回审查报告（含融合建议和过期建议）。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                focus: { type: 'string', description: '审查重点（如"重复记忆""过期记忆"）' }
            }
        }
    },
    {
        name: 'memory_pin',
        description: '切换记忆的置顶状态。置顶的记忆始终注入到 [系统记忆] 中。',
        category: 'execution',
        riskLevel: 'low',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '记忆 ID' },
                name: { type: 'string', description: '记忆标题（便于识别）' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_stats',
        description: '返回记忆库的轻量级统计概览。比 memory_review 更快，不计算相似度。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'memory_export',
        description: '将记忆库导出为 JSON 字符串，便于备份、迁移或跨设备同步。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                includeDisabled: { type: 'boolean', description: '是否包含已禁用记忆' },
                includePinnedOnly: { type: 'boolean', description: '仅导出置顶记忆' },
                category: { type: 'string', description: '仅导出指定分类' }
            }
        }
    },
    {
        name: 'memory_archive',
        description: '手动触发归档：删除 90 天未访问 + 访问次数 < 3 + 未置顶的记忆。',
        category: 'execution',
        riskLevel: 'high',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        boundaryNote: '与 memory_delete 的区别：archive 按条件批量清理，delete 按 ID 精确删除。归档不可逆。'
    },
    {
        name: 'memory_import_preview',
        description: '将文本解析为记忆候选列表并预览，不实际保存。用于批量导入前预览。',
        category: 'execution',
        riskLevel: 'low',
        isReadOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '待导入的内容（JSON 数组或纯文本）' },
                defaultType: { type: 'string', description: '默认记忆类型' },
                tags: { type: 'array', items: { type: 'string' }, description: '附加标签' }
            },
            required: ['content']
        },
        boundaryNote: '仅预览不保存。收到结果后需对每条记忆调用 memory_save 实际保存。'
    }
];

// ============================================================
// 执行器
// ============================================================

/**
 * 创建记忆工具执行器映射
 * @returns {Object<string, Function>}
 */
export function createMemoryToolExecutors() {
    return {
        memory_save: _executeMemorySave,
        memory_get: _executeMemoryGet,
        memory_update: _executeMemoryUpdate,
        memory_replace: _executeMemoryReplace,
        memory_delete: _executeMemoryDelete,
        memory_clear: _executeMemoryClear,
        memory_search: _executeMemorySearch,
        memory_list: _executeMemoryList,
        memory_recall: _executeMemoryRecall,
        memory_merge: _executeMemoryMerge,
        memory_review: _executeMemoryReview,
        memory_pin: _executeMemoryPin,
        memory_stats: _executeMemoryStats,
        memory_export: _executeMemoryExport,
        memory_archive: _executeMemoryArchive,
        memory_import_preview: _executeMemoryImportPreview
    };
}

// ============================================================
// 执行器实现
// ============================================================

/**
 * 执行 memory_save
 * @param {Object} payload
 * @returns {import('../core/tool-registry.js').ToolResult}
 */
function _executeMemorySave(payload) {
    const validTypes = ['preference', 'context', 'fact', 'instruction'];
    const type = payload.type;
    if (!type || !validTypes.includes(type)) {
        return { ok: false, summary: '记忆格式错误', detail: 'type 必须是 preference/context/fact/instruction' };
    }
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, summary: '记忆格式错误', detail: 'name 必须是非空字符串' };
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) return { ok: false, summary: '记忆格式错误', detail: 'content 必须是非空字符串' };
    const tags = Array.isArray(payload.tags) ? payload.tags.filter(t => typeof t === 'string') : [];

    // 已删除检查
    if (isMemoryDeleted('', name, content)) {
        return { ok: true, skipped: true, summary: '记忆已被用户删除，跳过保存', detail: '此记忆曾被用户删除' };
    }

    // 内容去重
    const dup = findSimilarMemory(name, content, 0.85);
    if (dup) {
        if (dup.matchType === 'exact') {
            return { ok: true, skipped: true, summary: '记忆已存在', detail: `已存在完全相同的记忆"${dup.mem.title}"（id=${dup.mem.id}）` };
        }
        if (tags.length > 0) {
            const existingTags = dup.mem.tags || [];
            const merged = [...new Set([...existingTags, ...tags])];
            if (merged.length !== existingTags.length) {
                updateMemory(dup.mem.id, { tags: merged });
            }
        }
        return { ok: true, skipped: true, summary: '相似记忆已存在', detail: `已存在相似记忆"${dup.mem.title}"（id=${dup.mem.id}）` };
    }

    const mem = addMemory(name, content, type, { tags });
    if (mem) {
        return { ok: true, summary: '已保存记忆', detail: `"${name}" 已添加到长期记忆（id=${mem.id}）` };
    }
    return { ok: false, summary: '保存失败' };
}

function _executeMemoryGet(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, summary: '参数错误', detail: 'id 必须是非空字符串' };
    const mem = getMemoryById(id);
    if (!mem) return { ok: false, summary: '记忆不存在', detail: '未找到 id=' + id + ' 的记忆' };

    const formatDate = (ts) => {
        if (!ts) return '未知';
        try { const d = new Date(ts); if (isNaN(d.getTime())) return '未知'; return d.toISOString().slice(0, 16).replace('T', ' '); } catch (e) { return '未知'; }
    };
    const history = Array.isArray(mem.history) ? mem.history.slice().sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0)) : [];
    const lines = [
        '## 记忆详情',
        `- ID: ${mem.id}`, `- 标题: ${mem.title}`, `- 分类: ${mem.category || 'preference'}`,
        `- 内容: ${mem.content}`, `- 标签: ${(mem.tags || []).join(', ') || '（无）'}`,
        `- 置顶: ${mem.pinned ? '是' : '否'}`, `- 访问次数: ${mem.accessCount || 0}`,
        `- 创建: ${formatDate(mem.createdAt)}`, `- 更新: ${formatDate(mem.updatedAt)}`
    ];
    if (history.length > 0) {
        lines.push('', `### 历史版本（${history.length} 条）`);
        history.forEach((h, i) => {
            lines.push(`${i + 1}. [${formatDate(h?.timestamp)}] ${h?.title || ''}: ${(h?.content || '').slice(0, 80)}${(h?.content || '').length > 80 ? '...' : ''}`);
        });
    }
    return { ok: true, summary: '记忆详情', detail: lines.join('\n') };
}

function _executeMemoryUpdate(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, summary: '记忆格式错误', detail: 'id 必须是非空字符串' };
    const updates = {};
    if (typeof payload.type === 'string') {
        if (!['preference', 'context', 'fact', 'instruction'].includes(payload.type)) {
            return { ok: false, summary: '记忆格式错误', detail: 'type 无效' };
        }
        updates.category = payload.type;
    }
    if (typeof payload.name === 'string' && payload.name.trim()) updates.title = payload.name.trim();
    if (typeof payload.content === 'string' && payload.content.trim()) updates.content = payload.content.trim();
    if (Array.isArray(payload.tags)) updates.tags = payload.tags.filter(t => typeof t === 'string');
    const updated = updateMemory(id, updates);
    if (updated) return { ok: true, summary: '已更新记忆', detail: `"${updated.title}" 已更新` };
    return { ok: false, summary: '更新失败', detail: `未找到 ID 为 ${id} 的记忆` };
}

function _executeMemoryReplace(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, summary: '参数错误', detail: 'id 必须是非空字符串' };
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) return { ok: false, summary: '参数错误', detail: 'content 必须是非空字符串' };
    const mem = replaceMemory(id, content, { title: payload.title, tags: payload.tags, reason: payload.reason });
    if (!mem) return { ok: false, summary: '替换失败', detail: '未找到 id=' + id + ' 的记忆' };
    return { ok: true, summary: '已覆盖更新记忆', detail: `记忆"${mem.title}"已更新，旧内容已存入历史` };
}

function _executeMemoryDelete(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, summary: '记忆格式错误', detail: 'id 必须是非空字符串' };
    if (deleteMemory(id)) return { ok: true, summary: '已删除记忆', detail: `记忆 ${id} 已删除` };
    return { ok: false, summary: '删除失败', detail: `未找到 ID 为 ${id} 的记忆` };
}

function _executeMemoryClear(payload) {
    const scope = typeof payload.scope === 'string' ? payload.scope.trim() : '';
    if (!['global', 'project', 'all'].includes(scope)) {
        return { ok: false, summary: '参数错误', detail: 'scope 必须是 global/project/all' };
    }
    if (payload.confirm !== true) return { ok: false, summary: '需要确认', detail: '请添加 "confirm":true 确认清空' };
    const result = clearMemoriesByScope(scope, { includePinned: payload.includePinned === true, confirm: true });
    if (result && result.ok) {
        return { ok: true, summary: `已清空 ${result.deletedCount} 条记忆`, detail: `已删除 ${result.deletedCount} 条，保留 ${result.retainedPinnedCount} 条置顶记忆` };
    }
    return { ok: false, summary: '清空失败', detail: (result && result.reason) || '未知原因' };
}

function _executeMemorySearch(payload) {
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) return { ok: false, summary: '搜索参数错误', detail: 'query 不能为空' };
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 10, 1), 50);
    const threshold = Math.min(Math.max(Number(payload.threshold) || 0, 0), 1);
    const category = typeof payload.category === 'string' ? payload.category.trim() : '';

    const all = getMemories().filter(m => m.enabled !== false);
    if (all.length === 0) return { ok: true, summary: '记忆库为空', detail: '当前没有任何记忆' };

    const qLower = query.toLowerCase();
    const results = [];
    for (const mem of all) {
        if (category && (mem.category || 'preference') !== category) continue;
        let score = 0, matchType = 'none';
        if (threshold > 0) {
            const titleSim = _bigramSimilarity(mem.title || '', query);
            const contentSim = _bigramSimilarity(mem.content || '', query);
            score = titleSim * 0.3 + contentSim * 0.7;
            if (score >= threshold) matchType = 'similar';
        } else {
            const title = (mem.title || '').toLowerCase();
            const content = (mem.content || '').toLowerCase();
            const tags = (mem.tags || []).join(' ').toLowerCase();
            if (title.includes(qLower)) { score = 0.9; matchType = 'title'; }
            else if (content.includes(qLower)) { score = 0.6; matchType = 'content'; }
            else if (tags.includes(qLower)) { score = 0.5; matchType = 'tags'; }
        }
        if (matchType !== 'none') results.push({ mem, score, matchType });
    }

    if (results.length === 0) {
        return { ok: true, summary: `未找到与"${query}"相关的记忆`, detail: `搜索了 ${all.length} 条记忆，没有匹配结果` };
    }
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);
    const lines = [`找到 ${results.length} 条相关记忆（显示前 ${top.length} 条）：`];
    top.forEach((r, i) => {
        const m = r.mem;
        lines.push(`${i + 1}. (id:${m.id}) [${m.category || 'preference'}] ${m.title}`);
        lines.push(`   内容: ${m.content}`);
        if (m.tags?.length) lines.push(`   标签: ${m.tags.join(', ')}`);
    });
    return { ok: true, summary: `找到 ${results.length} 条相关记忆`, detail: lines.join('\n') };
}

function _executeMemoryList(payload) {
    const category = typeof payload.category === 'string' ? payload.category.trim() : '';
    const tag = typeof payload.tag === 'string' ? payload.tag.trim() : '';
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(payload.offset, 10) || 0, 0);
    let all = getMemories();
    if (!payload.includeDisabled) all = all.filter(m => m.enabled !== false);
    if (category) all = all.filter(m => (m.category || 'preference') === category);
    if (tag) all = all.filter(m => m.tags?.some(t => t.toLowerCase() === tag.toLowerCase()));
    if (all.length === 0) return { ok: true, summary: '记忆列表为空', detail: '没有符合条件的记忆' };
    const page = all.slice(offset, offset + limit);
    const lines = [`记忆列表（总计 ${all.length} 条）：`];
    page.forEach((m, i) => {
        const pin = m.pinned ? '★' : ' ';
        lines.push(`${offset + i + 1}. ${pin} (id:${m.id}) [${m.category || 'preference'}] ${m.title}`);
    });
    return { ok: true, summary: `共 ${all.length} 条记忆`, detail: lines.join('\n') };
}

function _executeMemoryRecall(payload) {
    const memoryIds = Array.isArray(payload.memoryIds) ? payload.memoryIds.filter(id => typeof id === 'string' && id.trim()) : [];
    if (memoryIds.length === 0) return { ok: false, summary: '记忆格式错误', detail: 'memoryIds 必须是非空数组' };
    const validIds = memoryIds.filter(id => findMemoryById(id));
    if (validIds.length === 0) return { ok: false, summary: '调用报告失败', detail: '所有 memoryIds 均无效' };
    touchMemories(validIds);
    return { ok: true, summary: `已报告调用 ${validIds.length} 条记忆` };
}

function _executeMemoryMerge(payload) {
    const memoryIds = (Array.isArray(payload.memoryIds) ? payload.memoryIds : []).map(id => typeof id === 'string' ? id.trim() : '').filter(Boolean);
    if (memoryIds.length < 2) return { ok: false, summary: '记忆格式错误', detail: 'memoryIds 至少需要 2 条记忆' };
    const result = mergeMemories(memoryIds, { name: payload.name, content: payload.content, type: payload.type, tags: payload.tags });
    if (result.ok) {
        return { ok: true, summary: `已融合 ${result.deletedCount} 条记忆`, detail: `新记忆"${result.newMemory.title}"(id=${result.newMemory.id}) 已创建` };
    }
    return { ok: false, summary: '融合失败', detail: result.reason || '未知原因' };
}

function _executeMemoryReview(payload) {
    const all = getMemories();
    if (all.length === 0) return { ok: true, summary: '审查完成：记忆库为空', detail: '当前没有任何记忆' };
    const stats = { total: all.length, byCategory: {}, pinnedCount: 0, disabledCount: 0 };
    let totalAccess = 0;
    for (const mem of all) {
        stats.byCategory[mem.category || 'preference'] = (stats.byCategory[mem.category || 'preference'] || 0) + 1;
        totalAccess += (mem.accessCount || 0);
        if (mem.pinned) stats.pinnedCount++;
        if (mem.enabled === false) stats.disabledCount++;
    }
    const mergeSuggestions = [];
    for (let i = 0; i < all.length && mergeSuggestions.length < 10; i++) {
        for (let j = i + 1; j < all.length; j++) {
            const sim = _computeSimilarity(all[i], all[j]);
            if (sim.score >= 0.6) mergeSuggestions.push({ ids: [all[i].id, all[j].id], titles: [all[i].title, all[j].title], similarity: sim.score.toFixed(2), reason: sim.reason });
        }
    }
    const now = Date.now();
    const deleteSuggestions = all.filter(m => !m.pinned && m.enabled !== false && (m.lastAccessedAt || 0) < now - 90 * 86400000 && (m.accessCount || 0) < 3)
        .sort((a, b) => (b.lastAccessedAt || 0) - (a.lastAccessedAt || 0)).slice(0, 10);
    const lines = [
        `## 记忆库审查报告`, '', `### 统计摘要`,
        `- 记忆总数：${stats.total} 条`, `- 分类：${Object.entries(stats.byCategory).map(([k, v]) => `${k}=${v}`).join('、')}`,
        `- 置顶：${stats.pinnedCount} 条`, `- 禁用：${stats.disabledCount} 条`,
        '', `### 建议融合（${mergeSuggestions.length} 组）`,
        ...mergeSuggestions.map((s, i) => `${i + 1}. [相似度 ${s.similarity}] "${s.titles[0]}" + "${s.titles[1]}"（${s.reason}）\n   IDs: ${s.ids.join(', ')}`),
        '', `### 建议删除（${deleteSuggestions.length} 条）`,
        ...deleteSuggestions.map((s, i) => `${i + 1}. "${s.title}"（${Math.floor((now - (s.lastAccessedAt || 0)) / 86400000)} 天未访问）\n   ID: ${s.id}`)
    ];
    return { ok: true, summary: `审查完成：${stats.total} 条记忆，${mergeSuggestions.length} 组建议融合`, detail: lines.join('\n') };
}

function _executeMemoryPin(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, summary: '参数错误', detail: 'id 不能为空' };
    const mem = findMemoryById(id);
    if (!mem) return { ok: false, summary: '记忆不存在', detail: `未找到 id=${id} 的记忆` };
    const newPinned = togglePinMemory(id);
    if (newPinned === null) return { ok: false, summary: '置顶失败' };
    return { ok: true, summary: newPinned ? '已置顶' : '已取消置顶', detail: `记忆"${mem.title}"${newPinned ? '已设为置顶' : '已取消置顶'}` };
}

function _executeMemoryStats() {
    const all = getMemories();
    if (all.length === 0) return { ok: true, summary: '记忆库为空' };
    const stats = { total: all.length, pinnedCount: 0, disabledCount: 0, totalAccessCount: 0 };
    const tagSet = new Set();
    for (const mem of all) {
        if (mem.pinned) stats.pinnedCount++;
        if (mem.enabled === false) stats.disabledCount++;
        stats.totalAccessCount += (mem.accessCount || 0);
        if (mem.tags) for (const t of mem.tags) if (t.trim()) tagSet.add(t.trim());
    }
    return { ok: true, summary: `${stats.total} 条记忆，${stats.pinnedCount} 置顶，${tagSet.size} 标签`, detail: `记忆总数：${stats.total}，置顶：${stats.pinnedCount}，标签：${tagSet.size}，累计访问：${stats.totalAccessCount}` };
}

function _executeMemoryExport(payload) {
    const result = exportMemories({
        includeDisabled: payload.includeDisabled !== false,
        includePinnedOnly: payload.includePinnedOnly === true,
        category: typeof payload.category === 'string' ? payload.category.trim() : ''
    });
    if (!result.ok) return { ok: false, summary: '导出失败' };
    return { ok: true, summary: `已导出 ${result.count} 条记忆`, detail: result.json };
}

function _executeMemoryArchive() {
    const before = getMemories().length;
    const archived = archiveStaleMemories();
    const after = getMemories().length;
    if (archived === 0) return { ok: true, summary: '无需归档', detail: '没有符合条件的过期记忆' };
    return { ok: true, summary: `已归档 ${archived} 条过期记忆`, detail: `归档前 ${before} 条 → 归档后 ${after} 条` };
}

function _executeMemoryImportPreview(payload) {
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (!content.trim()) return { ok: false, summary: '记忆格式错误', detail: 'content 必须是非空字符串' };
    try {
        const result = previewMemoryImport({ content, defaultType: payload.defaultType, tags: payload.tags });
        const titleList = result.memories.slice(0, 20).map((m, i) => `${i + 1}. [${m.category}] ${m.title}`).join('\n');
        return { ok: true, summary: `预览就绪：${result.memories.length} 条可导入`, detail: `可导入 ${result.memories.length} 条，重复 ${result.duplicates} 条，拒绝 ${result.rejected} 条\n${titleList}` };
    } catch (e) {
        return { ok: false, summary: '预览失败', detail: e?.message || String(e) };
    }
}

// ============================================================
// 辅助函数
// ============================================================

function _bigramSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const sa = new Set(); for (let i = 0; i < a.length - 1; i++) sa.add(a.slice(i, i + 2));
    const sb = new Set(); for (let i = 0; i < b.length - 1; i++) sb.add(b.slice(i, i + 2));
    if (sa.size === 0 || sb.size === 0) return 0;
    let intersect = 0; for (const g of sa) if (sb.has(g)) intersect++;
    return intersect / (sa.size + sb.size - intersect);
}

function _computeSimilarity(a, b) {
    if (a.title === b.title) return { score: 1.0, reason: '标题完全相同' };
    if (a.content === b.content) return { score: 0.95, reason: '内容完全相同' };
    if (a.title.length > 3 && b.title.length > 3 && (a.title.includes(b.title) || b.title.includes(a.title))) {
        return { score: 0.85, reason: '标题包含关系' };
    }
    const tagsA = new Set((a.tags || []).map(t => String(t).toLowerCase()));
    const tagsB = new Set((b.tags || []).map(t => String(t).toLowerCase()));
    let overlap = 0; for (const t of tagsA) if (tagsB.has(t)) overlap++;
    if (overlap > 0 && tagsA.size > 0 && tagsB.size > 0) {
        const tagSim = (2 * overlap) / (tagsA.size + tagsB.size);
        if (tagSim >= 0.5) return { score: 0.6 + tagSim * 0.2, reason: `标签重叠 ${overlap} 个` };
    }
    const contentSim = _bigramSimilarity(a.content || '', b.content || '');
    if (contentSim >= 0.6) return { score: contentSim, reason: `内容相似度 ${contentSim.toFixed(2)}` };
    return { score: 0, reason: '' };
}