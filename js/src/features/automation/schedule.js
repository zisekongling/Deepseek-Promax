/**
 * @file schedule.js
 * @description 调度表达式解析与下次运行时间计算
 *
 * 支持：
 *   - cron 表达式（5 字段：分 时 日 月 周）
 *     - 通配符 * 与 ?
 *     - 逗号列表 1,5,10
 *     - 范围 1-5
 *     - 步长 *\/15 或 1-10/2
 *   - 简易 RRULE（FREQ=DAILY/WEEKLY/MONTHLY + BYDAY + INTERVAL）
 *
 * 硬约束：最小调度间隔 15 分钟，低于此间隔的调度拒绝创建。
 *
 * 参考：deepseek-pp/core/automation/schedule.ts
 *   - cron 字段解析与 dayOfWeek 7→0 规范化逻辑保持一致
 *   - dayOfMonth 与 dayOfWeek 同时非通配符时取 OR（标准 cron 语义）
 *   - 最小间隔校验：计算前两次运行的间隔，低于 15 分钟则拒绝
 *
 * 本模块为纯函数，无副作用，不访问 localStorage / window（除 Date 构造）。
 */

/** 最小调度间隔（分钟）—— 硬约束 */
export const MINIMUM_INTERVAL_MINUTES = 15;

/** 单位换算常量 */
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** cron 下次运行的最大前瞻天数（避免无限循环） */
const MAX_LOOKAHEAD_DAYS = 370;

/** cron 字段定义：[字段名, 最小值, 最大值] */
const CRON_FIELD_DEFS = [
    ['minute', 0, 59],
    ['hour', 0, 23],
    ['dayOfMonth', 1, 31],
    ['month', 1, 12],
    ['dayOfWeek', 0, 7] // 0 与 7 均表示周日
];

/** RRULE 星期缩写 → 数字（0=周日 … 6=周六） */
const RRULE_DAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

/**
 * 构造失败结果对象
 * @param {string} code - 错误码
 * @param {string} message - 错误信息
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function fail(code, message) {
    return { ok: false, error: { code, message } };
}

/**
 * 解析单个 cron token（无逗号），支持通配符 / 范围 / 步长
 * @param {string} token - 单个 token（如 "*\/15"、"1-5"、"3"、"1-10/2"）
 * @param {number} min - 该字段允许的最小值
 * @param {number} max - 该字段允许的最大值
 * @returns {{ ok: true, values: number[] } | { ok: false, error: { code: string, message: string } }}
 */
function parseCronToken(token, min, max) {
    if (!token) return fail('invalid_cron_field', 'cron 字段包含空 token');
    const [rangePart, stepPart] = token.split('/');
    const step = stepPart == null ? 1 : parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) {
        return fail('invalid_cron_step', `非法 cron 步长 "${stepPart}"`);
    }
    let start, end;
    if (rangePart === '*' || rangePart === '?') {
        start = min;
        end = max;
    } else {
        const [s, e] = rangePart.split('-');
        start = parseInt(s, 10);
        end = e == null ? start : parseInt(e, 10);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
            return fail('invalid_cron_range', `非法 cron 范围 "${rangePart}"`);
        }
    }
    const values = [];
    for (let v = start; v <= end; v += step) values.push(v);
    if (values.length === 0) {
        return fail('invalid_cron_field', `cron token "${token}" 未选中任何值`);
    }
    return { ok: true, values };
}

/**
 * 解析 cron 字段（支持逗号分隔的多个 token）
 * @param {string} field - 字段字符串
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @param {(v: number) => number} [normalize] - 值规范化函数（如 dayOfWeek 的 7→0）
 * @returns {{ ok: true, values: Set<number>, wildcard: boolean } | { ok: false, error: { code: string, message: string } }}
 */
function parseCronField(field, min, max, normalize) {
    const norm = normalize || (v => v);
    const wildcard = field === '*' || field === '?';
    const values = new Set();
    for (const token of field.split(',')) {
        const r = parseCronToken(token.trim(), min, max);
        if (!r.ok) return r;
        for (const v of r.values) values.add(norm(v));
    }
    if (values.size === 0) {
        return fail('invalid_cron_field', `cron 字段 "${field}" 未选中任何值`);
    }
    return { ok: true, values, wildcard };
}

/**
 * 将 dayOfWeek 的 7 规范化为 0（周日）
 * @param {number} v
 * @returns {number}
 */
function normalizeDayOfWeek(v) {
    return v === 7 ? 0 : v;
}

/**
 * 解析 cron 表达式
 * @param {string} expr - cron 表达式（5 字段：分 时 日 月 周）
 * @returns {{ ok: true, schedule: { type: 'cron', expr: string, cron: object } } | { ok: false, error: { code: string, message: string } }}
 */
