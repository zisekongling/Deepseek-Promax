/**
 * Webpack 构建配置（多环境多入口）
 *
 * 将 src/ 下的 ES Module 源码打包为五个产物：
 *   1. dspro.user.js      — 篡改猴版，带 ==UserScript== 头部 + banner.txt，document-start 注入
 *   2. dspro.js           — WebView 主脚本，无头部，由宿主在 onPageFinished 注入
 *   3. dspro.early-boot.js — WebView 早注入 stub，无头部，由宿主在 onPageStarted 注入，
 *                           只装 fetch/XHR/redirect hook，确保 document-start 类功能生效
 *   4. dspro.desktop.js   — Tauri 桌面端专属脚本，无头部，由 Tauri on_page_load 注入，
 *                           使用 DesktopPlatform 提供原生文件系统/对话框/系统信息能力
 *   5. dspro.mobile.js    — Android 移动端专属脚本，无头部，由 Android WebView onPageFinished 注入，
 *                           针对移动端优化：触屏适配、长按菜单、性能优化默认配置、原生桥接预热
 *
 * 四者共享同一份 src 源码（单源码多构建），通过运行时环境探测（platform/bridge.js）
 * 自动切换行为，避免代码分叉。桌面端通过 desktop-index.js 入口使用 DesktopPlatform。
 *
 * 构建模式：
 *   - development：保留所有注释，篡改猴版用 BannerPlugin 注入头部，输出 source-map
 *   - production：terser 删除所有注释，篡改猴版用 ReinjectHeaderPlugin 在压缩后重新注入头部
 *
 * 油猴脚本头部元数据格式必须是 `// ==UserScript==` 单行注释，
 * 因此不能用块注释包裹（terser 默认保留 ! 注释），只能在 terser 删除注释后重新注入。
 */
const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const headers = require('./userscript-headers');

/**
 * 构建 ==UserScript== 头部注释块
 * @returns {string} 完整的 UserScript 头部注释（含 banner.txt 艺术字）
 */
function buildUserScriptHeader() {
    let banner = '// ==UserScript==\n';
    for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            for (const v of value) {
                banner += `// @${key}  ${v}\n`;
            }
        } else {
            banner += `// @${key.padEnd(10)} ${value}\n`;
        }
    }
    banner += '// ==/UserScript==\n';

    // 读取 banner.txt 艺术字（如果存在）
    const bannerPath = path.resolve(__dirname, 'banner.txt');
    if (fs.existsSync(bannerPath)) {
        let bannerText = fs.readFileSync(bannerPath, 'utf-8');
        // 变量替换
        bannerText = bannerText
            .replace(/\$\{name\}/g, headers.name || '')
            .replace(/\$\{version\}/g, headers.version || '')
            .replace(/\$\{description\}/g, headers.description || '')
            .replace(/\$\{author\}/g, headers.author || '')
            .replace(/\$\{namespace\}/g, headers.namespace || '');
        // 每行添加注释前缀
        const bannerLines = bannerText.split('\n').map(line => line ? `// ${line}` : '//').join('\n');
        banner += '\n' + bannerLines + '\n';
    }

    return banner;
}

/**
 * 自定义插件：注入油猴头部注释 + 用 IIFE 包裹 bundle 实现 window 重定向
 *
 * 工作原理：
 *   1. terser 在 PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE 阶段压缩代码并删除所有注释
 *   2. 本插件在更后的 PROCESS_ASSETS_STAGE_REPORT 阶段运行
 *   3. 输出 = 油猴头部注释 + IIFE 开头 + bundle 源码 + IIFE 结尾
 *
 * IIFE 重定向的作用（解决沙箱 window 不透传写入问题）：
 *   - @grant none 时脚本运行在页面上下文，window === 页面 window
 *   - @grant GM_xmlhttpRequest 时脚本运行在沙箱，window 写入不透传到页面
 *   - 用 IIFE 参数 (function(window, document, ...){ ... })(unsafeWindow, ...)
 *     让 bundle 内所有 window/document 等标识符词法解析到 unsafeWindow
 *   - 这样 window.fetch hook、window._dsXxx 注入都直接作用于页面 window
 *
 * dev/prod 统一用此插件，替代原 BannerPlugin（dev）+ ReinjectHeaderPlugin（prod）：
 *   - dev 模式：webpack 直接输出 bundle → 本插件注入头部 + IIFE 包裹
 *   - prod 模式：terser 压缩 bundle → 本插件注入头部 + IIFE 包裹
 *   - 统一处理避免 BannerPlugin 与 IIFE 包裹的顺序冲突
 */
