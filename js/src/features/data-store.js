/**
 * 对话数据存储模块（Store）
 *
 * 从 XHR/Fetch 响应中捕获 DeepSeek 对话数据，供导出功能使用。
 * 数据来源：
 *   - /api/v0/chat/history_messages（历史消息列表）
 *   - /api/v0/chat/completion 等（生成消息）
 *
 * 数据结构：
 *   { msgs: [], sid: '', aid: '', title: '' }
 */
import { CONFIG } from '../config.js';

/** 从 URL 中提取会话 ID */
export function getSidFromUrl() {
    const m = location.href.match(/\/chat\/s\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
}

/** 在嵌套对象中查找包含 chat_messages 的业务数据负载 */
export function findBizPayload(v, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 7) return null;
    if (Array.isArray(v.chat_messages) && v.chat_messages.length > 0) return v;
    for (const item of (Array.isArray(v) ? v : Object.values(v))) {
        const found = findBizPayload(item, depth + 1);
        if (found) return found;
    }
    return null;
}

/** 内部数据状态 */
const _data = { msgs: [], sid: null, aid: null, title: '' };
const _listeners = [];

/** Store 对象 */
export const Store = {
    /**
     * 更新数据并通知监听器
     * @param {Object} p - 部分数据
     */
    update(p) {
        Object.assign(_data, p);
        _listeners.forEach(fn => { try { fn({..._data}); } catch(e) {} });
    },

    /** 获取当前数据副本 */
    get() { return {..._data}; },

    /** 是否已有数据 */
    hasData() { return _data.msgs.length > 0; },

    /**
     * 注册数据更新监听器
     * @param {Function} fn - 回调函数
     * @returns {Function} 取消监听函数
     */
    onData(fn) {
        _listeners.push(fn);
        return () => {
            const i = _listeners.indexOf(fn);
            if (i >= 0) _listeners.splice(i, 1);
        };
    },

    /** 清空数据（切换对话时调用） */
    clear() {
        _data.msgs = [];
        _data.sid = null;
        _data.aid = null;
        _data.title = '';
    }
};

/**
 * 处理从 API 响应中提取的业务数据，更新 Store
 * @param {Object} biz - 包含 chat_messages 的业务数据
 */
export function handleBiz(biz) {
    biz = findBizPayload(biz) || biz;
    if (!biz?.chat_messages?.length) return;
    const sid = biz.chat_session?.id || biz.chat_session_id || biz.session_id || getSidFromUrl() || _data.sid || '';
    const aid = biz.chat_session?.current_message_id || biz.current_message_id || biz.message_id || '';
    const title = biz.chat_session?.title || biz.title || document.title.replace(/\s*-\s*DeepSeek.*/i, '') || '';
    Store.update({ msgs: biz.chat_messages, sid, aid, title });
}

/**
 * 切换对话时重置 Store 并尝试从 IndexedDB 恢复数据
 * @param {string} targetSid - 目标会话 ID
 */
export async function tryReadIDB(targetSid) {
    const sid = targetSid || _data.sid || getSidFromUrl();
    if (_data.msgs.length > 0 || !sid || !indexedDB.databases) return;
    const find = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 8) return null;
        if (v.chat_session?.id === sid && v.chat_messages?.length > 0) return v;
        for (const item of (Array.isArray(v)?v:Object.values(v))) { const r = find(item, depth+1); if (r) return r; }
        return null;
    };
    try {
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
            for (const store of db.objectStoreNames) {
                const recs = await new Promise(res => { const o=[], r=db.transaction(store,'readonly').objectStore(store).openCursor(); r.onsuccess=e=>{const c=e.target.result;if(!c)return res(o);o.push(c.value);c.continue();};r.onerror=()=>res(o); });
                for (const v of recs) { const f = find(v,0); if (f) { handleBiz(f); db.close(); return; } }
            }
            db.close();
        }
    } catch(e) {}
}
