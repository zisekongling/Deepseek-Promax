/**
 * Usage 模块类型定义（移植自 deepseek-pp/core/usage/types.ts）
 *
 * 定义 token 用量记录的数据模型与聚合结果类型。
 * 本文件仅含类型常量与 JSDoc typedef，无运行时代码。
 */

/** 统计范围（天数） */
export const USAGE_RANGE_DAYS_7 = 7;
export const USAGE_RANGE_DAYS_30 = 30;

/** 用量记录来源 */
export const USAGE_SOURCE_DEEPSEEK_WEB = 'deepseek-web';
export const USAGE_SOURCE_SIDEPANEL_WEB = 'sidepanel-web';
export const USAGE_SOURCE_SIDEPANEL_API = 'sidepanel-api';

/** token 度量来源 */
export const TOKEN_METRIC_SOURCE_SERVER = 'server';    // 服务端返回的精确值
export const TOKEN_METRIC_SOURCE_ESTIMATED = 'estimated'; // 前端估算值

/** 最大记录数（超出自动裁剪最旧的） */
export const MAX_RECORDS = 5000;

/** 保留天数（超过 180 天的自动删除） */
export const RETENTION_DAYS = 180;

/**
 * @typedef {Object} UsageTurnInput
 * @property {string} id - 唯一标识（通常用 assistantMessageId 或时间戳）
 * @property {number} [recordedAt] - 记录时间戳（默认 Date.now()）
 * @property {string} source - 来源：'deepseek-web' | 'sidepanel-web' | 'sidepanel-api'
 * @property {string|null} [chatSessionId] - 会话 id
 * @property {number|null} [assistantMessageId] - AI 消息 id
 * @property {string|null} [modelType] - 模型类型（deepseek-chat/deepseek-reasoner）
 * @property {number} totalTokens - 总 token 数
 * @property {'server'|'estimated'} tokenSource - token 来源
 * @property {number} tps - tokens per second
 * @property {'server'|'estimated'} speedSource - 速度来源
 * @property {number} elapsedMs - 耗时（毫秒）
 * @property {number} [messageCount] - 消息数（默认 2：一问一答）
 */

/**
 * @typedef {Object} UsageTurnRecord
 * @property {string} id
 * @property {number} recordedAt
 * @property {string} day - 'YYYY-MM-DD' 本地时区
 * @property {string} source
 * @property {string|null} chatSessionId
 * @property {number|null} assistantMessageId
 * @property {string|null} modelType
 * @property {number} totalTokens
 * @property {'server'|'estimated'} tokenSource
 * @property {number} tps
 * @property {'server'|'estimated'} speedSource
 * @property {number} elapsedMs
 * @property {number} messageCount
 */

/**
 * @typedef {Object} UsageDailySummary
 * @property {string} day - 'YYYY-MM-DD'
 * @property {number} totalTokens
 * @property {number} turnCount
 * @property {number} messageCount
 */

/**
 * @typedef {Object} UsageHeatmapCell
 * @property {string} day - 'YYYY-MM-DD'
 * @property {number} level - 0-5（0=无用量，5=最高）
 * @property {number} totalTokens
 */

/**
 * @typedef {Object} UsageModelSummary
 * @property {string} modelKey - 归一化的模型 key
 * @property {string} modelLabel - 显示标签
 * @property {number} totalTokens
 * @property {number} turnCount
 * @property {number} share - 占比（0-1）
 */

/**
 * @typedef {Object} UsageSummary
 * @property {number} totalTokens
 * @property {number} sessionCount
 * @property {number} messageCount
 * @property {number} turnCount
 * @property {number} activeDays
 * @property {number} currentStreak - 连续活跃天数
 * @property {number} serverTokenRecordCount - 服务端返回的精确记录数
 * @property {UsageModelSummary|null} mostUsedModel
 * @property {UsageDailySummary[]} days
 * @property {UsageHeatmapCell[]} heatmap
 * @property {UsageModelSummary[]} modelUsage
 */
