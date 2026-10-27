import eslint from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '**/*.min.js'] },
  eslint.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
];
