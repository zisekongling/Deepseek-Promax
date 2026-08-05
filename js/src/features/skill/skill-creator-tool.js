/**
 * Skill Creator 工具模块
 *
 * 提供 skill_draft_create 工具的描述符与执行器，让 AI 能根据用户描述生成 skill 草稿。
 * 草稿不写入仓库，仅暴露到 window._dsPendingSkillDraft 供设置面板读取。
 *
 * 与其他模块的关系：
 *   - 被 capability-register.js 导入并注册为 Agent 工具
 *   - 草稿保存需要调用 api.js 的 saveSkill（由设置面板触发）
 *   - 刻意不依赖 repository.js（normalizeSkillName 独立实现），避免拉入持久化依赖
 */

/**
 * Skill Creator 工具的描述符
 *
 * 注册到 capability-register 后，AI 可调用 <skill_draft_create>...</skill_draft_create>
 * 创建一个 skill 草稿，用户可在设置面板中查看并保存。
 *
 * @returns {ToolDescriptor}
 */
export function createSkillCreatorToolDescriptor() {
    return {
        name: 'skill_draft_create',
        description: '创建一个 AI Skill 草稿。AI 根据用户描述生成 name/description/instructions/memoryEnabled，用户可在设置面板中查看并保存。',
        category: 'system',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '技能名（kebab-case，将自动归一化）' },
                description: { type: 'string', description: '简短描述（最长 500 字符）' },
                instructions: { type: 'string', description: '指令正文（Markdown，至少 40 字符，可用 {args} 占位符）' },
                memoryEnabled: { type: 'boolean', description: '是否启用记忆（默认 false）' }
            },
            required: ['name', 'description', 'instructions'],
            additionalProperties: false
        }
    };
}

/**
 * 执行 skill_draft_create 工具调用
 *
 * @param {Object} payload - { name, description, instructions, memoryEnabled? }
 * @returns {Promise<{ok: boolean, summary: string, detail?: string, output?: any}>}
 */
export async function executeSkillCreatorToolCall(payload) {
    try {
        const output = createSkillDraft(payload);
        return {
            ok: true,
            summary: 'Skill 草稿已生成，请在设置面板中查看并保存',
            detail: output.draft.name,
            output
        };
    } catch (error) {
        return {
            ok: false,
            summary: 'Skill 草稿生成失败',
            detail: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * 从用户输入创建一个 skill 草稿（不写入仓库，仅返回结构化草稿）
 *
 * 校验规则：
 *   - name: 非空字符串，自动归一化为 kebab-case（最长 64）
 *   - description: 非空字符串（最长 500）
 *   - instructions: 非空字符串（至少 40 字符，最长 16000）
 *   - memoryEnabled: 默认 false
 *
 * @param {unknown} value
 * @returns {{kind: 'skill_draft', draft: Skill, warnings: string[]}}
 */
export function createSkillDraft(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Skill draft payload must be an object');
    }
    const payload = value;
    const name = normalizeSkillNameCreator(requiredDraftString(payload.name, 'name'));
    const description = requiredDraftString(payload.description, 'description').slice(0, 500);
    const instructions = requiredDraftString(payload.instructions, 'instructions');
    if (instructions.length < 40) {
        throw new Error('instructions must be at least 40 characters');
    }
    const warnings = [];
    if (instructions.length > 16000) warnings.push('instructions_truncated');
    return {
        kind: 'skill_draft',
        draft: {
            name,
            description,
            instructions: instructions.slice(0, 16000),
            source: 'custom',
            memoryEnabled: payload.memoryEnabled === true,
            enabled: true,
            metadata: { createdBy: 'skill_draft_create' }
        },
        warnings
    };
}

/** 内部：skill draft 字段校验（非空字符串） */
function requiredDraftString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value.trim();
}

/** 内部：skill draft 专用名称归一化（与 normalizeSkillName 等价，独立实现避免循环依赖） */
function normalizeSkillNameCreator(name) {
    const normalized = name.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!normalized) throw new Error('Skill name cannot be empty');
    return normalized.slice(0, 64);
}
