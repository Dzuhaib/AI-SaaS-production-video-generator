import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node for unit tests. The browser and render suites drive a real Chromium
    // themselves, because jsdom has no layout: offsetParent, offsetTop/Left and
    // getBoundingClientRect all return 0, and getTotalLength() is unimplemented.
    // Anything touching point(), cursorTo() or draw() cannot be tested there.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Rendering is IO-bound and spawns browsers; running suites in parallel
    // makes frame-timing assertions flaky.
    fileParallelism: false,
  },
});
