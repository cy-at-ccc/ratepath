/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: produces ./out as a tree of pre-rendered HTML/CSS/JS.
  // The app is client-only (IndexedDB + Web Worker, no API routes, no SSR
  // data fetching), so every page in app/ pre-renders cleanly at build time.
  // Required for Cloudflare Workers Static Assets / Pages deployment.
  output: "export",

  // Emit /about/index.html etc. instead of /about.html — matches how the
  // App Router serves routes during `next dev` and how Workers Static
  // Assets resolves paths.
  trailingSlash: true,

  // next/image's default optimisation loader needs a server; static export
  // can't run one. Bypass it (the app uses no <Image> components today;
  // this just future-proofs the build).
  images: { unoptimized: true }
};

export default nextConfig;
