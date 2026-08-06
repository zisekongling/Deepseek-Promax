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
│   ├── index.js                  # 主入口（篡改猴版 + WebView 主脚本共用）：四批初始化（关键/UI/Agent/Idle），防重入
│   ├── desktop-index.js          # 桌面端入口：Electron 环境专用初始化流程
│   ├── mobile-index.js           # 移动端入口：Android WebView 环境专用初始化流程
│   ├── early-boot.js             # WebView 早注入 stub 入口：仅安装 document-start 阶段必需的 hook（redirect/XHR/fetch）
│   ├── config.js                 # 配置管理：DEFAULTS / loadConfig / saveConfig，内存缓存 + 250ms 防抖写入
│   ├── selectors.js              # DeepSeek DOM hash 类名集中管理：所有 CSS 类名单一定义，禁止硬编码
│   ├── utils.js                  # 通用工具函数：debounce/throttle/暗色检测/图片识别/平台探测等
│   ├── styles.js                 # 样式注入：全局 CSS 注入管理
│   ├── themes.js                 # 主题色定义：各主题色方案的色值常量
│   ├── userscript-headers.js     # 油猴头部元数据
│   │
│   ├── platform/
│   │   ├── bridge.js             # 跨环境桥接：window.AndroidBridge 探测，统一切剪贴板/震动/分享/通知 API，异步调用 60 秒超时
│   │   └── desktop-bridge.js     # 桌面端桥接：Electron IPC 通信封装，支持 invoke/handle 模式
│   │
│   ├── customizations/           # 外观自定义
│   │   ├── background.js         # 背景图/字体应用：自定义聊天背景图片和字体样式
│   │   ├── border-theme.js       # 窄边距主题：紧凑布局，减少留白
│   │   ├── font.js               # 自定义字体：允许用户设置自定义字体族
│   │   ├── placeholder.js        # 占位符文字：修改输入框占位提示文字
│   │   ├── cherry-theme.js       # 樱花主题：粉色调主题色方案
│   │   ├── forest-theme.js       # 森林主题：绿色调主题色方案
│   │   ├── lavender-theme.js     # 薰衣草主题：紫色调主题色方案
│   │   ├── ocean-theme.js        # 海洋主题：蓝色调主题色方案
│   │   └── sunset-theme.js       # 日落主题：橙色调主题色方案
│   │
│   ├── agent/                    # Agent 系统（新架构，统一入口）
│   │   ├── index.js                  # 统一入口（整合所有子模块）
│   │   ├── core/                     # 核心引擎
│   │   │   ├── tool-registry.js      #   工具注册中心（单一数据源）
│   │   │   ├── harness.js            #   约束/验证/纠正框架
│   │   │   ├── context.js            #   上下文管理（提示词构建）
│   │   │   └── engine.js             #   ReAct 循环引擎
│   │   ├── tools/                    # 工具集（五类）
│   │   │   ├── memory-tools.js       #   记忆操作（Execution）
│   │   │   ├── control-tools.js      #   控制流（Control）
│   │   │   ├── collaboration-tools.js #  协作（Collaboration）
│   │   │   ├── perception-tools.js   #   感知（Perception）
│   │   │   └── execution-tools.js    #   执行（Execution）
│   │   └── guards/                   # 护栏层
│   │       ├── tool-guard.js         #   工具护栏
│   │       ├── input-guard.js        #   输入护栏
│   │       └── output-guard.js       #   输出护栏
│   │
│   ├── features/                 # 功能模块（核心）
│   │   │
│   │   ├── # === 文本与内容增强 ===
│   │   ├── text-process.js           # 文本处理核心：工具调用 XML 解析、工具卡片渲染（todo/ask_user/通用）、段落级扫描、续跑 prompt 清理
│   │   ├── anti-recall.js            # 防撤回：拦截 XHR response getter 检测被撤回回复，替换为本地缓存存档，支持 SSE 流式+历史消息
│   │   ├── privacy-shield.js         # 隐私护盾：敏感词替换，仅作用于 `.ds-message` 类文本节点，支持大小写敏感开关
│   │   ├── mermaid.js                # Mermaid 图表渲染：检测 Markdown 中的 mermaid 代码块，调用 mermaid.js 渲染为 SVG 图表
│   │   ├── code-fold.js              # 代码块折叠：根据行数阈值自动折叠代码块，通过 observer-hub 实时响应流式输出
│   │   ├── think-fold.js             # 思考折叠：将 AI 的 `> 思考` 引用块折叠为可展开的摘要行
│   │   ├── copy-code.js              # 行内代码复制：点击 Markdown 行内代码自动复制到剪贴板并显示 Toast
│   │   ├── code-executor.js          # 代码块执行：在 bash/bat/powershell 代码块旁注入"执行"按钮，支持终端选择
│   │   │
│   │   ├── # === Agent 能力（旧版，已由 agent/ 替代） ===
│   │   ├── capability-register.js    # [旧] Agent 能力注册：在请求前注入能力提示词，提供 executeToolCall 执行器，支持动态工具注册
│   │   ├── capability-agent.js       # [旧] Agent 循环引擎：检测工具调用 XML 并执行，构建续跑 prompt 发送给 AI
│   │   │
│   │   ├── # === 记忆系统 ===
│   │   ├── memory.js                 # 记忆系统聚合入口：全局 store + 自动注入 + 自动记录 + UI 管理（1293行）
│   │   ├── memory/                   # 记忆系统子模块
│   │   │   ├── schema.js             #   常量 + 纯函数：记忆数据结构、格式化、验证、去重签名
│   │   │   ├── selector.js           #   智能选择器：分词/关键词评分/时间衰减/相似度计算，按 token 预算筛选
│   │   │   └── store.js              #   数据层工厂：createMemoryStore()，封装 localStorage CRUD + 防重删
│   │   ├── memory-importer.js        # 记忆导入：解析 JSON 格式记忆数据，预览卡片展示，选择性导入，防重复写入
│   │   │
│   │   ├── # === Agent 协作工具 ===
│   │   ├── todo.js                   # Todo 清单管理器：6 项校验规则，全量替换模式，最多 1 个 in_progress，nag 提醒
│   │   ├── ask-user.js               # 主动提问管理器：最多 4 问题/每题 2-4 选项，同一时刻 1 个 pending，支持答案提交
│   │   ├── loop-engine.js            # 循环引擎 v2.0：信号驱动（[[GITL::PROCEED]]/[[GITL::HALT]]），at-most-once 事务，Tab Lock，崩溃恢复
│   │   │
│   │   ├── # === 会话与消息管理 ===
│   │   ├── conversation-detector.js  # 会话检测：从 URL 提取会话 ID，获取标题，缓存最近会话，侧边栏会话列表提取
│   │   ├── history-cleanup.js        # 历史消息清理：拦截 history_messages API 响应，清理工具调用 XML 和续跑 prompt
│   │   ├── history-tags.js           # 历史标签：增强历史会话搜索，支持自定义标签添加和按标签筛选
│   │   ├── data-store.js             # 对话数据存储：从 XHR/Fetch 响应中捕获对话数据，供导出功能使用
│   │   │
│   │   ├── # === 导出功能 ===
│   │   ├── export.js                 # 对话导出：支持 JSON / Markdown / PNG 三种格式，数据源优先级 Store → IndexedDB → DOM
│   │   ├── inline-export.js          # 内联导出：每条消息添加导出 Markdown 按钮，点击下载单条消息
│   │   ├── table-export.js           # 表格导出：将 Markdown 表格导出为 CSV 或 Excel 格式
│   │   ├── saved-items.js            # 收藏项管理：收藏/取消收藏消息，持久化存储，支持查看和导出
│   │   │
│   │   ├── # === 效率增强 ===
│   │   ├── auto-retry.js             # 自动重试：检测网络错误"重新生成"按钮，通过 SVG path 特征识别，自动点击重试
│   │   ├── token-speed.js            # Token 速度显示：实时显示 token 生成速度和总数，支持流式增量解析
│   │   ├── usage-stats.js            # 使用量统计：统计对话轮次、token 消耗、会话时长等使用数据
│   │   ├── context-menu.js           # 右键场景模板：选中文本弹出菜单（总结/解释/翻译），支持自定义场景模板
│   │   ├── file-upload.js            # 文件上传（专家模式）：发送栏注入上传按钮，文件卡片渲染，文本内容注入 prompt（75000字上限）
│   │   │
│   │   ├── # === UI 增强 ===
│   │   ├── default-mode.js           # 默认模式切换：检测模式选择器重置，自动点击用户配置的模式（快速/专家/识图），最多 8 次重试
│   │   ├── remove-components.js      # 组件移除：隐藏转发按钮/下载应用入口/分享按钮，遵循 React 安全操作规范
│   │   ├── redirect.js               # 自动跳转：从旧域名/channel 页面自动跳转到主页面
│   │   ├── title-faker.js            # 标题伪装：自定义页面标题，支持动态替换
│   │   ├── sakura.js                 # 樱花动画：Canvas 实现的樱花飘落背景动画
│   │   ├── magic-wand.js             # 魔法棒：侧边栏宽度切换、用户对话字体大小切换等界面快捷控制
│   │   │
│   │   ├── # === Agent 上下文注入 ===
│   │   ├── personas.js               # 人格定义：为 loop-engine 提供不同人格模式的 prompt 指令
│   │   ├── postures.js               # 姿态定义：定义 Agent 的行为姿态（如分析模式、执行模式）
│   │   ├── payloads.js               # 载荷定义：loop-engine 续跑时注入的额外上下文指令
│   │   ├── workflows.js              # 工作流定义：预定义的多步骤 Agent 工作流模板
│   │   ├── roadmap.js                # 路线图：任务规划与进度追踪的 prompt 模板
│   │   ├── handoff.js                # 交接报告：生成 Markdown 格式的 AI 交接报告，跨标签页传递
│   │   │
│   │   ├── # === 技能与预设 ===
│   │   ├── skill.js                  # 技能系统入口：技能注册、调用、命令解析的聚合模块
│   │   ├── scenario.js               # 场景模板：预定义对话场景（如代码审查、写作助手），快速切换 AI 行为
│   │   ├── preset.js                  # 预设管理：预设内容创建、编辑、激活，在 prompt 注入时插入
│   │   │
│   │   ├── # === 高级能力 ===
│   │   ├── web-tools.js              # Web 工具：web_search（搜索引擎查询）和 web_fetch（网页抓取）的实现
│   │   ├── tool-descriptors.js       # 工具描述符：为旧版 capability-register 提供工具描述符定义
│   │   │
│   │   ├── # === 数据管理 ===
│   │   ├── folder-store.js           # 文件夹管理：会话文件夹创建/重命名/删除，会话添加/移除，从 DeepSeek-Enhancer 移植
│   │   │
│   │   ├── # === 子模块（复杂功能，独立目录） ===
│   │   ├── mcp/                      # MCP 协议客户端
│   │   │   ├── client.js             #   MCP 客户端：服务发现、连接管理、工具调用
│   │   │   ├── capability-projection.js # 能力投影：MCP 服务能力映射到 Agent 工具注册
│   │   │   ├── store.js              #   MCP 配置持久化存储
│   │   │   └── transports/           #   传输层：common.js（公共逻辑）/ http.js / sse.js / streamable.js
│   │   │
│   │   ├── artifacts/                # 制品导出（HTML/Markdown/PDF/Service）
│   │   │   ├── index.js              #   入口：统一导出接口
│   │   │   ├── html.js               #   HTML 制品生成
│   │   │   ├── markdown.js           #   Markdown 制品生成
│   │   │   ├── pdf.js                #   PDF 制品生成
│   │   │   └── service.js            #   制品服务：统一调度渲染和导出
│   │   │
│   │   ├── automation/               # 自动化调度
│   │   │   ├── index.js              #   入口：初始化调度器
│   │   │   ├── scheduler.js          #   调度器：cron 表达式解析，定时任务触发
│   │   │   ├── runner.js             #   运行器：任务执行引擎
│   │   │   ├── schedule.js           #   调度管理：任务的增删改查
│   │   │   ├── panel.js              #   面板：自动化调度 UI 面板
│   │   │   └── store.js              #   存储：调度任务持久化
│   │   │
│   │   ├── i18n/                     # 国际化
│   │   │   ├── index.js              #   入口：t() 翻译函数、语言切换
│   │   │   ├── store.js              #   语言偏好持久化
│   │   │   └── resources/            #   语言资源：en.js（英文）/ zh-CN.js（中文）
│   │   │
│   │   ├── multimodal/               # 多模态分析
│   │   │   ├── index.js              #   入口：多模态处理调度
│   │   │   ├── analyzer.js           #   分析器：图片/音频/视频内容分析
│   │   │   ├── media.js              #   媒体处理：格式转换、压缩
│   │   │   └── settings.js           #   多模态设置
│   │   │
│   │   ├── pet/                      # 桌面宠物
│   │   │   ├── index.js              #   入口：宠物初始化
│   │   │   ├── pet.js                #   宠物核心：动画、交互、拖拽
│   │   │   ├── lines.js              #   台词系统：随机台词、状态相关对话
│   │   │   └── store.js              #   宠物状态持久化
│   │   │
│   │   ├── project/                  # 项目管理工作台
│   │   │   ├── index.js              #   入口：项目初始化
│   │   │   ├── injector.js           #   注入器：将项目上下文注入 prompt
│   │   │   ├── panel.js              #   面板：项目管理 UI
│   │   │   └── store.js              #   存储：项目数据持久化
│   │   │
│   │   ├── sandbox/                  # Python 沙箱
│   │   │   ├── index.js              #   入口：沙箱初始化
│   │   │   ├── python-worker.js      #   Python Worker：Web Worker 中运行 Pyodide
│   │   │   └── tool.js               #   沙箱工具：python_exec 工具实现
│   │   │
│   │   ├── skill/                    # 技能系统（12 个文件）
│   │   │   ├── index.js              #   入口：技能系统初始化
│   │   │   ├── api.js                #   API：技能注册、调用、管理接口
│   │   │   ├── codec.js              #   编解码：技能数据序列化/反序列化
│   │   │   ├── repository.js         #   仓库：技能存储和检索
│   │   │   ├── builtin-skills.js     #   内置技能：系统预设技能集合
│   │   │   ├── sync-policy.js        #   同步策略：技能同步规则
│   │   │   ├── command-parser.js     #   命令解析：/命令 语法解析
│   │   │   ├── skill-doc-parser.js   #   文档解析：SKILL.md 格式解析
│   │   │   ├── skill-creator-tool.js #   创建工具：skill_draft_create 工具实现
│   │   │   ├── github-importer.js    #   GitHub 导入：从 GitHub 仓库导入技能
│   │   │   ├── text-importer.js      #   文本导入：从纯文本导入技能
│   │   │   └── import-staging.js     #   导入暂存：预览和确认导入流程
│   │   │
│   │   ├── sync/                     # WebDAV 同步
│   │   │   ├── index.js              #   入口：同步系统初始化
│   │   │   ├── coordinator.js        #   协调器：同步流程编排（快照→差异→应用）
│   │   │   ├── snapshot.js           #   快照：数据快照生成与比对
│   │   │   ├── apply-journal.js      #   日志应用：增量变更应用
│   │   │   ├── store.js              #   存储：同步状态持久化
│   │   │   └── webdav-client.js      #   WebDAV 客户端：文件上传/下载/列表
│   │   │
│   │   ├── usage/                    # 使用量统计
│   │   │   ├── index.js              #   入口：统计系统初始化
│   │   │   ├── stats.js              #   统计：数据聚合和计算
│   │   │   ├── store.js              #   存储：统计数据持久化
│   │   │   └── types.js              #   类型定义：统计数据结构
│   │   │
│   │   └── capability-agent/         # [旧] Agent UI 子模块（已由 agent/ 替代）
│   │       ├── index.js              #   入口
│   │       ├── agent-ui.js           #   Agent UI 渲染
│   │       ├── ask-user-coordinator.js # 提问协调器
│   │       ├── input-dom.js          #   输入框 DOM 操作
│   │       ├── prompt-builder.js     #   Prompt 构建
│   │       ├── result-normalizer.js  #   结果归一化
│   │       └── state-store.js        #   状态存储
│   │
│   ├── persistence/              # 持久化层
│   │   ├── versioned-repository.js    # 版本化存储库：数据版本管理、快照、回滚
│   │   ├── coalescing-mutation-queue.js # 合并变更队列：批量去重写入，防抖合并
│   │   └── serial-operation-queue.js  # 串行操作队列：保证异步操作按序执行、错误隔离
│   │
│   ├── ui/                       # UI 模块
│   │   ├── settings-panel.js     # 设置面板：7 Tab（WebView）/ 11 Tab（篡改猴），响应式布局（桌面双栏/平板横滚/手机底部工作表）
│   │   ├── menu-inject.js        # 菜单注入：侧边栏菜单项 + 移动端下拉菜单"脚本设置"入口
│   │   ├── folder-panel.js       # 文件夹管理面板：会话文件夹树形 UI，拖拽排序
│   │   ├── preset-menu.js        # 预设菜单：快捷预设选择器，历史记录下拉
│   │   └── toast.js              # 通用 Toast：单例模式，支持 success/warning/error/info 四种色调，默认 3000ms
│   │
│   └── utils/                    # 工具模块
│       ├── fetch-hub.js          # 统一 Fetch 拦截中心：window.fetch 包装，注册 completion 事件处理器，防重入安装
│       ├── observer-hub.js       # 统一 MutationObserver 调度中心：按元素/文本节点/弹窗分类，内置防抖（200/300/350ms）
│       ├── agent-marker.js       # Agent 续跑标记识别：三层防御（v2边界/v1末尾/结构化标签），生成 Agent 徽章
│       ├── prompt-augmentation.js # 提示词拼装统一入口：buildPromptPrefix() 5层累加（预设/技能/系统指令/记忆/能力），区分普通消息与续跑消息
│       ├── streaming-tool-parser.js # 流式工具调用解析：状态机匹配不完整 XML 标签，支持跨 chunk 解析
│       ├── token-estimator.js    # Token 估算：字符→token 近似转换，支持流式增量估算
│       └── prompt-visibility.js  # 用户消息可见性标记：标记用户可见消息以区分续跑 prompt
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
  │   │   → initAgentSystem（统一入口，替代 initCapabilityRegister + initCapabilityAgent）
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

