# DeepSeek Promax

> DeepSeek 客户端多端构建工程：油猴脚本（JS）+ Android APK + Desktop EXE，三端共享同一套脚本资源。

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
│   │   ├── customizations/  # 外观自定义（背景、边框主题、字体、占位符、多主题）
│   │   ├── features/        # 功能模块（Agent 系统、记忆、Skill、MCP、沙箱等）
│   │   │   ├── capability-agent/   # Agent 循环引擎子模块
│   │   │   ├── memory/             # 记忆系统子模块
│   │   │   ├── mcp/                # MCP 协议客户端
│   │   │   ├── artifacts/          # 制品导出（HTML/Markdown/PDF）
│   │   │   ├── automation/         # 自动化调度
│   │   │   ├── i18n/               # 国际化（中/英）
│   │   │   ├── multimodal/         # 多模态分析
│   │   │   ├── pet/                # 桌面宠物
│   │   │   ├── project/            # 项目管理
│   │   │   ├── sandbox/            # Python 沙箱
│   │   │   ├── skill/              # 技能系统
│   │   │   ├── sync/               # WebDAV 同步
│   │   │   └── usage/              # 使用量统计
│   │   ├── persistence/    # 持久化层
│   │   ├── platform/       # 跨环境桥接（篡改猴 / WebView）
│   │   ├── ui/             # UI 注入（设置面板、菜单、文件夹面板、预设面板）
│   │   ├── utils/          # 工具模块（请求拦截、DOM 观察、Token 估算等）
│   │   ├── config.js       # 全局配置与默认值
│   │   ├── index.js        # 入口与模块编排
│   │   ├── selectors.js    # DeepSeek DOM 类名集中管理
│   │   ├── styles.js       # 样式注入
│   │   ├── themes.js       # 主题颜色配置
│   │   └── utils.js        # 通用工具
│   ├── scripts/            # 构建辅助脚本
│   ├── ARCHITECTURE.md     # 架构说明文档
│   ├── DEVELOPMENT.md      # 开发规范文档
│   ├── banner.txt          # 脚本头部 ASCII 艺术
│   ├── userscript-headers.js # Tampermonkey 元数据
│   ├── webpack.config.js   # 构建配置（双环境双构建）
│   └── package.json
│
├── DeepSeekClient/          # Kotlin 多平台客户端（Android + Desktop）
│   ├── androidApp/          # Android WebView 容器模块
│   ├── desktopApp/          # JavaFX WebView 桌面模块
│   ├── shared/              # KMP 共享模块（存放 dspro.js 资源）
│   ├── build-resources/     # 图标资源
│   ├── gradle/              # Gradle Wrapper 与版本目录
│   ├── build.gradle.kts     # 根构建脚本
│   └── settings.gradle.kts  # 项目设置
│
├── output/                  # 构建产物输出（被 .gitignore 忽略）
├── build.py                 # 一键构建脚本（图标生成 + JS 打包 + APK/EXE 构建 + adb 安装）
├── icon.png                 # 应用图标源文件
└── script.user.js           # 油猴脚本发布版（供 Tampermonkey 一键安装）
```

## 快速开始

### 环境要求

- **Node.js** >= 18（用于 JS 打包）
- **Python** >= 3.10 + Pillow（用于图标生成与构建脚本）
- **JDK** 21 + JavaFX（用于 Desktop EXE 构建）
- **Android SDK** + Gradle 9.2（用于 APK 构建）

### 构建命令

```bash
# 1. 仅构建 JS（webpack 打包为单文件 dspro.js）
python build.py --js-only

# 2. 仅生成图标
python build.py --icons-only

# 3. 构建 APK（Android 签名 Release）
python build.py --apk

# 4. 构建 EXE（Desktop jpackage）
python build.py --exe

# 5. 构建全部
python build.py --all

