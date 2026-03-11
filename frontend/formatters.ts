import type { Mode } from './types'
import yaml from 'js-yaml'

export function normalizeText(text: string): string {
    return String(text || '').replace(/\r\n?/g, '\n')
}

function formatPlainText(text: string): string {
    return normalizeText(text)
        .split('\n')
        .map(line => line.replace(/\s+$/g, ''))
        .join('\n')
}

function formatMarkdownText(text: string): string {
    return formatPlainText(text)
        .replace(/\n{3,}/g, '\n\n')
}

function formatJsonText(text: string): string {
    return `${JSON.stringify(JSON.parse(normalizeText(text)), null, 2)}\n`
}

function formatYamlText(text: string): string {
    const parsed = yaml.load(normalizeText(text))
    return yaml.dump(parsed, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
    })
}

export function buildFormatError(mode: Mode, error: unknown, sourceText: string): Error {
    const message = error instanceof Error ? error.message : String(error || '')

    if (mode === 'json') {
        const positionMatch = message.match(/position\s+(\d+)/i)
        if (positionMatch) {
            const index = Number(positionMatch[1])
            const normalized = normalizeText(sourceText)
            const before = normalized.slice(0, index)
            const line = before.split('\n').length
            const column = before.length - before.lastIndexOf('\n')
            return new Error(`${message} (line ${line}, column ${column})`)
        }
    }

    if (mode === 'yaml') {
        const lineMatch = message.match(/at line (\d+), column (\d+)/i)
        if (lineMatch) {
            return new Error(message)
        }
    }

    return error instanceof Error ? error : new Error(message)
}

export function formatTextByMode(mode: Mode, text: string): string {
    if (mode === 'json') {
        return formatJsonText(text)
    }
    if (mode === 'yaml') {
        return formatYamlText(text)
    }
    if (mode === 'md') {
        return formatMarkdownText(text)
    }
    return formatPlainText(text)
}
