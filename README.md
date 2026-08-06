# DeepSeek Promax

> DeepSeek 客户端多端构建工程：油猴脚本（JS）+ Android APK + Electron Desktop EXE，三端共享同一套脚本资源。

> **Vibe Coding** — 本项目完全通过 vibe coding 方式构建：以自然语言对话驱动 AI 生成代码、迭代功能、修复缺陷，开发者专注于意图表达与决策，由 AI 完成具体实现。

## 安装

### 油猴脚本（推荐）

先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展，然后点击下方链接一键安装 DeepSeek Promax：

[👉 点击安装 DeepSeek Promax 油猴脚本](https://github.com/zisekongling/Deepseek-Promax/raw/refs/heads/main/script.user.js)

> 链接指向仓库 `main` 分支根目录的 `script.user.js`，Tampermonkey 会识别 `// ==UserScript==` 头部并自动弹出安装确认窗口。安装后访问 [deepseek.com](https://deepseek.com) 即自动生效。

### 客户端（APK / EXE）

Android 与桌面客户端需从源码构建，参见下方 [构建命令](#构建命令) 章节。

## 项目结构

```
新建文件夹/
├── js/                      # 油猴脚本模块化开发目录（webpack 打包）
│   ├── src/
│   │   ├── index.js                # 主入口：四批初始化（关键/UI/Agent/Idle），防重入
│   │   ├── early-boot.js           # WebView 早注入 stub：仅安装 redirect/XHR/fetch hook
│   │   ├── desktop-index.js        # 桌面端入口（Electron）
│   │   ├── mobile-index.js         # 移动端入口（Android WebView）
│   │   ├── config.js               # 全局配置：DEFAULTS + 内存缓存 + 250ms 防抖写入
│   │   ├── selectors.js            # DeepSeek DOM hash 类名集中管理（禁止硬编码）
│   │   ├── utils.js                # 通用工具：debounce/throttle/暗色检测/平台探测
│   │   ├── styles.js               # 全局 CSS 样式注入
│   │   ├── themes.js               # 主题色方案常量定义
│   │   │
│   │   ├── agent/                  # Agent 系统 v2.0（新架构，统一入口）
│   │   │   ├── index.js            #   统一入口：替代 capability-register + capability-agent
│   │   │   ├── core/               #   核心引擎：tool-registry / harness / context / engine
│   │   │   ├── tools/              #   工具集（五类）：memory/control/collaboration/perception/execution
│   │   │   └── guards/             #   护栏层：input / tool / output 三层安全检查
│   │   │
│   │   ├── customizations/         # 外观自定义（9 个文件）
│   │   │   ├── background.js       #   背景图 + 字体
│   │   │   ├── border-theme.js     #   窄边距主题
│   │   │   ├── font.js             #   自定义字体
│   │   │   ├── placeholder.js      #   占位符文字
│   │   │   └── cherry/forest/lavender/ocean/sunset-theme.js  # 5 套主题色
│   │   │
│   │   ├── features/               # 功能模块（46 个顶层文件 + 13 个子目录）
│   │   │   ├── # 文本与内容增强
│   │   │   ├── text-process.js     #   工具调用 XML 解析 + 卡片渲染（todo/ask_user）
│   │   │   ├── anti-recall.js      #   防撤回（XHR hook + Agent 请求拦截）
│   │   │   ├── privacy-shield.js   #   敏感词替换（仅作用于 .ds-message 文本节点）
│   │   │   ├── mermaid.js          #   Mermaid 图表渲染
│   │   │   ├── code-fold.js        #   代码块自动折叠
│   │   │   ├── think-fold.js       #   AI 思考过程折叠
│   │   │   ├── copy-code.js        #   行内代码点击复制
│   │   │   ├── code-executor.js    #   代码块一键执行（bash/bat/powershell）
│   │   │   │
│   │   │   ├── # Agent 能力（旧版，已由 agent/ 替代）
│   │   │   ├── capability-register.js  # [旧] 能力注册 + 提示词注入
│   │   │   ├── capability-agent.js     # [旧] 循环引擎
│   │   │   │
│   │   │   ├── # 记忆系统
│   │   │   ├── memory.js           #   聚合入口：自动注入 + 自动记录 + UI 管理
│   │   │   ├── memory-importer.js  #   记忆导入（JSON 格式，预览卡片）
│   │   │   │
│   │   │   ├── # Agent 协作工具
│   │   │   ├── todo.js             #   Todo 清单（6 项校验，最多 1 个 in_progress）
│   │   │   ├── ask-user.js         #   主动提问（最多 4 问题/每题 2-4 选项）
│   │   │   ├── loop-engine.js      #   独立循环引擎 v2.0（信号驱动 + Tab Lock）
│   │   │   │
│   │   │   ├── # 会话与消息管理
│   │   │   ├── conversation-detector.js  # 会话 ID 检测 + 缓存
│   │   │   ├── history-cleanup.js  #   历史消息清理（三层防御第二层）
│   │   │   ├── history-tags.js     #   历史标签筛选
│   │   │   ├── data-store.js       #   对话数据存储（供导出）
│   │   │   │
│   │   │   ├── # 导出功能
│   │   │   ├── export.js           #   对话导出（JSON/Markdown/PNG）
│   │   │   ├── inline-export.js    #   单条消息内联导出
│   │   │   ├── table-export.js     #   表格导出（CSV/Excel）
│   │   │   ├── saved-items.js      #   收藏项管理
│   │   │   │
│   │   │   ├── # 效率增强
│   │   │   ├── auto-retry.js       #   网络错误自动重试
│   │   │   ├── token-speed.js      #   Token 速度实时显示
│   │   │   ├── usage-stats.js      #   使用量统计
│   │   │   ├── context-menu.js     #   右键场景模板（总结/解释/翻译）
│   │   │   ├── file-upload.js      #   文件上传（专家模式，75000 字上限）
│   │   │   │
│   │   │   ├── # UI 增强
│   │   │   ├── default-mode.js     #   默认模式自动切换（最多 8 次重试）
│   │   │   ├── remove-components.js # 移除转发/下载/分享按钮
│   │   │   ├── redirect.js         #   自动跳转旧域名
│   │   │   ├── title-faker.js      #   标题伪装
│   │   │   ├── sakura.js           #   樱花飘落动画（Canvas）
│   │   │   ├── magic-wand.js       #   侧边栏宽度 + 字体大小快捷控制
│   │   │   │
│   │   │   ├── # Agent 上下文注入
│   │   │   ├── personas.js         #   人格定义（loop-engine 用）
│   │   │   ├── postures.js         #   行为姿态（分析/执行模式）
│   │   │   ├── payloads.js         #   续跑载荷指令
│   │   │   ├── workflows.js        #   工作流模板
│   │   │   ├── roadmap.js          #   路线图规划模板
│   │   │   ├── handoff.js          #   交接报告（跨标签页传递）
│   │   │   │
│   │   │   ├── # 技能与预设
│   │   │   ├── skill.js            #   技能系统入口
│   │   │   ├── scenario.js         #   场景模板
│   │   │   ├── preset.js           #   预设管理
│   │   │   │
│   │   │   ├── # 高级能力
│   │   │   ├── web-tools.js        #   web_search + web_fetch 实现
│   │   │   ├── tool-descriptors.js #   工具描述符定义（旧版）
│   │   │   │
│   │   │   ├── # 数据管理
│   │   │   ├── folder-store.js     #   文件夹管理（从 DeepSeek-Enhancer 移植）
│   │   │   │
│   │   │   ├── # 子模块（复杂功能，独立目录）
│   │   │   ├── mcp/                #   MCP 协议客户端（HTTP/SSE/Streamable）
│   │   │   ├── artifacts/          #   制品导出（HTML/Markdown/PDF/Service）
│   │   │   ├── automation/         #   自动化调度（cron + 任务执行）
│   │   │   ├── i18n/               #   国际化（中/英，自动跟随系统语言）
│   │   │   ├── multimodal/         #   多模态分析（图片/音频/视频）
│   │   │   ├── pet/                #   桌面宠物（猫娘，动画 + 台词）
│   │   │   ├── project/            #   项目管理工作台
│   │   │   ├── sandbox/            #   Python 沙箱（Pyodide Web Worker）
│   │   │   ├── skill/              #   技能系统（12 个文件：注册/导入/同步/创建）
│   │   │   ├── sync/               #   WebDAV 同步（快照 + 差异 + 日志）
│   │   │   ├── usage/              #   使用量统计
│   │   │   └── capability-agent/   #   [旧] Agent UI 子模块
│   │   │
│   │   ├── persistence/            # 持久化层
│   │   │   ├── versioned-repository.js     # 版本化存储（快照/回滚）
│   │   │   ├── coalescing-mutation-queue.js # 合并变更队列（去重防抖）
│   │   │   └── serial-operation-queue.js    # 串行操作队列（错误隔离）
│   │   │
│   │   ├── platform/               # 跨环境桥接
│   │   │   ├── bridge.js           #   统一 API（篡改猴 Web API / WebView AndroidBridge）
│   │   │   └── desktop-bridge.js   #   Electron IPC 通信封装
│   │   │
│   │   ├── ui/                     # UI 注入模块
│   │   │   ├── settings-panel.js   #   设置面板（7/11 Tab，响应式三布局）
│   │   │   ├── menu-inject.js      #   菜单注入（侧边栏 + 移动端下拉）
│   │   │   ├── folder-panel.js     #   文件夹管理面板
│   │   │   ├── preset-menu.js      #   预设菜单 + 历史记录
│   │   │   └── toast.js            #   通用 Toast 通知（单例，4 种色调）
│   │   │
│   │   └── utils/                  # 工具模块
│   │       ├── fetch-hub.js        #   统一 Fetch 拦截中心（completion 事件分发）
│   │       ├── observer-hub.js     #   统一 MutationObserver 调度（防抖 200/300/350ms）
│   │       ├── agent-marker.js     #   Agent 续跑标记识别（三层防御）
│   │       ├── prompt-augmentation.js  # 提示词拼装统一入口（5 层累加）
│   │       ├── streaming-tool-parser.js # 流式工具调用解析状态机
│   │       ├── token-estimator.js  #   Token 估算（字符→token 近似）
│   │       └── prompt-visibility.js #  用户消息可见性标记
│   │
│   ├── scripts/            # 构建辅助脚本
│   ├── ARCHITECTURE.md     # 架构说明文档（300+ 行，含模块详解）
│   ├── DEVELOPMENT.md      # 开发规范文档（600+ 行，14 章强制规范）
│   ├── banner.txt          # 脚本头部 ASCII 艺术
│   ├── userscript-headers.js # Tampermonkey 元数据
│   ├── webpack.config.js   # 构建配置（三产物并行输出）
│   └── package.json
│
├── DeepSeekClient/          # Kotlin 多平台客户端（Android + 共享脚本）
│   ├── androidApp/          # Android WebView 容器模块
│   ├── shared/              # KMP 共享模块（存放 dspro.js 资源）
│   ├── build-resources/     # 图标资源
│   ├── gradle/              # Gradle Wrapper 与版本目录
│   ├── build.gradle.kts     # 根构建脚本
│   └── settings.gradle.kts  # 项目设置
│
├── deepseek-electron/       # Electron 桌面客户端（Windows EXE）
│   ├── extension/           # 内嵌浏览器扩展（sidepanel、pyodide、技能仓库等）
│   ├── resources/           # JS 产物与图标（由 build.py 同步）
│   ├── main.js              # Electron 主进程
│   ├── preload.js           # 预加载脚本
│   └── package.json         # electron-builder 配置（输出 dist3/）
│
├── output/                  # 构建产物输出（被 .gitignore 忽略）
├── build.py                 # 一键构建脚本（图标生成 + JS 打包 + APK/EXE 构建 + adb 安装）
├── icon.png                 # 应用图标源文件
└── script.user.js           # 油猴脚本发布版（供 Tampermonkey 一键安装）
```

## 快速开始

### 环境要求

- **Node.js** >= 18（用于 JS 打包与 Electron 构建）
- **Python** >= 3.10 + Pillow（用于图标生成与构建脚本）
- **Android SDK** + Gradle 9.2（用于 APK 构建）
- **Electron** >= 35（用于 Desktop EXE 构建，由 npm 自动安装）

### 构建命令

```bash
# 1. 仅构建 JS（webpack 打包为单文件 dspro.js）
python build.py --js-only

# 2. 仅生成图标
python build.py --icons-only

# 3. 构建 APK（Android 签名 Release）
python build.py --apk

# 4. 构建 EXE（Electron desktop，便携文件夹）
python build.py --exe

# 5. 构建全部
python build.py --all

# 6. 交互式菜单
python build.py
```

构建产物将自动复制到 `output/` 目录。

## 功能概览

### Agent 系统

让 DeepSeek 具备自主工具调用、长期记忆、Todo 清单管理、主动提问和多轮循环能力。v2.0 采用三层分离架构：**core（核心引擎）→ tools（工具集）→ guards（护栏层）**，通过 `agent/index.js` 统一入口初始化。

| 模块 | 说明 |
|------|------|
| 工具注册中心 | `agent/core/tool-registry.js` 单一数据源，22 个内置工具 + 动态注册（Web 搜索、Python 沙箱、MCP） |
| 工具集（五类） | memory-tools（16 个记忆操作）/ control-tools（Agent 控制流）/ collaboration-tools（ask_user）/ perception-tools（web_search/web_fetch/mcp_*）/ execution-tools（python_exec/skill_draft_create） |
| 护栏层 | input-guard（输入验证 + 注入检测）/ tool-guard（pre + post + correct 三层防护）/ output-guard（回复验证 + 循环健康度） |
| Harness 框架 | 约束/验证/纠正/熔断机制，保护 Agent 循环安全执行 |
| 记忆系统 | 分层记忆存储（Core/Archival/History），智能关键词匹配选择，Token 预算管理，防重删机制，自动归档 |
| Todo 清单 | 全量替换式 Todo 管理，6 项校验规则，三色状态卡片渲染，轮次上限动态调整（有 pending 时 3→8 轮） |
| 主动提问 | ask_user 工具，支持 1-4 个问题，每个 2-4 选项，紫色卡片渲染，提交后自动续跑 |
| 循环引擎 | 多轮工具调用自动续跑，v2 边界标记防刷新丢失，三层防御识别续跑消息，用户可随时停止 |
| 独立循环引擎 | `loop-engine.js` 基于信号检测的备用循环系统，Tab Lock 多标签页防护，20 轮漂移保护 |

### 效率工具

| 模块 | 说明 |
|------|------|
| 预设系统 | 预设提示词管理，支持 `/` 斜杠菜单快速调用，与设置面板数据同步 |
| 技能系统（Skill） | 内置技能 + 自定义技能仓库（12 个文件），支持 GitHub/文本导入，Skill Creator 创建工具 |
| 场景系统 | 场景模式切换，自动调整 Agent 行为策略 |
| 文件夹管理 | 对话文件夹分类管理，支持拖拽排序，从 DeepSeek-Enhancer 移植 |
| 历史标签 | 对话历史标签化管理，快速筛选 |
| 文件上传 | 专家模式下发送栏注入上传按钮，文本内容注入 prompt（75000 字上限），文件卡片渲染 |
| 内联导出 | 单条消息内联导出为 Markdown |
| 完整导出 | 对话导出为 JSON / Markdown / PNG |
| 制品导出 | `artifacts/` 完整对话导出为 HTML / Markdown / PDF |
| 表格导出 | Markdown 表格导出为 CSV/Excel |
| 收藏项 | 收藏/取消收藏消息，持久化存储，支持查看和导出 |
| 代码执行 | bash/bat/powershell 代码块旁注入"执行"按钮，支持终端选择 |
| Token 速度 | 实时显示 Token 生成速度与用量 |
| 使用量统计 | 按日/周/月统计 API 使用量 |
| 代码复制 | 行内代码点击复制 |
| 代码折叠 | 长代码块自动折叠，实时响应流式输出 |
| 思考折叠 | AI 思考过程（`> 思考` 引用块）自动折叠为可展开摘要 |
| 魔法棒 | 侧边栏宽度 + 用户对话字体大小快捷控制 |

### 扩展能力

| 模块 | 说明 |
|------|------|
| MCP 协议 | Model Context Protocol 客户端，支持 HTTP/SSE/Streamable 传输，服务发现与工具调用 |
| Python 沙箱 | 浏览器内 Python 代码执行（Pyodide Web Worker），支持文件操作与库导入 |
| 多模态分析 | 图片/音频/视频内容分析，支持 OpenAI/Gemini 配置 |
| Web 工具 | web_search（Bing 搜索，支持分页合并最多 30 条）和 web_fetch（网页抓取，cors→no-cors 降级） |
| 自动化调度 | 定时任务调度，支持 cron 表达式，后台自动执行 |
| WebDAV 同步 | 配置/记忆/预设跨设备同步，快照 + 差异 + 日志应用 |
| 桌面宠物 | 可交互的桌面宠物（猫娘），支持多套动作与台词 |
| 项目管理工作台 | 项目上下文注入，项目管理面板 UI |
| 交接报告 | handoff.js 生成 Markdown 格式 AI 交接报告，跨标签页传递 |
| 工作流 | 预定义多步骤 Agent 工作流模板，支持自动推进和暂停 |

### UI 增强

| 模块 | 说明 |
|------|------|
| 设置面板 | 11 Tab（篡改猴）/ 7 Tab（WebView），响应式三布局（桌面双栏/平板横滚/手机底部工作表） |
| 主题系统 | 多套预设主题（Border/Cherry/Forest/Lavender/Ocean/Sunset），自定义背景图与字体 |
| 樱花动画 | 可开关的 Canvas 樱花飘落特效 |
| 隐私盾 | 敏感词替换，仅作用于 `.ds-message` 内文本节点，支持大小写敏感开关 |
| 防撤回 | XHR response getter 拦截，检测被撤回回复并替换为本地缓存存档 |
| 组件清理 | 移除转发/下载应用/分享按钮，遵循 React 安全操作规范（display:none） |
| 默认模式 | 自动选择对话模式（快速/专家/识图），最多 8 次重试防止竞态 |
| 标题伪装 | 自定义页面标题，支持动态替换 |
| 自动重试 | 检测网络错误"重新生成"按钮，通过 SVG path 特征自动点击重试 |
| Mermaid 图表 | Mermaid 代码块渲染为 SVG 图表 |
| 国际化 | 中/英双语界面，自动跟随系统语言 |

## 模块化油猴脚本

`js/` 目录是 DeepSeek Promax 油猴脚本的核心开发目录，使用 webpack 进行模块化打包，采用"单源码多产物"策略：

| 产物 | 入口 | 用途 |
|------|------|------|
| `dist/dspro.user.js` | `src/index.js` | 篡改猴版，含 `==UserScript==` 头部 + banner.txt ASCII 艺术 |
| `dist/dspro.js` | `src/index.js` | WebView 主脚本，onPageFinished 注入 |
| `dist/dspro.early-boot.js` | `src/early-boot.js` | WebView 早注入 stub，仅安装 document-start 必需的 hook |
| `dist/dspro.desktop.js` | `src/desktop-index.js` | Electron 桌面端专属脚本 |
| `dist/dspro.mobile.js` | `src/mobile-index.js` | 移动端专属脚本 |

源码通过 `Platform.isWebView` 运行时探测自动切换行为，三端共享同一套 `src/` 源码。详细架构参见 [js/ARCHITECTURE.md](js/ARCHITECTURE.md)。

## 客户端构建

### Android APK（`DeepSeekClient/`）

使用 Kotlin 多平台 + Gradle 构建：

- **Android APK**：原生 WebView 容器，自动加载脚本
- **shared 模块**：统一存放 `dspro.js`、`dspro.early-boot.js`、`dspro.mobile.js` 资源

### Electron Desktop EXE（`deepseek-electron/`）

使用 Electron + electron-builder 构建：

- **Electron 主进程**：`main.js` 创建窗口并加载 DeepSeek 网页
- **内嵌扩展**：`extension/` 目录集成 sidepanel、pyodide、技能仓库、MCP 控制器等完整能力
- **资源同步**：`resources/` 目录由 `build.py` 自动同步 JS 产物与图标
- **构建产物**：`dist3/win-unpacked/` 便携文件夹（含 DeepSeek.exe）

## 开发约定

- **文档体系**：`js/ARCHITECTURE.md`（架构说明，含完整模块清单） + `js/DEVELOPMENT.md`（14 章强制规范）
- JS 构建分 dev/prod 模式：dev 保留注释用于调试，prod 移除注释并保留头部
- 永不移除 React 管理的 DOM 节点，使用 `style.display = 'none'` 替代
- 使用 MutationObserver 持久化移除组件，通过 `observer-hub.js` 统一调度（防抖 200/300/350ms）
- 模式选择采用顺序方法尝试（React → click → mouse → keyboard），最多 8 次重试
- 所有 hash 类名集中在 `selectors.js` 管理，禁止在业务代码中硬编码
- 跨模块通信使用 `window._ds*` 全局接口，避免 ES Module 循环依赖
- Agent 系统 v2.0 通过 `agent/index.js` 统一入口，替代旧的 `capability-register.js` + `capability-agent.js`
- 提示词拼装通过 `prompt-augmentation.js` 统一入口（5 层累加），区分普通消息与续跑消息
- 废弃数据清理采用三层防御：流式实时清理 → 历史 API 拦截 → 标记识别
- 详细规范参见 [js/ARCHITECTURE.md](js/ARCHITECTURE.md) 和 [js/DEVELOPMENT.md](js/DEVELOPMENT.md)

## 参考与致谢

本项目在开发过程中参考或使用了以下优秀项目/代码，特此致谢：

| 项目 | 说明 |
|------|------|
| [DeepSeek 功能增强工具箱](https://scriptcat.org/zh-CN/script-show-page/5676) | 油猴脚本管理平台 |
| [deepseek-pp](https://github.com/zhu1090093659/deepseek-pp/releases/tag/v1.11.9) | DeepSeek 增强脚本，本项目核心参考项目 |
| [ai-agent-book](https://github.com/bojieli/ai-agent-book) | AI Agent 开发指南 |
| [DeepSeek-Enhancer](https://github.com/dlshuangchenyue1210/DeepSeek-Enhancer) | DeepSeek 增强器 |
| [DeepSeek-Refined](https://github.com/djh2203/DeepSeek-Refined) | DeepSeek 界面优化 |
| [Deepseek-Privacy](https://github.com/landifrancesco/Deepseek-Privacy/blob/main/DeepSeek%20Privacy.user.js) | DeepSeek 隐私保护 |
| [PromptHelper](https://github.com/dongshuyan/PromptHelper/blob/master/PromptHelper.js) | 提示词辅助工具 |

## License

GPL-3.0