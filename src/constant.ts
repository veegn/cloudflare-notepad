import type { SupportedLanguageMap } from './types'

// server side salt kept for legacy password verification
export const LEGACY_SALT = SCN_SALT
// server side secret
export const SECRET = SCN_SECRET
// optional admin password used to protect .index editing
export const INDEX_EDIT_PASSWORD = typeof SCN_INDEX_PASSWD === 'string' ? SCN_INDEX_PASSWD : ''

// supported language
export const SUPPORTED_LANG: SupportedLanguageMap = {
    en: {
        setPW: 'Set Password',
        changePW: 'Change Password',
        share: 'Share',
        lastModified: 'Last modified',
        copy: 'Copy',
        emptyPH: 'There are many like it, but this one is mine...',
        tipEncrypt: 'This note is protected. Enter the password to continue.',
        tip404: '404, nothing here.',
        tipPrivate: 'This note is not publicly shared.',
        editButtonText: 'Edit',
        rawButtonText: 'Raw',
        err: 'Error',
        enterPasswordPrompt: 'Enter the note password',
        passwordSetPrompt: 'Set a password for this note. Leave empty to remove it.',
        passwordSaved: 'Password updated.',
        passwordRemoved: 'Password removed.',
        shareCopied: 'Share link copied.',
        authFailed: 'Password authentication failed.',
        formatNow: 'Format Now',
        formatMode: 'Format',
        formatApplied: 'Formatting applied.',
        formatFailed: 'Formatting failed.',
        mdViewEdit: 'Edit',
        mdViewSplit: 'Split',
        mdViewPreview: 'Preview',
    },
    zh: {
        setPW: '设置密码',
        changePW: '修改密码',
        share: '分享',
        lastModified: '上次保存',
        copy: '复制',
        emptyPH: '看起来你是第一个到这里的人，写点什么吧...',
        tipEncrypt: '这条笔记受密码保护，请先输入密码。',
        tip404: '404，你要找的内容不存在。',
        tipPrivate: '这条笔记未公开分享。',
        editButtonText: '编辑',
        rawButtonText: '原文',
        err: '错误',
        enterPasswordPrompt: '请输入笔记密码',
        passwordSetPrompt: '请设置笔记密码，留空可移除密码。',
        passwordSaved: '密码已更新。',
        passwordRemoved: '密码已移除。',
        shareCopied: '分享链接已复制。',
        authFailed: '密码验证失败。',
        formatNow: '一键格式化',
        formatMode: '格式',
        formatApplied: '已应用格式化。',
        formatFailed: '格式化失败。',
    },
}
