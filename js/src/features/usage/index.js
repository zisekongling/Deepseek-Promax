/**
 * Usage 模块统一入口（v2，移植自 deepseek-pp/core/usage/）
 *
 * 架构说明：
 *   - 本模块是 v2 实现，数据层已完整移植（types/stats/store）
 *   - 旧 usage-stats.js 仍作为 UI 渲染层运行（含 500+ 行渲染代码，重写成本高）
 *   - token-speed.js 的 onStreamEnd 同时调用两个模块的 recordUsage（双写）
 *     - 旧模块：同步写入 ds_usage_records（供 UI 渲染）
 *     - 新模块：异步写入 deepseek_pp_usage_turns_v1（供未来迁移）
 *   - 未来切换时：把 UI 渲染层的数据源从旧 key 改为新 key 即可
 *
 * 对外暴露类型常量、统计函数、存储 API。
 */

export * from './types.js';
export * from './stats.js';
export * from './store.js';
