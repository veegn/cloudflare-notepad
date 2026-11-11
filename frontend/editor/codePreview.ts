import type { Mode } from '../core/types'
import { escapeCodeHtml, wrapKeywords } from './highlighting'

type TokenReplacement = {
    pattern: RegExp
    render: (...args: string[]) => string
}

function applyTokenReplacements(source: string, replacements: TokenReplacement[]): string {
    const tokens: string[] = []
    const markers: string[] = []
    let output = source

    const encodeIndex = (value: number): string => {
        let current = value + 1
        let result = ''

        while (current > 0) {
            current -= 1
            result = String.fromCharCode(65 + (current % 26)) + result
            current = Math.floor(current / 26)
        }

        return result
    }

    replacements.forEach(({ pattern, render }) => {
        output = output.replace(pattern, (...args) => {
            const html = render(...(args as string[]))
            const marker = `%%SCNTOKEN${encodeIndex(tokens.length)}%%`
            tokens.push(html)
            markers.push(marker)
            return marker
        })
    })

    let previousOutput = ''
    while (output !== previousOutput) {
        previousOutput = output
        output = output.replace(/%%SCNTOKEN([A-Z]+)%%/g, match => {
            const index = markers.indexOf(match)
            return index >= 0 ? tokens[index] : match
        })
    }

    return output
}

function renderPlainCode(text: string): string {
    return `<div class="code-layer">${wrapKeywords(escapeCodeHtml(text))}</div>`
}

function renderStructuredCodeViewer(text: string): string {
    const rows = text.split('\n').map((line, index) => `
        <div class="code-viewer-row">
            <span class="code-viewer-line-no">${index + 1}</span>
            <span class="code-viewer-line">${line || '<span class="code-viewer-line-empty"></span>'}</span>
        </div>
    `).join('')

    return `<div class="code-viewer">${rows}</div>`
}

function renderJsonCode(text: string): string {
    const highlighted = applyTokenReplacements(escapeCodeHtml(text), [
        {
            pattern: /("(?:\\.|[^"\\])*")(\s*:)?/g,
            render: (_match, stringToken, colon = '') => {
                const className = colon ? 'token-key' : 'token-string'
                return `<span class="${className}">${stringToken}</span>${colon}`
            },
        },
        {
            pattern: /\b(true|false|null)\b/g,
            render: match => `<span class="token-boolean">${match}</span>`,
        },
        {
            pattern: /\b(-?\d+(?:\.\d+)?)\b/g,
            render: match => `<span class="token-number">${match}</span>`,
        },
        {
            pattern: /[{}[\],:]/g,
            render: match => `<span class="token-punctuation">${match}</span>`,
        },
    ])

    return renderStructuredCodeViewer(wrapKeywords(highlighted))
}

function renderYamlCode(text: string): string {
    const highlighted = applyTokenReplacements(escapeCodeHtml(text), [
        {
            pattern: /(^|\s)(#.*)$|("[^"]*"|'[^']*')(\s*:)?/gm,
            render: (_match, prefix, comment, stringToken, colon = '') => {
                if (comment) {
                    return `${prefix}<span class="token-comment">${comment}</span>`
                }

                const className = colon ? 'token-key' : 'token-string'
                const colonMatch = colon.match(/^(\s*)(:)/)
                const colonHtml = colonMatch
                    ? `${colonMatch[1]}<span class="token-punctuation">${colonMatch[2]}</span>`
                    : ''
                return `<span class="${className}">${stringToken}</span>${colonHtml}`
            },
        },
        {
            pattern: /(^|[\s{,])([a-zA-Z0-9_-]+)([ \t]*)(:)/g,
            render: (_match, prefix, key, gap, colon) =>
                `${prefix}<span class="token-key">${key}</span>${gap}<span class="token-punctuation">${colon}</span>`,
        },
        {
            pattern: /^([ \t]*-\s)/gm,
            render: match => `<span class="token-punctuation">${match}</span>`,
        },
        {
            pattern: /\b(true|false|null)\b/g,
            render: match => `<span class="token-boolean">${match}</span>`,
        },
        {
            pattern: /\b(-?\d+(?:\.\d+)?)\b/g,
            render: match => `<span class="token-number">${match}</span>`,
        },
    ])

    return renderStructuredCodeViewer(wrapKeywords(highlighted))
}

export function renderCodePreview(text: string, mode: Mode): string {
    switch (mode) {
        case 'json':
            return renderJsonCode(text)
        case 'yaml':
            return renderYamlCode(text)
        default:
            return renderPlainCode(text)
    }
}
