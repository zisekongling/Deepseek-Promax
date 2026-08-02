/**
 * 主题颜色配置模块
 *
 * 定义可用主题（border）的亮色/暗色配色方案，
 * 并提供根据主题名 + 暗色模式获取配色对象的函数。
 */
import { utils } from './utils.js';

/** 主题配色表：每个主题包含 light / dark 两套配色 */
export const THEMES = {
    border: {
        light: { primary: '#793f82', primaryHover: '#9B7AA0', accent: '#9B7AA0', bgSoft: '#F9F6F4', cardBg: '#FEFBF5', border: '#F2E0E4', textPrimary: '#4A4348', glow: 'rgba(121,63,130,0.35)', deepThinkActive: '#793f82', buttonBg: '#793f82', buttonHover: '#9B7AA0', mainBorderGlow: 'rgba(121,63,130,0.5)', thinkPanelBg: '#F2E0E4', thinkPanelBorder: '#EBE4F0', thinkTitleColor: '#9B7AA0', msgBubbleBg: '#F9F6F4', msgBubbleBorder: '#F2E0E4', codeBg: '#F2E0E4', linkColor: '#9B7AA0', thinkBg: '#F2E0E4' },
        dark: { primary: '#7c8df4', primaryHover: '#9bb0ff', accent: '#7c8df4', bgSoft: '#27282e', cardBg: '#2d2e34', border: '#32333a', textPrimary: 'hsl(232,6%,88%)', glow: 'rgba(124,141,244,0.35)', deepThinkActive: '#7c8df4', buttonBg: '#7c8df4', buttonHover: '#9bb0ff', mainBorderGlow: 'rgba(124,141,244,0.5)', thinkPanelBg: '#2d2e34', thinkPanelBorder: '#32333a', thinkTitleColor: '#9bb0ff', msgBubbleBg: '#2d2e34', msgBubbleBorder: '#32333a', codeBg: '#32333a', linkColor: '#9bb0ff', thinkBg: '#2d2e34' }
    }
};

/**
 * 根据主题名获取当前暗色/亮色模式下的配色对象
 * @param {string} themeName - 主题名（border/original）
 * @returns {Object|null} 配色对象，original 主题返回 null
 */
export function getThemeColors(themeName) {
    if (themeName === 'original') return null;
    const theme = THEMES[themeName] || THEMES.border;
    return theme[utils.isDarkMode() ? 'dark' : 'light'];
}
