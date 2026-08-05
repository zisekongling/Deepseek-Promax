# DeepSeek Promax 开发规范文档

> 本文档面向开发该油猴脚本的 AI Agent / 人类开发者，列出**必须遵守的强制规范**。
> 修改代码前请先查阅 [ARCHITECTURE.md](./ARCHITECTURE.md) 理解整体架构。

## 〇、最高原则

1. **先读后改**：修改任何文件前必须先 Read 该文件相关部分，理解上下文。不要凭文件名猜测内容。
2. **最小变更**：只做被要求的改动。不顺手重构、不补 docstring、不加类型注解、不动无关代码。
3. **不创建多余文件**：优先编辑现有文件，不主动新建 `.md` / `README` / 工具脚本。
4. **删除需确认**：删除任何文件前必须征得用户明确同意。
5. **不臆造路径**：引用文件、模块、API 时使用从代码中确认过的真实路径与签名。

## 一、项目通用规范

### 1.1 语言与注释

- **代码注释语言**：中文（与现有代码一致）。
- **函数级注释**：每个导出函数必须有 JSDoc 风格注释，说明职责、参数、返回值。内部辅助函数视复杂度而定。
- **文件头注释**：每个 `.js` 文件开头必须有模块说明注释，描述职责、设计原则、与其他模块的关系。
- **生产构建注释处理**：terser 会删除所有注释，但 `userscript-headers.js` 头部和 `banner.txt` 会被 `ReinjectHeaderPlugin` 重新注入。**不要**用块注释包裹油猴头部（必须是单行 `//` 注释）。

### 1.2 模块系统

- 使用 **ES Module**（`import` / `export`），不使用 CommonJS（`require` / `module.exports`），`webpack.config.js` 和 `userscript-headers.js` 除外。
- 静态导入：`early-boot.js` 必须用静态 import 让 webpack 打包为单文件（WebView 注入时不加载异步 chunk）。
- 循环依赖规避：跨模块通信用 `window._ds*` 全局接口，不用 ES Module 循环 import。

### 1.3 代码风格

