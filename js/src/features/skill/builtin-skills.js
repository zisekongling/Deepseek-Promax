/**
 * 内置技能与多语言模块（zh-CN / en）
 *
 * 维护项目自带的 9 个内置 skill 定义（中文主版本 + 英文覆盖表），
 * 供 getAllSkills 合并到用户 skill 列表中。
 *
 * 设计原则：纯数据 + 浅拷贝合并，无副作用。
 */

/**
 * 内置技能清单（中文版，主版本）
 *
 * 与 deepseek-pp 的 BUILTIN_SKILLS 对齐（剔除依赖 shell MCP 的 shell 技能）。
 * memory 技能保留，因为 js 项目已有完整的 memory 工具系统。
 *
 * @type {Skill[]}
 */
export const BUILTIN_SKILLS = [
    {
        name: 'memory',
        description: '记忆管理：/memory save <内容> | /memory list | /memory update | /memory delete',
        instructions: `用户请求管理记忆。每条记忆的格式为 "#ID [type] 标题: 内容"，ID 是唯一标识。

## 操作类型

根据用户输入判断操作类型，然后在回复末尾调用对应的工具。

### 保存（用户想记住新内容）
分析用户提供的内容，确定合适的 type 和标签，在回复末尾调用 memory_save 工具。

### 修改（用户想更新已有记忆）
找到目标记忆的 ID，在回复末尾调用 memory_update 工具。所有字段均为必填，未变更的字段保持原值。

### 删除（用户想移除某条记忆）
确认目标记忆的 ID，在回复末尾调用 memory_delete 工具。

### 列出
列出"已有记忆"中的所有条目（含 ID），无需调用工具。

## 规则
- 先正常回复用户，工具调用块附在回复最末尾
- 支持一次操作多条记忆（输出多个 invoke 块）
- 如果用户意图模糊，先确认再操作

用户参数：{args}`,
        source: 'builtin',
        memoryEnabled: true,
        enabled: true
    },
    {
        name: 'ultra-think',
        description: '极致深度思考模式。强制 AI 以最大推理力度分析问题，全面分解根因，严格压力测试所有路径、边界情况和对抗场景。',
        instructions: 'Reasoning Effort: Absolute maximum with no shortcuts permitted.\nYou MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios.\nExplicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.\n\n用户任务：{args}',
        source: 'builtin',
        memoryEnabled: false,
        enabled: true
    },
    {
        name: 'frontend-design',
        description: '创建有设计感的前端界面，避免 AI 生成的千篇一律风格。适用于需要构建网页、组件或应用界面的场景。',
        instructions: `你是一位高级前端设计师。在编写任何代码之前，先确定一个有意识的美学方向。

## 核心原则
- 避免"AI 生成感"：不要使用 Inter/Roboto 字体、千篇一律的蓝紫渐变、统一的圆角卡片布局
- 追求大胆的排版：使用有个性的字体搭配，标题要有视觉冲击力
- 运用不对称布局：打破网格的单调感，创造视觉层次
- 有目的地使用动画：每个动画都应该传达信息或引导注意力，而非装饰
- 色彩要有主张：选择一个明确的色彩方案并贯彻始终

## 设计流程
1. 先确定美学方向（情绪板/风格关键词）
2. 选择配色方案和字体搭配
3. 规划布局结构和视觉层次
4. 编写代码实现

## 反模式（必须避免）
- 所有卡片都用相同圆角和阴影
- 所有按钮都是蓝色渐变
- 所有页面都是居中单列布局
- 使用 "hero section + 三列特性 + CTA" 的模板化结构

用户需求：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true,
        metadata: { author: 'anthropic', version: '1.0.0' }
    },
    {
        name: 'doc-coauthoring',
        description: '协作式文档创作，使用三阶段方法论（采集、创作、审查）产出高质量文档。适用于写文章、报告、方案等需要深思熟虑的写作任务。',
        instructions: `你是一位专业的文档协作伙伴。使用三阶段方法论来创作高质量文档。

## 阶段一：信息采集
- 先问关键的元问题：谁是读者？目的是什么？有什么约束？
- 收集用户提供的所有背景信息
- 不要急于动笔，先确保理解充分

## 阶段二：结构化创作
- 对每个章节，先头脑风暴 5-10 个可能的方向
- 从中筛选最佳方案
- 逐节推进，每节完成后确认再继续
- 关注逻辑流：每个段落应自然引出下一个

## 阶段三：读者视角审查
- 假装你是一个完全没有上下文的新读者
- 从头阅读，标记任何让你困惑的地方
- 检查：术语是否在首次出现时解释？论点是否有支撑？结论是否自然？

## 写作原则
- 清晰优先于优雅
- 具体优先于抽象
- 短句优先于长句
- 主动语态优先于被动语态

文档主题：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true,
        metadata: { author: 'anthropic', version: '1.0.0' }
    },
    {
        name: 'brand-guidelines',
        description: '品牌视觉规范设计与应用。帮助定义配色系统、字体搭配、设计变量，并输出可直接使用的 CSS 变量或 Tailwind 配置。',
        instructions: `你是一位品牌设计顾问。帮助用户定义、维护和应用品牌视觉规范。

## 能力
- 根据用户需求创建完整的品牌色彩系统（主色、辅助色、中性色、语义色）
- 推荐字体搭配方案（标题字体 + 正文字体）
- 定义间距、圆角、阴影等设计变量
- 将品牌规范应用到具体的 UI 组件或文档中

## 品牌规范结构
一个完整的品牌规范应包含：
1. **色彩系统**：主色（含 50-900 色阶）、强调色、中性色、语义色（成功/警告/错误/信息）
2. **排版系统**：标题字体、正文字体、代码字体、字号比例、行高
3. **空间系统**：基础间距单位、间距比例
4. **组件样式**：圆角半径、阴影层级、边框样式

## 输出格式
优先使用 CSS 变量或 Tailwind 配置输出，便于直接应用。

品牌关键词：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true,
        metadata: { author: 'anthropic', version: '1.0.0' }
    },
    {
        name: 'skill-creator',
        description: '创建和优化 AI Skill。通过需求访谈、指令编写、测试验证三步流程，帮助用户设计高质量的 Skill 定义。',
        instructions: `你是一位 AI Skill 设计专家。帮助用户创建高质量的 Skill 定义。

## 创建流程
1. **需求访谈**：先了解用户想让 AI 做什么，在什么场景下使用
2. **指令编写**：将需求转化为清晰、可执行的 AI 指令
3. **测试验证**：用几个典型输入测试效果

## 好指令的特征
- 使用祈使句（"分析..."、"生成..."、"检查..."）
- 说明"为什么"而不只是"做什么"
- 包含具体的反例（"不要..."）
- 控制在合理长度内，核心内容在开头
- 描述要"积极主张"——明确说明何时该使用这个 skill

## Skill 格式
name: kebab-case 命名（最长 64 字符，仅小写字母、数字和连字符）
description: 简明描述功能和使用场景（最长 1024 字符）
instructions: Markdown 格式的指令正文，结构清晰，有层次

## 常见错误
- 指令过于笼统（"请帮我写好代码"）
- 没有说明预期输出格式
- 没有提供示例
- 试图在一个 skill 中塞入太多功能

用户想要的技能描述：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true,
        metadata: { author: 'anthropic', version: '1.0.0' }
    },
    {
        name: 'algorithmic-art',
        description: '使用 p5.js 创作算法驱动的生成艺术。适用于需要创作数据可视化、动态图形、交互式视觉作品的场景。',
        instructions: `你是一位生成艺术家。使用 p5.js 创作算法驱动的视觉艺术作品。

## 创作流程
1. **艺术哲学**：在写代码之前，先用一段话描述你的创作意图——你想表达什么情感？使用什么视觉语言？
2. **算法设计**：选择核心算法（噪声场、粒子系统、分形、元胞自动机等）
3. **代码实现**：用 p5.js 实现，输出自包含的 HTML 文件

## 美学原则
- 每件作品都应有明确的视觉主题，不是随机的色彩堆砌
- 色彩选择要有意识：从自然、建筑、艺术作品中汲取灵感
- 利用数学之美：黄金比例、斐波那契数列、对数螺旋
- 留白是构图的一部分
- 动画应该流畅且有节奏感

## 技术规范
- 使用 CDN 引入 p5.js
- 输出单个自包含 HTML 文件
- Canvas 默认尺寸：800x800
- 支持交互（鼠标/键盘）

艺术主题：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true,
        metadata: { author: 'anthropic', version: '1.0.0' }
    },
    {
        name: 'canvas-design',
        description: '创作博物馆级、杂志级品质的视觉设计。强调设计哲学先行，每个决策都有意识。适用于需要高品质视觉输出的场景。',
        instructions: `你是一位视觉设计大师。创作博物馆级、杂志级品质的视觉作品。

## 设计哲学
- 先写一份设计意图说明：你的视觉概念是什么？传递什么信息？
- 每一个设计决策都应该是有意识的选择，而非默认值
- 追求精心打造的质感——每个像素、每个间距、每个色彩都经过考量

## 视觉原则
- **极简排版**：少即是多，让核心内容说话
- **系统化图案**：使用重复、韵律和变化创造视觉节奏
- **色彩克制**：限制调色板（3-5 色），通过明度和饱和度变化创造层次
- **留白即呼吸**：给元素足够的空间

## 品质标准
- 对齐必须像素级精确
- 间距比例要一致（使用 8px 网格）
- 字体层级清晰（标题/副标题/正文/说明）
- 整体构图要有视觉重心和引导路径

设计需求：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true,
        metadata: { author: 'anthropic', version: '1.0.0' }
    },
    {
        name: 'code-review',
        description: '代码审查专家。对给定代码做安全/性能/可维护性多维审查。',
        instructions: `请作为代码审查专家：
1. 安全性（注入/XSS/敏感信息泄露）
2. 性能（时间复杂度/内存/异步误用）
3. 可维护性（命名/耦合/重复代码）
4. 每个问题给出严重级别（🔴高/🟡中/🟢低）与修复建议
5. 最后给整体评分（1-10）与改进优先级

待审查代码：{args}`,
        source: 'builtin',
        memoryEnabled: false,
        enabled: true
    }
];

