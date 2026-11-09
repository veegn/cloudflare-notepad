declare global {
    interface Window {
        CONFIG?: import('./types').AppConfig
        mermaid?: {
            initialize: (config: Record<string, unknown>) => void
            run: (config: Record<string, unknown>) => void
        }
    }
}

export {}