### 4.3 Agent 系统架构（v2.0 重构）

Agent 系统 v2.0 采用三层分离架构：**core（核心引擎）→ tools（工具集）→ guards（护栏层）**，通过 `agent/index.js` 统一入口初始化。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent 系统 v2.0 架构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  agent/index.js（统一入口）                                       │
│  ├── initAgentSystem() → 按 CONFIG 开关分层初始化                  │
│  │                                                               │
│  ├── core/                                                       │
│  │   ├── tool-registry.js  工具注册中心（单一数据源）              │
│  │   │   ├── register(descriptor, executor, options)              │
│  │   │   ├── execute(name, payload) → ToolResult                 │
│  │   │   ├── renderSchemas() → 提示词文本                         │
│  │   │   └── renderIndex() → 工具索引（渐进式披露）               │
│  │   ├── harness.js        Harness 框架（约束/验证/纠正）         │
│  │   │   ├── constrainToolCall()   工具调用前约束                  │
│  │   │   ├── verifyToolResult()    结果验证                       │
│  │   │   ├── verifyLoopState()     循环状态验证                   │
│  │   │   ├── correctToolFailure()  失败纠正策略                   │
│  │   │   └── createCircuitBreaker() 熔断器                       │
│  │   ├── context.js        上下文管理（六层提示词）                │
│  │   │   ├── buildCapabilityPrompt() → [能力]...[/能力]          │
│  │   │   └── buildToolIndexPrompt() → 渐进式披露用                │
│  │   └── engine.js         ReAct 循环引擎                         │
│  │       ├── onToolCallExecuted()  工具结果回调入口               │
│  │       ├── buildContinuationPrompt() 续跑 prompt 构建           │
│  │       └── stopAgent()           终止循环                       │
│  │                                                               │
│  ├── tools/（五类工具，按《AI Agent 实战》指南分类）               │
│  │   ├── memory-tools.js     记忆操作（Execution）                │
│  │   ├── control-tools.js    控制流（Control）                   │
│  │   ├── collaboration-tools.js 协作（Collaboration）            │
│  │   ├── perception-tools.js 感知（Perception）                  │
│  │   └── execution-tools.js  执行（Execution）                   │
│  │                                                               │
│  └── guards/（护栏层，安全执行保障）                               │
│      ├── tool-guard.js   工具护栏（pre + post + correct）         │
│      ├── input-guard.js  输入护栏（注入检测 + 边界标记检测）       │
│      └── output-guard.js 输出护栏（回复验证 + 任务完成审查）       │
│                                                                  │
│  与旧版的关系：                                                   │
│  - agent/index.js 替代 capability-register.js + capability-agent.js │
│  - 保持 window._ds* 接口向后兼容                                  │
│  - 旧模块保留标记 [旧]，逐步迁移后可移除                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**ReAct 循环流程（v2.0）**：