# 6. 交互式菜单
python build.py
```

构建产物将自动复制到 `output/` 目录。

## 功能概览

### Agent 系统

让 DeepSeek 具备自主工具调用、长期记忆、Todo 清单管理、主动提问和多轮循环能力：

| 模块 | 说明 |
|------|------|
| 工具注册与执行 | 22 个内置工具（记忆 CRUD、Todo 管理、主动提问、Agent 控制），支持动态注册（Web 搜索、Python 沙箱、MCP） |
| 记忆系统 | 分层记忆存储（Core/Archival/History），智能关键词匹配选择，Token 预算管理，防重删机制，自动归档 |
| Todo 清单 | 全量替换式 Todo 管理，6 项校验规则，三色状态卡片渲染，轮次上限动态调整 |
| 主动提问 | ask_user 工具，支持 1-4 个问题，每个 2-4 选项，紫色卡片渲染，提交后自动续跑 |
| 循环引擎 | 多轮工具调用自动续跑，v2 边界标记防刷新丢失，三层防御识别续跑消息，用户可随时停止 |
| 独立循环引擎 | 基于信号检测的备用循环系统，Tab Lock 多标签页防护，20 轮漂移保护 |

### 效率工具

| 模块 | 说明 |
|------|------|
| 预设系统 | 预设提示词管理，支持 `/` 斜杠菜单快速调用，与设置面板数据同步 |
| 技能系统（Skill） | 9 个内置技能 + 自定义技能仓库，支持 GitHub/文本导入，Skill Creator 创建工具 |
| 场景系统 | 场景模式切换，自动调整 Agent 行为策略 |
| 文件夹管理 | 对话文件夹分类管理，支持拖拽排序 |
| 历史标签 | 对话历史标签化管理，快速筛选 |
| 内联导出 | 对话内联导出为 JSON / Markdown / PNG |
| 制品导出 | 完整对话导出为 HTML / Markdown / PDF |
| Token 速度 | 实时显示 Token 生成速度与用量 |
| 使用量统计 | 按日/周/月统计 API 使用量 |
| 代码复制 | 代码块一键复制按钮 |
| 代码折叠 | 长代码块自动折叠 |
| 思考折叠 | AI 思考过程自动折叠，实时渲染 |
| 表格导出 | 表格优化导出为 CSV/Excel |

### 扩展能力

| 模块 | 说明 |
|------|------|
| MCP 协议 | Model Context Protocol 客户端，支持 HTTP/SSE/Streamable 传输，服务发现与工具调用 |
| Python 沙箱 | 浏览器内 Python 代码执行（Pyodide），支持文件操作与库导入 |
| 多模态分析 | 图片/文件上传分析，自动识别与处理 |
| Web 工具 | web_search（Bing 搜索，支持分页合并最多 30 条）和 web_fetch（网页抓取） |
| 自动化调度 | 定时任务调度，支持 cron 表达式，后台自动执行 |
| WebDAV 同步 | 配置/记忆/预设跨设备同步，支持 WebDAV 协议 |
| 桌面宠物 | 可交互的桌面宠物（猫娘），支持多套动作与台词 |

### UI 增强

| 模块 | 说明 |
|------|------|
| 设置面板 | 11 Tab（篡改猴）/ 7 Tab（WebView），响应式三布局（桌面/平板/手机） |
| 主题系统 | 多套预设主题（Border、Cherry、Forest、Lavender、Ocean、Sunset），自定义背景与字体 |
| 樱花动画 | 可开关的樱花飘落特效 |
| 隐私盾 | 敏感词替换，仅作用于对话文本节点 |
| 防撤回 | XHR 拦截防止消息被撤回 |
| 组件清理 | 移除转发/下载/分享等无用组件 |
| 默认模式 | 自动选择对话模式（快速/专家/识图） |
| 标题伪装 | 自定义页面标题 |
| 自动重试 | 请求失败自动重试 |
| Mermaid 图表 | Mermaid 代码块渲染为 SVG 图表 |
| 国际化 | 中/英双语界面，自动跟随系统语言 |

## 模块化油猴脚本

`js/` 目录是 DeepSeek Promax 油猴脚本的核心开发目录，使用 webpack 进行模块化打包，采用"单源码双构建"策略：

| 产物 | 入口 | 用途 |
|------|------|------|
| `dist/dspro.user.js` | `src/index.js` | 篡改猴版，含 `==UserScript==` 头部 |
| `dist/dspro.js` | `src/index.js` | WebView 主脚本，无头部 |
| `dist/dspro.early-boot.js` | `src/early-boot.js` | WebView 早注入 stub |

## 客户端构建

`DeepSeekClient/` 使用 Kotlin 多平台 + Gradle 构建：

- **Android APK**：原生 WebView 容器，自动加载脚本
- **Desktop EXE**：JavaFX WebView 容器，使用 jpackage 打包为原生应用

`shared` 模块统一存放 `dspro.js` 资源，由两端共享。

## 开发约定

- JS 构建分 dev/prod 模式：dev 保留注释用于调试，prod 移除注释并保留头部
- 永不移除 React 管理的 DOM 节点，使用 `style.display = 'none'` 替代
- 使用 MutationObserver 持久化移除组件，应对 DeepSeek 重新渲染
- 模式选择采用顺序方法尝试（React -> click -> mouse -> keyboard），最多 8 次重试
- 所有 hash 类名集中在 `selectors.js` 管理，禁止在业务代码中硬编码
- 跨模块通信使用 `window._ds*` 全局接口，避免 ES Module 循环依赖
- 详见 [js/ARCHITECTURE.md](js/ARCHITECTURE.md) 和 [js/DEVELOPMENT.md](js/DEVELOPMENT.md)

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