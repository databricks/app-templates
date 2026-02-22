export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2022',
          module: 'esnext',
          lib: ['ES2022'],
          moduleResolution: 'nodenext',
          resolveJsonModule: true,
          allowJs: true,
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          types: ['node', 'jest'],
          isolatedModules: true,
        },
        diagnostics: {
          ignoreCodes: [1343, 151002], // Ignore import.meta errors in tests
        },
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'], // Exclude e2e tests by default
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 30000,
};
