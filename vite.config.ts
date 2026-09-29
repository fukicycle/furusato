import { defineConfig } from 'vitest/config';

// GitHub Pages のプロジェクトサイト（https://fukicycle.github.io/furusato/）で配信するため base を合わせる
export default defineConfig({
  base: '/furusato/',
  build: {
    target: 'es2020',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
