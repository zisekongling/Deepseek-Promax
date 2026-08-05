/**
 * @file 宠物状态台词库
 *
 * 按状态分组的中 文台词池，支持随机选取与避免连续重复。
 *
 * 状态枚举（与 pet.js 的状态联动一一对应）：
 *   - idle          空闲：等待用户操作
 *   - thinking      思考中：DeepSeek 请求已发出，等待首字
 *   - outputting    输出中：流式 chunk 正在到达
 *   - tool_running  工具运行：capability-register 正在执行工具调用
 *   - success       成功：回复完成（短暂状态）
 *   - error         出错：请求失败或异常（短暂状态）
 *
 * 长时间停留某状态时由 pet.js 定时调用 getLine 轮播台词：
 *   idle 30s，thinking 15s，outputting 20s，tool_running 20s
 *   success / error 为短暂状态，不轮播
 */

/**
 * 宠物状态枚举
 * @enum {string}
 */
export const PET_STATES = {
    IDLE: 'idle',
    THINKING: 'thinking',
    OUTPUTTING: 'outputting',
    TOOL_RUNNING: 'tool_running',
    SUCCESS: 'success',
    ERROR: 'error'
};

/**
 * 各状态中文台词汇（每状态多条候选，随机轮播）
 * @type {Object<string, string[]>}
 */
const LINES = {
    idle: [
        '嬉戏中～',
        '戳一戳我嘛',
        '放空中…',
        '游来游去',
        '咕噜咕噜',
        '今天聊点什么呢'
    ],
    thinking: [
        '沉思中…',
        '推敲中…',
        '反复琢磨',
        '让我想想…',
        '脑力激荡中',
        '整理思路…'
    ],
    outputting: [
        '阐释中',
        '徐徐展开',
        '灵感涌现',
        '奋笔疾书',
        '文字流淌中',
        '慢慢道来～'
    ],
    tool_running: [
        '翻箱倒柜中',
        '调用工具ing',
        '执行任务…',
        '搬运数据',
        '齿轮转动中',
        '施展能力～'
    ],
    success: [
        '大功告成！',
        '搞定～',
        '收工！',
        '完美收尾',
        '万事 OK'
    ],
    error: [
        '卡壳了…',
        '出岔子了',
        '系统打嗝',
        '哎呀出错了',
        '再来一次？'
    ]
};

/**
 * 各状态台词轮播间隔（毫秒），0 表示不轮播（短暂状态）
 * @type {Object<string, number>}
 */
const ROTATE_INTERVALS = {
    idle: 30000,
    thinking: 15000,
    outputting: 20000,
    tool_running: 20000,
    success: 0,
    error: 0
};

/**
 * 获取指定状态的台词轮播间隔
 * @param {string} state - 状态枚举值
 * @returns {number} 间隔毫秒，0 表示该状态不轮播
 */
export function getRotateInterval(state) {
    return ROTATE_INTERVALS[state] || 0;
}

/**
 * 从指定状态的台词池中随机选取一条，尽量避免与 lastLine 重复
 * 当池中只有一条或全部与 lastLine 相同时，返回池中任意一条
 * @param {string} state - 状态枚举值
 * @param {string} [lastLine] - 上一次显示的台词，用于避免连续重复
 * @returns {string} 台词文本；无候选返回空字符串
 */
export function getLine(state, lastLine) {
    const pool = LINES[state];
    if (!pool || pool.length === 0) return '';
    if (pool.length === 1) return pool[0];
    // 优先选不等于 lastLine 的候选
    let candidates = lastLine ? pool.filter(l => l !== lastLine) : pool;
    if (candidates.length === 0) candidates = pool;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * 获取指定状态的全部候选台词（供调试或 UI 展示）
 * @param {string} state - 状态枚举值
 * @returns {string[]} 台词数组副本
 */
export function getLinesForState(state) {
    const pool = LINES[state];
    return pool ? pool.slice() : [];
}
