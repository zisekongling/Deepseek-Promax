/**
 * /命令解析模块
 *
 * 解析用户在聊天框输入的 /skill-name args 格式文本。
 * 触发规则：以 / 开头，第一个空白前为命令名，其余为 args。
 *
 * 与其他模块的关系：
 *   被 prompt-augmentation.js 调用，用于检测用户输入是否为 /命令 触发技能。
 */

/** /命令触发正则：以 / 开头，第一个空白前为命令名，其余为 args */
const SKILL_TRIGGER_REGEX = /^\/(\S+)\s*([\s\S]*)$/;

/**
 * 解析 /命令输入
 * @param {string} input - 用户输入文本
 * @returns {{skillName: string, args: string, rawInput: string} | null}
 *   不匹配返回 null；匹配返回 { skillName, args, rawInput }
 */
export function parseSkillCommand(input) {
    if (typeof input !== 'string' || !input) return null;
    const match = input.match(SKILL_TRIGGER_REGEX);
    if (!match) return null;
    return {
        skillName: match[1],
        args: match[2] ? match[2].trim() : '',
        rawInput: input
    };
}
