/**
 * Webpack 构建配置
 *
 * 将 src/ 下的 ES Module 源码打包为单文件油猴脚本。
 * - development 模式：输出到 dist/dspro.js，不压缩，保留所有注释，便于调试
 * - production 模式：输出到 dist/dspro.js，terser 压缩并删除所有注释，
 *   然后通过 ReinjectHeaderPlugin 在压缩后重新注入油猴头部（==UserScript== 块 + banner.txt）
 *
 * 油猴脚本头部元数据格式必须是 `// ==UserScript==` 单行注释，
 * 因此不能用块注释 ` slash-star-bang ... star-slash ` 包裹（terser 默认保留 ! 注释），
 * 只能在 terser 删除注释后重新注入。
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
 * 自定义插件：在 terser 压缩完成后重新注入头部注释
 *
 * 工作原理：
 *   1. terser 在 PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE 阶段压缩代码并删除所有注释
 *   2. 本插件在更后的 PROCESS_ASSETS_STAGE_REPORT 阶段运行
 *   3. 将预先构建好的头部注释插入到输出文件最前面
 *
 * 这样可以确保油猴头部（==UserScript== 块 + banner.txt）在删除注释后仍然保留。
 */
class ReinjectHeaderPlugin {
    /**
     * @param {string} header - 要注入的头部注释文本
     */
    constructor(header) {
        this.header = header;
    }

    apply(compiler) {
        compiler.hooks.compilation.tap('ReinjectHeaderPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'ReinjectHeaderPlugin',
                    // 在 terser 压缩之后的阶段运行，确保注释已被删除
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT
                },
                (assets) => {
                    const asset = assets['dspro.js'];
                    if (asset) {
                        const source = asset.source().toString();
                        // 头部 + 换行 + 压缩后的代码
                        const newSource = this.header + '\n' + source;
                        assets['dspro.js'] = new webpack.sources.RawSource(newSource);
                    }
                }
            );
        });
    }
}

/** @type {import('webpack').Configuration} */
const config = {
    entry: './src/index.js',
    output: {
        filename: 'dspro.js',
        path: path.resolve(__dirname, 'dist'),
        clean: true
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

module.exports = (env, argv) => {
    const isProd = argv.mode === 'production';

    if (!isProd) {
        // ═══════════════════════════════════════
        // development 模式：保留所有注释，用 BannerPlugin 注入头部
        // ═══════════════════════════════════════
        config.devtool = 'source-map';
        config.plugins.push(new webpack.BannerPlugin({
            banner: buildUserScriptHeader(),
            raw: true,
            entryOnly: true
        }));
    } else {
        // ═══════════════════════════════════════
        // production 模式：terser 删除所有注释，然后重新注入头部
        // ═══════════════════════════════════════
        config.optimization.minimize = true;
        config.optimization.minimizer = [
            new TerserPlugin({
                terserOptions: {
                    format: {
                        // 删除所有注释（头部会在压缩后重新注入）
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
        // 在 terser 压缩完成后重新注入油猴头部
        config.plugins.push(new ReinjectHeaderPlugin(buildUserScriptHeader()));
    }

    return config;
};
