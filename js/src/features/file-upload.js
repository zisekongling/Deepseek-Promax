/**
 * @module features/file-upload
 * @description 专家模式文件上传模块
 *
 * 职责：
 *   - 检测当前对话模式是否为专家模式（[data-model-type="expert"] + aria-checked="true"）
 *   - 在发送栏左侧注入文件上传按钮
 *   - 上传文件后，在输入框上方渲染文件卡片列表
 *   - 读取文件内容，发送时通过 prompt 注入器将文件名和内容注入到 prompt 前缀
 *   - 使用 MutationObserver 保持按钮和卡片在 DOM 重绘后存活
 *
 * 与其他模块的关系：
 *   - 复用 default-mode.js 的 DOM 契约（[data-model-type="expert"] + aria-checked）
 *   - prompt 注入通过 window._dsFileUploadInjector 注册，由 prompt-augmentation.js 调用
 *   - 配置项 fileUploadEnabled 由 config.js 管理，设置面板在「对话增强」中控制
 */

import { CONFIG } from '../config.js';

// ============================================================
// 常量
// ============================================================

/** 注入按钮容器 id */
const BUTTON_ID = 'ds-expert-file-upload-btn';
/** 文件输入 id */
const FILE_INPUT_ID = 'ds-expert-file-input';
/** 文件卡片容器 id */
const CARDS_CONTAINER_ID = 'ds-expert-file-cards';
/** 上传区域（注入到 textarea 上方）的 id */
const UPLOAD_AREA_ID = 'ds-expert-upload-area';

/** 单文件大小上限（10MB） */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 文本文件内容读取上限（500KB，超过此值不读取内容，仅传文件名） */
const MAX_TEXT_READ_BYTES = 500 * 1024;

/** prompt 注入标签 */
const FILES_PROMPT_START = '[上传文件]';
const FILES_PROMPT_END = '[/上传文件]';

// ============================================================
// 文件存储结构
// ============================================================

/**
 * 已上传文件列表
 * @type {Array<{id: string, file: File, name: string, size: number, ext: string, content: string|null, readError: string|null}>}
 */
const uploadedFiles = [];

/** 自增 id */
let idCounter = 0;

/** 模块是否已初始化 */
let installed = false;

/** 拖拽遮罩层 id */
const DRAG_OVERLAY_ID = 'ds-expert-drag-overlay';

/** 拖拽计数器（解决子元素 dragenter/dragleave 冒泡问题） */
let dragCounter = 0;

/** 观察者引用 */
let buttonObserver = null;
let modeAttrObserver = null;

// ============================================================
// 专家模式检测
// ============================================================

/**
 * 检测 DeepSeek 是否处于专家模式
 * 检测方式（任一满足即为专家模式）：
 *   1. 原生专家模式按钮：[data-model-type="expert"] + aria-checked="true"
 *   2. 自定义专家模式指示器：._9fcbeda._7ee190f 容器已渲染（含"星璃问候主人"等自定义名称）
 * @returns {boolean}
 */
function isExpertModeActive() {
    try {
        // 方式1：原生专家模式按钮
        const btn = document.querySelector('[data-model-type="expert"]');
        if (btn && btn.getAttribute('aria-checked') === 'true') return true;

        // 方式2：自定义专家模式指示器容器已渲染
        // 结构：._9fcbeda._7ee190f > .afa34042.e0a1edb7.e37a04e4._5a50d80（含自定义名称）+ .c03d486a（含专家模式图标）
        const customIndicator = document.querySelector('._9fcbeda._7ee190f');
        if (customIndicator) return true;

        return false;
    } catch (e) {
        return false;
    }
}

/**
 * 文件上传功能是否启用（配置开关 + 专家模式）
 * @returns {boolean}
 */
function isUploadEnabled() {
    const cfg = (typeof window !== 'undefined' && window.__dsConfig) ? window.__dsConfig : CONFIG;
    return !!(cfg.fileUploadEnabled && isExpertModeActive());
}

