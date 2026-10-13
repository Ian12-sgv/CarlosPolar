import { defineConfig } from 'vitest/config';

// Solo la lógica pura (sin React Native) se prueba con vitest.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