export function parseCron(expr) {
    if (typeof expr !== 'string' || !expr.trim()) {
        return fail('invalid_cron', 'cron 表达式不能为空');
    }
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) {
        return fail('invalid_cron', 'cron 表达式必须为 5 个字段（分 时 日 月 周）');
    }
    const parsed = {};
    for (let i = 0; i < 5; i++) {
        const [name, min, max] = CRON_FIELD_DEFS[i];
        const norm = name === 'dayOfWeek' ? normalizeDayOfWeek : undefined;
        const r = parseCronField(fields[i], min, max, norm);
        if (!r.ok) return r;
        parsed[name] = { values: r.values, wildcard: r.wildcard };
    }
    return { ok: true, schedule: { type: 'cron', expr: expr.trim(), cron: parsed } };
}

/**
 * 解析 RRULE 字符串
 * @param {string} str - RRULE 字符串（如 "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2"）
 * @returns {{ ok: true, schedule: { type: 'rrule', expr: string, rrule: object } } | { ok: false, error: { code: string, message: string } }}
 */
export function parseRRule(str) {
    if (typeof str !== 'string' || !str.trim()) {
        return fail('invalid_rrule', 'RRULE 表达式不能为空');
    }
    const normalized = str.trim().replace(/^RRULE:/i, '');
    const parts = new Map();
    for (const part of normalized.split(';')) {
        if (!part.trim()) continue;
        const eqIdx = part.indexOf('=');
        if (eqIdx < 0) {
            return fail('invalid_rrule', 'RRULE 各部分必须为 KEY=VALUE 格式');
        }
        const key = part.slice(0, eqIdx).trim().toUpperCase();
        const value = part.slice(eqIdx + 1).trim().toUpperCase();
        if (!key || !value) {
            return fail('invalid_rrule', 'RRULE 各部分必须为 KEY=VALUE 格式');
        }
        parts.set(key, value);
    }
    const freq = parts.get('FREQ');
    if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
        return fail('invalid_rrule_freq', 'RRULE FREQ 必须为 DAILY / WEEKLY / MONTHLY');
    }
    const intervalRaw = parts.get('INTERVAL') || '1';
    const interval = parseInt(intervalRaw, 10);
    if (!Number.isInteger(interval) || interval < 1) {
        return fail('invalid_rrule_interval', 'RRULE INTERVAL 必须为正整数');
    }
    let byday = [];
    if (parts.has('BYDAY')) {
        const days = parts.get('BYDAY').split(',');
        for (const d of days) {
            const code = d.trim();
            if (!Object.prototype.hasOwnProperty.call(RRULE_DAY_MAP, code)) {
                return fail('invalid_rrule_byday', `非法 BYDAY 值 "${d}"（应为 MO/TU/WE/TH/FR/SA/SU）`);
            }
            byday.push(code);
        }
    }
    const supported = new Set(['FREQ', 'INTERVAL', 'BYDAY']);
    const unsupported = [...parts.keys()].filter(k => !supported.has(k));
    if (unsupported.length > 0) {
        return fail('unsupported_rrule_part', `不支持的 RRULE 部分: ${unsupported.join(', ')}`);
    }
    return {
        ok: true,
        schedule: {
            type: 'rrule',
            expr: str.trim(),
            rrule: { freq, interval, byday }
        }
    };
}

/**
 * 校验调度对象是否合法（含最小间隔 15 分钟硬约束）
 * @param {{ type: 'cron'|'rrule', expr: string }} schedule - 调度对象
 * @returns {{ ok: boolean, error?: { code: string, message: string } }}
 */
export function isValidSchedule(schedule) {
    if (!schedule || typeof schedule !== 'object') {
        return { ok: false, error: { code: 'invalid_schedule', message: '调度对象为空' } };
    }
    if (schedule.type !== 'cron' && schedule.type !== 'rrule') {
        return { ok: false, error: { code: 'invalid_schedule_type', message: '调度类型必须为 cron 或 rrule' } };
    }
    const parsed = schedule.type === 'cron' ? parseCron(schedule.expr) : parseRRule(schedule.expr);
    if (!parsed.ok) return parsed;
    // 最小间隔校验：计算前两次运行，若间隔 < 15 分钟则拒绝
    const from = new Date();
    const first = getNextRun(parsed.schedule, from);
    if (!first) {
        return { ok: false, error: { code: 'no_next_run', message: '无法计算下次运行时间' } };
    }
    const second = getNextRun(parsed.schedule, first);
    if (second) {
        const gapMinutes = (second.getTime() - first.getTime()) / MINUTE_MS;
        if (gapMinutes < MINIMUM_INTERVAL_MINUTES) {
            return {
                ok: false,
                error: {
                    code: 'schedule_too_frequent',
                    message: `调度间隔必须 ≥ ${MINIMUM_INTERVAL_MINUTES} 分钟（当前约 ${gapMinutes.toFixed(1)} 分钟）`
                }
            };
        }
    }
    return { ok: true };
}

