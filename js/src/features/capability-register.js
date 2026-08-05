/**
 * 能力注册模块（Capability Register）
 *
 * 核心功能：
 *   1. 在每次对话请求前注入 [能力] 包裹的能力说明提示词，
 *      教会 DeepSeek 如何调用脚本提供的新能力（记忆系统、工具调用格式）
 *      提示词参考 deepseek-pp/core/i18n/resources/zh-CN.ts:1305 的 systemChat
 *   2. 提供 window._dsCapabilityInjector() 回调，供 fetch-hub / anti-recall 调用
 *   3. 提供 executeToolCall(name, payload) 执行器，解析并执行 <memory_save> 等工具调用
 *   4. 工具调用结果通过 toast 反馈给用户
 *
 * 工具调用协议（参考 deepseek-pp/core/tool/memory.ts）：
 *   <memory_save>
 *   {"type": "preference", "name": "标题", "content": "内容", "tags": ["标签"]}
 *   </memory_save>
 *
 *   <memory_delete>
 *   {"id": "mem-123"}
 *   </memory_delete>
 *
 * 注入方式：与 [系统指令] / [系统记忆] 一致，使用 [能力]...[/能力] 包裹，
 *   由 text-process.js 的 cleanPromptInjection 统一清理显示
 */
import { CONFIG as _CONFIG_SNAPSHOT, IS_ELECTRON } from '../config.js';
import { addMemory, updateMemory, deleteMemory, getMemories, findSimilarMemory, findMemoryById, isMemoryDeleted, previewMemoryImport, mergeMemories, touchMemories, togglePinMemory, archiveStaleMemories, exportMemories, getMemoryById, clearMemoriesByScope, replaceMemory } from './memory.js';
import { initTodoManager } from './todo.js';
import { initAskUserManager } from './ask-user.js';
import { createXmlToolCallRegex, getPreferredToolInvocationName, getDefaultRegistry, DEFAULT_TOOL_DESCRIPTORS, renderToolSchemas } from './tool-descriptors.js';
import { executeSkillCreatorToolCall } from './skill/skill-creator-tool.js';

/**
 * 安全获取最新的 CONFIG 引用
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

/** 模块是否已安装 */
let installed = false;

/**
 * 默认工具注册中心单例（从 tool-descriptors.js 获取）
 *
 * registry 是工具的单一数据源：描述符、执行器、元选项（requireAgentFeedback/category）。
 * 22 个内置工具在模块初始化时由 _registerBuiltinTools 注册，
 * 动态工具（web/python/MCP）在 initCapabilityRegister 时按 CONFIG 开关注册。
 */
const registry = getDefaultRegistry();

/**
 * 已知工具名集合（用于 text-process.js 的 XML 识别与隐藏）
 *
 * 向后兼容：保持为数组引用，在模块初始化时通过 splice 填充（_registerBuiltinTools），
 * register/unregister 动态工具时也 splice 同步。
 *
 * 消费方：
 *   - history-cleanup.js: `import { TOOL_NAMES }` → 模块加载时构建 TOOL_CALL_XML_RE 正则
 *   - streaming-tool-parser.js: `import { TOOL_NAMES }` → 运行时 fallback
 *   - text-process.js: `window._dsToolNames`（initCapabilityRegister 时赋同一引用）
 *
 * 因此必须在模块顶层（而非 initCapabilityRegister）就填充好，
 * 否则 history-cleanup.js 的正则会在空数组上构建。
 *
 * @type {string[]}
 */
export const TOOL_NAMES = [];

/**
 * 同步 TOOL_NAMES 与 registry 的当前状态
 *
 * 在 _registerBuiltinTools / registerDynamicTools / unregisterMcpTools 后调用，
 * 通过 splice 原地修改数组（保持引用不变），使 history-cleanup.js /
 * streaming-tool-parser.js / window._dsToolNames 的引用自动同步。
 */
function _syncToolNames() {
    const names = registry.getInvocationNames();
    // 原地 splice 保持 TOOL_NAMES 引用不变（history-cleanup.js / streaming-tool-parser.js 依赖此引用）
    try {
        TOOL_NAMES.splice(0, TOOL_NAMES.length, ...names);
    } catch (e) {
        // splice 失败时的兜底：逐个 push 缺失的工具名
        if (typeof console !== 'undefined') {
            console.warn('[capability-register] TOOL_NAMES splice failed, falling back to push:', e);
        }
        for (const name of names) {
            if (!TOOL_NAMES.includes(name)) {
                TOOL_NAMES.push(name);
            }
        }
    }
    // 确保 window._dsToolNames 与 TOOL_NAMES 同步
    if (typeof window !== 'undefined') {
        if (window._dsToolNames !== TOOL_NAMES) {
            // 引用不同：直接赋值为 TOOL_NAMES 引用
            window._dsToolNames = TOOL_NAMES;
        } else if (Array.isArray(window._dsToolNames) && window._dsToolNames.length !== names.length) {
            // 引用相同但长度不一致（splice 可能未生效）：逐个 push 缺失的工具名
            for (const name of names) {
                if (!window._dsToolNames.includes(name)) {
                    window._dsToolNames.push(name);
                }
            }
        }
    }
}

/**
 * 判断工具是否为 agent_finish（显式结束 Agent 模式的信号工具）
 *
 * agent_finish 是特殊的控制流工具：
 *   - 不触发 agent 续跑（相反，它要终止 agent 循环）
 *   - 不需要返回结果给 AI（AI 已决定结束）
 *   - 由 text-process.js 检测并调用 window._dsStopAgent()
 *
 * @param {string} toolName - 工具名
 * @returns {boolean} true 表示是 agent_finish 工具
 */
export function isAgentFinishTool(toolName) {
    return toolName === 'agent_finish';
}

/**
 * 判断工具是否需要返回结果给 AI（触发 agent 续跑）
 *
 * 委托给 registry.isRequireAgentFeedback，从工具注册时的 options.requireAgentFeedback
 * 获取。22 个内置工具的 requireAgentFeedback 标记在 _registerBuiltinTools 中设置
 * （除 memory_recall / agent_finish 外均为 true）。
 *
 * 原则：所有需要返回结果给 AI 的工具都触发续跑（包括状态切换类如 pin/export），
 * 只有纯记录型工具（memory_recall 仅记录调用次数）和控制流终止工具
 * （agent_finish 终止循环）不触发续跑。
 *
 * @param {string} toolName - 工具名
 * @returns {boolean} true 表示需要 agent 续跑
 */
export function requiresAgentFeedback(toolName) {
    return registry.isRequireAgentFeedback(toolName);
}

/**
 * 构建完整能力说明提示词的 legacy 版本（保留全部硬编码文本）
 *
 * 此函数保留原始的完整提示词文本（含第二层详细工具说明），
 * 供 getCoreRulesPrompt / getAdvancedUsagePrompt 提取分段文本。
 * 实际对外暴露的 getCapabilityPrompt 改为拼接三段子函数。
 *
 * @returns {string} [能力]...[/能力] 包裹的完整提示词文本
 * @private
 */
