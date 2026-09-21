declare global {
    interface Window {
        CONFIG?: import('./types').AppConfig
        passwdPrompt?: () => void
        mermaid?: {
            initialize: (config: Record<string, unknown>) => void
            run: (config: Record<string, unknown>) => void
        }
    }
}

export {}
