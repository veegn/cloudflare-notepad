interface ApiEnvelope<T> {
    code: number
    message?: string
    data?: T
}

interface ApiOptions extends RequestInit {
    json?: unknown
    errorMessage?: string
    requireData?: boolean
}

export function apiRequest<T>(url: string | URL, options: ApiOptions & { requireData: true }): Promise<T>
export function apiRequest<T = void>(url: string | URL, options?: ApiOptions): Promise<T | undefined>
export async function apiRequest<T>(url: string | URL, options: ApiOptions = {}): Promise<T | undefined> {
    const { json, errorMessage = 'Request failed', requireData, ...init } = options
    if (json !== undefined) {
        const headers = new Headers(init.headers)
        headers.set('Content-Type', 'application/json')
        init.headers = headers
        init.body = JSON.stringify(json)
    }

    const response = await fetch(url, init)
    if (response.status === 204 && !requireData) return undefined

    const fallback = `${errorMessage} (HTTP ${response.status})`
    const envelope = await response.json().catch(() => null) as ApiEnvelope<T> | null
    if (!response.ok || envelope?.code !== 0 || (requireData && envelope.data == null)) {
        throw new Error(envelope?.message || fallback)
    }

    return envelope.data
}
