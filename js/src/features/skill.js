/**
 * 技能库模块（移植自 deepseek-pp/core/skill/）
 *
 * 提供 /命令 触发的技能库：用户在聊天框输入 /skill-name args，
 * 脚本解析后把对应 skill 的 instructions + args 注入到 prompt。
 *
 * 数据模型：
 *   Skill { name, description, instructions, source, memoryEnabled, enabled?, metadata?, remote? }
 *   - name: kebab-case，最长 64 字符
 *   - source: 'builtin' | 'custom' | 'remote'
 *   - instructions: Markdown 指令正文，注入到 prompt 时会带 args
 *   - metadata: 可选的字符串键值对（author/version/provider 等）
 *   - remote: 远程导入元信息（sourceId/path/originalName/importedAt/...）
 *
 * Skill 源（SkillImportSource）：
 *   - GitHubSkillSource: 从 GitHub 仓库导入的源
 *   - TextSkillSource:   从粘贴文本导入的源（js 项目独有，替代 deepseek-pp 的 local-importer）
 *
 * 存储：
 *   key: deepseek_pp_skills        → Skill[]（仅 custom + remote 源，builtin 由代码常量提供）
 *   key: deepseek_pp_skill_sources → SkillImportSource[]
 *
 * /命令解析规则（正则 /^\/(\S+)\s*([\s\S]*)$/）：
 *   /ultra-think 帮我设计一个登录页  → name='ultra-think', args='帮我设计一个登录页'
 *   /frontend-design                → name='frontend-design', args=''
 *   普通文本不匹配                   → 返回 null
 *
 * 模块分区（已拆分到 ./skill/ 子目录）：
 *   1. /命令解析           - parseSkillCommand              → command-parser.js
 *   2. 内置技能与多语言     - BUILTIN_SKILLS / getLocalizedBuiltinSkills → builtin-skills.js
 *   3. 编解码器            - codec（含 metadata / remote / schemaVersion 校验） → codec.js
 *   4. 仓库实例            - userSkillRepository / skillSourceRepository → repository.js
 *   5. 名称归一化与去重    - normalizeSkillName / createUniqueSkillName → repository.js
 *   6. 对外 API            - getAllSkills / getSkillByName / saveSkill / deleteSkill ... → api.js
 *   7. SKILL.md 解析       - parseSkillDoc（YAML frontmatter + 正文） → skill-doc-parser.js
 *   8. GitHub 导入器       - previewGitHubSkillSource / importGitHubSkillSource / ... → github-importer.js
 *   9. 文本导入器          - importSkillFromText（粘贴 SKILL.md 内容导入） → text-importer.js
 *  10. Skill Creator 工具  - createSkillDraft / createSkillCreatorToolDescriptor → skill-creator-tool.js
 *  11. 同步策略            - isSyncableSkill / isSyncableSkillSource → sync-policy.js
 *
 * 本文件保留为对外公共 API 的薄入口（向后兼容），
 * 所有 `import { ... } from '../features/skill.js'` 无需修改。
 */

export * from './skill/index.js';
