const inMemory = new Map<string, string>()

export function readPreference(key: string): string | null {
    const fallback = inMemory.get(key)
    if (fallback !== undefined) return fallback

    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

export function writePreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value)
        inMemory.delete(key)
    } catch {
        inMemory.set(key, value)
    }
}
