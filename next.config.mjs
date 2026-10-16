/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  htmlLimitedBots: /.*/, // render metadata in <head> for every client, not streamed
  async headers() {
    return [
      { source: "/embed.js", headers: [{ key: "Cache-Control", value: "public, max-age=300, s-maxage=300" }, { key: "Access-Control-Allow-Origin", value: "*" }] },
      { source: "/admin/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
    ];
  },
};
export default nextConfig;
