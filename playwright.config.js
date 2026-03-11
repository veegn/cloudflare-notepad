const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:8788',
        headless: true,
    },
    webServer: {
        command: 'npx wrangler dev --port 8788 --ip 127.0.0.1',
        port: 8788,
        reuseExistingServer: true,
        timeout: 120000,
    },
})