```
用户消息 ──→ prompt-augmentation 注入 [能力] 提示词
     ↓
DeepSeek 回复（含 <tool_name>{json}</tool_name>）
     ↓
text-process.js 段落级扫描
  ├── 解析 XML → agent/index.js executeToolCall()
  │   ├── pre-guard: preToolCallGuard() 约束检查
  │   ├── execute: registry.execute() 执行工具
  │   └── post-guard: postToolCallGuard() + correctToolCall() 验证纠正
  ├── 隐藏 XML 文本，插入工具调用卡片
  └── 收集 agentResults → engine.onToolCallExecuted()
     ↓
engine.js 续跑循环
  ├── waitForReplyComplete()
  ├── buildContinuationPrompt() 构造续跑 prompt
  ├── verifyLoopState() Harness 验证（熔断/重复检测）
  ├── injectText() + clickSendButton() 发送续跑
  └── 循环直至：agent_finish / 用户停止 / 达到轮次上限 / 熔断
```

**统一初始化流程**：

```
initAgentSystem()
  ├── 1. 获取注册中心单例 getDefaultRegistry()
  ├── 2. 注册所有内置工具 _registerAllBuiltinTools()
  │     ├── memory-tools（16 个记忆操作工具）
  │     ├── control-tools（start_agent / agent_finish / todo_*）
  │     ├── collaboration-tools（ask_user）
  │     ├── perception-tools（web_search / web_fetch / mcp_*）
  │     └── execution-tools（python_exec / skill_draft_create）
  ├── 3. 初始化上下文模块 initContextModule()
  │     └── 挂载 _dsCapabilityInjector（供 fetch-hub 调用）
  ├── 4. 初始化循环引擎 initAgentEngine()
  │     └── 挂载 _dsOnToolCallExecuted / _dsStopAgent 等
  └── 5. 挂载 backward-compat window._ds* 接口
```

