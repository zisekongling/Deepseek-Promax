# DeepSeek Promax 架构说明文档

> 本文档面向开发该油猴脚本的 AI Agent / 人类开发者，描述项目整体架构、模块职责与协作关系。
> 修改代码前请先通读本文档，再查阅 `DEVELOPMENT.md` 中的强制规范。

## 一、项目定位

**DeepSeek Promax**（v4.0.0）是一个针对 `chat.deepseek.com` 的增强型油猴脚本，通过 webpack 5 打包为单文件注入页面。核心能力：

- **UI 美化与组件清理**：主题切换、樱花动画、字体/背景、移除转发/下载/分享按钮
- **文本增强**：图片渲染、删除线、Mermaid 图表、角标清理、防撤回
- **Agent 系统**：让 DeepSeek 具备工具调用、长期记忆、Todo 清单、主动提问、多轮循环能力
- **效率工具**：预设菜单、历史标签、内联导出、Token 速度、使用量统计、文件夹管理
- **高级能力**：Web 工具（搜索/抓取）、MCP 协议、Python 沙箱、多模态分析、WebDAV 同步、自动化调度

## 二、双环境单源码构建

项目采用"单源码双构建"策略，通过运行时环境探测自动切换行为：

| 产物 | 入口 | 用途 | 头部 |
|------|------|------|------|
| `dist/dspro.user.js` | `src/index.js` | 篡改猴版，document-start 注入 | 含 `==UserScript==` + banner.txt |
| `dist/dspro.js` | `src/index.js` | WebView 主脚本，onPageFinished 注入 | 无头部 |
| `dist/dspro.early-boot.js` | `src/early-boot.js` | WebView 早注入 stub，onPageStarted 注入 | 无头部 |

**关键设计**：
- 三者共享 `src/` 源码，通过 `Platform.isWebView` 运行时探测切换
- early-boot stub 只安装必须在 document-start 阶段生效的 hook（redirect / XHR / fetch），不初始化任何 UI
- 主脚本通过 `window.__dsEarlyBootDone` 标记检测 early-boot 是否已运行，避免重复安装 hook
- 生产构建用 terser 删除所有注释，篡改猴版通过 `ReinjectHeaderPlugin` 在压缩后重新注入头部

## 三、目录结构

