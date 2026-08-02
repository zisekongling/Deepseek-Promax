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
│   │   ├── customizations/  # 外观自定义（背景、边框主题、字体、占位符）
│   │   ├── features/        # 功能模块（防撤回、自动重试、Mermaid、导出、隐私盾等）
│   │   ├── ui/              # UI 注入（设置面板、菜单、文件夹面板）
│   │   ├── config.js        # 全局配置与默认值
│   │   ├── index.js         # 入口与模块编排
│   │   ├── observer.js      # DOM 观察器
│   │   ├── styles.js        # 样式注入
│   │   ├── themes.js        # 主题颜色配置
│   │   └── utils.js         # 通用工具
│   ├── dist/                # webpack 构建产物（被 .gitignore 忽略）
│   ├── banner.txt           # 脚本头部 ASCII 艺术
│   ├── userscript-headers.js# Tampermonkey 元数据
│   ├── webpack.config.js    # 构建配置（区分 dev/prod）
│   └── package.json
│
├── DeepSeekClient/          # Kotlin 多平台客户端（Android + Desktop）
│   ├── androidApp/          # Android WebView 容器模块
│   ├── desktopApp/          # JavaFX WebView 桌面模块
│   ├── shared/              # KMP 共享模块（存放 dspro.js 资源）
│   ├── build-resources/     # 图标资源
│   ├── keystore/            # 签名密钥（被 .gitignore 忽略）
│   ├── gradle/              # Gradle Wrapper 与版本目录
│   ├── build.gradle.kts     # 根构建脚本
│   └── settings.gradle.kts  # 项目设置
│
├── output/                  # 构建产物输出（被 .gitignore 忽略）
│   ├── DeepSeek.apk
│   └── DeepSeek/
│       ├── DeepSeek.exe
│       └── runtime/         # JRE 运行时
│
├── build.py                 # 一键构建脚本（图标生成 + JS 打包 + APK/EXE 构建 + adb 安装）
├── icon.png                 # 应用图标源文件
└── script.user.js           # 油猴脚本发布版（供 Tampermonkey 一键安装）
```

## 快速开始

### 环境要求

- **Node.js** ≥ 18（用于 JS 打包）
- **Python** ≥ 3.10 + Pillow（用于图标生成与构建脚本）
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

## 模块化油猴脚本

`js/` 目录是 DeepSeek Promax 油猴脚本的核心开发目录，使用 webpack 进行模块化打包。

主要功能模块：

| 模块 | 说明 |
|------|------|
| `features/anti-recall.js` | 防撤回（XHR 拦截） |
| `features/default-mode.js` | 默认模式自动选择 |
| `features/mermaid.js` | Mermaid 图表渲染 |
| `features/export.js` | JSON / Markdown / PNG 导出 |
| `features/privacy-shield.js` | 敏感词替换 |
| `features/personas.js` | 角色注入（8 种人格） |
| `features/workflows.js` | 工作流（7 种） |
| `features/postures.js` | 思考姿态 |
| `features/payloads.js` | 任务模式 |
| `ui/settings-panel.js` | 设置面板（外观/功能/清理/隐私/预设/导出） |
| `customizations/border-theme.js` | Border 边框主题 |

## 客户端构建

`DeepSeekClient/` 使用 Kotlin 多平台 + Gradle 构建：

- **Android APK**：原生 WebView 容器，自动加载脚本
- **Desktop EXE**：JavaFX WebView 容器，使用 jpackage 打包为原生应用

`shared` 模块统一存放 `dspro.js` 资源，由两端共享。

## 开发约定

- JS 构建分 dev/prod 模式：dev 保留注释用于调试，prod 移除注释并保留头部
- 永不移除 React 管理的 DOM 节点，使用 `style.display = 'none'` 替代
- 使用 MutationObserver 持久化移除组件，应对 DeepSeek 重新渲染
- 模式选择采用顺序方法尝试（React → click → mouse → keyboard），最多 8 次重试
- 详见 `js/webpack.config.js` 中的构建配置

## License

GPL-3.0
