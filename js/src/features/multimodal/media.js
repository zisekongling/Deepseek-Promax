/**
 * @module multimodal/media
 * @description 图片附件处理模块
 *
 * 职责：
 *   - pickImage()：触发文件选择对话框，选取一张或多张图片
 *   - pasteImage(event)：从 ClipboardEvent 提取图片并加入附件列表
 *   - fileToBase64(file)：File 转 base64 data URL
 *   - compressImage(file, maxSize?)：大图压缩（Canvas 主线程重绘，默认 1024x1024 / quality 0.8）
 *   - getAttachedImages() / clearAttachedImages() / removeImage(id)：附件内存管理
 *
 * 内存策略：
 *   - 附件图片仅暂存内存数组（attachedImages），不持久化到 localStorage
 *   - 页面刷新后自动清空，避免占用持久化存储配额
 *   - dataUrl 与 base64Data 同时保留，供 OpenAI（image_url.url=dataUrl）与 Gemini（inline_data.data=base64Data）使用
 *
 * 环境约束：
 *   - 图片压缩在主线程 Canvas 完成（油猴环境无 Worker）
 *   - 大图压缩避免阻塞过久：先通过 createImageBitmap/Image 异步解码，再 Canvas 绘制
 *
 * 参考实现：deepseek-pp/core/multimodal/media.ts（MultimodalMediaInput 结构）
 */

// ============================================================
// 常量
// ============================================================

/** 压缩默认最大边长（像素） */
const DEFAULT_MAX_SIZE = 1024;
/** 压缩默认质量（0-1，仅对 jpeg/webp 生效） */
const DEFAULT_QUALITY = 0.8;
/** 单张图片原始大小上限（8MB，超过则拒绝） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 压缩后输出 MIME 类型（统一 jpeg 以减小体积；透明图保留 png） */
const COMPRESS_MIME = 'image/jpeg';
const PNG_MIME = 'image/png';

// ============================================================
// 内存附件列表
// ============================================================

/**
 * 附加图片内存列表
 * @type {Array<{id:string, name:string, mimeType:string, size:number, dataUrl:string, base64Data:string, width:number, height:number}>}
 */
const attachedImages = [];

/** 自增 id 计数器 */
let idCounter = 0;

/**
 * 生成唯一图片 id
 * @returns {string}
 */
function genId() {
    idCounter += 1;
    return 'img_' + Date.now().toString(36) + '_' + idCounter.toString(36);
}

// ============================================================
// File → base64
// ============================================================

/**
 * 将 File 转为 base64 data URL
 *
 * @param {File|Blob} file - 文件对象
 * @returns {Promise<string>} data URL（如 data:image/png;base64,xxxx）
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        if (!file || typeof file === 'undefined') {
            reject(new Error('file 为空'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('FileReader 读取失败'));
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string' && result.length > 0) {
                resolve(result);
            } else {
                reject(new Error('FileReader 返回空结果'));
            }
        };
        reader.readAsDataURL(file);
    });
}

/**
 * 从 data URL 中提取纯 base64 数据（去掉 data:xxx;base64, 前缀）
 *
 * @param {string} dataUrl - data URL
 * @returns {string} 纯 base64 字符串
 */