- 缩进：4 个空格（与现有代码一致）。
- 字符串：单引号 `'` 优先，模板字符串用反引号 `` ` ``。
- 分号：语句结尾加分号。
- 命名：
  - 变量 / 函数：`camelCase`
  - 常量：`UPPER_SNAKE_CASE`
  - 类：`PascalCase`
  - 私有：前缀 `_`（如 `_cachedConfig`）
  - 全局接口：`window._ds*` 前缀

### 1.4 平台兼容

- **单源码双构建**：代码必须同时支持篡改猴和 WebView 环境，通过 `Platform.isWebView` 运行时探测切换，不要为两端写两份代码。
- **DOM 访问防御**：`document.body` 在 document-start 阶段可能不存在，访问前必须判断或用 `domReady()` 等待。
- **window 访问防御**：`typeof window !== 'undefined'` 检查后再访问 window。

## 二、React/DOM 操作强制规范（最高优先级）

### 2.1 永远不 remove React 管理的节点

DeepSeek 前端使用 React，直接 `remove()` React 渲染的节点会触发：

```
NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.
```

**替代方案**：

| 需求 | 正确做法 | 错误做法 |
|------|----------|----------|
| 隐藏组件 | `el.style.display = 'none'` | `el.remove()` |
| 替换内容 | `el.textContent = ''` + `appendChild(newNode)` | `el.outerHTML = '...'` |
| 插入新节点 | `parent.insertBefore(newNode, oldNode)` + 隐藏 oldNode | `parent.replaceChild(newNode, oldNode)` |
| 清空容器 | 遍历子节点 `style.display = 'none'` | `container.innerHTML = ''` |

**特例**：自己创建并插入的非 React 节点（如 toast、工具调用卡片）可以正常 `remove()`。

### 2.2 React 受控组件值注入

向 DeepSeek 输入框（textarea）注入文本必须用原生 setter + 失效 value tracker + 派发事件：

```js
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, 'value'
).set;
nativeSetter.call(textarea, value);
const tracker = textarea._valueTracker;
if (tracker) tracker.setValue('');
textarea.dispatchEvent(new InputEvent('input', {
  bubbles: true,
  inputType: 'insertFromPaste'
}));
```

直接 `textarea.value = value` 不会触发 React onChange。

### 2.3 点击按钮多策略

DeepSeek 按钮可能用 React onClick、mousedown 委托、或 SVG path 命中。发送按钮查找顺序：
1. class 含 "send" 的 selector
2. 手机端 `ds-button--primary.ds-button--filled.ds-button--circle`，多个时选最靠近输入框的
3. 兜底：SVG path `d^="M8.3125"`（向上箭头）特征查找

点击事件序列：`pointerdown → mousedown → pointerup → mouseup → click`；手机端额外 `touchstart → touchend`。

### 2.4 DOM hash 类名集中管理

DeepSeek 使用 CSS Modules，类名是构建时生成的 hash（如 `d29f3d7d`、`_4f9bf79`），每次改版可能变化。

**所有 hash 类名必须集中在 [selectors.js](./src/selectors.js) 中定义**，其他模块通过 `import { SELECTORS } from '../selectors.js'` 引用。**禁止在业务代码中硬编码 hash 类名**。

新增/修改类名时：
- 命名约定：`messageXXX` / `btnXXX` / `containerXXX`
- 同步更新 [selectors.js](./src/selectors.js) 中的注释和 `isUserMessage` / `isAiMessage` 判断函数

### 2.5 移动端菜单特殊处理

移动端 `ds-dropdown-menu` 注入入口时：
- **不**强制 `display:none` 隐藏 `.ds-floating-position-wrapper`
- **不**阻止 click 冒泡
- 让 DeepSeek 自身的菜单点击处理器关闭菜单，保证 React `isOpen` 状态正确

桌面端用 Esc 键 + mousedown 双重机制关闭下拉菜单，**不要**用 `body.click()`（会触发 toggle 状态反转）。

## 三、Agent 系统开发规范

### 3.1 工具注册

**新增工具必须遵守**：

1. 在 [capability-register.js](./src/features/capability-register.js) 的 `_registerBuiltinTools` 或 `_registerDynamicTools` 中注册
2. 注册时指定：
   - `name`：工具名（snake_case）
   - `label`：中文显示名
   - `description`：工具说明（给 AI 看）
   - `parameters`：参数 schema
   - `executor`：执行函数 `(payload) => { ok, summary, detail }` 或 `{ ok, summary, detail, pending }`
   - `requireAgentFeedback`：是否触发续跑（默认 true）
3. 工具名加入 `TOOL_NAMES` 数组（通过 `registry.register` 自动同步）
4. **NO_FEEDBACK 集合**：纯查询类工具（如 `memory_recall`）加入 `NO_FEEDBACK` 不触发续跑
5. 在 prompt 的第二层（`getToolSchemasPrompt`）会自动渲染，无需手动写提示词

**执行器返回值规范**：

```js
{
  ok: boolean,          // 成功/失败
  summary: string,      // 一句话摘要（给 AI 看的续跑 prompt 用）
  detail: string,       // 详细信息（给 AI 看的续跑 prompt 用）
  skipped?: boolean,    // 跳过（如去重命中），skipped 而非 failure，避免 AI 误判重试
  pending?: boolean     // 等待中（如 ask_user），Agent 循环会等待 Promise
}
```

### 3.2 续跑 prompt 构造

**必须使用 v2 边界标记**：

```
__DS_AGENT_V2_START__
[引导语]
<original_task>
[clampText(originalTask, 8000)]
</original_task>
<tool_results>
[JSON.stringify(results, null, 2)]
</tool_results>
__DS_AGENT_V2_END__
```

**禁止**：
- 只用 v1 末尾标记（`__ds_agent_continuation__`），刷新后可能被截断
- 不用标记直接发裸文本，无法识别续跑消息
- 在续跑 prompt 中重复注入记忆/系统指令（续跑 prompt 已含原始任务）

**originalTask 长度限制**：超过 8000 字符用 `clampText` 截断并标注 `...[truncated]`。

### 3.3 工具调用 XML 格式

AI 输出的工具调用必须是：

```xml
<tool_name>{"key":"value"}</tool_name>
```

**严格规范**：
- JSON 必须是**紧凑单行**，禁止多行排版
- 禁止用 `<invoke name="...">` / `<tool_call>` / Markdown 代码块包装
- 禁止放在思考/reasoning 区域
- 禁止标签内添加注释、前缀、后缀
- 禁止省略闭合标签
- 禁止输出不完整的 JSON

**解析容错**（`_lenientParseJSON`）：流式截断时尝试 6 步修复（移除 markdown 包装 → 移除注释 → 压缩字符串外空白 → 单引号转双引号 → 移除尾逗号 → 括号深度补全）。但**不要**因此放松对 AI 的格式要求。

### 3.4 工具调用 UI 渲染

| 工具 | 渲染方式 |
|------|----------|
| `todo_write` | `_renderTodoCard` 三色状态卡片（✓绿/▶蓝/○灰） |
| `ask_user` | `_renderAskUserCard` 紫色提问卡片 + 启动 pending Promise |
| 其他 | `_buildToolCallNoticeHTML` 紧凑工具调用卡片 |

**强制规则**：
- **不弹 toast**：工具调用只显示卡片，不弹 toast 通知
- **卡片只显示基础信息**：记忆标题、类型、标签，不显示成功/失败状态
- **删除的 memory 不重新记录**：`memory_save` 时双路检查 `isMemoryDeleted(id, title, content)`
- **XML 元素必须隐藏**：用户不可见工具调用 XML，清理后段落无可见文本则 `style.display = 'none'`

### 3.5 Agent 循环控制

| 工具 | 调用时机 | 禁止时机 |
|------|----------|----------|
| `agent_finish` | 任务完成并输出最终结论后；调用工具并已回复不需要更多结果时 | 还需要其他工具信息时；未输出最终结论时；有 pending ask_user 时 |
| `ask_user` | 需求模糊、关键决策、影响实现的歧义 | 明确任务、闲聊、可推断细节 |
| `todo_write` | 3 个及以上独立步骤 | 单步任务、闲聊 |
| `start_agent` | 用户明确要求 Agent 模式 | 普通对话 |

**轮次上限**：
- 默认 3 轮（`MAX_CONTINUATION_ROUNDS = 3`）
- 有 pending todo 时提升到 8 轮
- loop-engine（独立系统）默认 20 轮

**nag 提醒**：连续 3 轮未调用 `todo_write` 时注入 `<reminder>` 提醒 AI 回顾进度。

**用户停止**：`userStopRequested` 标志贯穿循环，每次关键节点检查；`stopAgent`（AI 主动）与用户停止的区别在于是否清空队列。

### 3.6 Todo 清单校验规则

`todo_write` 必须通过 6 项校验：

1. `todos` 必须是数组
2. `length <= 20`（超出返回 `清单过长`）
3. 每条 `content` 非空（trim 后非空）
4. `status` 缺省 `'pending'`，非空时必须在 `['pending', 'in_progress', 'completed']` 中
5. `priority` 缺省 `'medium'`，非空时必须在 `['high', 'medium', 'low']` 中
6. **同一时间最多 1 个 `in_progress`**（超出返回 `状态冲突`）

校验失败返回 `{ ok: false, summary, detail }`，**不更新** `state.todos`。

**todo_write 必须传完整列表**（全量替换，非增量）。content 写成可验证完成条件（错误："扫描文件"；正确："确认项目中不存在不符合 snake_case 的文件"）。

### 3.7 ask_user 规范

- 每次最多 4 个问题
- 每个问题 2-4 个选项
- `header` ≤ 12 字符
- 同一时刻只允许 1 个 pending 提问（新提问会先取消旧的）
- `ask_user` 必须放在回复末尾
- 用户答案通过 `<user_answers>` 块注入续跑 prompt

### 3.8 工具调用段落扫描

`scanToolCallElements` 处理流程：

1. 查找 `p.ds-markdown-paragraph` / `p` / `div` 段落
2. **在 await 之前立即设置** `paragraph.dataset.dsToolProcessed = 'true'`（防重入）
3. 用正则 `<(tool_name)>([\s\S]*?)</\1>` 匹配
4. JSON 解析：先 `JSON.parse`，失败回退 `_lenientParseJSON`
5. 执行工具调用（同步/异步均 `await`）
6. 直接修改 `paragraph.textContent` 移除 XML（清空子节点用一个文本节点替换）
7. 清理后段落无可见文本则 `style.display = 'none'`
8. 检测 `agent_finish` → 调用 `window._dsStopAgent(reason)`
9. 否则过滤 `requiresAgentFeedback` 的工具，构造 `agentResults` 调用 `window._dsOnToolCallExecuted`

## 四、记忆系统开发规范

### 4.1 记忆数据结构

```js
{
  id: 'mem-' + Date.now(),     // 唯一 ID，可自定义
  title: '',                    // 标题（必填）
  content: '',                  // 内容（必填）
  category: 'preference',       // 分类：preference/context/fact/instruction
  tags: [],                     // 标签数组
  pinned: false,                // 置顶
  enabled: true,                // 启用
  scope: 'global',              // 作用域：global/project
  createdAt: Date.now(),
  updatedAt: Date.now(),
  accessCount: 0,               // 访问计数
  lastAccessedAt: Date.now(),   // 最近访问时间
  history: []                   // 历史快照（replace 时保留，上限 5 条）
}
```

**字段名注意**：代码中 `category` 字段同时被称作 `type`（如 `mergeMemories` 接收 `newMemory.type`），二者等价。

### 4.2 记忆 ID 规则

- **AI 不可编造 ID**：必须来自 `[系统记忆]` 注入行或工具返回结果
- **ID 冲突回退**：AI 提供的 id 已被占用时，`addMemory` 回退到自动生成 id，返回时明确告知"实际 id=xxx（原 id=yyy 已被占用）"
- **formatMemoryLine 必须包含 ID**：`- [scope type] (id:mem-xxx) 标题: 内容`，让 AI 能引用正确 ID

### 4.3 防重删机制

删除记忆时必须：
- 记录 ID 到 `ds_memories_deleted_ids`
- 记录内容签名到 `ds_memories_deleted_sigs`（`title.trim().toLowerCase() + '|' + content.trim().toLowerCase()`）
- 集合上限 1000，LRU 淘汰

`memory_save` 时必须双路检查 `isMemoryDeleted(id, title, content)`，命中返回 `{ ok: true, skipped: true }`（skipped 而非 failure）。

**例外**：`archiveStaleMemories`（自动归档）**不**记录防重删，归档后的记忆理论上可重新添加。

### 4.4 记忆注入规范

- 必须传 original prompt 给 `window._dsMemoryInjector(prompt)` 启用关键词匹配
- 注入文本包裹为 `[系统记忆]...[/系统记忆]`
- Token 预算：默认 1500，prompt > 3000 token 时动态压缩至 800
- 注入后调用 `touchMemories(ids)` 异步反馈（accessCount +1）

### 4.5 自动归档条件

`archiveStaleMemories` 删除同时满足以下条件的记忆：
- `lastAccessedAt < Date.now() - 90 * 86400000`（90 天未访问）
- `accessCount < 3`
- `pinned === false`

启动时若 `CONFIG.memoryAutoArchive !== false` 自动执行一次。

## 五、配置系统规范

### 5.1 新增配置项

1. 在 [config.js](./src/config.js) 的 `DEFAULTS` 中添加默认值
2. 在 `OPTION_CONFIG_KEYS` 中添加短 ID → CONFIG 键名映射（checkbox 类）
3. 在 [settings-panel.js](./src/ui/settings-panel.js) 对应 Tab 中添加 UI 控件
4. 使用 `saveConfig` 保存，**不要**直接 `localStorage.setItem`

### 5.2 配置读取

- **模块内静态引用**：`import { CONFIG } from '../config.js'`，但 CONFIG 是 `let` 变量，saveConfig 时会更新引用
- **动态读取最新值**：`window.__dsConfig` 或 `getConfig()`（避免导入快照过期）
- **saveConfig 立即生效**：同步更新内存缓存 + CONFIG 引用 + `window.__dsConfig`，防抖 250ms 写入 localStorage

### 5.3 Agent 系统配置联动

- `agentSystemEnabled`（总开关）OFF 时，saveSettings **强制**把三个子开关置为 false
- 总开关 ON 时保留子模块单独控制
- UI 层**不**做实时联动禁用，联动只在保存时强制写 false

### 5.4 平台差异化默认值

WebView 端默认关闭（UI 隐藏）：`autoRedirectEnabled` / `titleFakerEnabled`
篡改猴版默认开启（UI 可见）
通过 `IS_WEBVIEW` 在 `DEFAULTS` 中区分。

## 六、UI 渲染规范

### 6.1 设置面板

- **WebView 端 7 Tab**：外观 / 功能 / 隐私 / 预设 / Agent / 自动化 / 扩展
- **篡改猴版 11 Tab**：拆分更细（外观 / 功能 / 清理 / 隐私 / 预设 / 场景 / 技能 / Agent / 导出 / 自动化 / 扩展）
- 响应式布局：桌面双栏（>900px）/ 平板横滚（≤900px）/ 手机底部工作表（≤480px）
- 所有文案通过 `t(k, p)` / `tt(k, fallback)` 走 i18n，key 缺失回退到硬编码中文
- `hideSettings()` 后必须调用 `window._dsRestoreFloatingWrappers()` 恢复被隐藏的浮动菜单

### 6.2 工具调用卡片

- **todo 卡片**：三色状态（`completed` 绿 `#22c55e` + 删除线 / `in_progress` 蓝 `#3b82f6` + 加粗 / `pending` 灰 `#9ca3af`）+ 优先级标签 + 20 格进度条
- **ask_user 卡片**：紫色渐变主题（`#faf5ff` → `#f3e8ff`），提交后 `opacity: 0.6; pointer-events: none` 防重复提交
- **默认卡片**：🔧 图标 + "工具调用" 标题 + 计数 + 工具列表
- **所有文本节点用 `textContent`**（防 XSS），**禁止** `innerHTML` 拼接用户内容

