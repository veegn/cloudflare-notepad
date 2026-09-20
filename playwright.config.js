const { defineConfig } = require('@playwright/test')

const PORT = Number(process.env.E2E_PORT || 8799)

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        headless: true,
        locale: 'en-US',
    },
    webServer: {
        command: `npm run start -- --port ${PORT} --ip 127.0.0.1`,
        port: PORT,
        reuseExistingServer: true,
        timeout: 180000,
        cwd: __dirname,
    },
})
