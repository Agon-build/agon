import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const nextConfig = {
  // BNB owns its runtime inside the exportable subtree. Trace it into AGON's
  // production build so the same implementation serves both repositories.
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  distDir: process.env.AGON_BUILD_DIR || ".next",
  // Don't fail the production build on lint (e.g. <a> vs <Link>); types are still checked.
  eslint: { ignoreDuringBuilds: true },
  // Baseline browser protections. AGON pages are never meant to be framed,
  // which also protects the sign-in, CLI approval, and admin screens from
  // clickjacking. A full script CSP needs a nonce plan for wallet SDKs and is
  // tracked separately.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
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