### 6.3 Toast 通知

- 使用 [toast.js](./src/ui/toast.js) 的 `showToast(message, opts)`
- `opts.tone`：`'success'` / `'warning'` / `'error'` / `'info'`（默认 `'info'`）
- `opts.duration`：默认 3000ms
- **单例**：每次显示前移除已有 toast，避免叠加
- **工具调用结果不弹 toast**，只显示卡片

### 6.4 Agent 徽章

续跑消息清理后插入 Agent 徽章（机器人 SVG + "Agent 自主产生" + 工具调用摘要）：
- 摘要从 `<tool_results>` JSON 提取，最多 3 个工具名，超 3 个追加 `+N`
- 内置 `labelMap`：`memory_save→保存记忆`、`memory_review→审查记忆` 等
- 避免重复插入（检查 `.ds-agent-badge`）

## 七、清理与防御规范

### 7.1 系统指令标签过滤

必须从用户可见内容中移除（包括刷新或切换标签页后）：
- `[系统指令]...[/系统指令]`
- `[系统记忆]...[/系统记忆]`
- `[能力]...[/能力]`
- `[技能指令]...[/技能指令]`

**安全策略**：能力说明段落（`## 工具调用格式` 等）仅在文本**完全由能力说明组成**（清理后 ≤10 字符）时清理，保护 AI 正常回复中引用的内容。

