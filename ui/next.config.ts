import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Ensures each page becomes a folder with index.html (nice for extension paths)
  trailingSlash: true,
  images: { unoptimized: true },
  // Serve Next assets from the extension's /ui folder.
  assetPrefix: "/ui"
};

export default nextConfig;
