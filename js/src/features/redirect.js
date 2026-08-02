/**
 * 自动跳转模块
 *
 * 当且仅当用户访问 www.deepseek.com 或 deepseek.com 时，
 * 自动跳转到 https://chat.deepseek.com/
 */
import { CONFIG } from '../config.js';

/**
 * 执行自动跳转检查
 * 仅在 autoRedirectEnabled 且当前域名为 www.deepseek.com 或 deepseek.com 时跳转
 */
export function initRedirect() {
    if (!CONFIG.autoRedirectEnabled) return;
    const host = location.hostname;
    if (host === 'www.deepseek.com' || host === 'deepseek.com') {
        location.replace('https://chat.deepseek.com/');
    }
}