// ============================================================
// 文件扩展名工具
// ============================================================

/**
 * 获取文件扩展名（不含点号），统一小写
 * @param {string} fileName
 * @returns {string}
 */
function getFileExt(fileName) {
    const idx = fileName.lastIndexOf('.');
    return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase();
}

/**
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ============================================================
// 文本文件检测
// ============================================================

/** 文本文件扩展名集合（常见编程/配置/文档类型） */
const textExts = new Set([
    'txt', 'md', 'csv', 'tsv', 'html', 'htm', 'json', 'log', 'yaml', 'yml', 'ini', 'conf', 'toml',
    'xml', 'svg', 'xhtml', 'rss', 'atom',
    'go', 'h', 'c', 'cpp', 'cxx', 'cc', 'hpp', 'hxx', 'cs', 'java', 'js', 'jsx', 'mjs', 'cjs',
    'css', 'scss', 'less', 'sass', 'jsp', 'php', 'py', 'py3', 'pyw', 'pyi', 'pyx', 'pxd', 'pxi',
    'ts', 'tsx', 'cts', 'mts', 'rs', 'swift', 'kt', 'kts', 'scala', 'rb', 'lua', 'pl', 'pm',
    'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'sql', 'r', 'dart', 'erl', 'ex', 'exs', 'elm',
    'fs', 'fsx', 'fsi', 'hs', 'lhs', 'jl', 'nim', 'zig', 'v', 'sv', 'vue', 'svelte', 'astro',
    'env', 'proto', 'graphql', 'gql', 'dot', 'cfg', 'properties', 'lock', 'gitignore', 'gitmodules',
    'tex', 'sty', 'cls', 'bib', 'ltx', 'makefile', 'mk', 'cmake', 'dockerfile', 'rst', 'rest',
    'haml', 'slim', 'jade', 'pug', 'handlebars', 'hbs', 'mustache', 'jinja', 'eex', 'erb', 'twig',
    'diff', 'patch', 'nix', 'dhall', 'cue', 'cson', 'coffee', 'iced', 'litcoffee',
    'gradle', 'groovy', 'gvy', 'vala', 'vapi', 'cr', 'pony', 'p6', 'nqp', 'raku', 'rakumod',
    'sc', 'scm', 'ss', 'sld', 'rkt', 'rktl', 'rktd', 'scrbl', 'clj', 'cljc', 'cljs', 'cljx',
    'edn', 'hy', 'fennel', 'janet', 'wren', 'nu', 'purs', 'pkl', 'tf', 'hcl', 'bicep',
    'tcl', 'awk', 'sed', 'm4', 'just', 'bazel', 'bzl', 'starlark', 'gn', 'gyp', 'gypi', 'ninja', 'meson',
    'rake', 'thor', 'cap', 'pp', 'pas', 'dpr', 'lpr', 'dfm', 'ada', 'adb', 'ads', 'cob', 'cbl',
    'cobol', 'forth', 'fth', '4th', 'f', 'f90', 'f95', 'f03', 'f08', 'for', 'fpp', 'f77',
    'abap', 'm', 'mm', 'mii', 'matlab', 'rex', 'rexx', 'cls',
    'xquery', 'xq', 'xql', 'xqm', 'xqy', 'xpl', 'xproc', 'xslt', 'xsl', 'xsd', 'dtd', 'rng', 'rnc',
    'sparql', 'rq', 'turtle', 'ttl', 'n3', 'nt', 'trig', 'nq', 'jsonld', 'owl', 'rdf',
    'markdown', 'mkd', 'mkdn', 'mkdown', 'ron', 'rdoc', 'asciidoc', 'adoc', 'asc',
    'org', 'pod', 'man', '1', '2', '3', '4', '5', '6', '7', '8',
    'me', 'mm', 'ms', 'nr', 'roff', 'nroff', 'troff', 'groff', 'mediawiki', 'wiki', 'creole',
    'ipynb', 'qmd', 'rmd', 'rnw', 'snw', 'cwl', 'smk', 'snakefile', 'wdl', 'nf',
    'http', 'rest', 'wsdl', 'raml', 'openapi', 'swagger',
    'avsc', 'avdl', 'thrift', 'capnp', 'fbs', 'flatbuffers',
    'epub', 'mobi', 'azw', 'azw3', 'fb2',
    'wxml', 'wxss', 'wxs', 'axml', 'acss', 'sjs', 'swan', 'ttml', 'ttss', 'qml', 'qss',
    'lisp', 'lsp', 'cl', 'el', 'emacs', 'vim', 'vba', 'vb', 'bas', 'frm',
    'do', 'ado', 'doh', 'sthlp', 'mata', 'matah', 'sas', 'sps', 'spv', 'spo',
    'dta', 'dct', 'smcl', 'gph', 'hlp', 'stpr', 'ster', 'stsem',
    'sps', 'spv', 'spo', 'spw', 'sav', 'zsav', 'por',
    'dta', 'do', 'ado', 'dct', 'smcl', 'gph', 'hlp', 'sthlp', 'mata',
    'py', 'pyw', 'pyc', 'pyo', 'pyd', 'pyi', 'pyx', 'pxd', 'pxi', 'pyz',
    'pyzw', 'rpy', 'tac', 'wsgi', 'xpy', 'pyt', 'pyde', 'pyp', 'pytb'
]);