/**
 * 判断时间点是否匹配 cron
 * @param {object} cron - parseCron 返回的 cron 对象
 * @param {Date} date - 待匹配时间
 * @returns {boolean}
 */
function matchesCron(cron, date) {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();
    const domMatch = cron.dayOfMonth.values.has(dayOfMonth);
    const dowMatch = cron.dayOfWeek.values.has(dayOfWeek);
    // 标准 cron 语义：dayOfMonth 与 dayOfWeek 同时非通配符时取 OR，否则取 AND
    const dayMatch = (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard)
        ? (domMatch || dowMatch)
        : (domMatch && dowMatch);
    return cron.minute.values.has(minute)
        && cron.hour.values.has(hour)
        && cron.month.values.has(month)
        && dayMatch;
}

/**
 * 计算 cron 调度的下次运行时间
 * @param {object} cron - parseCron 返回的 cron 对象
 * @param {Date} from - 基准时间
 * @returns {Date|null} 下次运行时间（严格大于 from），无匹配返回 null
 */
function getNextCronRun(cron, from) {
    const maxLookaheadMs = MAX_LOOKAHEAD_DAYS * DAY_MS;
    const startMs = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    const endMs = from.getTime() + maxLookaheadMs;
    for (let t = startMs; t <= endMs; t += MINUTE_MS) {
        const d = new Date(t);
        if (matchesCron(cron, d)) return d;
    }
    return null;
}

/**
 * 计算 RRULE 调度的下次运行时间
 * @param {object} rrule - parseRRule 返回的 rrule 对象
 * @param {Date} from - 基准时间
 * @returns {Date|null} 下次运行时间（严格大于 from），无匹配返回 null
 */
function getNextRRuleRun(rrule, from) {
    const fromMs = from.getTime();
    const fromDayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();

    if (rrule.freq === 'DAILY') {
        let candidate = fromDayStart + rrule.interval * DAY_MS;
        while (candidate <= fromMs) candidate += rrule.interval * DAY_MS;
        return new Date(candidate);
    }

    if (rrule.freq === 'WEEKLY') {
        const fromDow = from.getDay();
        const weekStart = fromDayStart - fromDow * DAY_MS;
        const bydays = rrule.byday && rrule.byday.length > 0
            ? rrule.byday
            : ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
        const targetDows = bydays.map(d => RRULE_DAY_MAP[d]);
        const maxIter = 7 * 52 * Math.max(1, rrule.interval);
        for (let i = 1; i <= maxIter; i++) {
            const candMs = weekStart + i * DAY_MS;
            const cd = new Date(candMs);
            const candDow = cd.getDay();
            const candWeekStart = candMs - candDow * DAY_MS;
            const weekDiff = Math.round((candWeekStart - weekStart) / (7 * DAY_MS));
            if (weekDiff % rrule.interval === 0 && targetDows.includes(candDow) && candMs > fromMs) {
                return new Date(candMs);
            }
        }
        return null;
    }

    if (rrule.freq === 'MONTHLY') {
        let y = from.getFullYear();
        let m = from.getMonth();
        let candidate = new Date(y, m, 1, 0, 0, 0).getTime();
        let i = 0;
        while (candidate <= fromMs && i < 12 * 50) {
            m += rrule.interval;
            candidate = new Date(y, m, 1, 0, 0, 0).getTime();
            i++;
        }
        return i < 12 * 50 ? new Date(candidate) : null;
    }

    return null;
}

/**
 * 计算下次运行时间
 * @param {{ type: 'cron'|'rrule', expr?: string, cron?: object, rrule?: object }} schedule - 调度对象
 *   - 传入 parseCron/parseRRule 返回的 schedule（含已解析的 cron/rrule 字段）可避免重复解析
 *   - 传入原始 { type, expr } 亦可（内部自动解析）
 * @param {Date} [from=new Date()] - 基准时间
 * @returns {Date|null} 下次运行时间（严格大于 from），无匹配返回 null
 */
export function getNextRun(schedule, from) {
    const base = from || new Date();
    if (!schedule || typeof schedule !== 'object') return null;
    if (schedule.type === 'cron') {
        let cron = schedule.cron;
        if (!cron) {
            const r = parseCron(schedule.expr);
            if (!r.ok) return null;
            cron = r.schedule.cron;
        }
        return getNextCronRun(cron, base);
    }
    if (schedule.type === 'rrule') {
        let rrule = schedule.rrule;
        if (!rrule) {
            const r = parseRRule(schedule.expr);
            if (!r.ok) return null;
            rrule = r.schedule.rrule;
        }
        return getNextRRuleRun(rrule, base);
    }
    return null;
}
