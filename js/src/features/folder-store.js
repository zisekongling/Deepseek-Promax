/**
 * 文件夹管理数据存储与服务层
 *
 * 从 DeepSeek-Enhancer 项目移植，适配油猴脚本环境：
 *   - chrome.storage.local → localStorage
 *   - TypeScript → 纯 JavaScript
 *   - 异步队列 → 同步操作（localStorage 本身同步）
 *
 * 数据模型：
 *   Folder:     { id, name, parentId, order, pinned, createdAt, updatedAt }
 *   FolderItem: { id, folderId, conversationId, title, url, addedAt, order }
 *   FolderData: { folders: Folder[], items: FolderItem[], updatedAt }
 *
 * 层级限制：最多两层（文件夹 > 子文件夹 > 会话）
 *
 * 存储 key：dspro.folders.v1
 */

const STORAGE_KEY = 'dspro.folders.v1';
const MAX_DEPTH = 2; // 最多两层

/**
 * 读取文件夹数据
 * @returns {FolderData}
 */
function readData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { folders: [], items: [], updatedAt: 0 };
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.folders) || !Array.isArray(data.items)) {
            return { folders: [], items: [], updatedAt: 0 };
        }
        return data;
    } catch {
        return { folders: [], items: [], updatedAt: 0 };
    }
}

/**
 * 写入文件夹数据
 * @param {FolderData} data
 */
function writeData(data) {
    data.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 生成唯一 ID
 * @param {string} prefix
 * @param {Set<string>} used
 * @returns {string}
 */
function createUniqueId(prefix, used) {
    let id;
    do {
        const random = (globalThis.crypto?.randomUUID?.() ?? '').slice(0, 8)
                     || Math.random().toString(36).slice(2, 10);
        id = `${prefix}_${random}`;
    } while (used.has(id));
    used.add(id);
    return id;
}

/**
 * 规范化名称（去除首尾空格，非空校验）
 * @param {string} name
 * @returns {string}
 */
function requireName(name) {
    const normalized = (name || '').trim();
    if (!normalized) throw new Error('文件夹名称不能为空');
    return normalized;
}

/**
 * 查找文件夹（不存在则抛错）
 * @param {FolderData} data
 * @param {string} folderId
 * @returns {Folder}
 */
function requireFolder(data, folderId) {
    const folder = data.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`文件夹不存在: ${folderId}`);
    return folder;
}