class InjectHeaderAndIifeWrapPlugin {
    /**
     * @param {string} header - 油猴头部注释文本（含 banner.txt）
     */
    constructor(header) {
        this.header = header;
        // IIFE 参数列表：bundle 内部可能引用的全局对象，全部重定向到 unsafeWindow
        // WebView 环境 typeof unsafeWindow === 'undefined'，fallback 到 window
        // 油猴环境 typeof unsafeWindow !== 'undefined'，使用 unsafeWindow（页面真实 window）
        const target = 'typeof unsafeWindow!=="undefined"?unsafeWindow:window';
        const targetDoc = 'typeof unsafeWindow!=="undefined"?unsafeWindow.document:document';
        const targetLoc = 'typeof unsafeWindow!=="undefined"?unsafeWindow.location:location';
        const targetNav = 'typeof unsafeWindow!=="undefined"?unsafeWindow.navigator:navigator';
        const targetHist = 'typeof unsafeWindow!=="undefined"?unsafeWindow.history:history';
        const targetLS = 'typeof unsafeWindow!=="undefined"?unsafeWindow.localStorage:localStorage';
        const targetSS = 'typeof unsafeWindow!=="undefined"?unsafeWindow.sessionStorage:sessionStorage';
        // XMLHttpRequest：anti-recall.js hook 其 prototype（open/send/setRequestHeader）
        // 必须重定向到 unsafeWindow.XMLHttpRequest，确保 hook 作用于页面 XHR 实例
        const targetXHR = 'typeof unsafeWindow!=="undefined"?unsafeWindow.XMLHttpRequest:XMLHttpRequest';
        // Element：inline-export.js 用 instanceof Element 检查页面 DOM 节点
        // 重定向确保 instanceof 检查使用页面 Realm 的构造器
        const targetEl = 'typeof unsafeWindow!=="undefined"?unsafeWindow.Element:Element';
        // IIFE 开头：声明参数名与全局对象同名，利用词法作用域屏蔽全局 window
        // bundle 内部 window.xxx / XMLHttpRequest.xxx 引用会解析到 IIFE 参数（即 unsafeWindow 对应对象）
        this.iifePrefix = `;(function(window,document,location,navigator,history,localStorage,sessionStorage,self,globalThis,top,parent,frames,opener,XMLHttpRequest,Element){`;
        // IIFE 结尾：传入对应的 unsafeWindow 属性（或 fallback 到沙箱对象）
        this.iifeSuffix = `})(${target},${targetDoc},${targetLoc},${targetNav},${targetHist},${targetLS},${targetSS},${target},${target},${target},${target},${target},${target},${targetXHR},${targetEl});`;
    }

    apply(compiler) {
        compiler.hooks.compilation.tap('InjectHeaderAndIifeWrapPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'InjectHeaderAndIifeWrapPlugin',
                    // 在 terser 压缩之后的阶段运行，确保注释已被删除
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT
                },
                (assets) => {
                    const asset = assets['dspro.user.js'];
                    if (asset) {
                        const source = asset.source().toString();
                        // 油猴头部 + IIFE 开头 + bundle 源码 + IIFE 结尾
                        const newSource =
                            this.header + '\n' +
                            this.iifePrefix + '\n' +
                            source + '\n' +
                            this.iifeSuffix;
                        assets['dspro.user.js'] = new webpack.sources.RawSource(newSource);
                    }
                }
            );
        });
    }
}

/**
 * 生产共享的 terser 配置（仅生产模式启用）
 * @returns {TerserPlugin[]}
 */
function buildMinimizers() {
    return [
        new TerserPlugin({
            terserOptions: {
                format: {
                    // 删除所有注释（篡改猴头部会在压缩后重新注入）
                    comments: false
                },
                compress: {
                    // 保留必要的语法结构，避免破坏油猴脚本
                    drop_console: false,
                    drop_debugger: true
                },
                mangle: {
                    // 保留顶层变量名（避免破坏 window.__ds* 全局钩子）
                    toplevel: false
                }
            },
            // 不提取注释到单独的 .LICENSE.txt 文件
            extractComments: false
        })
    ];
}

/**
 * 构建单个 webpack 配置对象
 * @param {Object} opts - 配置参数
 * @param {string} opts.entry - 入口文件路径
 * @param {string} opts.filename - 输出文件名
 * @param {boolean} opts.injectHeader - 是否注入油猴头部（仅篡改猴版）
 * @param {boolean} opts.isProd - 是否生产模式
 * @param {boolean} [opts.clean] - 是否清理输出目录（仅首个配置启用）
 * @returns {import('webpack').Configuration}
 */
