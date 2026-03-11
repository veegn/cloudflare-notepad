import type { NoteMetadata, NoteMode } from './types'

export function isIndexPath(path: string): boolean {
    return path === '.index'
}

export function createEditMetadata(metadata: NoteMetadata, content: string, mode?: NoteMode): NoteMetadata {
    return {
        ...metadata,
        updateAt: Math.floor(Date.now() / 1000),
        ...(mode !== undefined ? { mode } : {}),
    }
}

export function createPasswordMetadata(metadata: NoteMetadata, pw?: string): NoteMetadata {
    return {
        ...metadata,
        pw,
    }
}
