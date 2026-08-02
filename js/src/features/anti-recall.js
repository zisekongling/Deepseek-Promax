/**
 * 防撤回模块（XHR 拦截）
 *
 * 通过拦截 XMLHttpRequest 的 response/responseText getter，
 * 实时检测被撤回的回复并替换为本地缓存的存档内容。
 * 支持 SSE 流式响应和历史消息两种场景。
 */
import { CONFIG } from '../config.js';
import { Store, handleBiz, findBizPayload } from './data-store.js';

const TEMPLATE_RESPONSE = "TEMPLATE_RESPONSE";
const CONTENT_FILTER = "CONTENT_FILTER";
const RECALL_TIP_EN = "⚠️ This response has been is blocked and archived only on this browser";
const RECALL_TIP_CH = "⚠️ 此回复已被拦截，仅在本浏览器存档";
const RECALL_NOT_FOUND_EN = "⛔️ This response has been blocked and cannot be found in local cache.";
const RECALL_NOT_FOUND_CH = "⛔️ 此回复已被拦截，且无法在本地缓存中找到";

function getRecalledTipMessage(locale) {
    return locale == "zh_CN" ? RECALL_TIP_CH : RECALL_TIP_EN;
}

function getRecallNotFoundMessage(locale) {
    return locale == "zh_CN" ? RECALL_NOT_FOUND_CH : RECALL_NOT_FOUND_EN;
}

function _getKey(sessId, msgId) {
    return "deleted-chat-sess-" + sessId + "-msg-" + msgId;
}

function _parseKey(key, container) {
    if (Array.isArray(container) && key.match(/^[-+]?\d+$/)) {
        let int = parseInt(key);
        if (int < 0) {
            int = container.length + int;
        }
        return int;
    }
    return key;
}

function _setValueByPath(obj, path, value, isAppend) {
    const keys = path.split("/");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        let key = _parseKey(keys[i], current);

        if (!(key in current)) {
            const nextKey = _parseKey(keys[i + 1], current);
            current[key] = typeof nextKey === 'number' ? [] : {};
        }

        current = current[key];
    }

    const lastKey = _parseKey(keys[keys.length - 1], current);

    let lastVal = current[lastKey];
    if (isAppend) {
        if (Array.isArray(current[lastKey])) {
            for (let k = 0; k < value.length; k++) {
                current[lastKey].push(value[k]);
            }
        } else {
            current[lastKey] = lastVal + value;
        }
    } else {
        current[lastKey] = value;
    }
    return obj;
}

function DSState() {
    this.fields = {};
    this.sessId = "";
    this.locale = "en_US";
    this.recalled = false;
    this._updatePath = "";
    this._updateMode = "SET";
}

DSState.prototype.update = function(data) {
    let precheck = this.preCheck(data);
    if (data.p) {
        this._updatePath = data.p;
    }
    if (data.o) {
        this._updateMode = data.o;
    }
    let value = data.v;
    if (typeof value == 'object' && this._updatePath == "") {
        for (var key in value) {
            this.fields[key] = value[key];
        }
        return precheck;
    }
    this.setField(this._updatePath, value, this._updateMode);
    return precheck;
}

DSState.prototype.preCheck = function(data) {
    let path = data.p ? data.p : this._updatePath;
    let mode = data.o ? data.o : this._updateMode;
    let modified = false;
    if (mode == "BATCH" && path == "response") {
        for (let i = 0; i < data.v.length; i++) {
            let v = data.v[i];
            if (v.p == "fragments" && v.v[0].type == TEMPLATE_RESPONSE) {
                modified = true;
                data.v[i] = {"v": [{"id": this.fields.response.fragments.length + 1, "type": "TIP", "style": "WARNING", "content": getRecalledTipMessage(this.locale)}], "p": "fragments", "o": "APPEND"};
            }
            if (v.p == "status" && v.v == CONTENT_FILTER) {
                modified = true;
                data.v[i] = {"p": "status", "v": "FINISHED"};
            }
        }
    }
    if (modified) {
        this.recalled = true;
        saveRecalledMessage(this.sessId, this.fields.response.message_id, this.fields.response.fragments);
        return JSON.stringify(data);
    }
    return "";
}

DSState.prototype.setField = function(path, value, mode) {
    if (mode == "BATCH") {
        let subMode = "SET";
        for (let i = 0; i < value.length; i++) {
            let v = value[i];
            if (v.o) {
                subMode = v.o;
            }
            this.setField(path + "/" + v.p, v.v, subMode);
        }
    } else if (mode == "SET") {
        _setValueByPath(this.fields, path, value, false);
    } else if (mode == "APPEND") {
        _setValueByPath(this.fields, path, value, true);
    }
};

function saveRecalledMessage(sessId, msgId, fragments) {
    localStorage.setItem(_getKey(sessId, msgId), JSON.stringify(fragments));
}

function getRecalledMessage(req, sessId, msgId) {
    let frags = JSON.parse(localStorage.getItem(_getKey(sessId, msgId)));
    if (!frags) {
        return [{content: getRecallNotFoundMessage(req.__locale), id: 2, type: TEMPLATE_RESPONSE}];
    }
    frags.push({"id": frags.length + 1, "type": "TIP", "style": "WARNING", "content": getRecalledTipMessage(req.__locale)});
    return frags;
}

