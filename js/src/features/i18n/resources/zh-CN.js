/**
 * @file 简体中文语言资源
 * @module i18n/resources/zh-CN
 * @description
 *   DeepSeek 油猴脚本 i18n 模块的简体中文资源（key → 中文文案）。
 *   资源 key 命名规范：`section.subsection.key`（如 `settings.agent.title`）。
 *   覆盖范围：设置面板分区标题与选项标签、菜单项、工具名称与描述、
 *   Agent 续跑提示、工具卡片状态文案、toast 消息、错误提示。
 *   本文件为纯数据，不含任何逻辑。
 */

const zhCN = {
    // ===== 通用按钮与状态文案 =====
    common: {
        add: '添加',
        cancel: '取消',
        clear: '清空',
        close: '关闭',
        confirm: '确认',
        delete: '删除',
        edit: '编辑',
        enable: '启用',
        enabled: '已启用',
        disable: '停用',
        disabled: '已停用',
        loading: '加载中…',
        none: '无',
        open: '打开',
        preview: '预览',
        refresh: '刷新',
        remove: '移除',
        retry: '重试',
        save: '保存',
        saveChanges: '保存更改',
        search: '搜索',
        status: '状态',
        success: '成功',
        update: '更新',
        unnamed: '未命名',
        activate: '激活此预设',
        deactivate: '取消激活',
    },

    // ===== 设置面板 =====
    settings: {
        panel: {
            title: '脚本设置',
            subtitle: 'DeepSeek Promax v5.0',
        },
        // 标签页
        tab: {
            appearance: '🎨 外观',
            features: '✨ 功能',
            cleanup: '🧹 清理',
            privacy: '🔒 隐私',
            presets: '💬 预设',
            scenarios: '📋 场景',
            skills: '⚡ 技能',
            agent: '🤖 Agent',
            export: '📤 导出',
            automation: '👻 自动化',
            extensions: '🚀 扩展',
        },
        // 分区标题
        section: {
            themeColor: '主题颜色',
            fontCustom: '🔤 字体自定义',
            chatBackground: '🖼️ 聊天背景',
            contentRender: '内容渲染',
            dialogEnhance: '对话增强',
            efficiencyTools: '效率工具',
            interfaceCleanup: '界面清理',
            browsePrivacy: '浏览隐私',
            sensitiveReplace: '🔐 敏感词替换',
            messagePreset: '消息预设',
            scenarioTemplate: '场景模板',
            skillLibrary: '技能库',
            skillImport: '📥 导入技能',
            skillSources: '📦 已导入的源',
            agentSystem: 'Agent 系统',
            submodule: '子模块（在总开关开启时可单独控制）',
            memoryManage: '记忆管理',
            dialogExport: '对话导出',
            usageStats: '📊 使用量统计',
            loopEngine: '循环引擎',
            thinkingPosture: '🧠 思考姿态',
            taskMode: '▶ 任务模式',
            personaSystem: '👤 人格系统',
            workflowAutomation: '⛓ 工作流自动化',
            roadmapAutopilot: '🗺 路线图自动驾驶',
            promptQueue: '📋 提示词队列',
            handoffReport: '🤝 交接报告',
            agentEnhance: '🌐 Agent 能力增强',
            workbenchUx: '工作台与 UX',
            dataAutomation: '数据与自动化',
            advancedCapability: '高级能力',
        },
        // 底部按钮
        footer: {
            save: '💾 保存并应用',
            reset: '↺ 恢复默认',
        },
        // 开关标签与帮助描述（id 与 OPTION_CONFIG_KEYS 对应）
        toggle: {
            sakura: {
                label: '🌸 樱花飘落',
                desc: '在页面中飘落樱花动画，营造浪漫氛围',
            },
            narrow: {
                label: '📐 窄边距',
                desc: '压缩聊天内容的左右内边距，使布局更紧凑、信息密度更高',
            },
            image: {
                label: '🖼️ 图片渲染',
                desc: '自动将 Markdown 图片链接和纯图片 URL 渲染为可点击预览的图片',
            },
            strikethrough: {
                label: '✏️ 删除线渲染',
                desc: '将 ~~text~~ 转换为删除线样式（代码块内不生效）',
            },
            mermaid: {
                label: '📊 Mermaid 图表',
                desc: '渲染 Mermaid 代码块为图表（流程图、时序图、甘特图等）',
            },
            citation: {
                label: '🗑️ 移除角标',
                desc: '移除回复中的 [citation:数字] 标记和来源引用图标',
            },
            copyCode: {
                label: '📋 行内代码点击复制',
                desc: '点击 Markdown 行内代码时自动复制到剪贴板，方便快捷引用',
            },
            antiRecall: {
                label: '🛡️ 防撤回',
                desc: '拦截并缓存被撤回的回复，防止对话内容意外消失',
            },
            autoRetry: {
                label: '🔄 自动重试',
                desc: '当出现重试按钮时自动点击，最多重试 10 次，避免手动操作',
            },
            folderPanel: {
                label: '📁 文件夹管理',
                desc: '在 DeepSeek 侧边栏嵌入文件夹管理面板，支持两层层级结构和会话收藏',
            },
            defaultMode: {
                label: '⚡ 默认模式',
                desc: '新对话开始时自动切换到指定模式（快速/专家/识图）',
            },
            promptInject: {
                label: '🤖 系统提示词注入',
                desc: '在每次发送消息时自动注入系统提示词（DeepSeek 不会显示但会遵循）',
            },
            inlineExport: {
                label: '📤 消息内联导出',
                desc: '在每条 AI 回复旁添加导出按钮，可单独导出该条消息为 Markdown 文件',
            },
            historyTags: {
                label: '🏷️ 历史标签搜索',
                desc: '在历史搜索弹窗中注入标签过滤器，可给会话打标签并按标签筛选',
            },
            contextMenu: {
                label: '🖱️ 右键场景模板',
                desc: '选中文本后弹出菜单，支持一键总结/解释/翻译，支持自定义场景模板',
            },
            tokenSpeed: {
                label: '⚡ Token 速度指示器',
                desc: '在每条 AI 回复旁显示实时 token 数和输出速度（tok/s），需配合请求拦截',
            },
            removeForward: {
                label: '✂️ 移除转发按钮',
                desc: '移除消息上的转发/分享按钮，保持界面简洁',
            },
            removeDownloadApp: {
                label: '📱 移除下载入口',
                desc: '移除页面中的下载应用入口和下拉菜单中的下载选项',
            },
            placeholderText: {
                label: '💬 修改占位符文字',
                desc: '修改输入框的占位符提示文字内容（修改文字而非颜色）',
            },
            title: {
                label: '🎭 标题伪装',
                desc: '随机更换浏览器标签页标题，防止他人通过标题窥探浏览内容',
            },
            redirect: {
                label: '↗️ 自动跳转',
                desc: '仅当访问 www.deepseek.com 或 deepseek.com 时跳转到 chat.deepseek.com',
            },
            privacyShield: {
                label: '🛡️ 启用敏感词替换',
                desc: '将页面中消息容器内的敏感词替换为指定文本，保护隐私信息',
            },
            caseSensitive: {
                label: '🔍 区分大小写',
                desc: '敏感词替换时是否区分大小写（关闭则不区分大小写匹配）',
            },
            usageStats: {
                label: '📊 启用使用量统计',
                desc: '记录每轮对话的 token 数、速度和耗时，生成 30 天活跃热力图',
            },
            loopEngine: {
                label: '👻 启用循环引擎',
                desc: '启用循环引擎，AI 回复以信号标记结尾时自动继续对话，实现无人值守循环',
            },
            loopNotify: {
                label: '🔔 桌面通知',
                desc: '循环引擎每次执行时发送浏览器桌面通知，实时掌握进度',
            },
            loopCrashRecovery: {
                label: '🔄 崩溃恢复',
                desc: '循环引擎崩溃后自动恢复执行，3 分钟无活动自动暂停',
            },
            loopDrift: {
                label: '🛡️ 漂移防护（轮次上限）',
                desc: '漂移防护：达到轮次上限时软暂停，可选延长或重新锚定到原始任务',
            },
            loopUnattended: {
                label: '🤖 无人值守模式',
                desc: '无人值守模式：允许后台标签页运行，使用 Web Worker 防止节流',
            },
            personaPerTask: {
                label: '🔁 每步注入人格',
                desc: '每步注入人格：每条循环命令都附带人格指令（而非仅首轮）',
            },
            workflowAutoAdvance: {
                label: '⚡ 自动推进下一阶段',
                desc: '工作流自动推进：AI 完成一阶段后自动发送下一阶段指令',
            },
            workflowPauseBetween: {
                label: '⏸ 步间暂停（每阶段后等待）',
                desc: '步间暂停：每个工作流阶段完成后暂停，等待用户手动继续',
            },
            agentSystem: {
                label: '🤖 启用 Agent 系统（总开关）',
                desc: '🤖 Agent 系统总开关：一键启用完整 Agent 能力（记忆 + 工具调用 + 循环）。开启后 AI 可主动调用工具保存/调用/审查记忆，并自动发送续跑消息形成 Agent 循环。注意：开启后 DeepSeek 会出现自动发消息的现象（工具结果回传），请勿手动干涉输入框',
            },
            agentMemory: {
                label: '🧠 记忆模块（自动注入 + 管理）',
                desc: '🧠 记忆模块：自动将相关记忆注入到 prompt，让 AI 记住你的偏好和历史对话。提供记忆管理面板（增删改查、归档、导入导出）',
            },
            agentTools: {
                label: '🔧 工具调用模块（[能力] 提示词 + XML 执行）',
                desc: '🔧 工具调用模块：注入 [能力] 提示词，教会 AI 主动调用工具（memory_save/memory_recall/agent_finish 等 XML 标签），自动识别并执行 AI 输出的工具调用',
            },
            agentLoop: {
                label: '🔄 Agent 循环模块（工具结果回传 + 续跑）',
                desc: '🔄 Agent 循环模块：工具调用执行后将结果包装在 <tool_results> XML 中作为新消息发送给 AI，让 AI 看到工具结果并继续对话（Agent 循环，最多 3 轮）。依赖工具调用模块',
            },
            webTools: {
                label: '🌐 Web 工具总开关',
                desc: '🌐 Web 工具总开关：启用后 AI 可通过 web_search 联网搜索、web_fetch 抓取网页正文',
            },
            webSearch: {
                label: '🔍 web_search 搜索',
                desc: '🔍 web_search 工具：经跨域请求抓取 DuckDuckGo/Bing 搜索结果，返回结构化标题/URL/摘要',
            },
            webFetch: {
                label: '📄 web_fetch 抓取',
                desc: '📄 web_fetch 工具：抓取目标 URL 的可见正文文本，按站点白名单授权并截断到指定长度',
            },
            mcp: {
                label: '🔌 MCP 协议客户端',
                desc: '🔌 MCP 协议客户端：连接外部 MCP 服务器，扩展 AI 的工具调用能力（需在管理面板配置服务端）',
            },
            project: {
                label: '📁 项目管理工作台',
                desc: '📁 项目管理工作台：管理多个项目，隔离会话/记忆/配置，支持快速切换与项目级上下文注入',
            },
            pet: {
                label: '🐳 桌面宠物',
                desc: '🐳 桌面宠物：在页面角落显示一只鲸鱼宠物，根据对话状态切换心情与台词，陪伴你的对话',
            },
            artifactsExport: {
                label: '📤 制品导出',
                desc: '📤 制品导出：将 AI 生成的代码/文档导出为 HTML/Markdown/PDF 等制品文件',
            },
            memoryImport: {
                label: '📥 记忆导入',
                desc: '📥 记忆导入：从外部文件（JSON/Markdown）批量导入记忆到记忆系统',
            },
            sync: {
                label: '🔄 数据同步（WebDAV）',
                desc: '🔄 数据同步：通过 WebDAV 同步配置/记忆/项目数据到云端，支持多设备数据一致',
            },
            automationModule: {
                label: '⏰ 自动化调度',
                desc: '⏰ 自动化调度：定时执行预设任务，支持 cron 表达式调度与条件触发',
            },
            multimodal: {
                label: '🎨 多模态分析',
                desc: '🎨 多模态分析：分析图片/音频/视频内容，扩展 AI 对非文本模态的理解能力',
            },
            pythonSandbox: {
                label: '🐍 Python 沙箱',
                desc: '🐍 Python 沙箱：在浏览器中通过 Pyodide 执行 Python 代码，供 AI 调用以完成计算任务',
            },
            magicWand: {
                label: '🪄 页面缩略控制',
                desc: '🪄 页面缩略控制：在侧边栏底部注入控制面板，可一键切换侧边栏宽度、用户字体大小、深度思考折叠、输入框扩展、代码块折叠',
            },
            timeInject: {
                label: '🕐 时间注入',
                desc: '🕐 时间注入：在每次对话中注入当前日期时间（精确到秒），让 AI 对时间有所感知',
            },
            codeFold: {
                label: '📦 代码块折叠',
                desc: '📦 代码块折叠：自动折叠超过阈值的代码块，显示预览行数，支持折叠/展开切换',
            },
            tableExport: {
                label: '📊 表格优化导出',
                desc: '📊 表格优化导出：悬停表格显示 PNG/CSV 导出按钮，支持主题适配和列宽策略',
            },
            thinkFold: {
                label: '🧠 思考过程自动折叠',
                desc: '🧠 思考过程自动折叠：AI 开始思考后自动收起"已思考"过程，减少页面滚动',
            },
            script: {
                label: '🟢 脚本总开关',
                desc: '🟢 脚本总开关：关闭后仅保留设置面板入口，不执行任何功能增强（樱花/字体/背景/Agent 等全部停用）。适合临时禁用脚本排查问题',
            },
            fontCustom: {
                label: '🔤 启用字体自定义',
                desc: '🔤 启用字体自定义：通过系统字体或在线字体（.woff2/.ttf/Google Fonts CSS）替换 DeepSeek 默认字体',
            },
            bgImage: {
                label: '🖼️ 启用聊天背景',
                desc: '🖼️ 启用聊天背景：为聊天区域设置自定义背景图片（支持图片 URL 或本地上传），并可调节透明度',
            },
            scenarios: {
                label: '📋 启用场景模板（总开关）',
                desc: '📋 场景模板总开关：关闭后场景列表不加载，右键菜单也不显示场景项（仅保留自定义场景输入区）',
            },
            skill: {
                label: '⚡ 启用技能系统（总开关）',
                desc: '⚡ 技能系统总开关：关闭后 /命令 不触发技能，输入框的斜杠命令按普通文本处理',
            },
            skillSidebar: {
                label: '📋 技能侧边栏',
                desc: '在输入框输入 / 时，在预设菜单旁显示技能列表，可快速选择技能',
            },
            presets: {
                label: '💬 启用预设系统（总开关）',
                desc: '💬 预设系统总开关：关闭后不注入任何激活的预设内容（角色/场景提示词），预设列表仍可管理但不会生效',
            },
        },
        // 输入框标签与占位符
        field: {
            systemFont: '系统字体',
            onlineFont: '在线字体',
            systemFontPlaceholder: "如：Arial, 'Microsoft YaHei'",
            onlineFontPlaceholder: '.woff2 / .ttf 或 Google Fonts CSS',
            imageUrl: '图片 URL',
            imageUrlPlaceholder: '输入图片链接或选择文件',
            opacity: '透明度',
            targetMode: '目标模式',
            promptContent: '提示词内容',
            promptContentPlaceholder: '输入系统提示词，将在每次对话时自动注入…',
            placeholderText: '占位文字',
            placeholderTextPlaceholder: '如：说点什么吧～',
            titleList: '标题列表',
            titleListPlaceholder: '每行一个标题',
            sensitiveWord: '敏感词',
            sensitiveReplacement: '替换为',
            presetName: '名称（如：猫娘）',
            presetPrompt: '提示词（如：你是一个猫娘）',
            scenarioLabel: '场景名称（如：缩写）',
            scenarioTemplate: '模板（用 {text} 表示选中文本）',
            skillName: '技能名（kebab-case，如 my-skill）',
            skillDescription: '简短描述',
            maxRounds: '最大轮次',
            postureSelect: '姿态选择',
            modeSelect: '模式选择',
            taskDesc: '任务描述',
            taskDescPlaceholder: '输入要循环执行的任务…',
            personaSelect: '选择人格',
            workflowSelect: '选择工作流',
            roadmapTaskPlaceholder: '输入任务，AI 会先生成路线图再逐步执行…',
            queueList: '任务列表',
            queuePlaceholder: '每行一个任务，脚本会依次执行…',
            projectName: '项目名称',
            projectNamePlaceholder: '用于交接报告元数据',
        },
        // 下拉选项
        option: {
            themeDefault: '默认',
            modeQuick: '快速模式（不切换）',
            modeExpert: '专家模式',
            modeVision: '识图模式',
            postureStandard: '🔒 锁定 — 严格按计划',
            postureEvolving: '🌱 自适应 — 可中途扩展',
            postureExtended: '🔍 审计 — 计划 + 最终缺口审计',
            payloadLoop: '▶ 循环 — 分步执行',
            payloadThink: '🧠 先思考 — AI 自规划分批',
            payloadRoadmap: '🗺 路线图 — AI 研究→路线图→自动执行',
            personaNone: '无',
            personaResearcher: '研究员',
            personaBuilder: '建造者',
            personaRedteam: '红队',
            personaDevil: '魔鬼代言人',
            personaTester: '测试工程师',
            personaCustomer: '客户声音',
            personaExecutive: '执行官',
            personaRoundtable: '圆桌会议',
            workflowNone: '手动（不自动注入阶段）',
            workflowDeepResearch: '深度研究 — 研究→分支→红队→综合',
            workflowRdLab: 'R&D 实验室 — 发明→原型→评估→收敛',
            workflowShipyard: '船坞 — 概念→执行计划→QA→生产就绪',
            workflowDebate: '辩论 — 多视角挑战与综合',
            workflowPreMortem: '前置复盘 — 假设失败→调查→加固',
            workflowTrollproof: '抗喷子 — 敌意反馈→过滤→加固',
            workflowLensRelay: '透镜接力 — 多视角独立评估→综合',
        },
        // 操作按钮
        button: {
            exportJson: '📥 导出 JSON',
            exportMd: '📝 导出 MD',
            exportImg: '📸 截图 PNG',
            loopStart: '▶ 开始循环',
            loopPause: '⏸ 暂停',
            loopStop: '⏹ 停止',
            loopReset: '↺ 重置',
            roadmap: '🗺 路线图',
            thinkFirst: '🧠 先思考',
            queueStart: '📋 开始队列',
            handoff: '🤝 生成交接',
            handoffBackup: '📥 备份交接',
        },
        // 信息卡片
        info: {
            presetHint: '激活预设后，预设内容会注入到每条消息前缀。点击 ◉ 切换激活状态。',
            scenarioHint: '选中文本后右键可套用场景模板。内置场景不可删除，可禁用或修改模板。',
            skillHint: '在输入框输入 <code>/技能名 参数</code> 触发技能。内置技能始终启用，自定义技能可禁用。',
            skillEditHint: '添加后需编辑技能的 instructions（指令正文），用 <code>{args}</code> 作为参数占位符。',
            exportHint: '点击下方按钮导出当前对话，数据来源优先级：API 拦截 → 直接请求 → DOM 提取。截图导出需联网加载 html2canvas。',
            loopProtocol: '<b>信号协议：</b>AI 回复以 <code>[[GITL::PROCEED]]</code> 结尾则自动继续，以 <code>[[GITL::HALT]]</code> 结尾则停止。',
            loopAntiDetect: '<b>防检测：</b>8-15 秒随机延迟。',
            loopWatchdog: '<b>看门狗：</b>3 分钟无活动自动暂停。',
            personaMulti: '<b>多选：</b>按住 Ctrl/Cmd 多选组合委员会。',
            personaRoundtable: '<b>圆桌会议：</b>AI 模拟 5 种视角独立评估后综合。',
            personaPerTask: '<b>每步注入：</b>开启后每条循环命令都附带人格指令。',
            postureStandardDesc: '锁定到声明的计划，不允许添加、删除、合并或重排步骤。最可预测。',
            postureEvolvingDesc: '计划可以在执行中扩展 — 当出现真实阻碍或缺口时，AI 可加步骤并说明理由。',
            postureExtendedDesc: '锁定执行计划，完成后做一次覆盖审计，仅补材料性缺口。',
        },
        // Agent 警告卡片
        agentWarn: {
            title: '⚠️ 重要提示：关于工具调用产生的自动消息',
            body: '开启 Agent 系统后，DeepSeek 会在调用工具（保存/调用/融合/审查记忆）后<b>自动发送一条续跑消息</b>，将工具执行结果回传给 AI，让 AI 基于结果继续对话（即 Agent 循环）。',
            normalBehavior: '这是<b>正常行为</b>，并非 bug：',
            bullet1: '输入框会自动被锁定并填充续跑内容，<b>请勿手动输入或点击发送</b>',
            bullet2: '右下角会显示"停止 Agent"按钮，如需中断可点击它',
            bullet3: '一次用户消息最多触发 3 轮续跑，达到上限自动停止',
            bullet4: '切换会话或刷新页面可立即终止续跑',
            bullet5: 'AI 调用 <code>agent_finish</code> 工具时正常结束循环',
            closeLoopHint: '如不想出现自动消息，可关闭"Agent 循环"子模块，仅使用工具调用能力。',
        },
    },

    // ===== 菜单项 =====
    menu: {
        scriptSettings: '脚本设置',
        scriptSettingsWithIcon: '⚙️ 脚本设置',
    },

    // ===== 工具名称与描述（与 capability-register.js 的 TOOL_LABELS 对应） =====
    tools: {
        memory_save: { name: '保存记忆', desc: '保存一条新的长期记忆' },
        memory_update: { name: '更新记忆', desc: '更新已有记忆的内容' },
        memory_delete: { name: '删除记忆', desc: '删除指定记忆' },
        memory_import_preview: { name: '预览导入记忆', desc: '预览导入记忆（不实际保存）' },
        memory_recall: { name: '报告调用记忆', desc: '报告参考了哪些已有记忆' },
        memory_merge: { name: '融合记忆', desc: '将多条关联记忆融合为一条' },
        memory_review: { name: '审查记忆', desc: '审查并整理记忆库' },
        memory_search: { name: '搜索记忆', desc: '主动搜索记忆库' },
        memory_list: { name: '列出记忆', desc: '列出记忆库中的记忆' },
        memory_pin: { name: '置顶记忆', desc: '切换记忆的置顶状态' },
        memory_stats: { name: '记忆统计', desc: '返回记忆库统计概览' },
        memory_export: { name: '导出记忆', desc: '将记忆库导出为 JSON' },
        memory_archive: { name: '归档记忆', desc: '归档过期记忆' },
        memory_get: { name: '读取记忆', desc: '按 ID 读取单条记忆' },
        memory_clear: { name: '清空记忆', desc: '批量清空指定作用域的记忆' },
        memory_replace: { name: '覆盖更新记忆', desc: '覆盖式更新记忆并保留历史' },
        todo_write: { name: '更新任务清单', desc: '全量替换当前 todo 清单' },
        todo_read: { name: '读取任务清单', desc: '查看当前清单状态' },
        todo_clear: { name: '清空任务清单', desc: '清空所有 todo' },
        ask_user: { name: '向用户提问', desc: '向用户提问并暂停 Agent 循环' },
        start_agent: { name: '启动Agent', desc: '显式启动 Agent 循环' },
        agent_finish: { name: '结束Agent', desc: '显式结束 Agent 循环' },
    },

    // ===== Agent 续跑提示（来自 capability-register.js 的工具执行结果） =====
    agent: {
        started: 'Agent 已启动',
        finished: 'Agent 已结束',
        startDetail: 'AI 主动启动 Agent 循环',
        finishDetail: 'AI 声明任务完成。Agent 循环已终止，用户可继续输入。',
        taskPrefix: '任务',
        reasonPrefix: '理由',
        waitUser: '等待用户回答',
        shownQuestions: '已展示 {count} 个问题给用户，等待回答',
        loopTerminated: 'Agent 循环已终止，用户可继续输入。',
    },

    // ===== 工具卡片状态文案（来自 text-process.js） =====
    toolCard: {
        title: '工具调用',
        count: '{count} 次',
        todoTitle: '任务清单',
        recallInfo: '调用 {count} 条: {ids}{more}',
        recallMore: ' 等 {count} 条',
        mergeInfo: '融合 {count} 条 → {name}',
        reviewFocus: '审查重点: {focus}',
        reviewDefault: '全面审查',
    },

    // ===== toast 消息 =====
    toast: {
        saved: '已保存',
        deleted: '已删除',
        updated: '已更新',
        copied: '已复制到剪贴板',
        exported: '导出成功',
        imported: '导入成功',
        settingsSaved: '✅ 设置已保存，正在刷新页面…',
        resetDone: '✅ 已恢复默认设置，正在刷新页面…',
        preparing: '⏳ 正在准备…',
        namePromptRequired: '名称和提示词不能为空',
        emptyPreset: '暂无预设，添加一个吧',
        noSensitiveWords: '暂无敏感词',
        manualPause: '手动暂停',
    },

    // ===== 错误提示（来自 capability-register.js 的工具执行失败结果） =====
    error: {
        invalidToolCall: '无效的工具调用',
        emptyToolOrPayload: '工具名或参数为空',
        toolExecFailed: '工具执行失败',
        unknownTool: '未知工具：{name}',
        memoryFormat: '记忆格式错误',
        saveFailed: '保存失败',
        updateFailed: '更新失败',
        deleteFailed: '删除失败',
        mergeFailed: '融合失败',
        previewFailed: '预览失败',
        exportFailed: '导出失败',
        replaceFailed: '替换失败',
        clearFailed: '清空失败',
        pinFailed: '置顶失败',
        paramError: '参数错误',
        notFound: '记忆不存在',
        needConfirm: '需要确认',
        todoNotInit: 'Todo 模块未初始化',
        execFailed: '执行失败',
    },
};

export default zhCN;
