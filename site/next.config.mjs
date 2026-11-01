import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/**
 * `outputFileTracingRoot` is pinned to this directory because the CLI package
 * one level up has its own lockfile, and Next otherwise walks up to it and
 * warns about an ambiguous workspace root.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: here,
};

export default nextConfig;
