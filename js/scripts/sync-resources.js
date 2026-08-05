/**
 * 构建产物同步脚本
 *
 * 将 webpack 构建出的 dist/dspro.js 和 dist/dspro.early-boot.js 拷贝到
 * DeepSeekClient/shared/src/commonMain/resources/，供 Android 与 Desktop
 * 宿主通过 ScriptLoader 读取并注入 WebView。
 *
 * 用法：node scripts/sync-resources.js
 * 也可通过 npm run sync 调用。
 */
const fs = require('fs');
const path = require('path');

/** js 项目根目录（脚本位于 js/scripts/ 下） */
const jsRoot = path.resolve(__dirname, '..');
/** dist 输出目录 */
const srcDir = path.join(jsRoot, 'dist');
/** DeepSeekClient 共享资源目录（相对 js 根目录向上回到父级，再进入 DeepSeekClient） */
const dstDir = path.resolve(jsRoot, '..', 'DeepSeekClient', 'shared', 'src', 'commonMain', 'resources');

/** 需要同步的产物文件名列表 */
const files = ['dspro.js', 'dspro.early-boot.js'];

let ok = 0;
let fail = 0;

for (const f of files) {
    const src = path.join(srcDir, f);
    const dst = path.join(dstDir, f);
    if (!fs.existsSync(src)) {
        console.warn(`[sync] 跳过：源文件不存在 ${src}（请先执行 npm run build）`);
        fail++;
        continue;
    }
    try {
        // 确保目标目录存在
        fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(src, dst);
        const size = fs.statSync(dst).size;
        console.log(`[sync] OK  ${f}  ${(size / 1024).toFixed(1)} KiB  ->  ${dst}`);
        ok++;
    } catch (e) {
        console.error(`[sync] 失败：${f}  ${e.message}`);
        fail++;
    }
}

console.log(`[sync] 完成：成功 ${ok} 个，失败 ${fail} 个`);
process.exit(fail > 0 ? 1 : 0);