```
js/
├── src/
│   ├── index.js                  # 主入口（篡改猴版 + WebView 主脚本共用）
│   ├── early-boot.js             # WebView 早注入 stub 入口
│   ├── config.js                 # 配置管理（DEFAULTS / loadConfig / saveConfig）
│   ├── selectors.js              # DeepSeek DOM hash 类名集中管理
│   ├── utils.js                  # 通用工具函数（防抖/暗色检测/图片识别等）
│   ├── styles.js                 # 样式注入
│   ├── themes.js                 # 主题色定义
│   ├── userscript-headers.js     # 油猴头部元数据
│   │
│   ├── platform/
│   │   └── bridge.js             # 跨环境桥接（WebView 原生 / 篡改猴 Web 降级）
│   │
│   ├── customizations/           # 外观自定义
│   │   ├── background.js         # 背景图/字体应用
│   │   ├── border-theme.js       # 窄边距主题
│   │   ├── font.js               # 自定义字体
│   │   └── placeholder.js        # 占位符文字
│   │
│   ├── features/                 # 功能模块（核心）
│   │   ├── capability-register.js    # Agent 能力注册（工具 + 提示词）
│   │   ├── capability-agent.js       # Agent 循环引擎（续跑 prompt）
│   │   ├── memory.js                 # 记忆系统聚合入口
│   │   ├── memory/                   # 记忆系统子模块
│   │   │   ├── schema.js             #   常量 + 纯函数
│   │   │   ├── selector.js           #   智能选择器（分词/评分/相似度）
│   │   │   └── store.js              #   数据层工厂（localStorage）
│   │   ├── memory-importer.js        # 记忆导入工具
│   │   ├── todo.js                   # Todo 清单管理器
│   │   ├── ask-user.js               # 主动提问管理器
│   │   ├── text-process.js           # 文本处理核心（工具调用 XML/卡片渲染）
│   │   ├── anti-recall.js            # 防撤回（XHR hook + Agent 请求拦截）
│   │   ├── history-cleanup.js        # 历史消息清理（三层防御第二层）
│   │   ├── loop-engine.js            # 循环引擎 v2.0（独立于 Agent 循环）
│   │   ├── conversation-detector.js  # 会话检测与缓存
│   │   ├── default-mode.js           # 默认模式自动切换
│   │   ├── remove-components.js      # 无用组件移除
│   │   ├── redirect.js / title-faker.js / sakura.js   # 跳转/标题伪装/樱花
│   │   ├── auto-retry.js / copy-code.js / mermaid.js  # 自动重试/代码复制/图表
│   │   ├── privacy-shield.js         # 敏感词替换
│   │   ├── inline-export.js / export.js / saved-items.js
│   │   ├── history-tags.js / context-menu.js / token-speed.js
│   │   ├── usage-stats.js / data-store.js / folder-store.js
│   │   ├── personas.js / postures.js / payloads.js / workflows.js / roadmap.js / handoff.js
│   │   ├── skill.js / scenario.js / preset.js
│   │   ├── web-tools.js              # web_search / web_fetch 工具实现
│   │   ├── mcp/                      # MCP 协议客户端
│   │   ├── artifacts/                # 制品导出（HTML/Markdown/PDF）
│   │   ├── automation/               # 自动化调度
│   │   ├── i18n/                     # 国际化
│   │   ├── multimodal/               # 多模态分析
│   │   ├── pet/                      # 桌面宠物
│   │   ├── project/                  # 项目管理工作台
│   │   ├── sandbox/                  # Python 沙箱
│   │   ├── sync/                     # WebDAV 同步
│   │   └── usage/                    # 使用量统计
│   │
│   ├── persistence/              # 持久化层
│   │   ├── versioned-repository.js
│   │   ├── coalescing-mutation-queue.js
│   │   └── serial-operation-queue.js
│   │
│   ├── ui/                       # UI 模块
│   │   ├── settings-panel.js     # 设置面板（7 Tab / 11 Tab 双布局）
│   │   ├── menu-inject.js        # 菜单注入（侧边栏 + 移动端下拉）
│   │   ├── folder-panel.js       # 文件夹管理面板
│   │   ├── preset-menu.js        # 预设菜单 + 历史记录
│   │   └── toast.js              # 通用 Toast 通知
│   │
│   └── utils/                    # 工具模块
│       ├── fetch-hub.js          # 统一 Fetch 拦截中心
│       ├── observer-hub.js       # 统一 MutationObserver 调度中心
│       ├── agent-marker.js       # Agent 续跑标记识别（三层防御）
│       ├── prompt-augmentation.js # 提示词拼装统一入口
│       ├── streaming-tool-parser.js # 流式工具调用解析状态机
│       ├── token-estimator.js    # Token 估算
│       └── prompt-visibility.js  # 用户消息可见性标记
│
├── webpack.config.js             # 双环境构建配置
├── userscript-headers.js         # 油猴头部元数据
├── banner.txt                    # ASCII 艺术字 banner
└── package.json
```

## 四、核心架构分层

### 4.1 初始化分层（index.js）

初始化分四批，保证关键功能优先、非关键功能不阻塞首屏：

```
init()
  ├── [document-start] initRedirect()              # 自动跳转（early-boot 已处理则跳过）
  ├── await domReady()                              # 等待 DOM 就绪
  ├── 第一批：关键功能
  │   ├── injectStyles()
  │   ├── registerDomHandler({})  # 触发 observer-hub 安装
  │   └── installXhrHook()       # 防撤回 + Agent 请求拦截
  ├── 第二批（requestAnimationFrame）：UI 增强
  │   ├── initSakura / initTitleFaker / applyCustomizations
  │   ├── initPresetMenu / injectMenuItem / initDefaultMode / initCopyCode
  │   ├── 效率工具（inlineExport / historyTags / contextMenu / tokenSpeed / usageStats）
  │   ├── Agent 系统（顺序敏感）：
  │   │   initMemory → initTodoManager → initAskUserManager
  │   │   → initCapabilityRegister → initCapabilityAgent
  │   ├── loopEngine（依赖 payloads/postures/personas/workflows/roadmap/handoff）
  │   └── Phase 6 模块（i18n → webTools → mcp → project → pet → artifacts
  │       → memoryImporter → sync → automation → multimodal → sandbox）
  ├── 第三批（requestIdleCallback）：全量扫描 + 组件移除 + 文件夹面板
  └── 路由监听 + 暗色模式监听 + beforeunload 清理
```

**防重入**：`window._dsInitStarted` 全局标志跨脚本实例共享。

### 4.2 请求拦截与提示词注入分层