function _buildLegacyCapabilityPrompt() {
    return `[能力]
你是用户的私人 AI 助手，已通过浏览器扩展获得跨对话长期记忆能力。你能记住用户的身份、偏好、技术栈和历史对话中的关键信息，在后续对话中提供个性化的帮助。

## 第一层：核心规则（必须遵守）

### 身份说明

你是用户的私人 AI 助手，已通过浏览器扩展获得跨对话长期记忆能力。你能记住用户的身份、偏好、技术栈和历史对话中的关键信息，在后续对话中提供个性化的帮助。

### 工具调用格式（严格遵守）

通过输出 XML 标签调用工具。**标签体内必须是紧凑的单行 JSON**（不要换行、不要缩进、不要在标签内添加任何非 JSON 文本）。

#### 正确格式示例

<memory_save>
{"type":"preference","name":"用户职业","content":"前端开发","tags":["前端"]}
</memory_save>

注意：每个工具调用必须包含**完整的开标签 <tool_name> 和闭标签 </tool_name>**，JSON 必须以 } 或 ] 结尾。缺少闭标签或 JSON 不完整会导致工具调用失败。

#### 错误格式（禁止）

- 禁止在 JSON 中换行或多行排版
- 禁止使用 <invoke name="...">、<tool_call>、Markdown 代码块、{"tool":"...","arguments":{...}} 等包装
- 禁止把工具调用放在思考/reasoning 区域，必须放在最终回复内容中
- 禁止在标签内添加注释、前缀、后缀文本
- **禁止省略闭合标签**：每个 <tool_name> 必须有对应的 </tool_name>
- **禁止输出不完整的 JSON**：JSON 必须是有效的完整对象（{...}）或数组（[...]）

#### 通用规则

- 标签名必须与下方"第二层：工具说明"中的名称完全一致（区分大小写）
- 工具调用可以放在回复的任何位置（不限于末尾）
- 一条回复中可以调用多次工具
- 扩展会自动执行工具调用，并在界面上显示"工具调用"卡片
- **memory_save 不需要提供 id 字段**，系统会自动生成唯一 ID（格式：mem-时间戳，如 mem-1722580800000），并在返回结果中告知实际 id
- **每个工具调用必须输出完整的 <tool_name>JSON</tool_name> 三段结构**，不要只输出开标签

#### ID 使用规则（非常重要，违反会导致工具调用失败）

记忆 ID 是系统自动生成并管理的（格式：mem-时间戳，如 mem-1722580800000），**所有记忆工具调用都不要自己生成 id**：

- **memory_save**：不需要提供 id 字段，系统会自动生成唯一 ID 并在返回结果中告知
- **memory_update / memory_delete / memory_merge / memory_replace / memory_get**：参数中的 id / sourceIds / targetId / memoryIds **必须**来自以下两个来源之一：
  1. 当前对话注入的 [系统记忆] 中显示的 id（格式如 (id:mem-1722580800000)）
  2. 之前 memory_save 工具调用返回结果中显示的实际 id

- **错误示例**：<memory_merge>{"sourceIds":["mem-8f3a2c","mem-7b3e91"],...}</memory_merge>（自己编造的 id 不在系统中，融合会失败）
- **正确示例**：从 [系统记忆] 或 memory_save 返回结果复制实际的 id，如 <memory_merge>{"sourceIds":["mem-1722580800000","mem-1722580900000"],"targetId":"mem-1722580800000"}</memory_merge>

### 决策原则（多工具协同 — 重要）

你可以在同一轮对话中**自由组合**不同分类的工具。以下按分类列出所有决策场景：

#### 记忆类工具（memory_*）— 持久化用户信息

| 用户意图 | 决策 | 调用工具 |
|---|---|---|
| 透露全新的偏好/事实/身份 | SAVE | memory_save |
| 修正已有记忆的部分字段 | UPDATE | memory_update |
| 用户偏好已变化，旧内容失效 | REPLACE | memory_replace |
| 记忆过时/错误/冗余 | DELETE | memory_delete |
| 多条记忆描述同一主题 | MERGE | memory_merge |
| 需要查看记忆库全貌 | LIST | memory_list / memory_search |
| 临时指令、闲聊、敏感信息 | NONE | 不调用 |

#### 搜索类工具（web_search / web_fetch）— 获取实时信息

| 用户意图 | 决策 | 调用工具 |
|---|---|---|
| 需要最新资讯/新闻/实时数据 | SEARCH | web_search |
| 需要读取网页具体内容 | FETCH | web_fetch |
| 知识截止日期后的事件 | SEARCH | web_search |
| 需要验证/对比事实 | SEARCH | web_search |

#### 交互类工具（ask_user）— 收集用户决策

| 用户意图 | 决策 | 调用工具 |
|---|---|---|
| 需求模糊（如"用哪种语言"） | ASK | ask_user |
| 关键决策点（如"重构还是重写"） | ASK | ask_user |
| 需要用户输入个性化信息 | ASK | ask_user |
| 可通过上下文推断 | NONE | 文本回复 |

#### 任务管理类工具（todo_write）— 复杂任务拆解

| 用户意图 | 决策 | 调用工具 |
|---|---|---|
| 任务包含 3+ 独立步骤 | PLAN | todo_write |
| 单步任务、闲聊、信息查询 | NONE | 不调用 |

#### 多工具协同示例（你可以在一轮回复中同时使用多种工具）

**示例 1**：用户说"帮我查一下最新的 React 19 特性，然后记下来"
→ 回复：web_search 查最新特性 → 输出文本总结 → memory_save 保存 → agent_finish

**示例 2**：用户说"帮我规划一个博客项目，我不确定用哪个框架"
→ 回复：todo_write 拆解任务 → ask_user 询问框架选择 → agent_finish

**示例 3**：用户说"我最近在学 Rust，帮我找点学习资源"
→ 回复：memory_search 查是否有相关记忆 → web_search 搜学习资源 → memory_save 保存偏好 → 输出文本建议 → agent_finish

**示例 4**：用户说"帮我重构 utils.js，先查一下之前的重构记录"
→ 回复：memory_search 查历史记录 → todo_write 规划步骤 → start_agent 启动 Agent 模式

### 行为约束

**禁止保存**以下内容到记忆：
- 密钥/密码/Token/API Key
- PII（身份证号/手机号/银行卡号）
- 一次性问答内容
- 临时指令（如"这次回答简短点"）
- 闲聊内容（如"你好""谢谢"）

**通用约束**：
- 一条回复中可以使用多个不同分类的工具（如同时搜索+记忆+提问）
- 不要在不必要时调用工具，优先用文本直接回答简单问题
- 工具调用放在回复末尾时，agent_finish 必须放在最末尾

## 第二层：工具说明

### CRUD 类工具

#### memory_save（保存记忆）

保存一条新的长期记忆。

参数（JSON 字段，紧凑单行）：
- type（string，必填）：记忆类型，可选值：
  - preference：用户偏好、身份、角色、习惯
  - context：对话上下文、项目背景
  - fact：重要事实、技术决策
  - instruction：行为纠正、指令规则
- name（string，必填）：简短标题（将作为卡片主标题显示给用户）
- content（string，必填）：要保存的内容
- tags（string[]，可选）：标签列表

调用时机：用户透露全新偏好/事实/身份时

禁止调用：临时指令、敏感信息

调用示例：
<memory_save>
{"type":"preference","name":"用户技术栈","content":"主要使用 React 和 TypeScript","tags":["前端","React","TypeScript"]}
</memory_save>

#### memory_get（读取记忆）

按 ID 读取单条记忆的完整字段（含历史版本 history）。

参数（JSON 字段，紧凑单行）：
- id（string，必填）：要读取的记忆 ID，**必须来自 [系统记忆] 或工具返回结果中的实际 id**

调用时机：需要查看记忆完整字段（含历史版本）时

禁止调用：已知记忆内容时

调用示例（id 必须是 [系统记忆] 中的实际 id）：
<memory_get>
{"id":"mem-1722580800000"}
</memory_get>

反例（id 不是 [系统记忆] 中的实际 id，调用会失败）：
<memory_get>
{"id":"mem-8f3a2c"}
</memory_get>

#### memory_update（更新记忆）

更新已有记忆的内容。参数：id（string，必填，**必须来自 [系统记忆] 或工具返回结果中的实际 id**）、type、name、content、tags

调用时机：修正已有记忆的部分字段时

调用示例（id 必须是 [系统记忆] 中的实际 id）：
<memory_update>
{"id":"mem-1722580800000","type":"preference","name":"用户技术栈","content":"主要使用 React、TypeScript 和 Vue","tags":["前端","React","TypeScript","Vue"]}
</memory_update>

#### memory_replace（覆盖更新记忆）

覆盖式更新记忆：用新内容完全替换旧内容，旧内容作为快照进入 history（最多保留 5 条历史版本）。适用于用户偏好已发生变化的场景。

参数（JSON 字段，紧凑单行）：
- id（string，必填）：要替换的记忆 ID，**必须来自 [系统记忆] 或工具返回结果中的实际 id**
- content（string，必填）：新内容（完全替换旧内容）
- title（string，可选）：新标题
- tags（string[]，可选）：新标签
- reason（string，可选）：替换原因（便于追溯）

调用时机：用户偏好已变化，旧内容失效时

禁止调用：仅修改部分字段时（用 memory_update）

调用示例（id 必须是 [系统记忆] 中的实际 id）：
<memory_replace>
{"id":"mem-1722580800000","content":"新的技术栈内容","reason":"用户技术栈已变化"}
</memory_replace>

反例（content 不能为空）：
<memory_replace>
{"id":"mem-xxx","content":""}
</memory_replace>

#### memory_delete（删除记忆）

删除指定记忆。

参数（JSON 字段，紧凑单行）：
- id（string，必填）：要删除的记忆 ID，**必须来自 [系统记忆] 或工具返回结果中的实际 id**
- name（string，可选）：记忆标题（便于用户在卡片上识别删除了哪条记忆）

调用示例（id 必须是 [系统记忆] 中的实际 id）：
<memory_delete>
{"id":"mem-1722580800000","name":"用户技术栈"}
</memory_delete>

#### memory_clear（清空记忆）

批量清空指定作用域的记忆。需要显式 confirm:true 确认，避免误操作。默认保留置顶记忆（可通过 includePinned:true 一并清空）。所有被删除的记忆会加入已删除集合，防止被历史消息重新加载时重新保存。

参数（JSON 字段，紧凑单行）：
- scope（string，必填）：清空范围，可选值：
  - global：清空全局记忆
  - project：清空当前项目记忆
  - all：清空所有记忆
- confirm（boolean，必填）：必须为 true，否则不执行删除
- includePinned（boolean，可选）：是否一并清空置顶记忆（默认 false）

调用时机：用户要求清空某范围全部记忆时

禁止调用：删除单条记忆时（用 memory_delete）

调用示例：
<memory_clear>
{"scope":"project","confirm":true}
</memory_clear>

反例（缺少 confirm:true，不会执行删除）：
<memory_clear>
{"scope":"all"}
</memory_clear>

### 检索类工具

#### memory_search（搜索记忆）

主动搜索记忆库，查找与指定关键词或语义相关的记忆。当 [系统记忆] 注入的内容不够，或你需要查找特定主题的记忆时使用。

**与 memory_recall 的区别**：recall 是报告你"已经参考了"哪些记忆（事后记录），search 是主动查找记忆（事前检索）。

参数（JSON 字段，紧凑单行）：
- query（string，必填）：搜索关键词或语义查询文本
- limit（number，可选）：返回结果上限（默认 10，最大 50）
- threshold（number，可选）：相似度阈值 0-1，大于 0 时启用相似度模式（默认 0=关键词子串匹配）
- category（string，可选）：按分类筛选（preference/context/fact/instruction）

调用示例：
<memory_search>
{"query":"用户技术栈","limit":10}
</memory_search>

相似度模式示例：
<memory_search>
{"query":"React 前端开发","threshold":0.3,"limit":5}
</memory_search>

#### memory_list（列出记忆）

列出记忆库中的记忆，支持按分类/标签筛选和分页。用于了解记忆全貌，比 memory_review 更轻量（不计算相似度，不给出建议）。

参数（JSON 字段，紧凑单行）：
- category（string，可选）：按分类筛选（preference/context/fact/instruction）
- tag（string，可选）：按标签筛选（精确匹配，不区分大小写）
- limit（number，可选）：每页数量（默认 20，最大 100）
- offset（number，可选）：偏移量（默认 0，用于分页）
- includeDisabled（boolean，可选）：是否包含已禁用记忆（默认 false）

调用示例：
<memory_list>
{"category":"preference","limit":20}
</memory_list>

#### memory_recall（报告调用记忆）

报告你在当前回复中**参考/调用了哪些已有记忆**。被报告的记忆会自动增加访问次数，用于统计记忆使用频率，作为后续审查和归档的依据。

参数（JSON 字段，紧凑单行）：
- memoryIds（string[]，必填）：你本次回复中实际参考的记忆 ID 列表

调用时机：
- 当你在回复中参考了注入的 [系统记忆] 中的内容时，**必须**调用此工具报告所参考的记忆 ID
- 如果本次回复没有参考任何已有记忆，则不需要调用

调用示例（memoryIds 必须是 [系统记忆] 中的实际 id）：
<memory_recall>
{"memoryIds":["mem-1722580800000","mem-1722580900000"]}
</memory_recall>

### 管理类工具

#### memory_merge（融合记忆）

将多条**有关联**的记忆融合为一条新记忆。融合后原记忆被删除，新记忆继承原记忆的标签和访问统计。

**重要约束**：
- 只能融合"确实有关联"的记忆（如同一主题、相互补充、信息重叠、描述同一对象的不同方面）
- **禁止**盲目合并无关记忆
- 融合是不可逆操作，请确保新内容完整覆盖了所有原记忆的关键信息
- **memoryIds 必须来自 [系统记忆] 中显示的实际 id**，不要使用自己编造的 id，否则融合会失败（找不到记忆）

参数（JSON 字段，紧凑单行）：
- memoryIds（string[]，必填）：待融合的记忆 ID 数组（至少 2 条），**必须从 [系统记忆] 中复制实际 id**
- name（string，必填）：新记忆标题
- content（string，必填）：新记忆内容（应整合所有原记忆的关键信息）
- type（string，可选）：新记忆类型（preference/context/fact/instruction），缺省为 fact
- tags（string[]，可选）：新记忆标签（会与原记忆标签合并去重）

调用示例（id 必须是 [系统记忆] 中的实际 id）：
<memory_merge>
{"memoryIds":["mem-1722580800000","mem-1722580900000"],"name":"用户技术栈","content":"主要使用 React 和 TypeScript，后端使用 Node.js","type":"context","tags":["前端","后端"]}
</memory_merge>

#### memory_review（审查记忆）

审查并整理记忆库，返回审查报告，识别需要融合的相似记忆对和需要删除的过期记忆。

参数（JSON 字段，紧凑单行）：
- focus（string，可选）：审查重点（如"重复记忆""过期记忆""特定主题"），缺省为全面审查

返回的报告包含：
- 统计摘要（记忆总数、分类分布、平均访问次数等）
- 建议融合的记忆对（相似度 ≥ 0.6，含 ID 和相似原因）
- 建议删除的过期记忆（90 天未访问 + 访问次数 < 3 + 未置顶）
- 后续操作建议

收到报告后，你应当：
1. 对"建议融合"的记忆对：**确认确实有关联**后，调用 memory_merge 工具融合
2. 对"建议删除"的过期记忆：调用 memory_delete 工具删除
3. 每次审查后最多处理 3-5 条，避免一次操作过多
4. 不要强制融合/删除，仅处理确实有必要的项

调用示例：
<memory_review>
{"focus":"重复记忆"}
</memory_review>

#### memory_pin（置顶/取消置顶记忆）

切换记忆的置顶状态。置顶的记忆会在每次注入时获得 +1000 评分加成，**始终**被注入到 [系统记忆] 中，不受 token 预算限制。

设计为切换式：如果当前已置顶则取消置顶，未置顶则置顶。

参数（JSON 字段，紧凑单行）：
- id（string，必填）：要置顶/取消置顶的记忆 ID，**必须来自 [系统记忆] 或工具返回结果中的实际 id**
- name（string，可选）：记忆标题（便于识别）

调用示例（id 必须是 [系统记忆] 中的实际 id）：
<memory_pin>
{"id":"mem-1722580800000","name":"用户技术栈"}
</memory_pin>

#### memory_stats（记忆统计）

返回记忆库的轻量级统计概览，不计算相似度，比 memory_review 快。适用于快速了解记忆库状态。

参数：无（空 JSON 对象 {}）

调用示例：
<memory_stats>
{}
</memory_stats>

返回统计包括：记忆总数、置顶数、禁用数、标签总数、累计/平均访问次数、分类分布、范围分布。

#### memory_export（导出记忆）

将记忆库导出为 JSON 字符串，便于备份、迁移或跨设备同步。导出的 JSON 可通过 memory_import_preview 解析后重新导入。

**注意**：导出是只读操作，不会修改记忆库。大记忆库可能产生很长的输出。

参数（JSON 字段，紧凑单行）：
- includeDisabled（boolean，可选）：是否包含已禁用记忆（默认 true）
- includePinnedOnly（boolean，可选）：仅导出置顶记忆（默认 false）
- category（string，可选）：仅导出指定分类

调用示例：
<memory_export>
{"includeDisabled":true}
</memory_export>

#### memory_archive（归档过期记忆）

手动触发归档：删除满足以下**全部**条件的记忆：
- 90 天未访问
- 访问次数 < 3
- 未置顶

这些记忆通常是过期或低价值的。归档可保持记忆库整洁。

**与 memory_delete 的区别**：archive 是按条件批量清理，delete 是按 ID 精确删除。归档不可逆，但被归档的记忆会被记录到已删除集合，防止被历史消息重新加载时重新保存。

参数：无（空 JSON 对象 {}）

调用示例：
<memory_archive>
{}
</memory_archive>

#### memory_import_preview（预览导入记忆）

将一段文本（JSON 或纯文本）解析为记忆候选列表并预览，**不实际保存**。用于用户要求"批量导入记忆""把这些都记下来"时先解析预览，再决定是否逐条保存。

参数（JSON 字段，紧凑单行）：
- content（string，必填）：待导入的内容，支持两种格式：
  - JSON：数组 [{"name":"...","content":"...","type":"...","tags":[...]}] 或对象 {"memories":[...]}
  - 纯文本：按空行或列表项（- 或 *）分隔，每块作为一条记忆
- defaultType（string，可选）：默认记忆类型（preference/context/fact/instruction），缺省为 fact
- tags（string[]，可选）：为所有导入的记忆附加的标签

每条 JSON 项的字段（兼容多种命名）：
- name/title/key → 标题
- content/text/value → 内容
- type/category → 类型（缺省用 defaultType）
- tags → 标签（会与外层 tags 合并）

调用示例：
<memory_import_preview>
{"content":"[{\"name\":\"偏好简洁回复\",\"content\":\"用户喜欢简洁直接的回答风格\",\"type\":\"preference\",\"tags\":[\"沟通\"]},{\"name\":\"技术栈\",\"content\":\"主要使用 React + TypeScript\",\"type\":\"context\",\"tags\":[\"前端\"]}]","defaultType":"fact","tags":["导入"]}
</memory_import_preview>

返回结果包含：memories（可导入的新记忆数组）、duplicates（与已有记忆重复的数量）、rejected（格式无效被拒绝的数量）。收到结果后，如需实际保存，请对每条记忆调用 memory_save。

### 控制流工具

#### start_agent（启动 Agent 模式 — 主动触发续跑）

显式声明开始 Agent 循环。调用此工具后，扩展会发送续跑 prompt，让你在收到"Agent 已启动"确认后开始调用工具执行任务。

**调用时机**：
- 用户给出复杂任务，你需要分多步执行（先规划再执行）
- 你需要主动启动 Agent 模式，而非被动等待工具调用触发

**调用位置**：放在回复末尾，在你分析了任务并准备好开始执行之后。

参数（JSON 字段，紧凑单行）：
- task（string，可选）：任务描述（便于调试，用户不可见）
- reason（string，可选）：启动理由

调用示例：
<start_agent>
{"task":"重构 utils.js 模块","reason":"需要分步骤执行"}
</start_agent>

#### agent_finish（结束 Agent 模式 — 必须放在回复末尾）

显式声明任务完成，结束 Agent 循环。调用此工具后，扩展将停止发送续跑 prompt，用户可以重新输入。

**这是最重要的控制流工具**。每次你在回复中调用了任何工具（memory_save/memory_search 等），你**必须在回复末尾调用 agent_finish**，除非你确实需要更多工具结果来继续任务。

**调用时机**（严格遵守）：

1. **必须调用**的情况：
   - 你已经完成了用户的所有要求，并输出了最终结论文本
   - 你调用了工具（如 memory_save）并已给出回复，不需要更多工具结果
   - 你判断不需要再调用任何工具，可以直接回答用户

2. **禁止调用**的情况：
   - 你还需要调用其他工具获取信息时（先调用其他工具，等收到结果后再决定是否调用 agent_finish）
   - 你还没有输出最终结论文本时（先输出文本结论，再调用 agent_finish）

**调用位置**：必须放在回复的**最末尾**，在所有文本和工具调用之后。

**为什么不调用 agent_finish 会有问题**：
- 如果你不调用 agent_finish，扩展会认为你可能还需要工具结果，会发送续跑 prompt
- 这会导致无意义的循环：你收到空的续跑 prompt，再次回复，再次触发续跑...
- 持续消耗资源，直到达到安全上限（50 次）才停止
- 用户在此期间无法输入（输入框被锁定）

参数（JSON 字段，紧凑单行）：
- reason（string，可选）：结束理由（便于调试，用户不可见）

调用示例：
<agent_finish>
{}
</agent_finish>

带理由的示例：
<agent_finish>
{"reason":"已保存记忆并回复用户"}
</agent_finish>

## 第三层：高级用法

### 记忆审查与整理规则（重要）

你应当**主动**维护记忆库的整洁，避免记忆膨胀和冗余。具体规则：

#### 何时触发审查

1. **每 10 轮对话**：主动调用一次 memory_review 进行全面审查
2. **用户明确要求**：用户说"整理记忆""清理记忆""审查记忆"时立即调用
3. **发现冗余**：当你在 [系统记忆] 中发现明显重复或相似的记忆时，可主动调用 memory_review（focus="重复记忆"）
4. **记忆数量较多**：当注入的 [系统记忆] 超过 15 条时，建议触发一次审查

#### 审查后的处理流程

收到 memory_review 报告后，按以下顺序处理：

1. **优先处理高相似度融合建议**（相似度 ≥ 0.8）：
   - 调用 memory_merge 工具融合，新内容要**完整整合**所有原记忆的关键信息
   - 一次最多融合 3 组，避免一次操作过多

2. **处理过期记忆**：
   - 调用 memory_delete 工具删除长期未访问且低频的记忆
   - 已置顶的记忆不要删除
   - 一次最多删除 5 条

3. **不要过度整理**：
   - 仅处理确实有问题（重复、过期、矛盾）的记忆
   - 不要为了整理而整理，避免破坏有价值的记忆
   - 单次审查后处理总数不超过 8 条

#### 融合决策原则

只有满足以下条件之一的记忆才能被融合：
- **同一主题的不同方面**：如"用户技术栈-前端"和"用户技术栈-后端"
- **信息重叠**：两条记忆描述了相同/相似的内容，可以合并为更完整的版本
- **相互补充**：一条记忆是另一条的补充说明
- **同一事件的不同片段**：如多次对话中提到的同一项目信息

**禁止融合**的情况：
- 完全无关的记忆（即使标签相似）
- 不同时间点的不同偏好（用户偏好可能已变化）
- 不同对象的信息（即使表述相似）

### Agent 循环终止规则（必须遵守）

当你收到工具结果并完成回复后，你**必须**在回复末尾调用 agent_finish 工具，显式结束 Agent 循环。

**标准回复流程**：
1. 收到 <tool_results> 后，分析所有工具执行结果（可能同时收到多个工具的结果）
2. 如果需要更多信息，调用下一个工具（如 web_search）
3. 如果结果足够，输出最终结论文本
4. **在回复最末尾调用 agent_finish**，结束 Agent 循环

**多工具协同流程**（推荐）：
1. 分析用户需求 → 确定需要哪些分类的工具（记忆/搜索/提问/任务）
2. 在一条回复中调用多个工具（如 memory_search + web_search + ask_user）
3. 收到所有工具结果后，综合分析并输出最终结论
4. 调用 agent_finish 结束

**错误示范**（会导致循环）：
- 收到工具结果后只输出文本，不调用 agent_finish → 扩展会发送空续跑 prompt
- 收到工具结果后再次调用相同工具 → 无意义重复
- 在回复开头调用 agent_finish，然后继续输出文本 → 顺序错误

**正确示范**：
- 输出结论文本 → 调用 agent_finish → 结束
- 调用 memory_search + web_search → 等待结果 → 输出结论文本 → 调用 agent_finish → 结束
- 调用 todo_write + ask_user → 等待用户回答 → 继续执行 → 输出结论文本 → 调用 agent_finish → 结束

### 工具结果回传机制（Agent 循环）

当你输出工具调用 XML 后，扩展会：
1. 解析并执行你的工具调用
2. 将工具执行结果包装在 <tool_results> XML 块中
3. 作为新的用户消息发送给你，格式如下：

<original_task>
（你最初回复的原始用户消息）
</original_task>

<tool_results>
[
  {
    "tool": "memory_save",
    "ok": true,
    "skipped": false,
    "summary": "已保存记忆",
    "detail": "\\"用户技术栈\\" 已添加到长期记忆"
  },
  {
    "tool": "web_search",
    "ok": true,
    "summary": "搜索完成",
    "detail": "找到 10 条结果..."
  },
  {
    "tool": "ask_user",
    "ok": true,
    "summary": "已向用户提问",
    "detail": "等待用户回答..."
  }
]
</tool_results>

收到工具结果后，你应该：
- 如果工具执行成功（ok: true, skipped: false），简短确认，然后继续回答用户问题
- 如果工具被跳过（ok: true, skipped: true），说明记忆已存在或已被用户删除，无需重试
- 如果工具执行失败（ok: false），根据 summary/detail 修正参数并重试，或直接告知用户
- 不要在收到工具结果后再次调用相同的工具（避免循环）
- 如果结果已足够，直接输出最终结论，不要继续调用工具
- **多个工具结果可以综合分析**：同一轮调用的 memory_save + web_search + ask_user 结果会一起返回

## 第四层：分层记忆说明

### 核心层（Core Memory）

注入到 [系统记忆] 中的记忆，受 Token 预算（1500）约束。长 prompt（>3000 tokens）时预算自动压缩至 800。置顶记忆不受预算限制，始终注入。

### 归档层（Archival Memory）

被 memory_archive 删除的记忆，不可恢复。被记录到已删除集合防止 AI 重保存。

### 历史层（History）

memory_replace 保留的旧版本快照（最多 5 条），可通过 memory_get 查看历史版本，用于追溯偏好变化轨迹。

### 冲突处理原则

新旧矛盾时以新为准，旧值优先通过 memory_replace 进入 history 保留历史轨迹，禁止直接 memory_delete 矛盾记忆（会丢失历史）。

### 容量管理

当 [系统记忆] 超过 15 条时，建议触发 memory_review 审查冗余记忆。

## 第五层：Todo 清单管理（多步任务必备）

### 何时创建 todo
- **必须创建**：用户任务包含 3 个及以上独立步骤时（如"重构文件 + 跑测试 + 修复 + 检查"）
- **禁止创建**：单步任务、纯信息查询、闲聊（如"解释这段代码""你好"）
- **创建时机**：任务开始时**一次性拆解**，不要边做边加

### 如何更新 todo
1. 开始执行某一步前：把该项 status 改为 \`in_progress\`（同时上一项改 \`completed\`）
2. 完成某一步后：立即把该项 status 改为 \`completed\`
3. 发现新需求时：可以追加新项（全量重写列表）
4. 计划偏离时：可以修订整个列表（让变化可见）

### 核心规则（必须遵守）
- **同一时间只能有一个 \`in_progress\`**：强制单一焦点，避免"5 件事同时在做却没做完"
- **每次调用 todo_write 必须传入完整列表**：不是"把 #2 改成 completed"，而是提交当前所有任务和状态
- **content 要写成可验证的完成条件**：
  - 错误："扫描文件"（只描述动作，无法判断何时完成）
  - 正确："确认项目中不存在不符合 snake_case 的文件"
- **任务全部完成后**：调用 \`agent_finish\` 结束 Agent 循环（todo_write 不终止循环）

### Todo 工具说明

#### todo_write — 更新任务清单
- **用途**：全量替换当前 todo 清单
- **参数**：\`{ todos: [{ id, content, status, priority }] }\`
  - \`id\`（可选，默认 "1","2"...）：任务编号
  - \`content\`（必填）：任务内容，写成可验证的完成条件
  - \`status\`（可选，默认 "pending"）：pending / in_progress / completed
  - \`priority\`（可选，默认 "medium"）：high / medium / low
- **调用时机**：任务开始时拆解；开始执行某步前；完成某步后
- **禁止调用**：单步任务、闲聊
- **示例**：
  \`<todo_write>{"todos":[{"id":"1","content":"扫描不符合 snake_case 的文件","status":"in_progress","priority":"high"},{"id":"2","content":"更新文件名和相关导入","status":"pending","priority":"medium"}]}</todo_write>\`
- **反例**：
  \`<todo_write>{"id":"2","status":"completed"}</todo_write>\`（错误：必须传完整 todos 数组）

#### todo_read — 读取任务清单
- **用途**：查看当前清单状态（少用，todo_write 返回值已含状态）
- **参数**：无
- **调用时机**：忘记当前清单状态时
- **示例**：\`<todo_read>{}</todo_read>\`

#### todo_clear — 清空任务清单
- **用途**：清空所有 todo
- **参数**：无
- **调用时机**：任务全部完成并调用 agent_finish 后清理
- **示例**：\`<todo_clear>{}</todo_clear>\`

### 与 agent_finish 的协同
- todo 全部 \`completed\` **不等于**自动结束循环，仍需显式调用 \`agent_finish\`
- \`agent_finish\` 必须放在回复**最末尾**，在 \`todo_write\` 之后
- 如果 todo 还有 \`pending\`/\`in_progress\`，**禁止**调用 \`agent_finish\`（应继续执行）

## 第六层：用户提问（需要澄清时使用）

### 何时提问
- **必须提问**：需求模糊（如"用哪种语言"未指定）、关键决策点（如"重构还是重写"）、影响实现路径的歧义
- **禁止提问**：明确任务、闲聊、可通过上下文推断的细节
- **提问上限**：每次最多 4 个问题，避免疲劳轰炸

### 与其他工具协同
- **ask_user 可以与其他工具同时使用**：例如 web_search 搜索信息 + ask_user 确认用户偏好 + memory_save 保存结果
- 常见组合：todo_write 规划任务 + ask_user 确认关键决策 → 等待用户回答后继续执行
- 常见组合：memory_search 查历史 + web_search 搜实时信息 + ask_user 确认偏好 → 综合分析后回应

### ask_user 工具说明（重要：必须使用工具而非文本提问）
- **核心规则**：当需要向用户收集信息或让用户做决策时，**必须使用 \`ask_user\` 工具调用**，**禁止直接在回复文本中提问**
  - ❌ 错误：在回复中写"请问您希望使用哪种语言？"（用户无法便捷回答，Agent 无法自动接收）
  - ✅ 正确：调用 \`<ask_user>{...}</ask_user>\` 工具（渲染为可点击的问题卡片，用户回答后自动注入到 Agent 循环）
- **用途**：向用户提问，暂停 Agent 循环等待回答
- **参数**：\`{ questions: [{ question, header, options, multiSelect }] }\`
  - \`question\`（必填）：问题文本
  - \`header\`（必填，最多 12 字符）：短标签，显示为 chip
  - \`options\`（必填，2-4 个）：选项数组，每项含 \`label\`（1-5 词）+ \`description\`（解释含义与影响）
  - \`multiSelect\`（可选，默认 false）：是否支持多选
- **调用时机**：
  - 需求模糊（如"用什么语言"未指定）—— 必须用 ask_user
  - 关键决策点（如"重构还是重写"）—— 必须用 ask_user
  - 影响实现路径的歧义（如"前端还是后端"）—— 必须用 ask_user
  - 需要用户输入昵称、名称、配置等个性化信息 —— 必须用 ask_user
- **禁止调用**：明确任务、闲聊、可通过上下文推断
- **示例**：
  \`<ask_user>{"questions":[{"question":"使用哪种语言实现?","header":"语言选择","options":[{"label":"Python","description":"快速开发，生态丰富"},{"label":"JavaScript","description":"浏览器原生支持"}],"multiSelect":false}]}</ask_user>\`
- **反例**：
  \`<ask_user>{"questions":[{"question":"你好吗?"]}</ask_user>\`（错误：闲聊，且缺少 header 和 options）

### 与 agent_finish 的协同
- 有 pending 提问时，**禁止**调用 \`agent_finish\`
- \`ask_user\` 必须放在回复末尾（等待用户回答后再继续）
- 用户回答后，Agent 循环自动恢复

[/能力]

`;
}

