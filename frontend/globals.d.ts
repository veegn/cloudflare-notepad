declare global {
    interface Window {
        CONFIG?: import('./types').AppConfig
        passwdPrompt?: () => void
    }
}

export {}