DeepSeek 网页实际通过 **XHR**（非 fetch）发送 `/api/v0/chat/completion`，因此需要双路径拦截：

```
用户输入 → DeepSeek 发送请求
         ├── XHR 路径（实际路径）
         │   anti-recall.js 的 send hook
         │   → applyPromptAugmentation(body)
         │   → observeXhrStream() 复用 fetch-hub 的事件分发
         │
         └── fetch 路径（备用 / history_messages）
             fetch-hub.js 的 window.fetch hook
             → injectPromptAndMemory(args)
             → observeStream() 分发 onStart/onChunk/onEnd
```

**提示词拼装统一入口**（`prompt-augmentation.js` 的 `buildPromptPrefix`）：

```
普通用户消息（5 层累加）：
  1. Preset 预设内容（最高优先级，---分隔）
  2. Skill /命令注入（命中后替换 effectivePrompt）
  3. 系统指令 [系统指令]...[/系统指令]
  4. 记忆系统 [系统记忆]...[/系统记忆]（传入 effectivePrompt 做关键词匹配）
  5. 能力注册 [能力]...[/能力]
  + 若 skill 命中：额外 prepend [技能指令]...[/技能指令]

Agent 续跑消息：
  只注入 [能力]...[/能力]（续跑 prompt 已含原始任务和工具结果）
```

### 4.3 Agent 系统架构

Agent 系统是本项目最复杂的子系统，由三个核心模块构成：

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 系统总体流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  用户消息 ──→ prompt-augmentation 注入 [能力] 提示词          │
│      ↓                                                       │
│  DeepSeek 回复（含 <tool_name>{json}</tool_name>）           │
│      ↓                                                       │
│  text-process.js 段落级扫描                                   │
│   ├── 解析 XML → 调用 capability-register.executeToolCall    │
│   ├── 隐藏 XML 文本，插入工具调用卡片                          │
│   │   ├── todo_write → 渲染三色状态卡片                       │
│   │   ├── ask_user  → 渲染提问卡片 + 启动 pending Promise     │
│   │   └── 其他      → 渲染紧凑工具调用卡片                     │
│   └── 收集 agentResults → 调用 capability-agent              │
│      ._dsOnToolCallExecuted(agentResults, originalPrompt)    │
│      ↓                                                       │
│  capability-agent.js 续跑循环                                 │
│   ├── waitForReplyComplete()（fetch-hub onEnd 优先）         │
│   ├── buildContinuationPrompt() 构造续跑 prompt：             │
│   │   __DS_AGENT_V2_START__                                  │
│   │   <original_task>...</original_task>                     │
│   │   <tool_results>...</tool_results>                       │
│   │   <user_answers>...</user_answers>（如有）                │
│   │   <todo_status>...</todo_status>（如有）                  │
│   │   <reminder>...</reminder>（连续3轮未更新todo时）         │
│   │   __DS_AGENT_V2_END__                                    │
│   ├── injectText() React 兼容注入                              │
│   ├── clickSendButton() 多策略发送                             │
│   └── 循环直至：agent_finish / 用户停止 / 达到轮次上限         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**三个模块的职责分离**：

| 模块 | 职责 | 关键接口 |
|------|------|----------|
| `capability-register.js` | 教 AI 用什么工具（prompt 注入）+ 执行工具调用 | `window._dsCapabilityInjector` / `_dsExecuteToolCall` / `_dsParseToolCalls` |
| `capability-agent.js` | 把工具结果回传给 AI 形成循环 | `window._dsOnToolCallExecuted` / `_dsStopAgent` / `_dsRecordOriginalTask` |
| `text-process.js` | DOM 层工具调用 XML 扫描与卡片渲染 | `scanToolCallElements` / `_processParagraphForToolCalls` |

### 4.4 工具注册体系

`capability-register.js` 通过 `registry`（单一数据源）管理所有工具：

**22 个内置工具**（顶层立即注册，因为 history-cleanup 依赖 `TOOL_NAMES` 构建正则）：

| 类别 | 工具名 | 是否触发续跑 |
|------|--------|--------------|
| memory | `memory_save` / `memory_update` / `memory_delete` / `memory_replace` / `memory_merge` / `memory_review` / `memory_search` / `memory_list` / `memory_pin` / `memory_stats` / `memory_export` / `memory_archive` / `memory_get` / `memory_clear` / `memory_import_preview` | 是 |
| memory | `memory_recall` | **否**（仅记录访问，不续跑） |
| todo | `todo_write` / `todo_read` / `todo_clear` | 是 |
| ask_user | `ask_user` | 是 |
| control | `start_agent` | 是 |
| control | `agent_finish` | **否**（终止循环） |