function makeConfig({ entry, filename, injectHeader, isProd, clean = false }) {
    /** @type {import('webpack').Configuration} */
    const config = {
        entry,
        output: {
            filename,
            path: path.resolve(__dirname, 'dist'),
            clean
        },
        // 油猴脚本不需要打包 polyfill，忽略 Node.js 内置模块
        externals: {},
        resolve: {
            extensions: ['.js']
        },
        optimization: {
            minimize: false  // 默认不压缩，production 模式下覆盖
        },
        plugins: [],
        // 性能提示：油猴脚本体积较大是正常的
        performance: {
            hints: false
        }
    };

    if (!isProd) {
        // ═══════════════════════════════════════
        // development 模式：保留所有注释，用统一插件注入头部 + IIFE 包裹
        // ═══════════════════════════════════════
        // 注：IIFE 包裹后 source-map 行号会偏移，但油猴脚本调试不依赖 source map
        config.devtool = 'source-map';
        if (injectHeader) {
            config.plugins.push(new InjectHeaderAndIifeWrapPlugin(buildUserScriptHeader()));
        }
    } else {
        // ═══════════════════════════════════════
        // production 模式：terser 删除所有注释，篡改猴版用统一插件注入头部 + IIFE 包裹
        // ═══════════════════════════════════════
        config.optimization.minimize = true;
        config.optimization.minimizer = buildMinimizers();
        if (injectHeader) {
            // 在 terser 压缩完成后注入油猴头部并用 IIFE 包裹实现 window 重定向
            config.plugins.push(new InjectHeaderAndIifeWrapPlugin(buildUserScriptHeader()));
        }
    }

    return config;
}

/** 标记 dist 是否已清理（避免 watch 模式下每次 rebuild 都清理） */
let distCleaned = false;

module.exports = (env, argv) => {
    const isProd = argv.mode === 'production';
    const distDir = path.resolve(__dirname, 'dist');

    // 多 config 并行执行时，webpack 的 output.clean 会在各 config 间互相清空产物，
    // 导致只保留最后一个 clean:true 的 config 输出。
    // 这里改为手动清理一次（仅首次构建），所有 config 都设 clean:false，避免并行清理冲突。
    // try-catch 容错：中文路径在 Windows 上可能因编码问题导致 EPERM，失败时改为逐文件清理
    if (!distCleaned) {
        distCleaned = true;
        if (fs.existsSync(distDir)) {
            try {
                fs.rmSync(distDir, { recursive: true, force: true });
            } catch (e) {
                // rmSync 失败（中文路径编码问题或文件占用），逐文件删除
                try {
                    const files = fs.readdirSync(distDir);
                    for (const f of files) {
                        try { fs.rmSync(path.join(distDir, f), { recursive: true, force: true }); } catch (e2) {}
                    }
                } catch (e3) {}
            }
        }
        try { fs.mkdirSync(distDir, { recursive: true }); } catch (e) {}
    }

    // 配置1：篡改猴版（带油猴头）
    const tmConfig = makeConfig({
        entry: './src/index.js',
        filename: 'dspro.user.js',
        injectHeader: true,
        isProd,
        clean: false  // 手动清理已处理，禁用 webpack 的 output.clean 避免多 config 并行冲突
    });

    // 配置2：WebView 主脚本（无头），与篡改猴版共享 index.js 源码
    const wvConfig = makeConfig({
        entry: './src/index.js',
        filename: 'dspro.js',
        injectHeader: false,
        isProd,
        clean: false
    });

    // 配置3：WebView 早注入 stub（无头），独立入口 early-boot.js
    const ebConfig = makeConfig({
        entry: './src/early-boot.js',
        filename: 'dspro.early-boot.js',
        injectHeader: false,
        isProd,
        clean: false
    });

    // 配置4：Tauri 桌面端专属脚本（无头），独立入口 desktop-index.js
    // 使用 DesktopPlatform 提供原生文件系统/对话框/系统信息能力
    const dtConfig = makeConfig({
        entry: './src/desktop-index.js',
        filename: 'dspro.desktop.js',
        injectHeader: false,
        isProd,
        clean: false
    });

    // 配置5：Android 移动端专属脚本（无头），独立入口 mobile-index.js
    // 针对移动端优化：触屏适配、长按菜单、性能优化默认配置、原生桥接预热
    const moConfig = makeConfig({
        entry: './src/mobile-index.js',
        filename: 'dspro.mobile.js',
        injectHeader: false,
        isProd,
        clean: false
    });

    return [tmConfig, wvConfig, dtConfig, moConfig, ebConfig];
};
