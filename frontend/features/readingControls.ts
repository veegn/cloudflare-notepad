const MOBILE_VIEWPORT = '(max-width: 760px)'

/** Allow mobile readers to toggle the hidden status bar by tapping the page. */
export function initReadingControls(): void {
    const readingSurface = document.querySelector<HTMLElement>('.composer-frame.is-reading')
    const appShell = document.querySelector<HTMLElement>('.app-shell')
    if (!readingSurface || !appShell) return

    const mobileViewport = window.matchMedia(MOBILE_VIEWPORT)
    let isMobile = mobileViewport.matches

    const updateMobileState = (): void => {
        const nextIsMobile = mobileViewport.matches
        if (nextIsMobile === isMobile) return

        isMobile = nextIsMobile
        appShell.classList.toggle('reading-controls-auto-hide', isMobile)
        appShell.classList.remove('reading-controls-visible')
    }

    appShell.classList.toggle('reading-controls-auto-hide', isMobile)
    window.addEventListener('resize', updateMobileState)
    readingSurface.addEventListener('click', () => {
        if (!isMobile) return
        appShell.classList.toggle('reading-controls-visible')
    })
}