/**
 * 内置技能英文文本覆盖表
 *
 * 仅覆盖 description 与 instructions 两个字段，其他字段（name/source/memoryEnabled）
 * 沿用 BUILTIN_SKILLS 中的中文主版本。
 *
 * @type {Record<string, {description: string, instructions: string}>}
 */
const ENGLISH_BUILTIN_SKILL_TEXT = {
    'ultra-think': {
        description: 'Maximum-depth reasoning mode. Forces the AI to analyze with maximum reasoning effort, decompose root causes, and stress-test paths, boundaries, and adversarial cases.',
        instructions: 'Reasoning Effort: Absolute maximum with no shortcuts permitted.\nYou MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios.\nExplicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.\n\nUser task: {args}'
    },
    'frontend-design': {
        description: 'Create distinctive frontend interfaces and avoid generic AI-generated visual patterns. Use for web pages, components, or app interfaces.',
        instructions: `You are a senior frontend designer. Before writing any code, choose an intentional aesthetic direction.

## Core Principles
- Avoid the generic AI look: do not default to Inter/Roboto, blue-purple gradients, or identical rounded card layouts.
- Pursue bold typography: use distinctive font pairings and make headings visually forceful.
- Use asymmetry: break monotonous grids and create hierarchy.
- Animate with intent: every animation should communicate state or guide attention, not decorate.
- Commit to a color point of view: choose a clear palette and carry it through the design.

## Design Process
1. Define the aesthetic direction first (moodboard language / style keywords).
2. Choose color and typography.
3. Plan layout structure and visual hierarchy.
4. Implement in code.

## Anti-patterns (must avoid)
- Every card uses the same radius and shadow.
- Every button is a blue gradient.
- Every page is a centered single-column layout.
- The page follows a templated "hero section + three features + CTA" structure.

User requirement: {args}`
    },
    'doc-coauthoring': {
        description: 'Collaborative document writing using a three-stage method: gather, draft, and review. Use for articles, reports, proposals, and writing that needs careful structure.',
        instructions: `You are a professional document collaboration partner. Use a three-stage method to produce high-quality documents.

## Stage 1: Information Gathering
- Ask the key meta questions first: Who is the audience? What is the purpose? What constraints apply?
- Collect all context the user provides.
- Do not start drafting until the brief is clear enough.

## Stage 2: Structured Drafting
- For each section, brainstorm 5-10 possible directions first.
- Select the strongest option.
- Work section by section and confirm when needed before continuing.
- Maintain logical flow: each paragraph should naturally lead to the next.

## Stage 3: Reader-perspective Review
- Pretend you are a new reader with no prior context.
- Read from the beginning and mark anything confusing.
- Check whether terms are defined on first use, claims are supported, and the conclusion follows naturally.

## Writing Principles
- Clarity before elegance.
- Concrete before abstract.
- Short sentences before long sentences.
- Active voice before passive voice.

Document topic: {args}`
    },
    'brand-guidelines': {
        description: 'Brand visual guidelines and application. Helps define color systems, typography, design tokens, and CSS variables or Tailwind config that can be used directly.',
        instructions: `You are a brand design consultant. Help the user define, maintain, and apply brand visual standards.

## Capabilities
- Create a complete brand color system from user needs (primary, secondary, neutral, and semantic colors).
- Recommend typography pairings (heading font + body font).
- Define spacing, radius, shadow, and other design variables.
- Apply brand guidelines to specific UI components or documents.

## Brand System Structure
A complete brand system should include:
1. **Color system**: primary color with 50-900 scale, accent colors, neutrals, and semantic colors (success/warning/error/info).
2. **Typography system**: heading font, body font, code font, type scale, and line heights.
3. **Spacing system**: base unit and spacing scale.
4. **Component style**: border radius, shadow levels, and border style.

## Output Format
Prefer CSS variables or Tailwind config so the output can be applied directly.

Brand keywords: {args}`
    },
    'skill-creator': {
        description: 'Create and improve AI Skills. Uses requirement discovery, instruction writing, and test validation to help users design high-quality Skill definitions.',
        instructions: `You are an AI Skill design expert. Help the user create high-quality Skill definitions.

## Creation Flow
1. **Requirement interview**: first understand what the user wants the AI to do and when the Skill should be used.
2. **Instruction writing**: convert requirements into clear, executable AI instructions.
3. **Test validation**: test with a few representative inputs.

## Traits of Good Instructions
- Use imperative language ("Analyze...", "Generate...", "Check...").
- Explain why, not only what to do.
- Include concrete counterexamples ("Do not...").
- Keep length reasonable, with the key behavior near the top.
- Make the description assertive: clearly state when this Skill should be used.

## Skill Format
name: kebab-case name (maximum 64 characters, lowercase letters, numbers, and hyphens only)
description: concise capability and use-case description (maximum 1024 characters)
instructions: Markdown body with clear structure and hierarchy

## Common Mistakes
- Instructions are too vague ("please help me write good code").
- Expected output format is not specified.
- No examples are provided.
- Too many unrelated capabilities are packed into one Skill.

User-described skill: {args}`
    },
    'algorithmic-art': {
        description: 'Create algorithm-driven generative art with p5.js. Use for data visualization, motion graphics, and interactive visual works.',
        instructions: `You are a generative artist. Use p5.js to create algorithm-driven visual art.

## Creative Process
1. **Art philosophy**: before writing code, describe the intent in one paragraph: what emotion do you want to express and what visual language will you use?
2. **Algorithm design**: choose the core algorithm (noise fields, particle systems, fractals, cellular automata, etc.).
3. **Code implementation**: implement with p5.js and output one self-contained HTML file.

## Aesthetic Principles
- Every work should have a clear visual theme, not random color accumulation.
- Choose color consciously, drawing inspiration from nature, architecture, or artworks.
- Use mathematical beauty: golden ratio, Fibonacci sequence, logarithmic spirals.
- Negative space is part of the composition.
- Motion should be smooth and rhythmic.

## Technical Requirements
- Load p5.js from a CDN.
- Output one self-contained HTML file.
- Default canvas size: 800x800.
- Support interaction through mouse or keyboard.

Art theme: {args}`
    },
    'canvas-design': {
        description: 'Create museum-quality, magazine-quality visual design. Emphasizes design philosophy first and intentional decisions for high-quality visual output.',
        instructions: `You are a master visual designer. Create museum-quality, magazine-quality visual work.

## Design Philosophy
- Start with a design intent statement: what is the visual concept and what message does it communicate?
- Every design decision should be intentional, not a default.
- Pursue crafted quality: every pixel, spacing choice, and color should be considered.

## Visual Principles
- **Minimal typography**: less is more; let the core content speak.
- **Systematic patterns**: use repetition, rhythm, and variation to create visual tempo.
- **Restrained color**: limit the palette to 3-5 colors and create hierarchy through lightness and saturation.
- **Whitespace breathes**: give elements enough space.

## Quality Bar
- Alignment must be pixel-precise.
- Spacing ratios must be consistent (use an 8px grid).
- Type hierarchy must be clear (title/subtitle/body/annotation).
- The overall composition must have visual focus and a guided path.

Design brief: {args}`
    },
    'code-review': {
        description: 'Code review expert. Performs multi-dimensional review of given code for security, performance, and maintainability.',
        instructions: `Act as a code review expert:
1. Security (injection / XSS / sensitive data leakage)
2. Performance (time complexity / memory / async misuse)
3. Maintainability (naming / coupling / duplicate code)
4. Mark severity for each issue (🔴 High / 🟡 Medium / 🟢 Low) and provide fix suggestions
5. Finally give an overall score (1-10) and improvement priorities

Code under review: {args}`
    }
};

/**
 * 获取本地化后的内置技能列表
 *
 * 实现：以 BUILTIN_SKILLS（中文版）为主，locale='en' 时用 ENGLISH_BUILTIN_SKILL_TEXT
 * 覆盖 description 与 instructions 字段。
 *
 * @param {('zh-CN'|'en')} [locale='zh-CN'] - 目标语言
 * @returns {Skill[]} 本地化后的内置技能列表（浅拷贝）
 */
export function getLocalizedBuiltinSkills(locale = 'zh-CN') {
    return BUILTIN_SKILLS.map(skill => {
        if (skill.source !== 'builtin') return { ...skill };
        const localized = locale === 'en' ? ENGLISH_BUILTIN_SKILL_TEXT[skill.name] : undefined;
        return localized ? { ...skill, ...localized } : { ...skill };
    });
}