**动态工具**（按 CONFIG 开关注册）：
- `web_search` / `web_fetch`（`CONFIG.webToolsEnabled`）
- `python_exec`（`CONFIG.pythonSandboxEnabled`）
- `mcp_discover` / `mcp_describe` / `mcp_invoke`（`CONFIG.mcpEnabled`）
- `mcp__{server}__{tool}`（MCP 服务发现后自动注册）

**`requireAgentFeedback` 标记**：`memory_recall` 和 `agent_finish` 不触发续跑，其余工具都会触发。

### 4.5 提示词分层结构

`getCapabilityPrompt()` 拼装为 `[能力]...[/能力]` 包裹的六层结构：

| 层 | 内容 | 来源 |
|----|------|------|
| 第一层 | 核心规则（身份/格式/ID规则/决策原则/行为约束） | 静态缓存 `_cachedCoreRules` |
| 第二层 | 工具说明（动态渲染当前注册的工具） | `registry.renderAllSchemas()` |
| 第三层 | 高级用法（记忆审查/融合决策/Agent循环终止） | 静态缓存 `_cachedAdvancedUsage` |
| 第四层 | 分层记忆说明（Core/Archival/History/冲突/容量） | 静态缓存 |
| 第五层 | Todo 清单管理规则 | 静态缓存 |
| 第六层 | 用户提问规则（ask_user 使用时机） | 静态缓存 |

### 4.6 续跑 prompt 标记的三层防御

`agent-marker.js` 集中管理续跑标记识别，解决刷新后识别混乱问题：

| 层 | 标记 | 可靠性 |
|----|------|--------|
| v2 边界标记 | `__DS_AGENT_V2_START__` ... `__DS_AGENT_V2_END__` | 最可靠（包裹整段，刷新后仍可识别） |
| v1 末尾标记 | `__ds_agent_continuation__` | 向后兼容（可能被截断） |
| 结构化标签 | 同时含 `<original_task>` + `<tool_results>` | 用户不会自然输入此组合 |

### 4.7 废弃数据清理的三层防御

避免工具调用 XML 和续跑 prompt 残留在用户可见消息中：

| 层 | 时机 | 模块 | 策略 |
|----|------|------|------|
| 第一层 | 流式输出时 | `text-process.js` | 实时清理 DOM（`cleanAIWasteData` / `cleanContinuationPrompt`） |
| 第二层 | 历史消息加载时 | `history-cleanup.js` | 拦截 `history_messages` API 响应，持久化清理 |
| 第三层 | 续跑 prompt 标识 | `agent-marker.js` | 用特殊标记包裹，加载时替换为不可见占位符 + Agent 徽章 |

**安全策略**：能力说明段落（`## 工具调用格式` 等）仅在文本**完全由能力说明组成**（清理后 ≤10 字符）时清理，保护 AI 正常回复中引用的内容。

## 五、跨模块协作接口

### 5.1 window 全局接口约定

项目通过 `window._ds*` 命名空间暴露跨模块接口，避免 ES Module 循环依赖：

| 接口 | 提供方 | 调用方 |
|------|--------|--------|
| `window._dsCapabilityInjector()` | capability-register | prompt-augmentation |
| `window._dsMemoryInjector(prompt)` | memory | prompt-augmentation |
| `window._dsParseToolCalls(text)` | capability-register | text-process |
| `window._dsExecuteToolCall(name, payload)` | capability-register | text-process |
| `window._dsToolNames` | capability-register | text-process / history-cleanup / streaming-tool-parser |
| `window._dsOnToolCallExecuted(results, prompt)` | capability-agent | text-process |
| `window._dsStopAgent(reason)` | capability-agent | text-process（检测到 agent_finish） |
| `window._dsRecordOriginalTask(prompt)` | capability-agent | fetch-hub / anti-recall |
| `window._dsTodoWrite / _dsTodoRead / _dsTodoClear` | todo | capability-register |
| `window._dsAskUser / _dsSubmitAskUserAnswer / _dsCancelAskUser` | ask-user | capability-register / text-process |
| `window._dsPendingAskPromise` | text-process | capability-agent |
| `window.__dsConfig` | config | 所有需要动态读取配置的模块 |
| `window._dsBridgeCallback(id, success, result)` | platform/bridge | 原生端 |