// ============================================================
// Prompt 拆分（getCoreRulesPrompt / getToolSchemasPrompt / getAdvancedUsagePrompt）
// ============================================================

/** 缓存：从 legacy prompt 提取的核心规则文本 */
let _cachedCoreRules = null;
/** 缓存：从 legacy prompt 提取的高级用法文本 */
let _cachedAdvancedUsage = null;

/**
 * 从 _buildLegacyCapabilityPrompt 提取核心规则与高级用法文本段
 *
 * 第二层（工具说明）被丢弃，由 getToolSchemasPrompt 用 registry.renderAllSchemas() 替代。
 * 提取结果缓存，避免重复构建大字符串。
 *
 * @returns {{ core: string, advanced: string }}
 * @private
 */
function _extractPromptSections() {
    if (_cachedCoreRules !== null) {
        return { core: _cachedCoreRules, advanced: _cachedAdvancedUsage };
    }
    const full = _buildLegacyCapabilityPrompt();
    const startMarker = '[能力]\n';
    const layer2Marker = '## 第二层';
    const layer3Marker = '## 第三层';
    const endMarker = '[/能力]';
    const startIdx = full.indexOf(startMarker);
    const layer2Idx = full.indexOf(layer2Marker);
    const layer3Idx = full.indexOf(layer3Marker);
    const endIdx = full.indexOf(endMarker);
    _cachedCoreRules = full.slice(startIdx + startMarker.length, layer2Idx).trim();
    _cachedAdvancedUsage = full.slice(layer3Idx, endIdx).trim();
    return { core: _cachedCoreRules, advanced: _cachedAdvancedUsage };
}

/**
 * 构建核心规则提示词（第一层：身份/工具调用格式/ID 使用规则/决策原则/行为约束）
 *
 * 静态业务逻辑，从 _buildLegacyCapabilityPrompt 提取（缓存）。
 *
 * @returns {string} 核心规则文本
 */
export function getCoreRulesPrompt() {
    return _extractPromptSections().core;
}

/**
 * 构建工具说明提示词（第二层，动态：含 MCP 工具说明）
 *
 * 描述符已无条件注册到 registry（保证识别链路总能识别所有工具 XML），
 * 但 prompt 渲染需按 CONFIG 开关过滤：关闭的工具不进入 prompt，
 * 避免 AI 看到未启用工具的说明而尝试调用。
 *
 * 过滤规则：
 *   - web_search / web_fetch：webToolsEnabled 关闭时不渲染
 *   - python_exec：pythonSandboxEnabled 关闭时不渲染
 *   - mcp_discover / mcp_describe / mcp_invoke：mcpEnabled 关闭时不渲染
 *   - mcp__*（MCP 投影工具）：mcpEnabled 关闭时不渲染
 *   - 其余内置工具（memory/todo/agent 等）总是渲染
 *
 * @returns {string} 工具说明文本；无可见工具时返回空字符串
 */
export function getToolSchemasPrompt() {
    const allDescriptors = registry.getAllDescriptors();
    const { CONFIG } = _getConfigSafe();
    // 按 CONFIG 开关过滤（关闭的不进入 prompt，但描述符仍注册以支持 XML 识别）
    const visibleDescriptors = allDescriptors.filter(d => {
        if (!CONFIG) return true;
        if (d.name === 'web_search' || d.name === 'web_fetch') {
            return CONFIG.webToolsEnabled !== false;
        }
        if (d.name === 'python_exec') {
            return CONFIG.pythonSandboxEnabled !== false;
        }
        if (d.name === 'mcp_discover' || d.name === 'mcp_describe' || d.name === 'mcp_invoke') {
            return CONFIG.mcpEnabled !== false;
        }
        if (d.name.startsWith('mcp__')) {
            return CONFIG.mcpEnabled !== false;
        }
        return true; // 内置工具（memory/todo/agent 等）总是渲染
    });
    const schemas = renderToolSchemas(visibleDescriptors);
    if (!schemas) return '';
    return '## 第二层：工具说明\n\n' + schemas;
}

/**
 * 构建高级用法提示词（第三层至第六层：高级用法/分层记忆/Todo 管理/ask_user 规则）
 *
 * 静态业务逻辑，从 _buildLegacyCapabilityPrompt 提取（缓存）。
 *
 * @returns {string} 高级用法文本
 */