/** 文件夹服务对象 */
export const FolderStore = {
    /**
     * 获取全部文件夹数据
     * @returns {FolderData}
     */
    getData() {
        return readData();
    },

    /**
     * 创建文件夹
     * @param {string} name - 文件夹名称
     * @param {string|null} parentId - 父文件夹 ID（null 表示顶层）
     * @returns {FolderData}
     */
    createFolder(name, parentId = null) {
        const data = readData();
        const normalizedName = requireName(name);
        if (parentId) {
            const parent = requireFolder(data, parentId);
            if (parent.parentId) throw new Error('最多支持两层文件夹');
        }
        const now = Date.now();
        data.folders.push({
            id: createUniqueId('folder', new Set(data.folders.map(f => f.id))),
            name: normalizedName,
            parentId,
            order: data.folders.filter(f => f.parentId === parentId).length,
            pinned: false,
            createdAt: now,
            updatedAt: now,
        });
        writeData(data);
        return data;
    },

    /**
     * 重命名文件夹
     * @param {string} folderId
     * @param {string} name
     * @returns {FolderData}
     */
    renameFolder(folderId, name) {
        const data = readData();
        const folder = requireFolder(data, folderId);
        const normalizedName = requireName(name);
        if (folder.name === normalizedName) return data;
        folder.name = normalizedName;
        folder.updatedAt = Date.now();
        writeData(data);
        return data;
    },

    /**
     * 删除文件夹（级联删除子文件夹和关联会话项）
     * @param {string} folderId
     * @returns {FolderData}
     */
    deleteFolder(folderId) {
        const data = readData();
        requireFolder(data, folderId);
        const deleted = new Set([folderId]);
        for (const folder of data.folders) {
            if (folder.parentId === folderId) deleted.add(folder.id);
        }
        data.folders = data.folders.filter(f => !deleted.has(f.id));
        data.items = data.items.filter(item => !deleted.has(item.folderId));
        writeData(data);
        return data;
    },

    /**
     * 添加会话到文件夹
     * @param {string} folderId
     * @param {{id:string, title:string, url:string}} conversation
     * @returns {FolderData}
     */
    addConversation(folderId, conversation) {
        const data = readData();
        requireFolder(data, folderId);
        const existing = new Set(
            data.items.filter(i => i.folderId === folderId).map(i => i.conversationId)
        );
        if (existing.has(conversation.id)) return data;
        data.items.push({
            id: createUniqueId('item', new Set(data.items.map(i => i.id))),
            folderId,
            conversationId: conversation.id,
            title: (conversation.title || '').trim() || '未命名对话',
            url: conversation.url,
            addedAt: Date.now(),
            order: data.items.filter(i => i.folderId === folderId).length,
        });
        writeData(data);
        return data;
    },

    /**
     * 从文件夹中移除会话
     * @param {string} itemId
     * @returns {FolderData}
     */
    removeConversation(itemId) {
        const data = readData();
        data.items = data.items.filter(i => i.id !== itemId);
        writeData(data);
        return data;
    },

    /**
     * 移动/复制会话到另一个文件夹
     * @param {string} itemId
     * @param {string} targetFolderId
     * @param {'move'|'copy'} action
     * @returns {FolderData}
     */
    transferConversation(itemId, targetFolderId, action) {
        const data = readData();
        requireFolder(data, targetFolderId);
        const source = data.items.find(i => i.id === itemId);
        if (!source) throw new Error(`会话项不存在: ${itemId}`);
        if (source.folderId === targetFolderId) return data;
        const existsInTarget = data.items.some(
            i => i.folderId === targetFolderId && i.conversationId === source.conversationId
        );
        if (!existsInTarget) {
            data.items.push({
                ...source,
                id: createUniqueId('item', new Set(data.items.map(i => i.id))),
                folderId: targetFolderId,
                addedAt: Date.now(),
                order: data.items.filter(i => i.folderId === targetFolderId).length,
            });
        }
        if (action === 'move') {
            data.items = data.items.filter(i => i.id !== itemId);
        }
        writeData(data);
        return data;
    },

    /**
     * 切换文件夹置顶状态
     * @param {string} folderId
     * @returns {FolderData}
     */
    togglePin(folderId) {
        const data = readData();
        const folder = requireFolder(data, folderId);
        folder.pinned = !folder.pinned;
        folder.updatedAt = Date.now();
        writeData(data);
        return data;
    },

    /**
     * 导出文件夹数据
     * @returns {object}
     */
    exportData() {
        return {
            format: 'dspro.folders.v1',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            data: readData(),
        };
    },

    /**
     * 导入文件夹数据
     * @param {object} payload
     * @param {'merge'|'overwrite'} strategy
     * @returns {FolderData}
     */
    importData(payload, strategy) {
        if (!payload?.data?.folders || !payload?.data?.items) {
            throw new Error('无效的导入数据格式');
        }
        if (strategy === 'overwrite') {
            writeData(JSON.parse(JSON.stringify(payload.data)));
            return payload.data;
        }
        // merge 策略
        const current = readData();
        const imported = payload.data;
        const foldersById = new Map(current.folders.map(f => [f.id, f]));
        const usedFolderIds = new Set(foldersById.keys());
        for (const folder of imported.folders) {
            if (!foldersById.has(folder.id)) {
                const id = createUniqueId('folder', usedFolderIds);
                usedFolderIds.add(id);
                current.folders.push({ ...folder, id });
            }
        }
        const itemKeys = new Set(current.items.map(i => `${i.folderId}:${i.conversationId}`));
        const itemIds = new Set(current.items.map(i => i.id));
        for (const item of imported.items) {
            const key = `${item.folderId}:${item.conversationId}`;
            if (!itemKeys.has(key)) {
                const id = createUniqueId('item', itemIds);
                itemIds.add(id);
                current.items.push({ ...item, id });
            }
        }
        writeData(current);
        return current;
    },

    /**
     * 清空所有文件夹数据
     * @returns {FolderData}
     */
    clearAll() {
        const empty = { folders: [], items: [], updatedAt: Date.now() };
        writeData(empty);
        return empty;
    },
};
