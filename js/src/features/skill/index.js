/**
 * skill 子系统聚合入口
 *
 * 把 11 个子模块的 export 重新聚合，提供 skill 子系统的完整公共 API。
 *
 * 与其他模块的关系：
 *   - 被 features/skill.js 作为薄入口 re-export
 *   - 间接被 settings-panel.js / prompt-augmentation.js / capability-register.js 调用
 *
 * 模块清单：
 *   1. command-parser      - /命令解析
 *   2. builtin-skills      - 内置技能与多语言
 *   3. codec               - 编解码器与校验工具
 *   4. repository          - 仓库实例 + 名称归一化
 *   5. skill-doc-parser    - SKILL.md 解析
 *   6. api                 - 对外 CRUD 接口
 *   7. github-importer     - GitHub 导入器
 *   8. text-importer       - 文本导入器
 *   9. import-staging      - 导入暂存（github/text 共用）
 *   10. skill-creator-tool - Skill Creator 工具
 *   11. sync-policy        - 同步策略
 */

export * from './command-parser.js';
export * from './builtin-skills.js';
export * from './codec.js';
export * from './repository.js';
export * from './skill-doc-parser.js';
export * from './api.js';
export * from './github-importer.js';
export * from './text-importer.js';
export * from './import-staging.js';
export * from './skill-creator-tool.js';
export * from './sync-policy.js';
