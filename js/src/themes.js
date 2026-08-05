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
    },
    forest: {
        light: { primary: '#4A7C59', primaryHover: '#6B9B7A', accent: '#6B9B7A', bgSoft: '#F5F2EB', cardBg: '#F5F2EB', border: '#E5DFC5', textPrimary: '#3A4A3F', glow: 'rgba(74,124,89,0.35)', deepThinkActive: '#4A7C59', buttonBg: '#4A7C59', buttonHover: '#6B9B7A', mainBorderGlow: 'rgba(74,124,89,0.5)', thinkPanelBg: '#E5DFC5', thinkPanelBorder: '#D8DCC4', thinkTitleColor: '#6B9B7A', msgBubbleBg: '#F5F2EB', msgBubbleBorder: '#E5DFC5', codeBg: '#E5DFC5', linkColor: '#6B9B7A', thinkBg: '#E5DFC5' },
        dark: { primary: 'hsl(140,40%,55%)', primaryHover: 'hsl(140,40%,65%)', accent: 'hsl(140,40%,55%)', bgSoft: '#1E2320', cardBg: '#242A26', border: '#2A312C', textPrimary: 'hsl(140,6%,88%)', glow: 'rgba(93,163,107,0.35)', deepThinkActive: 'hsl(140,40%,55%)', buttonBg: 'hsl(140,40%,55%)', buttonHover: 'hsl(140,40%,65%)', mainBorderGlow: 'rgba(93,163,107,0.5)', thinkPanelBg: '#242A26', thinkPanelBorder: '#2A312C', thinkTitleColor: 'hsl(140,40%,65%)', msgBubbleBg: '#242A26', msgBubbleBorder: '#2A312C', codeBg: '#2A312C', linkColor: 'hsl(140,40%,65%)', thinkBg: '#242A26' }
    },
    ocean: {
        light: { primary: '#3A6FB5', primaryHover: '#5A8FD5', accent: '#5A8FD5', bgSoft: '#F0F4F8', cardBg: '#F0F4F8', border: '#D8E6F0', textPrimary: '#2A3F5A', glow: 'rgba(58,111,181,0.35)', deepThinkActive: '#3A6FB5', buttonBg: '#3A6FB5', buttonHover: '#5A8FD5', mainBorderGlow: 'rgba(58,111,181,0.5)', thinkPanelBg: '#D8E6F0', thinkPanelBorder: '#C8DCF0', thinkTitleColor: '#5A8FD5', msgBubbleBg: '#F0F4F8', msgBubbleBorder: '#D8E6F0', codeBg: '#D8E6F0', linkColor: '#5A8FD5', thinkBg: '#D8E6F0' },
        dark: { primary: 'hsl(215,50%,58%)', primaryHover: 'hsl(215,50%,68%)', accent: 'hsl(215,50%,58%)', bgSoft: '#1A1D2E', cardBg: '#202438', border: '#262B42', textPrimary: 'hsl(225,6%,88%)', glow: 'rgba(90,140,220,0.35)', deepThinkActive: 'hsl(215,50%,58%)', buttonBg: 'hsl(215,50%,58%)', buttonHover: 'hsl(215,50%,68%)', mainBorderGlow: 'rgba(90,140,220,0.5)', thinkPanelBg: '#202438', thinkPanelBorder: '#262B42', thinkTitleColor: 'hsl(215,50%,68%)', msgBubbleBg: '#202438', msgBubbleBorder: '#262B42', codeBg: '#262B42', linkColor: 'hsl(215,50%,68%)', thinkBg: '#202438' }
    },
    sunset: {
        light: { primary: '#D4783A', primaryHover: '#E8985A', accent: '#E8985A', bgSoft: '#FDF6F0', cardBg: '#FDF6F0', border: '#F5E0C8', textPrimary: '#5A3A2A', glow: 'rgba(212,120,58,0.35)', deepThinkActive: '#D4783A', buttonBg: '#D4783A', buttonHover: '#E8985A', mainBorderGlow: 'rgba(212,120,58,0.5)', thinkPanelBg: '#F5E0C8', thinkPanelBorder: '#F0D8C0', thinkTitleColor: '#E8985A', msgBubbleBg: '#FDF6F0', msgBubbleBorder: '#F5E0C8', codeBg: '#F5E0C8', linkColor: '#E8985A', thinkBg: '#F5E0C8' },
        dark: { primary: 'hsl(25,55%,55%)', primaryHover: 'hsl(25,55%,65%)', accent: 'hsl(25,55%,55%)', bgSoft: '#1E1A18', cardBg: '#24201E', border: '#2A2624', textPrimary: 'hsl(25,6%,88%)', glow: 'rgba(210,115,50,0.35)', deepThinkActive: 'hsl(25,55%,55%)', buttonBg: 'hsl(25,55%,55%)', buttonHover: 'hsl(25,55%,65%)', mainBorderGlow: 'rgba(210,115,50,0.5)', thinkPanelBg: '#24201E', thinkPanelBorder: '#2A2624', thinkTitleColor: 'hsl(25,55%,65%)', msgBubbleBg: '#24201E', msgBubbleBorder: '#2A2624', codeBg: '#2A2624', linkColor: 'hsl(25,55%,65%)', thinkBg: '#24201E' }
    },
    lavender: {
        light: { primary: '#7B5EA7', primaryHover: '#9B7EC7', accent: '#9B7EC7', bgSoft: '#F8F4FA', cardBg: '#F8F4FA', border: '#E8DCF0', textPrimary: '#3A2A4A', glow: 'rgba(123,94,167,0.35)', deepThinkActive: '#7B5EA7', buttonBg: '#7B5EA7', buttonHover: '#9B7EC7', mainBorderGlow: 'rgba(123,94,167,0.5)', thinkPanelBg: '#E8DCF0', thinkPanelBorder: '#DCC8E8', thinkTitleColor: '#9B7EC7', msgBubbleBg: '#F8F4FA', msgBubbleBorder: '#E8DCF0', codeBg: '#E8DCF0', linkColor: '#9B7EC7', thinkBg: '#E8DCF0' },
        dark: { primary: 'hsl(265,40%,58%)', primaryHover: 'hsl(265,40%,68%)', accent: 'hsl(265,40%,58%)', bgSoft: '#1E1A2A', cardBg: '#242034', border: '#2A263E', textPrimary: 'hsl(260,6%,88%)', glow: 'rgba(130,100,180,0.35)', deepThinkActive: 'hsl(265,40%,58%)', buttonBg: 'hsl(265,40%,58%)', buttonHover: 'hsl(265,40%,68%)', mainBorderGlow: 'rgba(130,100,180,0.5)', thinkPanelBg: '#242034', thinkPanelBorder: '#2A263E', thinkTitleColor: 'hsl(265,40%,68%)', msgBubbleBg: '#242034', msgBubbleBorder: '#2A263E', codeBg: '#2A263E', linkColor: 'hsl(265,40%,68%)', thinkBg: '#242034' }
    },
    cherry: {
        light: { primary: '#D4687C', primaryHover: '#E8889C', accent: '#E8889C', bgSoft: '#FFF5F6', cardBg: '#FFF5F6', border: '#F8D8E0', textPrimary: '#4A2A3A', glow: 'rgba(212,104,124,0.35)', deepThinkActive: '#D4687C', buttonBg: '#D4687C', buttonHover: '#E8889C', mainBorderGlow: 'rgba(212,104,124,0.5)', thinkPanelBg: '#F8D8E0', thinkPanelBorder: '#F0C8D8', thinkTitleColor: '#E8889C', msgBubbleBg: '#FFF5F6', msgBubbleBorder: '#F8D8E0', codeBg: '#F8D8E0', linkColor: '#E8889C', thinkBg: '#F8D8E0' },
        dark: { primary: 'hsl(340,45%,58%)', primaryHover: 'hsl(340,45%,68%)', accent: 'hsl(340,45%,58%)', bgSoft: '#1E1820', cardBg: '#241E26', border: '#2A242E', textPrimary: 'hsl(330,6%,88%)', glow: 'rgba(210,100,120,0.35)', deepThinkActive: 'hsl(340,45%,58%)', buttonBg: 'hsl(340,45%,58%)', buttonHover: 'hsl(340,45%,68%)', mainBorderGlow: 'rgba(210,100,120,0.5)', thinkPanelBg: '#241E26', thinkPanelBorder: '#2A242E', thinkTitleColor: 'hsl(340,45%,68%)', msgBubbleBg: '#241E26', msgBubbleBorder: '#2A242E', codeBg: '#2A242E', linkColor: 'hsl(340,45%,68%)', thinkBg: '#241E26' }
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