export function extractBase64Data(dataUrl) {
    if (typeof dataUrl !== 'string') return '';
    const idx = dataUrl.indexOf(',');
    return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * 从 data URL 中提取 MIME 类型
 *
 * @param {string} dataUrl - data URL
 * @returns {string} MIME 类型（如 image/png），解析失败返回 image/jpeg
 */
export function extractMimeType(dataUrl) {
    if (typeof dataUrl !== 'string') return COMPRESS_MIME;
    const m = dataUrl.match(/^data:([^;,]+);base64/);
    return m ? m[1] : COMPRESS_MIME;
}

// ============================================================
// 图片压缩（主线程 Canvas）
// ============================================================

/**
 * 压缩图片：按最大边长缩放，Canvas 重绘后输出为新的 File
 *
 * 策略：
 *   - 若原图尺寸均 <= maxSize 且体积 < 1MB，直接返回原文件（避免无谓重编码）
 *   - 否则等比缩放到 maxSize 内，绘制到 Canvas，toBlob 输出 jpeg（透明图保留 png）
 *   - 压缩在主线程 Canvas 完成（油猴环境无 Worker）
 *
 * @param {File} file - 原始图片文件
 * @param {number} [maxSize=1024] - 最大边长（像素）
 * @param {number} [quality=0.8] - 压缩质量（0-1）
 * @returns {Promise<File>} 压缩后的 File（含正确 mimeType）
 */
export async function compressImage(file, maxSize = DEFAULT_MAX_SIZE, quality = DEFAULT_QUALITY) {
    if (!file) throw new Error('compressImage: file 为空');
    // 非图片直接返回
    if (!file.type || !file.type.startsWith('image/')) {
        throw new Error('compressImage: 仅支持图片文件');
    }

    // 解码图片获取原始尺寸
    const bitmap = await decodeImage(file);
    const { width: ow, height: oh } = bitmap;
    // 原图较小且体积不大时直接返回，避免重编码损失
    if (ow <= maxSize && oh <= maxSize && file.size < 1024 * 1024) {
        releaseBitmap(bitmap);
        return file;
    }

    // 等比缩放
    const scale = Math.min(maxSize / ow, maxSize / oh, 1);
    const tw = Math.max(1, Math.round(ow * scale));
    const th = Math.max(1, Math.round(oh * scale));

    // 绘制到 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        releaseBitmap(bitmap);
        throw new Error('compressImage: Canvas 2D 上下文不可用');
    }
    // 白底（避免 jpeg 黑底），仅在输出 jpeg 时需要
    const outMime = (file.type === PNG_MIME) ? PNG_MIME : COMPRESS_MIME;
    if (outMime === COMPRESS_MIME) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
    }
    drawToCanvas(ctx, bitmap, tw, th);
    releaseBitmap(bitmap);

    // toBlob 输出
    const blob = await canvasToBlob(canvas, outMime, quality);
    const safeName = ensureExtension(file.name, outMime);
    return new File([blob], safeName, { type: outMime, lastModified: Date.now() });
}

/**
 * 解码图片为可绘制对象（优先 createImageBitmap，回退 HTMLImageElement）
 *
 * @param {File} file - 图片文件
 * @returns {Promise<ImageBitmap|HTMLImageElement>} 可绘制对象（含 width/height）
 */
async function decodeImage(file) {
    // 优先 createImageBitmap（性能更好，且不污染 DOM）
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file);
            return bitmap;
        } catch (e) {
            // 回退到 Image 元素
        }
    }
    // 回退：HTMLImageElement
    const dataUrl = await fileToBase64(file);
    return await loadImageElement(dataUrl);
}

/**
 * 通过 Image 元素加载 data URL
 *
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image 解码失败'));
        img.src = dataUrl;
    });
}

/**
 * 将位图绘制到 Canvas（兼容 ImageBitmap 与 HTMLImageElement）
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ImageBitmap|HTMLImageElement} bitmap
 * @param {number} tw - 目标宽
 * @param {number} th - 目标高
 */
function drawToCanvas(ctx, bitmap, tw, th) {
    try {
        ctx.drawImage(/** @type {CanvasImageSource} */ (bitmap), 0, 0, tw, th);
    } catch (e) {
        // drawImage 失败时直接抛出
        throw new Error('Canvas drawImage 失败：' + (e && e.message || String(e)));
    }
}

/**
 * 释放位图资源（仅 ImageBitmap 需要 close）
 *
 * @param {ImageBitmap|HTMLImageElement} bitmap
 */
function releaseBitmap(bitmap) {
    if (bitmap && typeof bitmap.close === 'function') {
        try { bitmap.close(); } catch (e) {}
    }
}

/**
 * Canvas 转 Blob
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob 返回空'));
        }, mimeType, quality);
    });
}

/**
 * 确保文件名具有与输出 MIME 匹配的扩展名
 *
 * @param {string} name - 原始文件名
 * @param {string} mimeType - 输出 MIME
 * @returns {string}
 */
function ensureExtension(name, mimeType) {
    const baseName = (name && typeof name === 'string') ? name : 'image';
    const ext = mimeType === PNG_MIME ? 'png' : 'jpg';
    const dot = baseName.lastIndexOf('.');
    if (dot > 0) {
        return baseName.slice(0, dot) + '.' + ext;
    }
    return baseName + '.' + ext;
}

// ============================================================
// 附件管理
// ============================================================

/**
 * 将一个 File 添加到附件列表（自动压缩 + 转 base64）
 *
 * @param {File} file - 图片文件
 * @param {number} [maxSize] - 压缩最大边长
 * @returns {Promise<Object>} 添加成功的附件对象
 */
