import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**', '**/.databricks/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['**/*.{ts,tsx}'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['client/**/*.{ts,tsx}', '**/*.tsx'],
    languageOptions: { globals: globals.browser },
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin, 'react-refresh': reactRefreshPlugin },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/prop-types': 'off',
      'react/no-array-index-key': 'warn',
    },
  },
  { files: ['**/*.config.{js,ts}'], ...tseslint.configs.disableTypeChecked },
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
);