**与旧版模块的职责对比**：

| 旧模块 | 新模块 | 职责变化 |
|--------|--------|----------|
| `capability-register.js` | `agent/index.js` + `core/tool-registry.js` + `tools/*` | 工具注册、执行、提示词构建分离到独立模块 |
| `capability-agent.js` | `core/engine.js` | 循环引擎独立，集成 Harness 安全检查 |
| 分散的工具执行器 | `tools/*`（五类） | 按《AI Agent 实战》指南五类分类，纯函数设计 |
| 无 | `guards/*`（三层） | 新增护栏层：工具/输入/输出安全检查 |
| 无 | `core/harness.js` | 新增 Harness 框架：约束/验证/纠正/熔断 |

### 4.4 工具注册体系（v2.0）

`agent/core/tool-registry.js` 通过 `createToolRegistry()` 工厂函数创建注册中心，`getDefaultRegistry()` 返回全局单例。

**五类工具分类**（按《AI Agent 实战》指南）：

| 分类 | 模块 | 工具 | 是否触发续跑 | 可并行 |
|------|------|------|--------------|--------|
| **Execution** | `memory-tools.js` | memory_save/update/delete/replace/merge/review/search/list/pin/stats/export/archive/get/clear/import_preview | 是 | 否 |
| **Execution** | `memory-tools.js` | memory_recall | **否** | 是 |
| **Execution** | `execution-tools.js` | python_exec / skill_draft_create | 是 | 否 |
| **Control** | `control-tools.js` | start_agent / todo_write / todo_read / todo_clear | 是 | 否 |
| **Control** | `control-tools.js` | agent_finish | **否**（终止循环） | 否 |
| **Collaboration** | `collaboration-tools.js` | ask_user | 是 | 否 |
| **Perception** | `perception-tools.js` | web_search / web_fetch | 是 | **是** |
| **Perception** | `perception-tools.js` | mcp_discover / mcp_describe / mcp_invoke | 是 | **是** |
| **Perception** | 动态注册 | mcp__{server}__{tool}（MCP 服务发现后） | 是 | **是** |

