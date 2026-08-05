/**
 * 能力代理（Capability Agent）— 工具调用结果回传给 DeepSeek
 *
 * 参考 deepseek-pp/core/inline-agent/loop.ts 和 prompt.ts 的实现：
 *   1. 监听 AI 回复完成（流式输出结束）
 *   2. 检测回复中是否包含工具调用 XML（<memory_save> 等）
 *   3. 执行工具调用，收集结果
 *   4. 构建"续跑 prompt"（包含 <original_task> + <tool_results>）
 *   5. 将续跑 prompt 作为新的用户消息发送给 DeepSeek
 *   6. AI 看到工具结果后继续对话，形成 Agent 循环
 *
 * 与 deepseek-pp 的差异：
 *   - deepseek-pp 通过官方 API（submitPromptStreaming）发送续跑请求
 *   - 本模块通过模拟用户输入 + 点击发送按钮实现（油猴脚本限制）
 *   - 复用 loop-engine.js 的 injectText / getSendBtn 逻辑（轻量版，不引入完整循环引擎）
 *
 * 防循环保护：
 *   - 安全上限：50 次（避免无限循环，正常情况下由 AI 调用 agent_finish 结束）
 *   - 续跑 prompt 中明确告知 AI"任务完成后调用 agent_finish 结束循环"
 *   - AI 调用 agent_finish 工具时立即终止续跑
 *
 * 触发机制：
 *   - text-process.js 的 scanToolCallElements 执行工具调用后，
 *     通过 window._dsOnToolCallExecuted 回调通知本模块
 *   - 本模块等待 AI 回复完成（停止按钮消失），然后发送续跑 prompt
 *
 * 模块分区（已拆分到 ./capability-agent/ 子目录）：
 *   1. 状态存储与持久化  - state / sessionStorage / 常量 / sleep → state-store.js
 *   2. MCP 结果归一化    - normalizeToolResult → result-normalizer.js
 *   3. 续跑 Prompt 构建  - buildContinuationPrompt / clampText → prompt-builder.js
 *   4. 输入框 DOM 操作   - injectText / getSendBtn / getStopBtn → input-dom.js
 *   5. Agent UI 组件     - lockInput / showStopButton / 徽章样式 → agent-ui.js
 *   6. ask_user 协调     - _waitForAskUserAnswers / _formatAskUserAnswers → ask-user-coordinator.js
 *   7. 主流程与初始化     - onToolCallExecuted / _flushPendingToolResults / initCapabilityAgent → index.js
 *
 * 本文件保留为对外公共 API 的薄入口（向后兼容），
 * 所有 `import { ... } from './capability-agent.js'` 无需修改。
 */

export * from './capability-agent/index.js';