/** 文本 MIME 类型前缀 */
const textMimePrefixes = [
    'text/', 'application/json', 'application/xml', 'application/javascript',
    'application/x-yaml', 'application/x-httpd-php', 'application/x-sh',
    'application/x-shellscript', 'application/x-python', 'application/x-ruby',
    'application/x-perl', 'application/x-lua', 'application/x-sql'
];

/**
 * 判断文件是否为可读文本类型
 * @param {File} file
 * @returns {boolean}
 */
function isTextFile(file) {
    // 先检查 MIME 类型
    if (file.type) {
        for (const prefix of textMimePrefixes) {
            if (file.type.startsWith(prefix)) return true;
        }
    }
    // 再检查扩展名
    const ext = getFileExt(file.name);
    return textExts.has(ext);
}

// ============================================================
// 文件内容读取
// ============================================================

/**
 * 异步读取文本文件内容
 * @param {File} file
 * @returns {Promise<{content: string|null, readError: string|null}>}
 */
async function readFileContent(file) {
    if (!isTextFile(file) || file.size > MAX_TEXT_READ_BYTES) {
        return { content: null, readError: null };
    }
    try {
        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
        return { content: text, readError: null };
    } catch (e) {
        return { content: null, readError: e.message };
    }
}

// ============================================================
// 文件卡片渲染
// ============================================================

/**
 * 创建单个文件卡片 DOM 元素
 * 参考用户提供的 DeepSeek 文件卡片样式
 * @param {{id: string, name: string, size: number, ext: string}} fileInfo
 * @returns {HTMLElement}
 */