**动态工具**（按 CONFIG 开关注册）：
- `web_search` / `web_fetch`（`CONFIG.webToolsEnabled`）
- `python_exec`（`CONFIG.pythonSandboxEnabled`）
- `mcp_discover` / `mcp_describe` / `mcp_invoke`（`CONFIG.mcpEnabled`）
- `mcp__{server}__{tool}`（MCP 服务发现后自动注册，通过 `window._dsRegisterMcpServerTools`）

**注册中心 API**：

| 方法 | 用途 |
|------|------|
| `register(descriptor, executor, options)` | 注册工具（含描述符、执行器、选项） |
| `unregister(name)` | 注销工具 |
| `unregisterByCategory(category)` | 按分类批量注销 |
| `getDescriptor(name)` | 获取工具描述符 |
| `getAllDescriptors(category?)` | 获取所有工具描述符（可按分类筛选） |
| `getInvocationNames()` | 获取所有工具名（用于 `_dsToolNames`） |
| `resolveName(nameOrAlias)` | 别名解析为主名 |
| `isRequireAgentFeedback(name)` | 是否触发 Agent 续跑 |
| `isReadOnly(name)` | 是否只读（可并行调用） |
| `execute(name, payload)` | 执行工具调用 |
| `renderSchemas(descriptors?)` | 渲染工具 Schema 为提示词文本 |
| `renderIndex()` | 渲染工具索引（渐进式披露用） |