export function getAdvancedUsagePrompt() {
    return _extractPromptSections().advanced;
}

/**
 * 构建能力说明提示词（四层结构）
 *
 * 拼接 getCoreRulesPrompt + getToolSchemasPrompt + getAdvancedUsagePrompt，
 * 用 [能力]...[/能力] 包裹。由 fetch-hub / anti-recall 在每次对话请求前注入。
 *
 * @returns {string} [能力]...[/能力] 包裹的提示词文本
 */
export function getCapabilityPrompt() {
    const core = getCoreRulesPrompt();
    const schemas = getToolSchemasPrompt();
    const advanced = getAdvancedUsagePrompt();
    const parts = ['[能力]', ''];
    if (core) parts.push(core);
    if (schemas) parts.push('', schemas);
    if (advanced) parts.push('', advanced);
    parts.push('[/能力]', '');
    return parts.join('\n') + '\n';
}

// ============================================================
// 工具调用执行器（参考 deepseek-pp/core/tool/memory.ts 的 executeMemoryToolCall）
// ============================================================

/**
 * 执行工具调用（wrapper，委托给 registry.execute 统一分派）
 *
 * 保留原函数签名以兼容 text-process.js 的 window._dsExecuteToolCall 同步调用。
 * registry.execute 直接调用执行器并返回其结果：同步执行器返回 result 对象，
 * 异步执行器（web/python/mcp）返回 Promise<result>。
 *
 * @param {string} name - 工具名（memory_save / memory_update / web_search / ...）
 * @param {Object} payload - 调用参数
 * @returns {{ ok: boolean, summary: string, detail?: string } | Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
export function executeToolCall(name, payload) {
    if (!name || !payload) {
        return { ok: false, summary: '无效的工具调用', detail: '工具名或参数为空' };
    }
    return registry.execute(name, payload);
}

/**
 * 执行 memory_save 工具调用
 *
 * 去重策略（三层）：
 *   1. **ID 去重**（主策略）：AI 每次调用生成随机 id，若 id 已存在则跳过保存
 *      - 适用场景：流式输出重复触发、AI 重复调用同一 id
 *      - 仍会渲染工具调用卡片，让用户看到调用过程
 *   2. 精确匹配（标题+内容完全相同）：跳过，返回"记忆已存在"
 *   3. 高相似度匹配（≥0.85）：跳过新增，可选合并 tags 到已有记忆
 *
 * @param {Object} payload - { id?, type, name, content, tags }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemorySave(payload) {
    const type = payload.type;
    const validTypes = ['preference', 'context', 'fact', 'instruction'];
    if (!type || !validTypes.includes(type)) {
        return { ok: false, summary: '记忆格式错误', detail: 'type 必须是 preference/context/fact/instruction' };
    }
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
        return { ok: false, summary: '记忆格式错误', detail: 'name 必须是非空字符串' };
    }
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) {
        return { ok: false, summary: '记忆格式错误', detail: 'content 必须是非空字符串' };
    }
    const tags = Array.isArray(payload.tags)
        ? payload.tags.filter(t => typeof t === 'string')
        : [];

    // 0. 已删除检查：如果记忆曾被用户删除（通过内容签名匹配），
    //    跳过保存，防止历史消息重新加载时被 AI 工具调用重新记录
    //    标记为 skipped 而非失败，避免 AI 误判为错误并重试
    if (isMemoryDeleted('', name, content)) {
        return {
            ok: true,
            skipped: true,
            summary: '记忆已被用户删除，跳过保存',
            detail: '此记忆曾被用户删除，不再自动保存'
        };
    }

    // 1. 内容去重：查找相似度 ≥ 0.85 的已有记忆
    //    标记为 skipped 而非失败，避免 AI 误判为错误并重试
    //    返回已有记忆的实际 ID，便于 AI 后续调用 merge/update/delete 时引用正确 ID
    const dup = findSimilarMemory(name, content, 0.85);
    if (dup) {
        if (dup.matchType === 'exact') {
            // 精确重复：完全跳过
            return {
                ok: true,
                skipped: true,
                summary: '记忆已存在，跳过保存',
                detail: `已存在完全相同的记忆"${dup.mem.title}"（id=${dup.mem.id}），请后续工具调用使用此 id`
            };
        }
        // 高相似度：合并 tags 到已有记忆（不新增）
        if (tags.length > 0) {
            const existingTags = dup.mem.tags || [];
            const merged = [...new Set([...existingTags, ...tags])];
            if (merged.length !== existingTags.length) {
                updateMemory(dup.mem.id, { tags: merged });
            }
        }
        return {
            ok: true,
            skipped: true,
            summary: '相似记忆已存在，跳过保存',
            detail: `已存在相似记忆"${dup.mem.title}"（id=${dup.mem.id}），未重复保存。如需融合/更新，请使用此 id`
        };
    }

    // 2. 新增记忆：忽略 AI 生成的 id，统一使用系统生成的 id（时间戳格式 mem-1722580800000）
    //    避免与已有记忆 ID 冲突，同时保证后续 memory_update/memory_delete/memory_merge
    //    等工具调用引用正确的 ID
    const mem = addMemory(name, content, type, { tags });
    if (mem) {
        return {
            ok: true,
            summary: '已保存记忆',
            detail: `"${name}" 已添加到长期记忆（id=${mem.id}），后续调用 memory_update/memory_delete/memory_merge 时必须使用此 id`
        };
    }
    return { ok: false, summary: '保存失败' };
}

/**
 * 执行 memory_update 工具调用
 * @param {Object} payload - { id, type?, name?, content?, tags? }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryUpdate(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) {
        return { ok: false, summary: '记忆格式错误', detail: 'id 必须是非空字符串' };
    }
    const updates = {};
    if (typeof payload.type === 'string') {
        const validTypes = ['preference', 'context', 'fact', 'instruction'];
        if (!validTypes.includes(payload.type)) {
            return { ok: false, summary: '记忆格式错误', detail: 'type 必须是 preference/context/fact/instruction' };
        }
        updates.category = payload.type;
    }
    if (typeof payload.name === 'string' && payload.name.trim()) {
        updates.title = payload.name.trim();
    }
    if (typeof payload.content === 'string' && payload.content.trim()) {
        updates.content = payload.content.trim();
    }
    if (Array.isArray(payload.tags)) {
        updates.tags = payload.tags.filter(t => typeof t === 'string');
    }
    const updated = updateMemory(id, updates);
    if (updated) {
        return { ok: true, summary: '已更新记忆', detail: `"${updated.title}" 已更新` };
    }
    return { ok: false, summary: '更新失败', detail: `未找到 ID 为 ${id} 的记忆` };
}

/**
 * 执行 memory_delete 工具调用
 * @param {Object} payload - { id }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryDelete(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) {
        return { ok: false, summary: '记忆格式错误', detail: 'id 必须是非空字符串' };
    }
    if (deleteMemory(id)) {
        return { ok: true, summary: '已删除记忆', detail: `记忆 ${id} 已删除` };
    }
    return { ok: false, summary: '删除失败', detail: `未找到 ID 为 ${id} 的记忆` };
}

/**
 * 执行 memory_import_preview 工具调用
 *
 * 预览导入记忆（不实际保存）。将 content 解析为记忆候选列表，
 * 与已有记忆去重后返回可导入的记忆列表。
 *
 * 参考 deepseek-pp/core/memory/import-tool.ts:executeMemoryImportToolCall
 *
 * @param {Object} payload - { content, defaultType?, tags? }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryImportPreview(payload) {
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (!content.trim()) {
        return { ok: false, summary: '记忆格式错误', detail: 'content 必须是非空字符串' };
    }
    const defaultType = typeof payload.defaultType === 'string' ? payload.defaultType : undefined;
    const tags = Array.isArray(payload.tags) ? payload.tags.filter(t => typeof t === 'string') : undefined;

    try {
        const result = previewMemoryImport({ content, defaultType, tags });
        const count = result.memories.length;
        // 构建记忆标题列表摘要（最多 20 条，避免过长）
        const titleList = result.memories
            .slice(0, 20)
            .map((m, i) => `${i + 1}. [${m.category}] ${m.title}`)
            .join('\n');
        const moreHint = count > 20 ? `\n...（共 ${count} 条，仅显示前 20 条）` : '';
        const detail = `可导入 ${count} 条，重复 ${result.duplicates} 条，拒绝 ${result.rejected} 条\n${titleList}${moreHint}`;
        return {
            ok: true,
            summary: `预览就绪：${count} 条可导入`,
            detail
        };
    } catch (e) {
        return { ok: false, summary: '预览失败', detail: e?.message || String(e) };
    }
}

/**
 * 执行 memory_recall 工具调用
 *
 * 报告 AI 在当前回复中调用了哪些记忆。被报告的记忆会自动增加访问次数，
 * 用于统计记忆的使用频率，作为后续记忆审查和归档的依据。
 *
 * 使用场景：AI 在回复用户时参考了已有记忆，应当主动调用此工具报告所调用的记忆 ID，
 * 让记忆系统记录调用次数，便于后续审查时识别高频使用的记忆。
 *
 * @param {Object} payload - { memoryIds: string[] }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryRecall(payload) {
    const memoryIds = Array.isArray(payload.memoryIds) ? payload.memoryIds : [];
    if (memoryIds.length === 0) {
        return { ok: false, summary: '记忆格式错误', detail: 'memoryIds 必须是非空数组' };
    }
    // 校验所有 ID 是否存在
    const validIds = [];
    const invalidIds = [];
    for (const id of memoryIds) {
        if (typeof id !== 'string' || !id.trim()) continue;
        const mem = findMemoryById(id.trim());
        if (mem) {
            validIds.push(id.trim());
        } else {
            invalidIds.push(id);
        }
    }
    if (validIds.length === 0) {
        return { ok: false, summary: '调用报告失败', detail: `所有 memoryIds 均无效: ${invalidIds.join(', ')}` };
    }
    // 增加访问次数
    touchMemories(validIds);
    // 构建报告详情
    const titles = validIds.map(id => {
        const mem = findMemoryById(id);
        return mem ? `"${mem.title}"(${(mem.accessCount || 0) + 1}次)` : id;
    });
    const detail = invalidIds.length > 0
        ? `已记录 ${validIds.length} 条记忆的调用：${titles.join('、')}。无效 ID: ${invalidIds.join(', ')}`
        : `已记录 ${validIds.length} 条记忆的调用：${titles.join('、')}`;
    return {
        ok: true,
        summary: `已报告调用 ${validIds.length} 条记忆`,
        detail
    };
}

/**
 * 执行 memory_merge 工具调用
 *
 * 将多条有关联的记忆融合为一条新记忆。
 *
 * 重要约束：
 *   - 只能融合"确实有关联"的记忆（如同一主题、相互补充、信息重叠）
 *   - 不能盲目合并无关记忆
 *   - 融合后原记忆被删除，新记忆继承原记忆的 tags 和访问统计
 *
 * @param {Object} payload - { memoryIds: string[], name: string, content: string, type?: string, tags?: string[] }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryMerge(payload) {
    const memoryIds = Array.isArray(payload.memoryIds) ? payload.memoryIds : [];
    if (memoryIds.length < 2) {
        return { ok: false, summary: '记忆格式错误', detail: 'memoryIds 至少需要 2 条记忆才能融合' };
    }
    const trimmedIds = memoryIds.map(id => typeof id === 'string' ? id.trim() : '').filter(Boolean);
    if (trimmedIds.length < 2) {
        return { ok: false, summary: '记忆格式错误', detail: 'memoryIds 至少需要 2 条有效 ID' };
    }
    const result = mergeMemories(trimmedIds, {
        name: payload.name,
        content: payload.content,
        type: payload.type,
        tags: payload.tags
    });
    if (result.ok) {
        const newMem = result.newMemory;
        return {
            ok: true,
            summary: `已融合 ${result.deletedCount} 条记忆为 1 条新记忆`,
            detail: `原 ${result.deletedCount} 条记忆已删除，新记忆"${newMem.title}"(id=${newMem.id}) 已创建，继承访问次数 ${newMem.accessCount} 次`
        };
    }
    return { ok: false, summary: '融合失败', detail: result.reason || '未知原因' };
}

/**
 * 执行 memory_review 工具调用
 *
 * 审查并整理记忆库，返回审查报告供 AI 决策后续操作（如调用 memory_merge / memory_delete）。
 *
 * 审查维度：
 *   1. 重复/相似记忆：识别可能重复或高度相似的记忆对，建议融合
 *   2. 过期/低频记忆：识别长期未访问且访问次数低的记忆，建议删除
 *   3. 统计摘要：返回记忆总数、各分类数量、平均访问次数等
 *
 * AI 收到审查报告后，应当：
 *   - 对"建议融合"的记忆对，调用 memory_merge 工具进行融合
 *   - 对"建议删除"的记忆，调用 memory_delete 工具删除
 *   - 不要一次删除/融合过多，每次审查后最多处理 3-5 条
 *
 * @param {Object} payload - { focus?: string }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryReview(payload) {
    const focus = typeof payload.focus === 'string' ? payload.focus.trim() : '';
    const allMemories = getMemories();
    if (allMemories.length === 0) {
        return { ok: true, summary: '审查完成：记忆库为空', detail: '当前没有任何记忆，无需审查' };
    }

    // 1. 统计摘要
    const stats = {
        total: allMemories.length,
        byCategory: {},
        avgAccessCount: 0,
        pinnedCount: 0,
        disabledCount: 0
    };
    let totalAccess = 0;
    for (const mem of allMemories) {
        const cat = mem.category || 'preference';
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
        totalAccess += (mem.accessCount || 0);
        if (mem.pinned) stats.pinnedCount++;
        if (mem.enabled === false) stats.disabledCount++;
    }
    stats.avgAccessCount = (totalAccess / allMemories.length).toFixed(1);

    // 2. 识别重复/相似记忆对（基于内容相似度）
    const mergeSuggestions = [];
    const now = Date.now();
    const DAY_MS = 86400000;
    for (let i = 0; i < allMemories.length; i++) {
        for (let j = i + 1; j < allMemories.length; j++) {
            const a = allMemories[i];
            const b = allMemories[j];
            const sim = _computeMemorySimilarity(a, b);
            if (sim.score >= 0.6) {
                mergeSuggestions.push({
                    ids: [a.id, b.id],
                    titles: [a.title, b.title],
                    similarity: sim.score.toFixed(2),
                    reason: sim.reason
                });
            }
        }
        // 限制建议数量，避免过多
        if (mergeSuggestions.length >= 10) break;
    }

    // 3. 识别过期/低频记忆（90 天未访问 + 访问次数 < 3 + 未置顶）
    const staleThreshold = now - 90 * DAY_MS;
    const deleteSuggestions = allMemories
        .filter(m => !m.pinned && m.enabled !== false &&
            (m.lastAccessedAt || 0) < staleThreshold &&
            (m.accessCount || 0) < 3)
        .map(m => ({
            id: m.id,
            title: m.title,
            lastAccessedDays: Math.floor((now - (m.lastAccessedAt || 0)) / DAY_MS),
            accessCount: m.accessCount || 0
        }))
        .sort((a, b) => b.lastAccessedDays - a.lastAccessedDays)
        .slice(0, 10);

    // 4. 构建审查报告
    const reportLines = [
        `## 记忆库审查报告${focus ? `（重点：${focus}）` : ''}`,
        '',
        `### 统计摘要`,
        `- 记忆总数：${stats.total} 条`,
        `- 分类分布：${Object.entries(stats.byCategory).map(([k, v]) => `${k}=${v}`).join('、')}`,
        `- 平均访问次数：${stats.avgAccessCount}`,
        `- 置顶记忆：${stats.pinnedCount} 条`,
        `- 已禁用记忆：${stats.disabledCount} 条`,
        '',
        `### 建议融合的记忆对（${mergeSuggestions.length} 组）`
    ];
    if (mergeSuggestions.length === 0) {
        reportLines.push('- 暂无高度相似的记忆对');
    } else {
        mergeSuggestions.forEach((s, i) => {
            reportLines.push(`${i + 1}. [相似度 ${s.similarity}] "${s.titles[0]}" + "${s.titles[1]}"（${s.reason}）`);
            reportLines.push(`   IDs: ${s.ids.join(', ')}`);
        });
    }
    reportLines.push('', `### 建议删除的过期记忆（${deleteSuggestions.length} 条）`);
    if (deleteSuggestions.length === 0) {
        reportLines.push('- 暂无过期记忆');
    } else {
        deleteSuggestions.forEach((s, i) => {
            reportLines.push(`${i + 1}. "${s.title}"（${s.lastAccessedDays} 天未访问，访问 ${s.accessCount} 次）`);
            reportLines.push(`   ID: ${s.id}`);
        });
    }
    reportLines.push(
        '',
        '### 后续操作建议',
        '- 对"建议融合"的记忆对：确认确实有关联后，调用 memory_merge 工具融合',
        '- 对"建议删除"的过期记忆：调用 memory_delete 工具删除',
        '- 每次最多处理 3-5 条，避免一次操作过多',
        '- 不要强制融合/删除，仅处理确实有必要的项'
    );

    return {
        ok: true,
        summary: `审查完成：${stats.total} 条记忆，${mergeSuggestions.length} 组建议融合，${deleteSuggestions.length} 条建议删除`,
        detail: reportLines.join('\n')
    };
}

// ============================================================
// 新增工具执行器（参考 mem0 search / AgentMemory memory_smart_search）
// ============================================================

/**
 * 执行 memory_search 工具调用
 *
 * 让 AI 主动搜索记忆库，而不是被动等待注入。支持两种模式：
 *   1. 关键词模式（默认）：按 query 在标题/内容/标签中子串匹配
 *   2. 相似度模式：当 threshold > 0 时，使用 bigram Jaccard 相似度
 *
 * 场景：当 [系统记忆] 注入的内容不够，或 AI 需要查找特定主题的记忆时使用
 *
 * @param {Object} payload - { query: string, limit?: number, threshold?: number, category?: string }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemorySearch(payload) {
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
        return { ok: false, summary: '搜索参数错误', detail: 'query 不能为空' };
    }
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 10, 1), 50);
    const threshold = Math.min(Math.max(Number(payload.threshold) || 0, 0), 1);
    const category = typeof payload.category === 'string' ? payload.category.trim() : '';

    const all = getMemories();
    if (all.length === 0) {
        return { ok: true, summary: '记忆库为空', detail: '当前没有任何记忆' };
    }

    const qLower = query.toLowerCase();
    const results = [];
    for (const mem of all) {
        // 分类筛选
        if (category && (mem.category || 'preference') !== category) continue;
        // 已禁用的不参与搜索
        if (mem.enabled === false) continue;

        let score = 0;
        let matchType = 'none';

        if (threshold > 0) {
            // 相似度模式：综合标题+内容相似度
            const titleSim = _bigramSimilarity(mem.title || '', query);
            const contentSim = _bigramSimilarity(mem.content || '', query);
            score = titleSim * 0.3 + contentSim * 0.7;
            if (score >= threshold) matchType = 'similar';
        } else {
            // 关键词子串模式
            const title = (mem.title || '').toLowerCase();
            const content = (mem.content || '').toLowerCase();
            const tags = Array.isArray(mem.tags) ? mem.tags.join(' ').toLowerCase() : '';
            if (title.includes(qLower)) {
                score = 0.9;
                matchType = 'title';
            } else if (content.includes(qLower)) {
                score = 0.6;
                matchType = 'content';
            } else if (tags.includes(qLower)) {
                score = 0.5;
                matchType = 'tags';
            }
        }

        if (matchType !== 'none') {
            results.push({ mem, score, matchType });
        }
    }

    if (results.length === 0) {
        return {
            ok: true,
            summary: `未找到与"${query}"相关的记忆`,
            detail: `搜索了 ${all.length} 条记忆，没有匹配结果${threshold > 0 ? `（相似度阈值 ${threshold}）` : ''}`
        };
    }

    // 按分数降序，取 top N
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);

    const lines = [`找到 ${results.length} 条相关记忆（显示前 ${top.length} 条）：`];
    top.forEach((r, i) => {
        const m = r.mem;
        const scoreStr = r.score.toFixed(2);
        lines.push(`${i + 1}. (id:${m.id}) [${m.category || 'preference'}] ${m.title}`);
        lines.push(`   内容: ${m.content}`);
        if (Array.isArray(m.tags) && m.tags.length > 0) {
            lines.push(`   标签: ${m.tags.join(', ')}`);
        }
        lines.push(`   匹配: ${r.matchType} (得分 ${scoreStr}) | 访问 ${m.accessCount || 0} 次${m.pinned ? ' | 已置顶' : ''}`);
    });

    return {
        ok: true,
        summary: `找到 ${results.length} 条相关记忆`,
        detail: lines.join('\n')
    };
}

/**
 * 执行 memory_list 工具调用
 *
 * 列出记忆库中的记忆，支持按分类/标签筛选和分页。
 * 与 memory_review 的区别：review 侧重于相似度分析和建议，
 * list 侧重于让 AI 看到记忆全貌（标题+ID），便于后续引用。
 *
 * @param {Object} payload - { category?: string, tag?: string, limit?: number, offset?: number, includeDisabled?: boolean }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryList(payload) {
    const category = typeof payload.category === 'string' ? payload.category.trim() : '';
    const tag = typeof payload.tag === 'string' ? payload.tag.trim() : '';
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(payload.offset, 10) || 0, 0);
    const includeDisabled = payload.includeDisabled === true;

    let all = getMemories();
    if (!includeDisabled) {
        all = all.filter(m => m.enabled !== false);
    }
    if (category) {
        all = all.filter(m => (m.category || 'preference') === category);
    }
    if (tag) {
        all = all.filter(m => Array.isArray(m.tags) && m.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
    }

    if (all.length === 0) {
        return {
            ok: true,
            summary: '记忆列表为空',
            detail: `没有符合条件的记忆${category ? `（分类: ${category}）` : ''}${tag ? `（标签: ${tag}）` : ''}`
        };
    }

    const total = all.length;
    const page = all.slice(offset, offset + limit);

    const lines = [`记忆列表（总计 ${total} 条，显示 ${offset + 1}-${offset + page.length}）：`];
    if (category) lines.push(`筛选分类: ${category}`);
    if (tag) lines.push(`筛选标签: ${tag}`);

    page.forEach((m, i) => {
        const idx = offset + i + 1;
        const pin = m.pinned ? '★' : ' ';
        const dis = m.enabled === false ? '[禁用]' : '';
        lines.push(`${idx}. ${pin} (id:${m.id}) [${m.category || 'preference'}] ${m.title} ${dis}`);
        // 内容截断显示（避免列表过长）
        const c = m.content || '';
        const preview = c.length > 80 ? c.slice(0, 80) + '...' : c;
        lines.push(`     ${preview}`);
        if (Array.isArray(m.tags) && m.tags.length > 0) {
            lines.push(`     标签: ${m.tags.join(', ')}`);
        }
    });

    if (total > offset + page.length) {
        lines.push(`\n还有 ${total - offset - page.length} 条未显示，可增大 offset 或 limit 查看`);
    }

    return {
        ok: true,
        summary: `共 ${total} 条记忆`,
        detail: lines.join('\n')
    };
}

/**
 * 执行 memory_pin 工具调用
 *
 * 切换记忆的置顶状态。置顶的记忆会在每次注入时获得 +1000 评分加成，
 * 确保始终被注入到 [系统记忆] 中。
 *
 * 设计为切换式（toggle）而非显式 pin/unpin，减少工具数量。
 *
 * @param {Object} payload - { id: string, name?: string }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryPin(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) {
        return { ok: false, summary: '参数错误', detail: 'id 不能为空' };
    }
    const mem = findMemoryById(id);
    if (!mem) {
        return { ok: false, summary: '记忆不存在', detail: `未找到 id=${id} 的记忆` };
    }
    const newPinned = togglePinMemory(id);
    if (newPinned === null) {
        return { ok: false, summary: '置顶失败', detail: `无法切换记忆 id=${id} 的置顶状态` };
    }
    return {
        ok: true,
        summary: newPinned ? '已置顶' : '已取消置顶',
        detail: `记忆"${mem.title}"（id=${id}）${newPinned ? '已设为置顶，将始终注入到 [系统记忆]' : '已取消置顶'}`
    };
}

/**
 * 执行 memory_stats 工具调用
 *
 * 返回记忆库的轻量级统计概览。比 memory_review 更快，不计算相似度。
 * 适用于 AI 快速了解记忆库状态，决定是否需要 review/list/search。
 *
 * @param {Object} payload - {}（无参数，保留以备未来扩展）
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryStats(payload) {
    const all = getMemories();
    if (all.length === 0) {
        return { ok: true, summary: '记忆库为空', detail: '当前没有任何记忆' };
    }

    const stats = {
        total: all.length,
        byCategory: {},
        byScope: { global: 0, project: 0 },
        pinnedCount: 0,
        disabledCount: 0,
        totalAccessCount: 0,
        avgAccessCount: 0,
        tagsCount: 0
    };
    const tagSet = new Set();
    let totalAccess = 0;
    for (const mem of all) {
        const cat = mem.category || 'preference';
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
        stats.byScope[mem.scope || 'global']++;
        if (mem.pinned) stats.pinnedCount++;
        if (mem.enabled === false) stats.disabledCount++;
        totalAccess += (mem.accessCount || 0);
        if (Array.isArray(mem.tags)) {
            for (const t of mem.tags) {
                if (typeof t === 'string' && t.trim()) tagSet.add(t.trim());
            }
        }
    }
    stats.totalAccessCount = totalAccess;
    stats.avgAccessCount = (totalAccess / all.length).toFixed(1);
    stats.tagsCount = tagSet.size;

    const lines = [
        '## 记忆库统计',
        '',
        `### 概览`,
        `- 记忆总数：${stats.total} 条`,
        `- 置顶记忆：${stats.pinnedCount} 条`,
        `- 已禁用：${stats.disabledCount} 条`,
        `- 标签总数：${stats.tagsCount} 个`,
        `- 累计访问次数：${stats.totalAccessCount} 次`,
        `- 平均访问次数：${stats.avgAccessCount}`,
        '',
        `### 分类分布`,
        ...Object.entries(stats.byCategory).map(([k, v]) => `- ${k}: ${v} 条`),
        '',
        `### 范围分布`,
        `- 全局: ${stats.byScope.global} 条`,
        `- 项目: ${stats.byScope.project} 条`
    ];

    return {
        ok: true,
        summary: `${stats.total} 条记忆，${stats.pinnedCount} 置顶，${stats.tagsCount} 标签`,
        detail: lines.join('\n')
    };
}

/**
 * 执行 memory_export 工具调用
 *
 * 将记忆库导出为 JSON 字符串，便于备份、迁移或跨设备同步。
 * 导出的 JSON 可通过 memory_import_preview 解析后重新导入。
 *
 * 注意：导出操作不会修改记忆库，是只读操作。
 *
 * @param {Object} payload - { includeDisabled?: boolean, includePinnedOnly?: boolean, category?: string }
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryExport(payload) {
    const opts = {
        includeDisabled: payload.includeDisabled !== false,
        includePinnedOnly: payload.includePinnedOnly === true,
        category: typeof payload.category === 'string' ? payload.category.trim() : ''
    };

    const result = exportMemories(opts);
    if (!result.ok) {
        return { ok: false, summary: '导出失败', detail: '序列化记忆时出错' };
    }

    // 将 JSON 内容放入 detail，AI 可在 <tool_results> 中看到
    // 注意：大记忆库可能产生很长的输出，但这是用户明确请求的导出操作
    const sizeKB = (result.bytes / 1024).toFixed(1);
    const header = `已导出 ${result.count} 条记忆（${sizeKB} KB），JSON 内容如下：\n\n`;

    return {
        ok: true,
        summary: `已导出 ${result.count} 条记忆`,
        detail: header + result.json
    };
}

/**
 * 执行 memory_archive 工具调用
 *
 * 手动触发归档：删除 90 天未访问 + 访问次数 < 3 + 未置顶的记忆。
 * 这些记忆通常是过期或低价值的，归档可保持记忆库整洁。
 *
 * 与 memory_delete 的区别：archive 是按条件批量清理，delete 是按 ID 精确删除。
 * 归档操作不可逆，但被归档的记忆会被记录到已删除集合，防止被历史消息重新加载时重新保存。
 *
 * @param {Object} payload - {}（无参数）
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeMemoryArchive(payload) {
    const before = getMemories().length;
    const archived = archiveStaleMemories();
    const after = getMemories().length;

    if (archived === 0) {
        return {
            ok: true,
            summary: '无需归档',
            detail: `没有符合条件的过期记忆（归档条件：90 天未访问 + 访问次数 < 3 + 未置顶）。当前记忆库共 ${before} 条。`
        };
    }

    return {
        ok: true,
        summary: `已归档 ${archived} 条过期记忆`,
        detail: `归档前 ${before} 条 → 归档后 ${after} 条。被归档的记忆已记录到已删除集合，不会被历史消息重新加载时重新保存。`
    };
}

/**
 * 执行 memory_get 工具调用
 *
 * 按 ID 读取单条记忆的完整字段（含历史版本 history），用于 AI 需要查看记忆详情时。
 * 与 memory_list / memory_search 的区别：get 返回单条记忆的全部字段（含 history），
 * list/search 仅返回摘要，不包含历史版本。
 *
 * @param {Object} payload - { id: string }
 * @returns {{ ok: boolean, summary: string, detail?: string }} 执行结果
 */