function createFileCard(fileInfo) {
    // 外层：ds-animated-size-item（动画容器）
    const animatedItem = document.createElement('div');
    animatedItem.className = 'ds-animated-size-item';
    animatedItem.style.cssText = '--duration: 200ms; margin-left: 0px;';

    // 主卡片
    const card = document.createElement('div');
    card.className = '_25c7358 dafb6286';
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-file-id', fileInfo.id);

    // 内容容器
    const content = document.createElement('div');
    content.className = 'cd314545';

    // 文件图标
    const iconArea = document.createElement('div');
    iconArea.className = '_1c3b90b';
    iconArea.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M8.48924 28H19.5108C21.6479 28 22.7165 28 23.5594 27.6509C24.6833 27.1853 25.5762 26.2924 26.0417 25.1685C26.3909 24.3256 26.3909 23.257 26.3909 21.1199V8.79443C26.3909 8.32877 26.3909 8.09593 26.3471 7.87507C26.2887 7.58058 26.173 7.30042 26.0067 7.05048C25.882 6.86303 25.7177 6.69799 25.3893 6.36792L20.0611 1.01354C19.7304 0.681235 19.5651 0.515081 19.3769 0.38885C19.126 0.220541 18.8443 0.103463 18.5481 0.0443412C18.3259 0 18.0915 0 17.6226 0H8.48924C6.35209 0 5.28351 0 4.4406 0.349145C3.31672 0.814671 2.4238 1.70759 1.95828 2.83147C1.60913 3.67438 1.60913 4.74296 1.60913 6.88011V21.1199C1.60913 23.257 1.60913 24.3256 1.95828 25.1685C2.4238 26.2924 3.31672 27.1853 4.4406 27.6509C5.28351 28 6.35209 28 8.48924 28Z" fill="#418CFF"/>
        <path d="M26.3909 7.37445L19.0525 0V3.77445C19.0525 4.89271 19.0525 5.45184 19.2352 5.89289C19.4788 6.48096 19.946 6.94818 20.5341 7.19176C20.9751 7.37445 21.5342 7.37445 22.6525 7.37445H26.3909Z" fill="white" fill-opacity=".7"/>
        <path d="M8.10132 12.6846H19.8948" stroke="white" stroke-width="1.6"/>
        <path d="M8.10132 16.4688H19.8948" stroke="white" stroke-width="1.6"/>
        <path d="M8.10132 20.252H16.0199" stroke="white" stroke-width="1.6"/>
    </svg>`;

    // 文件信息区域
    const infoArea = document.createElement('div');
    infoArea.className = '_158cea4';

    const nameRow = document.createElement('div');
    nameRow.className = '_967f3f9';

    const nameEl = document.createElement('div');
    nameEl.className = 'e70accd6';
    nameEl.textContent = fileInfo.name;

    const spacer = document.createElement('div');
    spacer.className = 'd0fee470';

    nameRow.appendChild(nameEl);
    nameRow.appendChild(spacer);

    const sizeEl = document.createElement('div');
    sizeEl.className = '_7103a25 _078ccb5';
    sizeEl.textContent = fileInfo.ext.toUpperCase() + ' ' + formatFileSize(fileInfo.size);

    infoArea.appendChild(nameRow);
    infoArea.appendChild(sizeEl);

    // 删除按钮
    const removeBtn = document.createElement('div');
    removeBtn.className = '_8402d8c';
    removeBtn.setAttribute('tabindex', '0');
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(fileInfo.id);
    });

    const removeIcon = document.createElement('div');
    removeIcon.className = 'ds-icon';
    removeIcon.style.cssText = 'font-size: 14px; width: 14px; height: 14px;';
    removeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.6074 4.40278L8.00975 6.99973L10.6074 9.59739L9.59736 10.6074L6.9997 8.00978L4.40274 10.6074L3.3927 9.59739L5.98966 6.99973L3.3927 4.40278L4.40274 3.39273L6.9997 5.98969L9.59736 3.39273L10.6074 4.40278Z" fill="currentColor"/>
    </svg>`;

    const focusRing = document.createElement('div');
    focusRing.className = 'ds-focus-ring';
    focusRing.style.cssText = '--dsl-focus-ring-offset: -2px;';

    removeBtn.appendChild(removeIcon);
    removeBtn.appendChild(focusRing);

    // 组装内容
    content.appendChild(iconArea);
    content.appendChild(infoArea);
    content.appendChild(removeBtn);

    // 卡片底部 focus-ring
    const cardFocusRing = document.createElement('div');
    cardFocusRing.className = 'ds-focus-ring';

    card.appendChild(content);
    card.appendChild(cardFocusRing);

    animatedItem.appendChild(card);
    return animatedItem;
}

