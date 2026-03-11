const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const globals = require('globals')

module.exports = tseslint.config(
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'static/js/app.js',
            'test-results/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: __dirname,
            },
            globals: {
                ...globals.serviceworker,
            },
        },
        rules: {
            'no-console': 'off',
        },
    },
    {
        files: ['frontend/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.frontend.json',
                tsconfigRootDir: __dirname,
            },
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            'no-alert': 'off',
        },
    }
)
