if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
        configurable: true,
        writable: true,
        value(object: object, key: PropertyKey): boolean {
            return Object.prototype.hasOwnProperty.call(object, key)
        },
    })
}