function _executeMemoryGet(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) {
        return { ok: false, summary: '参数错误', detail: 'id 必须是非空字符串' };
    }
    const mem = getMemoryById(id);
    if (!mem) {
        return { ok: false, summary: '记忆不存在', detail: '未找到 id=' + id + ' 的记忆' };
    }

    // 格式化时间戳为可读日期（容错：无值时显示"未知"）
    const formatDate = (ts) => {
        if (!ts) return '未知';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return '未知';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (e) {
            return '未知';
        }
    };

    // 截断函数（用于历史版本内容预览，最多 80 字符）
    const truncate = (s, n) => {
        const str = typeof s === 'string' ? s : '';
        return str.length > n ? str.slice(0, n) + '...' : str;
    };

    const tagsText = Array.isArray(mem.tags) && mem.tags.length > 0 ? mem.tags.join(', ') : '（无）';
    const history = Array.isArray(mem.history) ? mem.history : [];
    // 历史版本按时间倒序（最新的旧版本排在前面）
    const sortedHistory = history.slice().sort((a, b) => {
        const ta = a?.timestamp || a?.updatedAt || 0;
        const tb = b?.timestamp || b?.updatedAt || 0;
        return tb - ta;
    });

    const reportLines = [
        '## 记忆详情',
        '',
        `- ID: ${mem.id || '未知'}`,
        `- 标题: ${mem.title || '（无）'}`,
        `- 分类: ${mem.category || 'preference'}`,
        `- 内容: ${mem.content || '（无）'}`,
        `- 标签: ${tagsText}`,
        `- 置顶: ${mem.pinned ? '是' : '否'}`,
        `- 启用: ${mem.enabled === false ? '否' : '是'}`,
        `- 范围: ${mem.scope || 'global'}`,
        `- 创建时间: ${formatDate(mem.createdAt)}`,
        `- 更新时间: ${formatDate(mem.updatedAt)}`,
        `- 访问次数: ${mem.accessCount || 0}`,
        `- 最后访问: ${formatDate(mem.lastAccessedAt)}`
    ];

    if (sortedHistory.length > 0) {
        reportLines.push('', `### 历史版本（${sortedHistory.length} 条）`);
        sortedHistory.forEach((h, i) => {
            const ts = h?.timestamp || h?.updatedAt;
            const title = h?.title || '（无标题）';
            const content = truncate(h?.content, 80);
            const reason = h?.reason || '（无）';
            reportLines.push(`${i + 1}. [${formatDate(ts)}] 标题: ${title} | 内容: ${content} | 原因: ${reason}`);
        });
    } else {
        reportLines.push('', '### 历史版本（0 条）');
        reportLines.push('暂无历史版本（此记忆未被 memory_replace 覆盖过）');
    }

    return { ok: true, summary: '记忆详情', detail: reportLines.join('\n') };
}