**工具执行流程（集成护栏）**：

```
executeToolCall(name, payload)
  ├── resolveName() 别名解析
  ├── preToolCallGuard() 约束检查
  │   ├── 工具是否已注册
  │   ├── Agent 系统是否启用
  │   └── 风险等级是否需要确认
  ├── registry.execute() 执行工具
  ├── postToolCallGuard() 结果验证
  │   ├── 格式校验（ok 字段）
  │   └── 连续失败模式检测
  └── correctToolCall() 失败纠正（retry/skip/abort/fallback）

### 4.5 提示词分层结构（v2.0）

`agent/core/context.js` 的 `buildCapabilityPrompt(registry)` 拼装为 `[能力]...[/能力]` 包裹的六层结构：

| 层 | 内容 | 来源 |
|----|------|------|
| 第一层 | 核心规则（身份/格式/ID规则/决策原则/行为约束） | 静态缓存 `_cachedCoreRules` |
| 第二层 | 工具说明（从 registry 动态渲染当前注册的工具 Schema） | `registry.renderSchemas()` |
| 第三层 | 高级用法（记忆审查/融合决策/Agent循环终止） | 静态缓存 `_cachedAdvancedUsage` |
| 第四层 | 分层记忆说明（Core/Archival/History/冲突/容量） | 静态缓存 |
| 第五层 | Todo 清单管理规则 | 静态缓存 |
| 第六层 | 用户提问规则（ask_user 使用时机） | 静态缓存 |

**渐进式披露**：`buildToolIndexPrompt(registry)` 仅输出工具名称和一句话描述，AI 可通过 `mcp_describe` 按需获取完整 Schema。

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
| `window._dsCapabilityInjector()` | agent/index（context） | prompt-augmentation |
| `window._dsMemoryInjector(prompt)` | memory | prompt-augmentation |
| `window._dsParseToolCalls(text)` | agent/index | text-process |
| `window._dsExecuteToolCall(name, payload)` | agent/index | text-process |
| `window._dsGetToolLabel(toolName)` | agent/index | UI |
| `window._dsToolNames` | agent/index（registry） | text-process / history-cleanup / streaming-tool-parser |
| `window._dsOnToolCallExecuted(results, prompt)` | agent/index（engine） | text-process |
| `window._dsStopAgent(reason)` | agent/index（engine） | text-process（检测到 agent_finish） |
| `window._dsRecordOriginalTask(prompt)` | agent/index（engine） | fetch-hub / anti-recall |
| `window._dsRegisterMcpServerTools` | agent/index | mcp/client.js |
| `window._dsUnregisterMcpServerTools` | agent/index | mcp/client.js |
| `window._dsUnregisterAllMcpTools` | agent/index | mcp/client.js |
| `window._dsAgentSystemReady` | agent/index | 外部检测初始化状态 |
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
| Agent 初始化统一入口 | `initAgentSystem()` 替代 `initCapabilityRegister()` + `initCapabilityAgent()` |
| 工具注册走 registry | 所有工具通过 `agent/core/tool-registry.js` 注册，不直接操作 `_dsToolNames` |
| 工具执行走护栏 | `executeToolCall()` 内置 pre-guard + post-guard + correct 三层防护 |
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
