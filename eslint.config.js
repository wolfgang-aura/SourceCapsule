'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // Ignore dependency + generated output.
    ignores: ['node_modules/**', '*.export.html', 'exports/**'],
  },
  js.configs.recommended,
  {
    // The userscript runs in the browser with Greasemonkey/Tampermonkey APIs.
    files: ['sourcecapsule.user.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Greasemonkey / Tampermonkey APIs granted in the metadata block.
        GM_xmlhttpRequest: 'readonly',
        GM_registerMenuCommand: 'readonly',
        GM_unregisterMenuCommand: 'readonly',
        GM: 'readonly',
        unsafeWindow: 'readonly',
        // Node-only export guard at the bottom of the file (no-op in browser).
        module: 'writable',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Node-based config/tooling files (CommonJS).
    files: ['eslint.config.js', 'prettier.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // ESM Node test + tooling scripts.
    files: ['test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