/**
 * 执行 memory_clear 工具调用
 *
 * 批量清空指定作用域的记忆。需要显式 confirm:true 确认，避免误操作。
 * 默认保留置顶记忆（可通过 includePinned:true 一并清空）。
 * 所有被删除的记忆会加入已删除集合，防止被历史消息重新加载时重新保存。
 *
 * @param {Object} payload - { scope: 'global'|'project'|'all', confirm: boolean, includePinned?: boolean }
 * @returns {{ ok: boolean, summary: string, detail?: string }} 执行结果
 */
function _executeMemoryClear(payload) {
    const scope = typeof payload.scope === 'string' ? payload.scope.trim() : '';
    const validScopes = ['global', 'project', 'all'];
    if (!validScopes.includes(scope)) {
        return { ok: false, summary: '参数错误', detail: 'scope 必须是 global/project/all' };
    }
    if (payload.confirm !== true) {
        return { ok: false, summary: '需要确认', detail: '请添加 "confirm":true 参数以确认清空操作' };
    }
    const result = clearMemoriesByScope(scope, {
        includePinned: payload.includePinned === true,
        confirm: true
    });
    if (result && result.ok) {
        return {
            ok: true,
            summary: '已清空 ' + result.deletedCount + ' 条记忆',
            detail: '已删除 ' + result.deletedCount + ' 条，保留 ' + result.retainedPinnedCount + ' 条置顶记忆。所有被删除的记忆已加入已删除集合，不会被重新保存。'
        };
    }
    return { ok: false, summary: '清空失败', detail: (result && result.reason) || '未知原因' };
}

/**
 * 执行 memory_replace 工具调用
 *
 * 覆盖式更新记忆：用新内容完全替换旧内容，旧内容作为快照进入 history。
 * 与 memory_update 的区别：update 仅修改部分字段，replace 完全替换并保留历史轨迹。
 * 适用于用户偏好已发生变化的场景（旧内容已失效但需保留历史）。
 *
 * @param {Object} payload - { id: string, content: string, title?: string, tags?: string[], reason?: string }
 * @returns {{ ok: boolean, summary: string, detail?: string }} 执行结果
 */
function _executeMemoryReplace(payload) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) {
        return { ok: false, summary: '参数错误', detail: 'id 必须是非空字符串' };
    }
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) {
        return { ok: false, summary: '参数错误', detail: 'content 必须是非空字符串' };
    }
    const mem = replaceMemory(id, content, {
        title: payload.title,
        tags: payload.tags,
        reason: payload.reason
    });
    if (!mem) {
        return { ok: false, summary: '替换失败', detail: '未找到 id=' + id + ' 的记忆' };
    }
    const historyLen = mem.history ? mem.history.length : 0;
    return {
        ok: true,
        summary: '已覆盖更新记忆',
        detail: '记忆"' + mem.title + '"已更新，新版本 v' + mem.version + '，旧内容已存入历史（共 ' + historyLen + ' 条历史版本）'
    };
}

/**
 * 执行 todo_write 工具调用 — 全量替换 todo 清单
 * @param {Object} payload - { todos: Array<{id, content, status, priority}> }
 * @returns {{ ok: boolean, summary: string, detail: string }}
 */
function _executeTodoWrite(payload) {
    if (typeof window === 'undefined' || typeof window._dsTodoWrite !== 'function') {
        return { ok: false, summary: 'Todo 模块未初始化', detail: 'window._dsTodoWrite 不存在' };
    }
    try {
        return window._dsTodoWrite(payload || {});
    } catch (e) {
        return { ok: false, summary: '执行失败', detail: String(e && e.message || e) };
    }
}

/**
 * 执行 todo_read 工具调用 — 读取当前 todo 清单
 * @param {Object} payload - 未使用
 * @returns {{ ok: boolean, summary: string, detail: string }}
 */
function _executeTodoRead(payload) {
    if (typeof window === 'undefined' || typeof window._dsTodoRead !== 'function') {
        return { ok: false, summary: 'Todo 模块未初始化', detail: 'window._dsTodoRead 不存在' };
    }
    try {
        return window._dsTodoRead();
    } catch (e) {
        return { ok: false, summary: '执行失败', detail: String(e && e.message || e) };
    }
}

/**
 * 执行 todo_clear 工具调用 — 清空 todo 清单
 * @param {Object} payload - 未使用
 * @returns {{ ok: boolean, summary: string, detail: string }}
 */
function _executeTodoClear(payload) {
    if (typeof window === 'undefined' || typeof window._dsTodoClear !== 'function') {
        return { ok: false, summary: 'Todo 模块未初始化', detail: 'window._dsTodoClear 不存在' };
    }
    try {
        return window._dsTodoClear();
    } catch (e) {
        return { ok: false, summary: '执行失败', detail: String(e && e.message || e) };
    }
}

/**
 * 执行 ask_user 工具调用 — 向用户提问
 *
 * 校验 questions 参数（1-4 个问题，每问题 2-4 个选项），
 * 返回 pending 标记。实际异步等待由 capability-agent.js 处理。
 *
 * @param {Object} payload - { questions: Array<{question, header, options, multiSelect}> }
 * @returns {{ ok: boolean, pending?: boolean, summary: string, detail: string }}
 */
function _executeAskUser(payload) {
    if (!payload || !Array.isArray(payload.questions) || payload.questions.length < 1) {
        return { ok: false, summary: '参数错误', detail: 'questions 必须是 1-4 个问题的数组' };
    }
    if (payload.questions.length > 4) {
        return { ok: false, summary: '问题过多', detail: '每次最多 4 个问题，当前 ' + payload.questions.length + ' 个' };
    }

    // 校验每个问题
    for (let i = 0; i < payload.questions.length; i++) {
        const q = payload.questions[i];
        if (!q || typeof q.question !== 'string' || q.question.trim() === '') {
            return { ok: false, summary: '问题缺失', detail: '第 ' + (i + 1) + ' 个问题的 question 不能为空' };
        }
        if (!q.header || typeof q.header !== 'string' || q.header.trim() === '') {
            return { ok: false, summary: '标签缺失', detail: '第 ' + (i + 1) + ' 个问题的 header 不能为空' };
        }
        if (q.header.length > 12) {
            return { ok: false, summary: '标签过长', detail: '第 ' + (i + 1) + ' 个问题的 header 最多 12 字符' };
        }
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
            return { ok: false, summary: '选项数量错误', detail: '第 ' + (i + 1) + ' 个问题的 options 必须是 2-4 个' };
        }
        for (let j = 0; j < q.options.length; j++) {
            const opt = q.options[j];
            if (!opt || typeof opt.label !== 'string' || opt.label.trim() === '') {
                return { ok: false, summary: '选项标签缺失', detail: '第 ' + (i + 1) + ' 个问题的第 ' + (j + 1) + ' 个选项的 label 不能为空' };
            }
        }
    }

    // 校验成功，返回 pending 标记（capability-agent 会 await window._dsAskUser）
    const questionCount = payload.questions.length;
    return {
        ok: true,
        pending: true,
        summary: '等待用户回答',
        detail: '已展示 ' + questionCount + ' 个问题给用户，等待回答'
    };
}

// ============================================================
// Agent 控制流工具
// ============================================================

/**
 * 执行 start_agent 工具调用 — 显式启动 Agent 循环
 *
 * 让 AI 能主动声明"我要开始 Agent 模式"，触发首次续跑。
 * 与隐式触发（工具调用后自动续跑）的区别：
 *   - start_agent 用于任务开始时，AI 先分析任务再启动 Agent 循环
 *   - 续跑 prompt 会告知 AI "Agent 已启动"，AI 可开始调用工具执行任务
 *
 * 调用后行为：
 *   1. 执行器返回成功（含任务描述，用于 UI 卡片显示）
 *   2. text-process.js 将结果传给 capability-agent.js 触发续跑
 *   3. capability-agent.js 构建"Agent 已启动"的续跑 prompt 发送给 DeepSeek
 *   4. AI 收到后知道 Agent 模式已开启，可开始调用工具
 *
 * @param {Object} payload - { task?: string, reason?: string }
 * @returns {{ ok: boolean, summary: string, detail: string, agentStarted?: boolean }}
 */
function _executeStartAgent(payload) {
    const task = typeof payload?.task === 'string' ? payload.task.trim() : '';
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    return {
        ok: true,
        summary: 'Agent 已启动',
        detail: task
            ? `任务：${task}${reason ? `（理由：${reason}）` : ''}`
            : (reason || 'AI 主动启动 Agent 循环'),
        agentStarted: true
    };
}

/**
 * 执行 agent_finish 工具调用
 *
 * 这是 Agent 循环的显式终止信号。当 AI 完成用户任务并输出最终结论后，
 * 调用此工具通知扩展停止 Agent 循环。
 *
 * 设计目的：
 *   - 解决 AI 不知道何时该停止调用工具的问题
 *   - 避免无意义的循环（AI 不断调用工具但不输出最终结论）
 *   - 让用户能更快看到最终回复，输入框更早解锁
 *
 * 调用后行为：
 *   1. 执行器返回成功（仅用于 UI 卡片显示）
 *   2. text-process.js 检测到 agent_finish，调用 window._dsStopAgent()
 *   3. capability-agent.js 终止续跑循环，清空队列，解锁输入框
 *   4. 不发送续跑 prompt（AI 已经给出了最终结论）
 *
 * @param {Object} payload - {}（无参数，保留以备未来扩展，如 reason 字段）
 * @returns {{ ok: boolean, summary: string, detail?: string }}
 */
function _executeAgentFinish(payload) {
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    return {
        ok: true,
        summary: 'Agent 已结束',
        detail: reason
            ? `AI 声明任务完成，理由：${reason}。Agent 循环已终止，用户可继续输入。`
            : 'AI 声明任务完成。Agent 循环已终止，用户可继续输入。'
    };
}

/**
 * 计算两条记忆的相似度（用于 memory_review 的融合建议）
 *
 * 综合考虑标题相似度和内容相似度，并识别具体的相似原因
 * @param {Object} a - 记忆 a
 * @param {Object} b - 记忆 b
 * @returns {{ score: number, reason: string }}
 */
function _computeMemorySimilarity(a, b) {
    // 标题精确相同
    if (a.title === b.title) {
        return { score: 1.0, reason: '标题完全相同' };
    }
    // 内容精确相同
    if (a.content === b.content) {
        return { score: 0.95, reason: '内容完全相同' };
    }
    // 标题包含关系
    if (a.title.length > 3 && b.title.length > 3) {
        if (a.title.includes(b.title) || b.title.includes(a.title)) {
            return { score: 0.85, reason: '标题存在包含关系' };
        }
    }
    // 内容包含关系
    if (a.content.length > 10 && b.content.length > 10) {
        if (a.content.includes(b.content) || b.content.includes(a.content)) {
            return { score: 0.8, reason: '内容存在包含关系' };
        }
    }
    // 标签重叠
    const tagsA = new Set((a.tags || []).map(t => String(t).toLowerCase()));
    const tagsB = new Set((b.tags || []).map(t => String(t).toLowerCase()));
    let tagOverlap = 0;
    for (const t of tagsA) if (tagsB.has(t)) tagOverlap++;
    if (tagOverlap > 0 && tagsA.size > 0 && tagsB.size > 0) {
        const tagSim = (2 * tagOverlap) / (tagsA.size + tagsB.size);
        if (tagSim >= 0.5) {
            return { score: 0.6 + tagSim * 0.2, reason: `标签重叠 ${tagOverlap} 个` };
        }
    }
    // 基于 bigram 的内容相似度（复用 memory.js 的 _similarity 逻辑）
    const contentSim = _bigramSimilarity(a.content || '', b.content || '');
    if (contentSim >= 0.6) {
        return { score: contentSim, reason: `内容相似度 ${contentSim.toFixed(2)}` };
    }
    return { score: 0, reason: '' };
}

/**
 * 基于字符 bigram 的相似度计算（Jaccard 系数）
 * @param {string} a - 字符串 a
 * @param {string} b - 字符串 b
 * @returns {number} 相似度 0-1
 */