### 7.2 敏感词替换

- **只作用于** `ds-message _63c77b1` 内的文本节点
- **不**替换 React props 或其他属性
- 区分大小写由 `CONFIG.caseSensitive` 控制

### 7.3 历史消息清理

`history-cleanup.js` 的三层防御：
1. 流式输出时 text-process.js 实时清理 DOM
2. 历史消息加载时拦截 `history_messages` API 响应清理
3. 续跑 prompt 用标记标识，加载时替换为不可见占位符

**普通用户消息（非续跑）不清理**，保护用户输入。

### 7.4 Agent 续跑标记识别

三层防御（任一命中即判定为 agent 消息）：
1. **v2 边界标记**（最可靠）：`__DS_AGENT_V2_START__` ... `__DS_AGENT_V2_END__`
2. **v1 末尾标记**（向后兼容）：`__ds_agent_continuation__`
3. **结构化标签**：同时含 `<original_task>` + `<tool_results>`，配合关键词二次确认

**清理顺序**：先删 v2 包裹块 → 再删残留 v2 标记 → 最后删 v1 标记。

## 八、构建与发布规范

### 8.1 构建命令

```bash
npm run dev           # 开发构建（保留注释 + source-map）
npm run watch         # 监听模式
npm run build         # 生产构建（terser 压缩 + 重新注入头部）
npm run build:android # 生产构建 + 同步资源到 Android
```