export async function addImageFromFile(file, maxSize) {
    if (!file) throw new Error('addImageFromFile: file 为空');
    if (!file.type || !file.type.startsWith('image/')) {
        throw new Error('仅支持图片文件：' + (file.name || ''));
    }
    if (file.size > MAX_IMAGE_BYTES) {
        throw new Error('图片过大（' + (file.size / 1024 / 1024).toFixed(1) + 'MB），上限 8MB');
    }

    // 压缩
    const compressed = await compressImage(file, maxSize);
    const dataUrl = await fileToBase64(compressed);
    const base64Data = extractBase64Data(dataUrl);
    const mimeType = extractMimeType(dataUrl);

    // 读取压缩后尺寸（用于展示/调试）
    let width = 0, height = 0;
    try {
        const img = await loadImageElement(dataUrl);
        width = img.naturalWidth || 0;
        height = img.naturalHeight || 0;
    } catch (e) {
        // 尺寸读取失败不影响主流程
    }

    const item = {
        id: genId(),
        name: compressed.name || file.name || 'image',
        mimeType,
        size: compressed.size,
        dataUrl,
        base64Data,
        width,
        height
    };
    attachedImages.push(item);
    return item;
}

/**
 * 触发文件选择对话框，选取一张或多张图片
 *
 * 内部创建隐藏的 <input type="file" accept="image/*" multiple>，
 * 用户选择后逐张压缩并入附件列表。
 *
 * @param {Object} [opts] - 选项
 * @param {number} [opts.maxSize] - 压缩最大边长
 * @param {number} [opts.maxImages] - 附件数量上限（超出部分忽略并提示）
 * @returns {Promise<Array<Object>>} 新增的附件对象数组
 */
export function pickImage(opts = {}) {
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            reject(new Error('pickImage: document 不可用'));
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.opacity = '0';
        input.addEventListener('change', async () => {
            const files = Array.from(input.files || []);
            // 清理 DOM
            if (input.parentNode) input.parentNode.removeChild(input);
            if (files.length === 0) {
                resolve([]);
                return;
            }
            const limit = (typeof opts.maxImages === 'number' && opts.maxImages > 0) ? opts.maxImages : Infinity;
            const room = Math.max(0, limit - attachedImages.length);
            const toAdd = files.slice(0, room);
            const added = [];
            for (const f of toAdd) {
                try {
                    const item = await addImageFromFile(f, opts.maxSize);
                    added.push(item);
                } catch (e) {
                    // 单张失败不影响其他图片
                    console.warn('[multimodal/media] addImageFromFile failed:', e && e.message);
                }
            }
            resolve(added);
        });
        // 取消选择
        input.addEventListener('cancel', () => {
            if (input.parentNode) input.parentNode.removeChild(input);
            resolve([]);
        });
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * 从 ClipboardEvent 提取图片并加入附件列表
 *
 * 遍历 clipboardData.items，筛选 image/* 类型，逐张压缩入列表。
 * 返回新增的附件数组（同步签名但内部异步处理，通过回调或 Promise 通知）。
 *
 * @param {ClipboardEvent} event - 粘贴事件
 * @param {Object} [opts] - 选项
 * @param {number} [opts.maxSize] - 压缩最大边长
 * @param {number} [opts.maxImages] - 附件数量上限
 * @returns {Promise<Array<Object>>} 新增的附件对象数组
 */
export async function pasteImage(event, opts = {}) {
    if (!event || !event.clipboardData) return [];
    const items = event.clipboardData.items;
    if (!items) return [];
    const files = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) files.push(f);
        }
    }
    if (files.length === 0) return [];
    const limit = (typeof opts.maxImages === 'number' && opts.maxImages > 0) ? opts.maxImages : Infinity;
    const room = Math.max(0, limit - attachedImages.length);
    const toAdd = files.slice(0, room);
    const added = [];
    for (const f of toAdd) {
        try {
            const item = await addImageFromFile(f, opts.maxSize);
            added.push(item);
        } catch (e) {
            console.warn('[multimodal/media] paste addImageFromFile failed:', e && e.message);
        }
    }
    return added;
}

/**
 * 获取当前附件图片列表（浅拷贝，调用方不应修改内部对象）
 *
 * @returns {Array<Object>} 附件对象数组
 */
export function getAttachedImages() {
    return attachedImages.slice();
}

/**
 * 按 id 移除指定附件图片
 *
 * @param {string} id - 图片 id
 * @returns {boolean} 是否移除成功
 */
export function removeImage(id) {
    const idx = attachedImages.findIndex(img => img.id === id);
    if (idx < 0) return false;
    attachedImages.splice(idx, 1);
    return true;
}

/**
 * 清空所有附件图片
 */
export function clearAttachedImages() {
    attachedImages.length = 0;
}

/**
 * 获取附件图片数量
 *
 * @returns {number}
 */
export function getAttachedCount() {
    return attachedImages.length;
}
