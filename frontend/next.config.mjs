import { fileURLToPath } from "node:url";
import { agonRedirects } from "./src/lib/agon/redirects.mjs";
import { SECURITY_HEADERS } from "./src/lib/security-headers.mjs";
/** @type {import('next').NextConfig} */
const nextConfig = {
  // BNB owns its runtime inside the exportable subtree. Trace it into AGON's
  // production build so the same implementation serves both repositories.
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  distDir: process.env.AGON_BUILD_DIR || ".next",
  // Don't fail the production build on lint (e.g. <a> vs <Link>); types are still checked.
  eslint: { ignoreDuringBuilds: true },
  // Browser protections, including the script policy, live in src/lib/security-headers.mjs.
  async redirects() {
    return agonRedirects(process.env.NEXT_PUBLIC_PRODUCT_VARIANT);
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  webpack: (config) => {
    // wagmi's connector barrel pulls in @metamask/sdk, which optionally imports
    // React Native and Node-only modules that do not exist in a web build.
    // Stub them so the bundle resolves cleanly.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