**用户偏好**：只在明确要求时构建，且只构建 release 版本（`npm run build`）。

### 8.2 生产构建约束

- terser 删除**所有**注释（`comments: false`）
- 保留 `window.__ds*` 全局钩子（`mangle.toplevel: false`）
- `drop_console: false`（保留 console.log 用于调试）
- `drop_debugger: true`
- 篡改猴版头部通过 `ReinjectHeaderPlugin` 在压缩后重新注入

### 8.3 多 config 并行

webpack 导出三个 config（篡改猴版 / WebView 主脚本 / early-boot stub），并行执行：
- 首次构建手动清理 dist，所有 config 设 `clean: false`（避免并行清理冲突）
- watch 模式下不重复清理（`distCleaned` 标志）

### 8.4 端口检查

启动 webui 前检查端口，如果端口被占用说明 webui 已经启动，**无需重启**，除非用户强调需要重启。

## 九、错误处理规范

### 9.1 模块初始化

每个模块初始化用独立 `try-catch` 包裹，失败不阻塞其他模块：

```js
try { initMemory(); } catch (e) {}
try { initTodoManager(); } catch (e) {}
try { initCapabilityRegister(); } catch (e) {}
```

### 9.2 工具调用执行器

- 参数校验失败返回 `{ ok: false, summary, detail }`，不抛异常
- 去重命中返回 `{ ok: true, skipped: true }`（skipped 而非 failure）
- 异步工具（web_search / python_exec / mcp_*）必须 `await`，异常时构造失败结果