function _bigramSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const sa = new Set();
    for (let i = 0; i < a.length - 1; i++) sa.add(a.slice(i, i + 2));
    const sb = new Set();
    for (let i = 0; i < b.length - 1; i++) sb.add(b.slice(i, i + 2));
    if (sa.size === 0 || sb.size === 0) return 0;
    let intersect = 0;
    for (const g of sa) if (sb.has(g)) intersect++;
    return intersect / (sa.size + sb.size - intersect);
}

// ============================================================
// 工具调用 XML 解析（参考 deepseek-pp/core/tool/xml-tags.ts）
// ============================================================

/**
 * 宽容解析 JSON body（回退渲染）
 *
 * 当标准 JSON.parse 失败时，尝试多种修复策略解析 AI 输出的格式错误 JSON：
 *   1. 移除 Markdown 代码块包装（```json ... ``` 或 ``` ... ```）
 *   2. 移除注释（行注释和块注释）
 *   3. 压缩多行为单行（保留字符串内的换行）
 *   4. 修复单引号为双引号
 *   5. 移除尾部逗号
 *   6. 自动补全缺失的闭合括号
 *
 * 与 text-process.js 的 _lenientParseJSON 逻辑保持一致，
 * 确保 parseToolCalls（整消息扫描）和 _processParagraphForToolCalls（单段落扫描）
 * 对格式错误 JSON 的处理能力一致。
 *
 * @param {string} body - 工具调用标签内的原始文本
 * @returns {Object|null} 解析成功返回对象，失败返回 null
 */
function _lenientParseJsonBody(body) {
    if (!body || typeof body !== 'string') return null;
    try {
        let cleaned = body;
        // 1. 移除 Markdown 代码块包装
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
        // 2. 移除单行注释和块注释
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // 3. 压缩多行为单行（保留字符串内的换行）
        let compacted = '';
        let inString = false;
        let escapeNext = false;
        for (let i = 0; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escapeNext) { compacted += ch; escapeNext = false; continue; }
            if (ch === '\\') { compacted += ch; escapeNext = true; continue; }
            if (ch === '"') { inString = !inString; compacted += ch; continue; }
            if (inString) {
                compacted += ch;
            } else {
                if (ch === '\n' || ch === '\r' || ch === '\t') {
                    compacted += ' ';
                } else {
                    compacted += ch;
                }
            }
        }
        cleaned = compacted.replace(/\s+/g, ' ').trim();
        // 4. 修复单引号为双引号
        cleaned = cleaned.replace(/'/g, '"');
        // 5. 移除尾部逗号
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
        // 6. 自动补全缺失的闭合括号
        let braceDepth = 0;
        let bracketDepth = 0;
        let inStr = false;
        let escNext = false;
        for (let i = 0; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escNext) { escNext = false; continue; }
            if (ch === '\\') { escNext = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth--;
            else if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth--;
        }
        if (braceDepth > 0) cleaned += '}'.repeat(braceDepth);
        if (bracketDepth > 0) cleaned += ']'.repeat(bracketDepth);
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

/**
 * 从文本中解析所有工具调用 XML 块
 * 匹配 <tool_name>{json}</tool_name> 格式
 * @param {string} text - 待解析的文本
 * @returns {Array<{ name: string, payload: Object, raw: string, index: number, endIndex: number }>}
 */
export function parseToolCalls(text) {
    if (!text || typeof text !== 'string') return [];
    const results = [];
    // 使用 tool-descriptors 的 catalog 正则（WeakMap 缓存，避免每次调用都构建正则）
    // catalog 支持工具别名（如 mem_save → memory_save），比原硬编码 TOOL_NAMES 更完整
    const toolPattern = createXmlToolCallRegex();
    let match;
    while ((match = toolPattern.exec(text)) !== null) {
        const rawName = match[1];
        // 别名归一化为主名（如 mem_save → memory_save）
        const name = getPreferredToolInvocationName(rawName);
        const body = match[2].trim();
        const raw = match[0];
        const index = match.index;
        const endIndex = index + raw.length;
        // 尝试解析 JSON body
        let payload = null;
        try {
            payload = JSON.parse(body);
        } catch (e) {
            // 标准解析失败，使用宽容解析回退（处理换行/单引号/尾部逗号等格式问题）
            payload = _lenientParseJsonBody(body);
            if (payload) {
                console.log('[ToolCall] parseToolCalls 标准解析失败，回退渲染成功:', name);
            }
        }
        if (!payload) continue;
        if (payload && typeof payload === 'object') {
            results.push({ name, payload, raw, index, endIndex });
        }
    }
    return results;
}

/**
 * 获取工具的中文标签（供 UI 提示使用）
 *
 * 从 registry.getDescriptor(name).description 获取，替代原 TOOL_LABELS 静态映射。
 * 找不到时返回工具名本身。
 *
 * @param {string} toolName - 工具名
 * @returns {string} 中文标签
 */
export function getToolLabel(toolName) {
    const desc = registry.getDescriptor(toolName);
    return (desc && desc.description) || toolName;
}

// ============================================================
// 内置工具注册（22 个 _executeXxx → registry.register）
// ============================================================

/**
 * 注册 22 个内置工具到 registry
 *
 * 从 DEFAULT_TOOL_DESCRIPTORS 取描述符，从本地 _executeXxx 取执行器，
 * requireAgentFeedback 除 memory_recall（纯记录）和 agent_finish（终止循环）外均为 true。
 *
 * 在模块顶层调用，确保 TOOL_NAMES 在 history-cleanup.js 导入前已填充。
 */
function _registerBuiltinTools() {
    /** 不需要 Agent 续跑反馈的工具 */
    const NO_FEEDBACK = new Set(['memory_recall', 'agent_finish']);
    /** 内置工具名 → 执行器映射 */
    const executors = {
        memory_save: _executeMemorySave,
        memory_update: _executeMemoryUpdate,
        memory_delete: _executeMemoryDelete,
        memory_import_preview: _executeMemoryImportPreview,
        memory_recall: _executeMemoryRecall,
        memory_merge: _executeMemoryMerge,
        memory_review: _executeMemoryReview,
        memory_search: _executeMemorySearch,
        memory_list: _executeMemoryList,
        memory_pin: _executeMemoryPin,
        memory_stats: _executeMemoryStats,
        memory_export: _executeMemoryExport,
        memory_archive: _executeMemoryArchive,
        memory_get: _executeMemoryGet,
        memory_clear: _executeMemoryClear,
        memory_replace: _executeMemoryReplace,
        todo_write: _executeTodoWrite,
        todo_read: _executeTodoRead,
        todo_clear: _executeTodoClear,
        ask_user: _executeAskUser,
        start_agent: _executeStartAgent,
        agent_finish: _executeAgentFinish,
        skill_draft_create: executeSkillCreatorToolCall
    };
    for (const desc of DEFAULT_TOOL_DESCRIPTORS) {
        const executor = executors[desc.name];
        if (typeof executor !== 'function') {
            if (typeof console !== 'undefined') {
                console.warn('[capability-register] no executor for builtin tool:', desc.name);
            }
            continue;
        }
        registry.register(desc, executor, {
            requireAgentFeedback: !NO_FEEDBACK.has(desc.name),
            category: desc.category || 'other'
        });
    }
}

// ============================================================
// 动态工具描述符（web_search / web_fetch / python_exec / mcp_*）
// ============================================================

/** web_search 工具描述符 */
const WEB_SEARCH_DESCRIPTOR = {
    name: 'web_search',
    description: '联网搜索引擎查询（Bing），返回结构化结果（标题/URL/摘要）。AI 应使用自然语言完整问句作为查询，像人类提问一样构造搜索词。需要更多结果时可通过 topK 参数指定（1-30，默认 10，超过 10 会自动翻页合并）。',
    category: 'web',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '搜索查询（一句话/完整问句）。请用自然语言描述你想查找的信息，例如"2026年8月最新热点新闻有哪些"、"ブルアカの炎上問題の最新情報は何か"。不要只填关键词堆砌，应像在搜索引擎搜索框中输入完整问句一样。' },
            topK: { type: 'integer', description: '期望返回的结果条数（1-30，默认 10）。超过 10 时会自动翻页合并多页结果。仅在需要更多搜索结果时设置，普通搜索无需指定。', minimum: 1, maximum: 30, default: 10 }
        },
        required: ['query']
    }
};

/** web_fetch 工具描述符 */
const WEB_FETCH_DESCRIPTOR = {
    name: 'web_fetch',
    description: '抓取目标 URL 的可见正文文本（默认允许所有站点，可在设置页配置白名单限制）',
    category: 'web',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '目标 URL（http/https）' },
            maxLength: { type: 'integer', description: '文本截断长度（默认 8000）', default: 8000 }
        },
        required: ['url']
    }
};

/** mcp_discover 工具描述符 */
const MCP_DISCOVER_DESCRIPTOR = {
    name: 'mcp_discover',
    description: '列出指定 MCP 服务的可用工具',
    category: 'mcp',
    inputSchema: {
        type: 'object',
        properties: {
            server: { type: 'string', description: '服务名' }
        },
        required: ['server']
    }
};

/** mcp_describe 工具描述符 */
const MCP_DESCRIBE_DESCRIPTOR = {
    name: 'mcp_describe',
    description: '查看指定 MCP 服务中某工具的完整描述（含参数 Schema）',
    category: 'mcp',
    inputSchema: {
        type: 'object',
        properties: {
            server: { type: 'string', description: '服务名' },
            tool: { type: 'string', description: '工具名' }
        },
        required: ['server', 'tool']
    }
};

/** mcp_invoke 工具描述符 */
const MCP_INVOKE_DESCRIPTOR = {
    name: 'mcp_invoke',
    description: '调用指定 MCP 服务的工具',
    category: 'mcp',
    inputSchema: {
        type: 'object',
        properties: {
            server: { type: 'string', description: '服务名' },
            tool: { type: 'string', description: '工具名' },
            args: { type: 'object', description: '工具参数（按工具 Schema 提供）' }
        },
        required: ['server', 'tool']
    }
};

// ============================================================
// 动态工具执行器（web / python / mcp handle）
// ============================================================

/**
 * 执行 web_search 工具调用
 *
 * 委托 window._dsExecuteWebSearch（由 web-tools.js initWebTools 挂载），
 * 将结构化结果序列化为 detail 文本供 Agent 回传。
 *
 * @param {Object} payload - { query: string }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
async function _executeWebSearch(payload) {
    // 主开关检查：webToolsEnabled 关闭时拒绝执行（描述符仍注册以支持 XML 识别）
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.webToolsEnabled === false) {
        return { ok: false, summary: 'web_search 未启用', detail: '请在设置面板开启 Web 工具（webToolsEnabled）开关' };
    }
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
        return { ok: false, summary: '参数错误', detail: 'query 不能为空' };
    }
    const fn = typeof window !== 'undefined' ? window._dsExecuteWebSearch : null;
    if (typeof fn !== 'function') {
        return { ok: false, summary: 'web_search 未启用', detail: 'window._dsExecuteWebSearch 不存在（请检查 webToolsEnabled 配置）' };
    }
    try {
        // 读取 topK 参数（1-30，默认 10，超过 10 会触发 Bing 翻页）
        const topK = (typeof payload.topK === 'number' && Number.isFinite(payload.topK))
            ? Math.min(Math.max(1, Math.floor(payload.topK)), 30)
            : 10;
        const result = await fn(query, { topK });
        if (result.ok && Array.isArray(result.results)) {
            const list = result.results.map((r, i) =>
                `${i + 1}. ${r.title}\n   URL: ${r.url}\n   摘要: ${r.snippet || ''}`
            ).join('\n');
            return {
                ok: true,
                summary: `找到 ${result.results.length} 条结果`,
                detail: list || '无搜索结果'
            };
        }
        return { ok: false, summary: '搜索失败', detail: result.error || '未知错误' };
    } catch (e) {
        return { ok: false, summary: '搜索失败', detail: (e && e.message) || String(e) };
    }
}

/**
 * 执行 web_fetch 工具调用
 *
 * 委托 window._dsExecuteWebFetch（由 web-tools.js initWebTools 挂载），
 * 将抓取的正文文本作为 detail 返回。
 *
 * @param {Object} payload - { url: string, maxLength?: number }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
async function _executeWebFetch(payload) {
    // 主开关检查：webToolsEnabled 关闭时拒绝执行（描述符仍注册以支持 XML 识别）
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.webToolsEnabled === false) {
        return { ok: false, summary: 'web_fetch 未启用', detail: '请在设置面板开启 Web 工具（webToolsEnabled）开关' };
    }
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) {
        return { ok: false, summary: '参数错误', detail: 'url 不能为空' };
    }
    const fn = typeof window !== 'undefined' ? window._dsExecuteWebFetch : null;
    if (typeof fn !== 'function') {
        return { ok: false, summary: 'web_fetch 未启用', detail: 'window._dsExecuteWebFetch 不存在（请检查 webToolsEnabled 配置）' };
    }
    try {
        const result = await fn(url, { maxLength: payload.maxLength });
        if (result.ok) {
            return {
                ok: true,
                summary: result.title ? `已抓取：${result.title}` : '已抓取',
                detail: result.content || ''
            };
        }
        return { ok: false, summary: '抓取失败', detail: result.error || '未知错误' };
    } catch (e) {
        return { ok: false, summary: '抓取失败', detail: (e && e.message) || String(e) };
    }
}

/**
 * 执行 python_exec 工具调用
 *
 * 委托 window._dsExecutePythonExec（由 sandbox/index.js initSandbox 挂载）。
 * 描述符优先用 window._dsPythonExecDescriptor（含完整 Schema），未就绪时跳过注册。
 *
 * @param {Object} payload - { code: string, timeoutMs?: number, reset?: boolean }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
async function _executePythonExec(payload) {
    // 主开关检查：pythonSandboxEnabled 关闭时拒绝执行（描述符仍注册以支持 XML 识别）
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.pythonSandboxEnabled === false) {
        return { ok: false, summary: 'python_exec 未启用', detail: '请在设置面板开启 Python 沙箱（pythonSandboxEnabled）开关' };
    }
    const fn = typeof window !== 'undefined' ? window._dsExecutePythonExec : null;
    if (typeof fn !== 'function') {
        return { ok: false, summary: 'python_exec 未启用', detail: 'window._dsExecutePythonExec 不存在（请检查 pythonSandboxEnabled 配置）' };
    }
    return fn(payload);
}

/**
 * 执行 mcp_discover 工具调用 — 列出指定 MCP 服务的可用工具
 *
 * 发现后自动把工具注册到 registry（Step 3 投影集成），
 * 使后续可直接按 mcp__{server}__{tool} 名调用。
 *
 * @param {Object} payload - { server: string }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
async function _executeMcpDiscover(payload) {
    // 主开关检查：mcpEnabled 关闭时拒绝执行（描述符仍注册以支持 XML 识别）
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.mcpEnabled === false) {
        return { ok: false, summary: 'mcp_discover 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
    }
    const serverName = typeof payload.server === 'string' ? payload.server.trim() : '';
    if (!serverName) {
        return { ok: false, summary: '参数错误', detail: 'server 不能为空' };
    }
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) {
        return { ok: false, summary: 'MCP 未初始化', detail: 'window._dsMcp 不存在' };
    }
    const servers = mcp.listServers();
    const server = servers.find(s => s.name === serverName && s.enabled);
    if (!server) {
        return { ok: false, summary: '服务未找到', detail: `未找到名为 "${serverName}" 的已启用 MCP 服务` };
    }
    try {
        const result = await mcp.discoverServer(server.id);
        const tools = result.tools || [];
        // Step 3: 把发现的工具注册到 registry，使 AI 可直接按名调用
        _registerMcpServerTools(server, tools);
        const toolList = tools.map(t =>
            `- ${t.name}: ${t.description || t.title || ''}`
        ).join('\n');
        return {
            ok: true,
            summary: `发现 ${tools.length} 个工具`,
            detail: `服务 "${serverName}" 共 ${tools.length} 个工具：\n${toolList}`
        };
    } catch (e) {
        return { ok: false, summary: '发现失败', detail: (e && e.message) || String(e) };
    }
}

/**
 * 执行 mcp_describe 工具调用 — 查看指定 MCP 工具的完整描述
 *
 * @param {Object} payload - { server: string, tool: string }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
async function _executeMcpDescribe(payload) {
    // 主开关检查：mcpEnabled 关闭时拒绝执行（描述符仍注册以支持 XML 识别）
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.mcpEnabled === false) {
        return { ok: false, summary: 'mcp_describe 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
    }
    const serverName = typeof payload.server === 'string' ? payload.server.trim() : '';
    const toolName = typeof payload.tool === 'string' ? payload.tool.trim() : '';
    if (!serverName || !toolName) {
        return { ok: false, summary: '参数错误', detail: 'server 和 tool 不能为空' };
    }
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) {
        return { ok: false, summary: 'MCP 未初始化' };
    }
    const servers = mcp.listServers();
    const server = servers.find(s => s.name === serverName && s.enabled);
    if (!server) {
        return { ok: false, summary: '服务未找到', detail: `未找到名为 "${serverName}" 的已启用服务` };
    }
    const tools = Array.isArray(server.tools) ? server.tools : [];
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
        return { ok: false, summary: '工具未找到', detail: `服务 "${serverName}" 中未找到工具 "${toolName}"` };
    }
    const schemaStr = tool.inputSchema ? JSON.stringify(tool.inputSchema, null, 2) : '（无）';
    return {
        ok: true,
        summary: `工具详情：${toolName}`,
        detail: `名称：${tool.name}\n标题：${tool.title || ''}\n描述：${tool.description || ''}\n参数 Schema：\n${schemaStr}`
    };
}

/**
 * 执行 mcp_invoke 工具调用 — 调用指定 MCP 服务的工具
 *
 * @param {Object} payload - { server: string, tool: string, args?: object }
 * @returns {Promise<{ ok: boolean, summary: string, detail?: string }>}
 */