### 5.2 fetch-hub 生命周期事件

`fetch-hub.js` 提供 `registerCompletionHandler({ onStart, onChunk, onEnd })`，统一分发 completion 流式事件：

- `onStart({ startTime, model, prompt, route, chatSessionId })`
- `onChunk({ chunk, accumulatedText, elapsedMs, tokens, firstTokenMs, serverStats })`
- `onEnd({ tokens, tps, durationMs, model, accumulatedText, serverStats, tokenSource, speedSource, chatSessionId, assistantMessageId, route })`

**消费者**：memory（onStart 触发自动记录）、token-speed、usage-stats、capability-agent（onEnd 用于精准感知流式完成）。

### 5.3 observer-hub DOM 事件

`observer-hub.js` 提供 `registerDomHandler({ onElements, onTextNodes, onDialogs })`，统一调度 MutationObserver：

- `onElements(elements)`：新增元素节点（防抖 200ms）
- `onTextNodes(nodes)`：变化文本节点（防抖 300ms）
- `onDialogs(dialogs)`：新增弹窗（防抖 350ms）

**消费者**：fullScan / removeUnwantedComponents（内置）/ 各模块自定义处理器。

## 六、平台桥接机制

`platform/bridge.js` 通过 `window.AndroidBridge` 探测环境，提供统一 API：

```
篡改猴环境：navigator.clipboard / navigator.vibrate / navigator.share / Web Notification
WebView 环境：window.AndroidBridge.invokeSync / invokeAsync + _dsBridgeCallback 回调
```

所有 API 返回 Promise，调用方无需关心环境差异。异步调用有 60 秒超时保护。

## 七、配置系统

`config.js` 采用"内存缓存 + 防抖异步写入"策略：

- **存储键**：`ds_enhance_config`（localStorage）
- **写入防抖**：250ms，多次连续 saveConfig 合并为一次 setItem
- **内存缓存**：`_cachedConfig` + `_cacheDirty` 标志，避免重复 JSON.parse
- **CONFIG 引用**：`export let CONFIG`，saveConfig 时同步更新引用 + `window.__dsConfig`
- **beforeunload**：flushConfig 确保待写入数据落盘

**Agent 系统配置联动**：
- `agentSystemEnabled`（总开关）OFF 时，saveSettings 强制把三个子开关（`agentMemoryEnabled` / `agentToolsEnabled` / `agentLoopEnabled`）置为 false
- 总开关 ON 时保留子模块的单独控制（允许只开工具调用不开循环）

## 八、记忆系统架构

P4 重构后采用分层设计：

| 文件 | 角色 | 依赖 |
|------|------|------|
| `memory/schema.js` | 常量 + 纯函数（无副作用） | 无 |
| `memory/selector.js` | 纯选择器（分词/评分/相似度） | schema.js / token-estimator |
| `memory/store.js` | 数据层工厂 `createMemoryStore` | schema.js / selector.js |
| `memory.js` | 聚合入口（全局 store + UI + 注入 + 自动记录） | 上述三个 + fetch-hub / config / toast |
| `memory-importer.js` | 独立导入工具（模态框） | memory.js 公共 API / toast |

**记忆数据结构**：`{ id, title, content, category, tags, pinned, enabled, scope, createdAt, updatedAt, accessCount, lastAccessedAt, history }`

**智能选择流程**（`selectMemories`）：
1. 评分 = pinned(+1000) + keywordScore + decayScore + 一小时内访问(+5)
2. 按 token 预算（默认 1500，长 prompt 动态压缩至 800）依次纳入
3. `touchMemories` 异步反馈（accessCount +1）
4. `formatMemoryLine` 拼接为 `- [scope type] (id:mem-xxx) 标题: 内容`

**记忆 ID 透传**：注入行显式包含 `(id:mem-xxx)`，让 AI 在调用 `memory_merge` / `memory_update` 等工具时能引用正确 ID。

**防重删机制**：删除记忆时记录 ID + 内容签名到 `ds_memories_deleted_ids` / `ds_memories_deleted_sigs`（上限 1000，LRU 淘汰），`memory_save` 时双路检查避免重新保存已删除记忆。

## 九、循环引擎 v2.0（独立于 Agent 循环）

`loop-engine.js` 是独立于 Agent 循环的另一套循环系统，通过信号检测驱动：