/**
 * 创建上传区域容器（在 textarea 上方）
 * @returns {HTMLElement|null}
 */
function createUploadArea() {
    const textarea = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
    if (!textarea) return null;

    const parent = textarea.parentElement;
    if (!parent) return null;

    let area = document.getElementById(UPLOAD_AREA_ID);
    if (!area) {
        area = document.createElement('div');
        area.id = UPLOAD_AREA_ID;
        area.style.cssText = 'margin-bottom: 8px; width: 100%;';
        parent.insertBefore(area, textarea);
    }

    const cardsContainer = document.createElement('div');
    cardsContainer.id = CARDS_CONTAINER_ID;
    cardsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
    area.innerHTML = '';
    area.appendChild(cardsContainer);

    return cardsContainer;
}

/**
 * 根据 uploadedFiles 数组渲染所有文件卡片
 */
function renderFileCards() {
    const container = createUploadArea();
    if (!container) return;

    container.innerHTML = '';
    uploadedFiles.forEach(file => {
        const card = createFileCard(file);
        container.appendChild(card);
    });
}

/**
 * 移除上传区域（无文件时清理）
 */
function removeUploadArea() {
    const area = document.getElementById(UPLOAD_AREA_ID);
    if (area) area.remove();
}

// ============================================================
// 文件管理
// ============================================================

/**
 * 移除指定文件
 * @param {string} fileId
 */
function removeFile(fileId) {
    const idx = uploadedFiles.findIndex(f => f.id === fileId);
    if (idx !== -1) {
        uploadedFiles.splice(idx, 1);
    }
    if (uploadedFiles.length === 0) {
        removeUploadArea();
    } else {
        renderFileCards();
    }
}

/**
 * 处理文件选择事件
 * @param {FileList} fileList
 */
async function handleFileSelect(fileList) {
    if (!fileList || fileList.length === 0) return;

    // 追加模式：不清空旧文件，每个文件独立上传处理
    for (const file of fileList) {
        if (file.size > MAX_FILE_BYTES) {
            console.warn(`[file-upload] 文件 ${file.name} 超过 10MB 限制，已跳过`);
            continue;
        }

        const fileInfo = {
            id: String(++idCounter),
            file: file,
            name: file.name,
            size: file.size,
            ext: getFileExt(file.name),
            content: null,
            readError: null
        };

        // 读取文本文件内容
        if (isTextFile(file) && file.size <= MAX_TEXT_READ_BYTES) {
            const result = await readFileContent(file);
            fileInfo.content = result.content;
            fileInfo.readError = result.readError;
        }

        uploadedFiles.push(fileInfo);
    }

    if (uploadedFiles.length > 0) {
        renderFileCards();
    }
}

// ============================================================
// 按钮注入
// ============================================================

/**
 * 创建文件上传按钮 + 隐藏的 file input
 * 参考用户提供的 DeepSeek 上传按钮样式
 * @returns {HTMLElement}
 */
