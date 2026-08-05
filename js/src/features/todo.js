/**
 * TodoManager 模块 — 会话级任务进度跟踪
 *
 * 对标 Claude Code 的 TodoWrite 工具，为 DeepSeek 浏览器脚本提供
 * 会话内的 todo 清单管理能力（内存态，不持久化）。
 *
 * 核心能力：
 *   1. write(payload)  — 全量替换当前 todo 清单（含严格校验）
 *   2. read()          — 读取当前清单状态并渲染为纯文本
 *   3. clear()         — 清空清单
 *   4. reset()         — 重置状态（新对话时调用）
 *   5. renderTodos()   — 将清单渲染为带进度条的纯文本
 *
 * 设计约束：
 *   - 仅内存态，不使用 localStorage / sessionStorage
 *   - 独立运行，不导入其他模块
 *   - 通过 initTodoManager() 在 window 上注册接口供
 *     capability-register.js / capability-agent.js 调用
 *
 * 状态规则：
 *   - 同一时间最多 1 个 'in_progress'（与 Claude Code TodoWrite 一致）
 *   - 最多 20 条 todo
 *   - 状态：pending(○) / in_progress(▶) / completed(✓)
 *   - 优先级：high(高) / medium(中) / low(低)
 */

// ============================================================
// 模块状态
// ============================================================

/**
 * 模块内部状态（内存态，不持久化）
 * @type {{ todos: Array<{id:string,content:string,status:string,priority:string}>, maxItems: number }}
 */
const state = {
    todos: [],
    maxItems: 20
};

// ============================================================
// 枚举与标签常量
// ============================================================

/** 合法状态枚举 */
const STATUSES = ['pending', 'in_progress', 'completed'];

/** 合法优先级枚举 */
const PRIORITIES = ['high', 'medium', 'low'];

/** 状态图标映射（pending=○ / in_progress=▶ / completed=✓） */
const STATUS_ICONS = { pending: '○', in_progress: '▶', completed: '✓' };

/** 优先级中文标签映射 */
const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };

// ============================================================
// 核心函数
// ============================================================

/**
 * 全量替换当前 todo 清单
 *
 * 校验规则：
 *   1. todos 必须是数组
 *   2. length <= state.maxItems (20)
 *   3. 每条 todo 的 content 非空
 *   4. status 在 STATUSES 中（默认 'pending'）
 *   5. priority 在 PRIORITIES 中（默认 'medium'）
 *   6. 同一时间最多 1 个 'in_progress'
 *
 * 校验失败时返回 { ok: false, summary, detail }，不更新 state.todos；
 * 校验成功时对每条 todo 补全默认值，深拷贝后赋给 state.todos。
 *
 * @param {Object} payload - { todos: Array<{id, content, status, priority}> }
 * @returns {{ ok: boolean, summary: string, detail: string }}
 */
function write(payload) {
    const todos = payload && payload.todos;

    // 1. todos 必须是数组
    if (!Array.isArray(todos)) {
        return { ok: false, summary: '参数错误', detail: 'todos 必须是数组' };
    }

    // 2. 数量上限校验
    if (todos.length > state.maxItems) {
        return {
            ok: false,
            summary: '清单过长',
            detail: '最多 20 条 todo，当前 ' + todos.length + ' 条。请合并或删除部分任务。'
        };
    }

    // 3-5. 逐条校验 content / status / priority，并补全默认值
    let inProgressCount = 0;
    const validated = [];

    for (let i = 0; i < todos.length; i++) {
        const t = todos[i];

        // 3. content 非空
        if (!t || t.content == null || String(t.content).trim() === '') {
            return {
                ok: false,
                summary: '内容为空',
                detail: '第 ' + (i + 1) + ' 条 todo 的 content 不能为空'
            };
        }

        // 4. status 校验（缺省默认 'pending'）
        let status = t.status;
        if (status === undefined || status === null) {
            status = 'pending';
        } else if (!STATUSES.includes(status)) {
            return {
                ok: false,
                summary: '状态非法',
                detail: 'status 必须是 pending/in_progress/completed，收到 ' + status
            };
        }

        // 5. priority 校验（缺省默认 'medium'）
        let priority = t.priority;
        if (priority === undefined || priority === null) {
            priority = 'medium';
        } else if (!PRIORITIES.includes(priority)) {
            return {
                ok: false,
                summary: '优先级非法',
                detail: 'priority 必须是 high/medium/low，收到 ' + priority
            };
        }

        if (status === 'in_progress') inProgressCount++;

        // 补全默认值：id 缺省时使用字符串索引 "1"/"2"...
        validated.push({
            id: (t.id !== undefined && t.id !== null) ? t.id : String(i + 1),
            content: t.content,
            status: status,
            priority: priority
        });
    }

    // 6. 同一时间最多 1 个 'in_progress'
    if (inProgressCount > 1) {
        return {
            ok: false,
            summary: '状态冲突',
            detail: '同一时间只能有 1 个 in_progress，当前 ' + inProgressCount + ' 个'
        };
    }

    // 校验通过：深拷贝后写入 state
    state.todos = JSON.parse(JSON.stringify(validated));

    return {
        ok: true,
        summary: `已更新任务清单（${state.todos.length} 项，${inProgressCount} 项进行中）`,
        detail: renderTodos()
    };
}