function handleEventItem(req, msg) {
    if (!msg.v) {
        return "";
    }
    return req.__dsState.update(msg);
}

function onEventStreamResp(req, res) {
    if (req.__messagesCount === undefined) {
        req.__messagesCount = 0;
        req.__dsState = new DSState();
        req.__dsState.sessId = req.__sessId;
        req.__dsState.locale = req.__locale;
    }
    let lastMessageCount = req.__messagesCount;
    let messages = res.split("\n");
    for (let i = lastMessageCount; i < messages.length - 1; i++) {
        let msg = messages[i];
        let data = {};
        req.__messagesCount++;
        if (!msg.startsWith("data: ")) {
            continue;
        }
        data = JSON.parse(msg.replace("data:", ""));
        let handleRes = handleEventItem(req, data);
        if (handleRes != "") {
            messages[i] = "data: " + handleRes;
        }
    }
    if (req.__dsState.recalled) {
        let res2 = "";
        for (let l = 0; l < messages.length; l++) {
            res2 += messages[l] + "\n";
        }
        return res2;
    }
    return res;
}

function onHistoryMessageResp(req, res) {
    let json = JSON.parse(res);
    if (!json.data || !json.data.biz_data) {
        return res;
    }
    let data = json.data.biz_data;

    // 数据捕获：将对话数据保存到 Store，供导出功能使用
    try { handleBiz(data); } catch(e) {}

    let sessId = data.chat_session.id;
    let modified = false;
    // 防撤回：将被拦截的消息替换为本地缓存的存档内容
    if (CONFIG.antiRecallEnabled) {
        for (let i = 0; i < data.chat_messages.length; i++) {
            if (data.chat_messages[i].status == CONTENT_FILTER) {
                data.chat_messages[i].fragments = getRecalledMessage(req, sessId, data.chat_messages[i].message_id);
                data.chat_messages[i].status = "FINISHED";
                modified = true;
            }
        }
    }
    if (modified) {
        json.data.biz_data = data;
        res = JSON.stringify(json);
    }
    return res;
}

function onResponse(req) {
    let origRes = req.getOriginalResponse();
    if (req.__reqType == "history" && req.readyState == 4) {
        return onHistoryMessageResp(req, origRes);
    } else if (req.__reqType == "generate" && CONFIG.antiRecallEnabled) {
        return onEventStreamResp(req, origRes);
    }
    return origRes;
}

let xhrHookInstalled = false;

/**
 * 安装 XHR 钩子，拦截 response/responseText
 * 同时支持：防撤回、系统提示词注入、对话数据捕获
 * 防止重复安装：Object.defineProperty 第二次调用会因属性不可配置而抛出 TypeError
 */
export function installXhrHook() {
    if (xhrHookInstalled) return;
    xhrHookInstalled = true;
    let originXhrResponse = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
    let originXhrResponseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
    let originXhrOpen = XMLHttpRequest.prototype.open;
    let originXhrSend = XMLHttpRequest.prototype.send;
    let originXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    Object.defineProperty(XMLHttpRequest.prototype, "response", {
        get: function() {
            if (!this.__reqType) {
                return originXhrResponse.get.call(this);
            }
            return onResponse(this);
        },
        set: function(body) {
            return originXhrResponse.set.call(this, body);
        }
    });

    Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
        get: function() {
            if (!this.__reqType) {
                return originXhrResponseText.get.call(this);
            }
            return onResponse(this);
        },
        set: function(body) {
            return originXhrResponseText.set.call(this, body);
        }
    });

    XMLHttpRequest.prototype.getOriginalResponse = function() {
        return originXhrResponse.get.call(this);
    }

    XMLHttpRequest.prototype.open = function(method, url) {
        let [urlPath] = url.split("?");
        if (urlPath == '/api/v0/chat/history_messages') {
            this.__reqType = "history";
        } else if (urlPath == '/api/v0/chat/completion' || urlPath == '/api/v0/chat/edit_message' || urlPath == '/api/v0/chat/regenerate' ||
                   urlPath == '/api/v0/chat/continue' || urlPath == '/api/v0/chat/resume_stream') {
            this.__reqType = "generate";
        }
        return originXhrOpen.apply(this, arguments);
    }

    XMLHttpRequest.prototype.send = function(body) {
        if (!this.__reqType) {
            return originXhrSend.apply(this, arguments);
        }
        if (this.__reqType == "generate") {
            try {
                let bodyJson = JSON.parse(body);
                this.__sessId = bodyJson.chat_session_id;
                // 系统提示词注入：在用户 prompt 前插入系统指令
                if (CONFIG.promptInjectEnabled && CONFIG.promptText && bodyJson.prompt) {
                    bodyJson.prompt = '[系统指令]\n' + CONFIG.promptText + '\n[/系统指令]\n\n' + bodyJson.prompt;
                    arguments[0] = JSON.stringify(bodyJson);
                }
            } catch(e) {}
        }
        return originXhrSend.apply(this, arguments);
    }

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (!this.__reqType) {
            return originXhrSetRequestHeader.apply(this, arguments);
        }
        if (header == "x-client-locale") {
            this.__locale = value;
        }
        return originXhrSetRequestHeader.apply(this, arguments);
    }
}