### 9.3 MCP 结果归一化

`normalizeToolResult` 防御多层：
- Promise 检测：若结果是未 await 的 Promise，构造失败结果
- 非对象检测：构造失败结果避免崩溃
- MCP 工具（`mcp__*` 前缀）调 `_normalizeMcpResult`：
  - 失败结果用 `error.message` 作 summary
  - 纯图片返回 `[图片内容已省略]` 避免 base64 爆 prompt
  - 超大结果（>10KB）按 UTF-8 字节估算截断并标注 `[结果已截断]`

### 9.4 JSON 序列化安全

避免循环引用崩溃，用 `_safeStringify`，失败回退到 `String(obj)` 或占位文本 `(无法序列化)`。

### 9.5 续跑循环防循环保护

- 最大轮数：默认 3 轮，有 todo 时 8 轮
- 历史消息防护：`lastUserMessageTime` 为 0 或距今 > 60 秒跳过续跑
- 并发锁：`isSendingContinuation` 防止多次 flush 冲突
- 用户停止：`userStopRequested` 标志贯穿整个循环
- `agent_finish`：AI 主动终止，清空队列并 resolve 悬挂 Promise

## 十、性能与资源规范

### 10.1 防抖与节流

- DOM 变化：observer-hub 已统一调度（elements 200ms / textNodes 300ms / dialogs 350ms）
- 配置写入：250ms 防抖
- 记忆写入：300ms 防抖
- 重试按钮扫描：500ms 防抖

### 10.2 缓存

- 提示词分层缓存：`_cachedCoreRules` / `_cachedAdvancedUsage`（静态提取）
- 记忆内存缓存：`_cacheMemories` + `_cacheDirty` 标志
- 分词缓存：`segmentCache`（LRU 上限 1000）
- 工具调用正则：WeakMap 缓存（按工具名集合）

### 10.3 异步预加载