/**
 * 读取当前 todo 清单状态
 *
 * 空清单时给出引导提示；非空时返回渲染后的清单文本。
 *
 * @returns {{ ok: boolean, summary: string, detail: string }}
 */
function read() {
    if (state.todos.length === 0) {
        return {
            ok: true,
            summary: '清单为空',
            detail: '尚未创建任何 todo。如果任务包含多步，建议先调用 todo_write 拆解任务。'
        };
    }
    return {
        ok: true,
        summary: `当前清单（${state.todos.length} 项）`,
        detail: renderTodos()
    };
}

/**
 * 清空 todo 清单
 *
 * 仅清空内存态数据，不涉及持久化。
 *
 * @returns {{ ok: boolean, summary: string, detail: string }}
 */
function clear() {
    const count = state.todos.length;
    state.todos = [];
    return {
        ok: true,
        summary: '已清空任务清单',
        detail: `原 ${count} 项已全部移除。`
    };
}

/**
 * 渲染 todo 清单为纯文本
 *
 * 输出格式：
 *   - 标题行：## 任务清单（已完成/总数 已完成）
 *   - 每行：  {图标} [{优先级}] #{id} {content}
 *   - 进度行：进度: {20格进度条} {percent}%
 *
 * 进度条使用 █（填充）和 ░（空白），共 20 格。
 *
 * @returns {string}
 */
function renderTodos() {
    if (state.todos.length === 0) return '（清单为空）';

    const completed = state.todos.filter(t => t.status === 'completed').length;
    const total = state.todos.length;
    const percent = Math.round(completed / total * 100);

    // 进度条：20 格
    const filled = Math.round(percent / 100 * 20);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

    const lines = state.todos.map(t => {
        const icon = STATUS_ICONS[t.status] || '○';
        const pri = `[${PRIORITY_LABELS[t.priority] || '中'}]`;
        return `${icon} ${pri} #${t.id} ${t.content}`;
    });

    return [
        `## 任务清单（${completed}/${total} 已完成）`,
        '',
        ...lines,
        '',
        `进度: ${bar} ${percent}%`
    ].join('\n');
}

/**
 * 重置 todo 状态（新对话时调用）
 *
 * 清空内存态清单，不返回任何内容。供会话切换 / 新对话场景使用。
 */
function reset() {
    state.todos = [];
}

// ============================================================
// 模块初始化与对外接口注册
// ============================================================

/**
 * 初始化 TodoManager 模块
 *
 * 在 window 上注册接口供 capability-register.js 调用：
 *   - window._dsTodoWrite        全量写入清单
 *   - window._dsTodoRead         读取清单
 *   - window._dsTodoClear        清空清单
 *   - window._dsTodoReset        重置状态
 *   - window._dsGetTodoCount      获取清单总数（供 capability-agent.js 同步查询）
 *   - window._dsGetTodoPendingCount  获取未完成数量
 *   - window._dsGetTodos          获取清单副本
 *
 * 在非浏览器环境（typeof window === 'undefined'）下直接返回，不做任何注册。
 */
export function initTodoManager() {
    if (typeof window === 'undefined') return;
    window._dsTodoWrite = write;
    window._dsTodoRead = read;
    window._dsTodoClear = clear;
    window._dsTodoReset = reset;
    // 供 capability-agent.js 同步查询（不返回 detail，仅状态）
    window._dsGetTodoCount = () => state.todos.length;
    window._dsGetTodoPendingCount = () => state.todos.filter(t => t.status !== 'completed').length;
    window._dsGetTodos = () => state.todos.slice();  // 返回副本
}