function createUploadButton() {
    const container = document.createElement('div');
    container.id = BUTTON_ID;
    container.style.cssText = 'display:flex;align-items:center;';

    // 文件 input（隐藏）
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = FILE_INPUT_ID;
    fileInput.multiple = true;
    fileInput.accept = '.wxml,.wxss,.wxs,.axml,.acss,.sjs,.swan,.ttml,.ttss,.qml,.qss,.pdf,.png,.jpg,.jpeg,.svg,.svgz,.bmp,.gif,.webp,.ico,.xbm,.dib,.pjp,.tif,.pjpeg,.avif,.apng,.tiff,.jfif,.txt,.md,.csv,.tsv,.html,.json,.log,.dot,.go,.h,.c,.cpp,.cxx,.cc,.cs,.java,.js,.css,.jsp,.php,.py,.py3,.asp,.yaml,.yml,.ini,.conf,.ts,.tsx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.rs,.swift,.kt,.kts,.scala,.rb,.lua,.pl,.sh,.bash,.bat,.cmd,.ps1,.sql,.r,.dart,.erl,.ex,.exs,.elm,.fs,.fsx,.hs,.jl,.nim,.zig,.v,.sv,.vue,.xml,.svelte,.astro,.env,.proto,.graphql,.gql,.cfg,.properties,.lock,.gitignore,.gitmodules,.tex,.scss,.less,.sass,.toml,.epub,.mobi';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', (e) => {
        handleFileSelect(e.target.files);
        // 重置 input 以允许重复选择同一文件
        fileInput.value = '';
    });

    // 按钮（DeepSeek 风格）
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.className = 'ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--s ds-button--icon-relative-m f02f0e25';
    btn.setAttribute('tabindex', '0');
    btn.style.cssText = '--dsl-button-height: 34px;';
    btn.innerHTML = `<div class="ds-button__background"></div>
        <div class="ds-button__icon ds-button__icon--last-child">
            <div class="ds-icon" style="font-size: inherit;">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z" fill="currentColor"/>
                </svg>
            </div>
        </div>`;

    btn.addEventListener('click', () => {
        fileInput.click();
    });

    container.appendChild(btn);
    container.appendChild(fileInput);

    return container;
}

/**
 * 查找 DeepSeek 发送栏中插入按钮的目标位置
 * 在发送栏左侧（麦克风按钮右侧）插入按钮
 * @returns {HTMLElement|null}
 */
function findButtonTarget() {
    // 方案1：非专家模式 - 查找 _6d1b417 按钮组容器
    const btnGroup = document.querySelector('._6d1b417') || document.querySelector('[class*="_6d1b417"]');
    if (btnGroup) return btnGroup;

    // 方案2：专家模式 - 查找发送按钮 .bf38813a，注入到其左边
    // 专家模式下输入框结构：._77cefa5 > ._020ab5b(textarea) + .ec4f5d61 > ._58b31c9(深度思考) + .bf38813a(发送)
    const sendBtn = document.querySelector('.bf38813a') || document.querySelector('[class*="bf38813a"]');
    if (sendBtn && sendBtn.parentElement) {
        return { parent: sendBtn.parentElement, before: sendBtn };
    }

    return null;
}

/**
 * 注入上传按钮到 DOM
 */
function injectButton() {
    if (document.getElementById(BUTTON_ID)) return; // 已存在

    const target = findButtonTarget();
    if (!target) return;

    const button = createUploadButton();
    // 如果 target 是对象 { parent, before }，插入到 before 之前
    if (target.parent && target.before) {
        target.parent.insertBefore(button, target.before);
    } else {
        // 否则作为第一个子元素插入
        target.insertBefore(button, target.firstChild);
    }
}

/**
 * 移除上传按钮
 */
function removeButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.remove();
    removeUploadArea();
}

/**
 * 根据专家模式状态切换按钮可见性
 */
function toggleButtonVisibility() {
    const btn = document.getElementById(BUTTON_ID);
    const enabled = isUploadEnabled();

    if (btn) {
        btn.style.display = enabled ? 'flex' : 'none';
    }

    if (!enabled) {
        removeUploadArea();
    }
}

// ============================================================
// 拖拽上传
// ============================================================

/**
 * 创建拖拽上传遮罩层
 * 参考用户提供的 DeepSeek 拖拽上传样式（彩色图标版）
 * @returns {HTMLElement}
 */