- `refreshPresetCache`：异步预加载激活 preset，buildPromptPrefix 时同步读取
- builtin skills：同步预填充到 `skillCache`
- custom skills：异步预加载（不阻塞主流程）

### 10.4 流式 token 估算

- 用 `lastChars` 追踪字符位置（非 `lastTokens*3`，修复原 bug）
- 增量解析服务端统计（`parseServerStats`）：只解析自上次以来的新增部分（含跨 chunk 行边界，多扫描 200 字符）
- TPS 从首 chunk 开始计算，排除 prefill 延迟

## 十一、文件操作规范

### 11.1 新增文件

- **不主动创建** `.md` / `README` / 文档文件
- 只在必要时创建新模块文件（如新增独立功能模块）
- 新文件必须有文件头注释（模块说明、职责、设计原则）

### 11.2 删除文件

- **必须征得用户明确同意**才能删除
- 删除前向用户提问确认

### 11.3 修改文件

- **先 Read 后 Edit**：修改前必须读文件相关部分
- 最小变更：只改被要求的部分
- 保持现有风格：缩进、命名、注释风格与文件一致

## 十二、Git 规范

- **不主动 commit**：只在用户明确要求时创建 commit
- **不主动 push**：只在用户明确要求时推送
- **不修改 git config**
- **不执行破坏性命令**：`push --force` / `reset --hard` / `checkout .` / `clean -f` 等需用户明确要求
- commit message 风格：跟随仓库现有风格（用 `git log` 查看）

## 十三、常见陷阱速查

| 陷阱 | 正确做法 |
|------|----------|
| `textarea.value = x` 不触发 React | 用原生 setter + 失效 value tracker + dispatch input 事件 |
| `el.remove()` 导致 React 崩溃 | 用 `style.display = 'none'` |
| 续跑 prompt 刷新后识别失败 | 用 v2 边界标记包裹整段 |
| 工具调用 XML 残留在用户消息 | 段落级 textContent 扫描 + history-cleanup 拦截 API |
| 记忆 ID 不匹配导致 merge 失败 | formatMemoryLine 必须包含 `(id:mem-xxx)` |
| AI 重新保存已删除记忆 | 双路检查 `isMemoryDeleted`，返回 skipped |
| 多个 MutationObserver 重复扫描 | 用 observer-hub 统一注册 |
| 多次 fetch/XHR hook 递归 | 用 `installed` 标志防重入 |
| 配置快照过期 | 用 `window.__dsConfig` 动态读取 |
| capability-register 顶层 await 导致 TOOL_NAMES 为空 | 顶层同步注册 22 个内置工具 |
| 续跑 prompt 重复注入记忆 | 续跑消息只注入 `[能力]`，不注入记忆/系统指令 |
| 工具调用 toast 干扰用户 | 只显示卡片，不弹 toast |
| 长循环漂移 | 20 轮上限 + regroundLoop 重新锚定（loop-engine） |
| 多标签页同时循环 | Tab Lock（loop-engine）|

## 十四、调试技巧

### 14.1 日志

- 模块加载时输出环境信息：`console.log('[bridge] env =', ENV, ...)`
- 关键流程日志：`console.log('[DS-Promax] init() 已执行过，跳过重复初始化')`
- 警告：`console.warn('[fetch-hub] recordOriginalTask failed:', e)`

### 14.2 全局调试接口

- `window.DSEnhance.reload()`：重新加载配置并应用所有功能
- `window.DSEnhance.getConfig()`：获取当前配置
- `window.DSEnhance.showSettings()`：显示设置面板
- `window.__dsConfig`：直接读取配置对象
- `window._dsToolNames`：查看当前注册的工具名列表
- `window._dsGetOriginalTask()`：查看当前 Agent 原始任务

### 14.3 构建验证

```bash
npm run build  # 成功则输出 dist/dspro.js / dspro.user.js / dspro.early-boot.js
```

构建失败常见原因：
- 模板字符串中未转义的反引号（capability-register.js 曾因此构建失败）
- import 不存在的文件（如缺失 toast.js）
- ES Module 循环依赖导致运行时 undefined

---

架构详情请查阅 [ARCHITECTURE.md](./ARCHITECTURE.md)。
