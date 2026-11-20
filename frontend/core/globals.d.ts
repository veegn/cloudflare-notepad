declare global {
    interface Window {
        CONFIG?: import('./types').AppConfig
        mermaid?: Pick<import('mermaid').Mermaid, 'initialize' | 'render'>
    }
}

export {}