function createDragOverlay() {
    const overlay = document.createElement('div');
    overlay.id = DRAG_OVERLAY_ID;
    overlay.className = 'c760857e';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';

    overlay.innerHTML = `<div class="_5ad05b0" style="text-align:center;">
        <div class="d48117bb" style="margin-bottom:16px;">
            <svg width="115" height="84" viewBox="0 0 115 84" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#uploadIconClipPath)">
                    <rect y="17.0742" width="44.1832" height="43.6431" rx="12" transform="rotate(-22.7338 0 17.0742)" fill="#9CE5ED"></rect>
                    <rect x="73.4043" y="8.54297" width="43.7267" height="50.5284" rx="8" transform="rotate(17.403 73.4043 8.54297)" fill="#679EFE"></rect>
                    <path d="M30.4917 28.1369L40.8865 33.4564L37.2232 34.9524L29.5302 31.0159L26.7919 39.2122L23.1285 40.7082L26.8287 29.6338L16.8967 24.5516L20.5601 23.0556L27.7902 26.7549L30.3639 19.052L34.0273 17.556L30.4917 28.1369Z" fill="white"></path>
                    <path d="M77.5088 26.3047L101.057 33.7966" stroke="white" stroke-width="3"></path>
                    <path d="M72.2646 42.7871L86.3938 47.2823" stroke="white" stroke-width="3"></path>
                    <path d="M74.8867 34.5469L98.4353 42.0388" stroke="white" stroke-width="3"></path>
                    <rect x="31.583" y="38.6641" width="44.9157" height="44.3666" rx="12" transform="rotate(-0.134233 31.583 38.6641)" fill="#3964FE"></rect>
                    <path d="M38.9521 73.0337C39.6129 71.7086 41.7113 66.0937 43.5113 61.1663C44.1607 59.3885 46.7484 59.3923 47.4591 61.1465C48.9728 64.8828 50.7969 68.6922 51.9988 69.1925C54.2946 70.1482 57.9854 59.3573 68.0064 70.1801" stroke="white" stroke-width="3"></path>
                    <circle cx="60.6157" cy="52.247" r="4.38794" transform="rotate(22.5996 60.6157 52.247)" fill="white"></circle>
                </g>
                <defs>
                    <clipPath id="uploadIconClipPath">
                        <rect width="115" height="84" fill="white"></rect>
                    </clipPath>
                </defs>
            </svg>
        </div>
        <div class="_125dfbc" style="font-size:16px;color:#fff;margin-bottom:8px;">文件拖动到此处即可上传（仅提取文字）（deepseek pro max提供支持）</div>
        <div class="_0b382d4" style="font-size:13px;color:rgba(255,255,255,0.6);">最多 10 个，每个 100MB，仅提取文字</div>
    </div>`;

    // 点击遮罩层取消拖拽
    overlay.addEventListener('click', () => {
        hideDragOverlay();
    });

    return overlay;
}

/**
 * 显示拖拽遮罩层
 */
