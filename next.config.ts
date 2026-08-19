import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core drives the headless browser behind /api/aspire-search. It
  // ships native bindings, so it has to be `require`d at runtime rather than
  // bundled — declared here so that's explicit rather than relying on Next's
  // built-in external list.
  serverExternalPackages: ["playwright-core"],
  // …and force the whole package into those two routes' traces. playwright-core
  // reaches its internals through dynamic requires the tracer can't follow, so
  // it shipped a partial copy — the entry point loaded and then threw on a
  // missing file, which surfaced as a 503 from /api/aspire-search.
  outputFileTracingIncludes: {
    "/api/aspire-search": ["./node_modules/playwright-core/**/*"],
    "/api/admin/aspire-session": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
