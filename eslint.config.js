import eslint from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  eslint.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
];