function showDragOverlay() {
    let overlay = document.getElementById(DRAG_OVERLAY_ID);
    if (!overlay) {
        overlay = createDragOverlay();
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

/**
 * 隐藏拖拽遮罩层
 */
function hideDragOverlay() {
    dragCounter = 0;
    const overlay = document.getElementById(DRAG_OVERLAY_ID);
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * 隐藏 DeepSeek 原生的"不支持文件上传"拖拽提示
 * 针对 .c760857e._45872ba（灰色图标版，专家模式下显示）
 */
function hideOriginalDragHint() {
    const hints = document.querySelectorAll('.c760857e._45872ba');
    hints.forEach(hint => {
        hint.style.display = 'none';
    });
}

/**
 * 设置全局拖拽事件监听
 * 仅在专家模式 + 文件上传启用时生效
 */
function setupDragEvents() {
    // 使用 window（最高层）+ 捕获阶段 + stopImmediatePropagation 三重保障：
    //   - window 比 document 更早收到捕获事件
    //   - stopImmediatePropagation 阻止同一元素上其他处理器（含 DeepSeek 原生）
    //   - 捕获阶段确保在冒泡之前拦截
    // 拖拽进入
    window.addEventListener('dragenter', (e) => {
        if (!isUploadEnabled()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        dragCounter++;
        if (dragCounter === 1) {
            showDragOverlay();
            hideOriginalDragHint();
        }
    }, true);

    // 拖拽在页面上移动
    window.addEventListener('dragover', (e) => {
        if (!isUploadEnabled()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
    }, true);

    // 拖拽离开
    window.addEventListener('dragleave', (e) => {
        if (!isUploadEnabled()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideDragOverlay();
        }
    }, true);

    // 拖拽放下
    window.addEventListener('drop', (e) => {
        if (!isUploadEnabled()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        hideDragOverlay();

        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
            handleFileSelect(files);
        }
    }, true);
}

// ============================================================
// MutationObserver（保持按钮存活）
// ============================================================

/**
 * 监听专家模式按钮的变化，切换上传按钮可见性
 */
function watchExpertMode() {
    if (modeAttrObserver) modeAttrObserver.disconnect();

    const expertBtn = document.querySelector('[data-model-type="expert"]');
    if (!expertBtn) return;

    modeAttrObserver = new MutationObserver(() => {
        toggleButtonVisibility();
    });

    modeAttrObserver.observe(expertBtn, {
        attributes: true,
        attributeFilter: ['aria-checked']
    });
}

/**
 * 监听 DOM 变化，在按钮丢失时重新注入
 */
function watchButtonRemoval() {
    if (buttonObserver) buttonObserver.disconnect();

    buttonObserver = new MutationObserver(() => {
        // 如果按钮丢失且当前为专家模式，重新注入
        if (!document.getElementById(BUTTON_ID) && isExpertModeActive()) {
            injectButton();
            toggleButtonVisibility();
        }
        // 隐藏 DeepSeek 原生的"不支持文件上传"拖拽提示
        if (isUploadEnabled()) {
            hideOriginalDragHint();
        }
    });

    buttonObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// ============================================================
// Prompt 注入器
// ============================================================

/**
 * 注册 window._dsFileUploadInjector，供 prompt-augmentation.js 调用
 * 在发送请求前将文件信息格式化为 [上传文件] 标签包裹的内容注入到 prompt 中
 */
function registerPromptInjector() {
    if (typeof window !== 'undefined') {
        window._dsFileUploadInjector = () => {
            // 仅检查是否有已上传文件，不重复检查 isUploadEnabled()
            // 配置开关和专家模式的门控已在按钮可见性和注入前配置检查中完成
            if (uploadedFiles.length === 0) return '';

            let content = FILES_PROMPT_START + '\n';
            uploadedFiles.forEach(file => {
                content += `文件名: ${file.name}\n`;
                if (file.content) {
                    // 扩大内容长度至约15倍（原5000 → 75000字符），确保足够上下文
                    content += `文件内容:\n${file.content.substring(0, 75000)}${file.content.length > 75000 ? '...（内容过长，已截断）' : ''}\n`;
                } else if (file.readError) {
                    content += `文件内容: [读取失败: ${file.readError}]\n`;
                } else {
                    content += `文件内容: [非文本文件或文件过大，仅提供文件名]\n`;
                }
                content += '---\n';
            });
            content += FILES_PROMPT_END + '\n\n';

            // 发送后清空文件列表，避免重复注入到后续消息
            uploadedFiles.length = 0;
            removeUploadArea();

            return content;
        };
    }
}

// ============================================================
// 初始化与清理
// ============================================================

/**
 * 初始化文件上传模块
 * 导出函数，由 index.js 在 requestAnimationFrame 中调用
 */
export function initFileUpload() {
    if (installed) return;
    installed = true;

    // 注册 prompt 注入器
    registerPromptInjector();

    // 初始注入按钮
    if (isExpertModeActive()) {
        injectButton();
    }

    // 监听专家模式切换
    watchExpertMode();

    // 监听按钮丢失
    watchButtonRemoval();

    // 初始可见性
    toggleButtonVisibility();

    // 设置拖拽上传事件
    setupDragEvents();
}