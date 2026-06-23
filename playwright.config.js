const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:8787',
        headless: true,
    },
    webServer: {
        command: 'npx wrangler dev --port 8787 --ip 127.0.0.1 --var SCN_SECRET:e2e-test-secret --var SCN_SALT:e2e-test-salt --var SCN_INDEX_PASSWD:e2e-test-password',
        port: 8787,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
    },
})