async function _executeMcpInvoke(payload) {
    // 主开关检查：mcpEnabled 关闭时拒绝执行（描述符仍注册以支持 XML 识别）
    const { CONFIG } = _getConfigSafe();
    if (CONFIG && CONFIG.mcpEnabled === false) {
        return { ok: false, summary: 'mcp_invoke 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
    }
    const serverName = typeof payload.server === 'string' ? payload.server.trim() : '';
    const toolName = typeof payload.tool === 'string' ? payload.tool.trim() : '';
    const args = payload.args || {};
    if (!serverName || !toolName) {
        return { ok: false, summary: '参数错误', detail: 'server 和 tool 不能为空' };
    }
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) {
        return { ok: false, summary: 'MCP 未初始化' };
    }
    const servers = mcp.listServers();
    const server = servers.find(s => s.name === serverName && s.enabled);
    if (!server) {
        return { ok: false, summary: '服务未找到', detail: `未找到名为 "${serverName}" 的已启用服务` };
    }
    try {
        const result = await mcp.callTool(server.id, toolName, args);
        return result;
    } catch (e) {
        return { ok: false, summary: '调用失败', detail: (e && e.message) || String(e) };
    }
}

// ============================================================
// 动态工具注册（按 CONFIG 开关注册 web/python/mcp handle 工具）
// ============================================================

/**
 * 无条件注册动态工具描述符（web/python/mcp handle）到 registry
 *
 * 识别链路（catalog/正则/parseToolCalls/hasToolFragment/cleanAIWasteData/
 * history-cleanup）依赖 registry 中的描述符来生成 XML 匹配正则。
 * 因此描述符必须无条件注册，使 AI 输出的 <web_search>...</web_search> 等
 * XML 文本总能被识别与清理，即使对应功能未启用。
 *
 * 与执行/prompt 链路解耦：
 *   - prompt 渲染：getToolSchemasPrompt 按 CONFIG 开关过滤，关闭的不进入 prompt
 *   - 执行器：各 _execute* 入口检查 CONFIG 开关，关闭时返回"未启用"错误
 *   - 子开关 webSearchEnabled/webFetchEnabled 仍控制是否注册子工具
 *   - MCP 投影工具（mcp__*）仅 mcpEnabled 时投影具体服务的工具
 */
function _registerDynamicTools() {
    const { CONFIG } = _getConfigSafe();
    if (!CONFIG) return;

    // web_search / web_fetch：主开关 webToolsEnabled 不再阻止描述符注册，
    // 由子开关 webSearchEnabled/webFetchEnabled 控制是否注册子工具
    if (CONFIG.webSearchEnabled !== false) {
        registry.register(WEB_SEARCH_DESCRIPTOR, _executeWebSearch, {
            requireAgentFeedback: true, category: 'web'
        });
    }
    if (CONFIG.webFetchEnabled !== false) {
        registry.register(WEB_FETCH_DESCRIPTOR, _executeWebFetch, {
            requireAgentFeedback: true, category: 'web'
        });
    }

    // python_exec：无条件注册描述符（优先用沙箱提供的完整 Schema，回退到内置）
    const pythonDescriptor = (typeof window !== 'undefined' && window._dsPythonExecDescriptor)
        ? window._dsPythonExecDescriptor
        : {
            name: 'python_exec',
            description: '在浏览器内置 Python 沙箱（pyodide）中执行 Python 代码',
            category: 'sandbox',
            inputSchema: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: '要执行的 Python 代码' },
                    timeoutMs: { type: 'integer', description: '超时毫秒数（默认 10000）' },
                    reset: { type: 'boolean', description: '是否清理全局命名空间（默认 false）' }
                },
                required: ['code']
            }
        };
    registry.register(pythonDescriptor, _executePythonExec, {
        requireAgentFeedback: true, category: 'sandbox'
    });

    // mcp_discover / mcp_describe / mcp_invoke：无条件注册描述符
    registry.register(MCP_DISCOVER_DESCRIPTOR, _executeMcpDiscover, {
        requireAgentFeedback: true, category: 'mcp'
    });
    registry.register(MCP_DESCRIBE_DESCRIPTOR, _executeMcpDescribe, {
        requireAgentFeedback: true, category: 'mcp'
    });
    registry.register(MCP_INVOKE_DESCRIPTOR, _executeMcpInvoke, {
        requireAgentFeedback: true, category: 'mcp'
    });

    // MCP 投影工具（mcp__*）：仅 mcpEnabled 时投影具体服务的工具到 registry
    if (CONFIG.mcpEnabled) {
        _registerAllCachedMcpTools();
    }

    _syncToolNames();
}

// ============================================================
// MCP 工具投影集成（Step 3）
// ============================================================

/**
 * 把单个 MCP 服务的工具注册到 registry
 *
 * 工具名采用命名空间格式 mcp__{serverName}__{toolName}，避免与内置工具冲突。
 * executor 闭包捕获 serverId + toolName，调 mcp.callTool(serverId, toolName, args)。
 *
 * @param {Object} server - MCP 服务配置（含 id/name）
 * @param {Array} tools - discoverServer 返回的工具列表
 */
function _registerMcpServerTools(server, tools) {
    if (!server || !Array.isArray(tools)) return;
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) return;
    const serverName = server.name;
    for (const tool of tools) {
        if (!tool || !tool.name) continue;
        const namespacedName = `mcp__${serverName}__${tool.name}`;
        const descriptor = {
            name: namespacedName,
            description: `[MCP:${serverName}] ${tool.description || tool.title || tool.name}`,
            category: 'mcp',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} }
        };
        // 闭包捕获 serverId + toolName
        const serverId = server.id;
        const toolName = tool.name;
        const executor = function(args) {
            // 主开关检查：mcpEnabled 关闭时拒绝执行（投影工具仅 mcpEnabled 时注册，
            // 但开关可能在运行时被关闭，此处做防御性检查）
            const { CONFIG } = _getConfigSafe();
            if (CONFIG && CONFIG.mcpEnabled === false) {
                return { ok: false, summary: 'MCP 未启用', detail: '请在设置面板开启 MCP（mcpEnabled）开关' };
            }
            return mcp.callTool(serverId, toolName, args || {});
        };
        registry.register(descriptor, executor, {
            requireAgentFeedback: true,
            category: 'mcp'
        });
    }
    _syncToolNames();
}

/**
 * 注册所有已启用 MCP 服务的缓存工具
 *
 * 在 _registerDynamicTools 中调用（mcpEnabled=true 时）。
 * 仅注册已缓存的工具（store 中的 server.tools），未发现的服务需 AI 调 mcp_discover 触发。
 */
function _registerAllCachedMcpTools() {
    const mcp = typeof window !== 'undefined' ? window._dsMcp : null;
    if (!mcp) return;
    try {
        const servers = mcp.listServers();
        for (const server of servers) {
            if (!server.enabled) continue;
            const tools = Array.isArray(server.tools) ? server.tools : [];
            if (tools.length > 0) {
                _registerMcpServerTools(server, tools);
            }
        }
    } catch (e) {
        if (typeof console !== 'undefined') {
            console.warn('[capability-register] register cached MCP tools failed:', e);
        }
    }
}

/**
 * 注销指定 MCP 服务的全部投影工具（断连或禁用时调用）
 *
 * @param {string} serverName - 服务名
 * @returns {string[]} 被移除的工具名列表
 */
export function unregisterMcpServerTools(serverName) {
    if (!serverName) return [];
    const prefix = `mcp__${serverName}__`;
    const toRemove = [];
    for (const desc of registry.getAllDescriptors()) {
        if (desc.name && desc.name.startsWith(prefix)) {
            toRemove.push(desc.name);
        }
    }
    for (const name of toRemove) {
        registry.unregister(name);
    }
    if (toRemove.length > 0) {
        _syncToolNames();
    }
    return toRemove;
}

/**
 * 注销全部 MCP 投影工具（MCP 总开关关闭时调用）
 * @returns {string[]} 被移除的工具名列表
 */
export function unregisterAllMcpTools() {
    const removed = registry.unregisterByCategory('mcp');
    if (removed.length > 0) {
        _syncToolNames();
    }
    return removed;
}

// ============================================================
// 模块顶层：注册内置工具并同步 TOOL_NAMES
// ============================================================

/**
 * 在模块加载时立即注册 22 个内置工具
 *
 * 必须在模块顶层（而非 initCapabilityRegister）执行：
 *   history-cleanup.js 导入 TOOL_NAMES 后立即用 join('|') 构建正则，
 *   若此时 TOOL_NAMES 为空，正则匹配会失效。
 *
 * Electron 桌面端跳过：DeepSeek++ 扩展已提供完整的 Agent 工具系统，
 * 无需重复注册内置工具（减少闭包创建和内存占用）。
 */
if (!IS_ELECTRON) {
    _registerBuiltinTools();
    _syncToolNames();
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化能力注册模块
 *
 * 执行内容：
 *   1. 注册 window._dsCapabilityInjector 回调，供 fetch-hub / anti-recall 调用
 *   2. 将 parseToolCalls / executeToolCall / getToolLabel / TOOL_NAMES 挂到 window 上，
 *      供 text-process.js 调用（避免 ES Module 循环依赖）
 *   3. 按 CONFIG 开关注册动态工具（web/python/mcp handle + MCP 投影）
 *   4. 暴露 MCP 工具注册/注销接口到 window（供 mcp/client.js 集成调用）
 */
export function initCapabilityRegister() {
    if (installed) return;
    installed = true;

    // 1. 注册能力注入回调（供 fetch-hub 的 injectPromptAndMemory 调用）
    if (typeof window !== 'undefined' && typeof window._dsCapabilityInjector !== 'function') {
        window._dsCapabilityInjector = function() {
            try {
                const { CONFIG } = _getConfigSafe();
                // 能力注册在 agentSystemEnabled（总开关）且 agentToolsEnabled 启用时生效
                // （记忆模块单独启用时不需要工具调用能力，仅注入记忆文本）
                if (!CONFIG) return '';
                if (!CONFIG.agentSystemEnabled) return '';
                if (!CONFIG.agentToolsEnabled) return '';
                return getCapabilityPrompt();
            } catch (e) {
                return '';
            }
        };
    }

    // 2. 暴露工具调用相关接口给 text-process.js（避免 ES Module 循环依赖）
    if (typeof window !== 'undefined') {
        window._dsParseToolCalls = parseToolCalls;
        window._dsExecuteToolCall = executeToolCall;
        window._dsGetToolLabel = getToolLabel;
        window._dsToolNames = TOOL_NAMES;
    }

    // 3. 按 CONFIG 开关注册动态工具（web/python/mcp handle + MCP 投影）
    try {
        _registerDynamicTools();
    } catch (e) {
        if (typeof console !== 'undefined') {
            console.warn('[capability-register] register dynamic tools failed:', e);
        }
    }

    // 3.1 兜底：确保 TOOL_NAMES 包含 registry 中的所有工具名
    // _registerDynamicTools 内部会调用 _syncToolNames，但在某些环境（如手机 WebView）
    // 可能因 splice 异常或时序问题导致 TOOL_NAMES 未同步动态工具名（web_search 等），
    // 使 text-process.js 的 _resolveToolNames 返回不含动态工具名的数组，
    // 进而导致 scanToolCallElements 无法识别和清理 web_search XML。
    // 此处显式再同步一次，确保动态工具名（web_search/web_fetch/python_exec/mcp_*）被包含。
    try {
        _syncToolNames();
    } catch (e) {
        if (typeof console !== 'undefined') {
            console.warn('[capability-register] fallback sync tool names failed:', e);
        }
    }

    // 4. 暴露 MCP 工具注册/注销接口（供 mcp/client.js 或其他模块集成调用）
    if (typeof window !== 'undefined') {
        window._dsRegisterMcpServerTools = _registerMcpServerTools;
        window._dsUnregisterMcpServerTools = unregisterMcpServerTools;
        window._dsUnregisterAllMcpTools = unregisterAllMcpTools;
    }
}