| 特性 | loop-engine | capability-agent |
|------|-------------|------------------|
| 触发方式 | AI 回复尾部的 `[[GITL::PROCEED]]` / `[[GITL::HALT]]` 信号 | AI 输出工具调用 XML |
| 续跑内容 | "继续" + 可选人格指令 | `<original_task>` + `<tool_results>` |
| 防重发 | at-most-once 事务性发送（9秒确认窗口 + 三种投递证据） | 输入框清空验证 |
| 多标签页 | Tab Lock（8秒有效期 + 5秒心跳） | 无 |
| 漂移防护 | 20 轮上限 + regroundLoop 重新锚定 | 3/8 轮上限 |
| 不确定状态 | uncertain 暂停等待人工裁决 | 用户停止按钮 |

## 十、UI 渲染关键约定

### 10.1 React DOM 节点处理

**永远不要 remove React 管理的 DOM 节点**，否则会触发 `NotFoundError: removeChild`。替代方案：
- 隐藏：`el.style.display = 'none'`
- 替换内容：`el.textContent = ''` 后 appendChild 新节点（避免 React 找不到原子节点）
- 插入：`parent.insertBefore(newNode, oldNode)` + 隐藏 oldNode

### 10.2 React 受控组件绕过

向 DeepSeek 输入框注入文本必须用原生 setter + 派发事件：

```js
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, 'value'
).set;
nativeSetter.call(textarea, value);
// 失效 React value tracker
const tracker = textarea._valueTracker;
if (tracker) tracker.setValue('');
textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
```

### 10.3 段落级 textContent 扫描

DeepSeek 把 `<memory_save>` 转义为 `&lt;memory_save&gt;` 并分散到多个 `<span>/<br>`，单 textNode 无法匹配。`scanToolCallElements` 合并段落 `textContent` 后用正则匹配，匹配后直接修改 `textContent`（清空子节点用一个文本节点替换）。

**防重入**：`paragraph.dataset.dsToolProcessed = 'true'` 必须在 **await 之前** 立即设置。

### 10.4 移动端菜单特殊处理

移动端 `ds-dropdown-menu` 注入"脚本设置"入口时**不**强制隐藏 `.ds-floating-position-wrapper`、**不**阻止 click 冒泡，让 DeepSeek 自身的菜单点击处理器关闭菜单，保证 React `isOpen` 状态正确。

## 十一、构建系统

### 11.1 命令

```bash
npm run dev       # 开发构建（保留注释 + source-map）
npm run watch     # 监听模式
npm run build     # 生产构建（terser 压缩 + 重新注入头部）
npm run build:android  # 生产构建 + 同步资源到 Android
```

### 11.2 多 config 并行

webpack.config.js 导出三个 config（篡改猴版 / WebView 主脚本 / early-boot stub），并行执行。为避免 `output.clean` 在多 config 间互相清空产物，首次构建时手动清理 dist，所有 config 设 `clean: false`。

### 11.3 头部注入

- **开发模式**：`BannerPlugin` 注入头部（保留注释）
- **生产模式**：terser 删除所有注释后，`ReinjectHeaderPlugin` 在 `PROCESS_ASSETS_STAGE_REPORT` 阶段重新注入头部

`banner.txt` 支持 `${name}` / `${version}` / `${description}` / `${author}` / `${namespace}` 变量替换。

## 十二、关键约束速查

| 约束 | 说明 |
|------|------|
| 不 remove React DOM | 用 `display:none` 或 `insertBefore + hide` |
| 不在 capability-register 顶层 await | 顶层同步注册 22 个内置工具，因为 history-cleanup 依赖 TOOL_NAMES |
| 续跑 prompt 必须用 v2 边界标记 | `__DS_AGENT_V2_START__` ... `__DS_AGENT_V2_END__` |
| 敏感词替换只作用于 `ds-message _63c77b1` 内文本节点 | 避免误伤 React props |
| 记忆注入必须传 original prompt 给 `_dsMemoryInjector()` | 启用关键词匹配 |
| 工具调用 toast 通知必须移除 | 只显示卡片，不弹 toast |
| 同一时间最多 1 个 in_progress todo | 校验规则之一 |
| ask_user 每次最多 4 个问题 | 每个问题 2-4 个选项 |
| 连续 3 轮未更新 todo 注入 `<reminder>` | nag 提醒机制 |
| 有 pending todo 时续跑上限提升至 8 轮 | 默认 3 轮 |
| 删除文件需用户确认 | 参见 user_profile |

---

详细开发规范请查阅 [DEVELOPMENT.md](./DEVELOPMENT.md)。
