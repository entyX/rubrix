import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Ship the rubric library with the serverless functions.
   *
   * The page and /api/grade read rubrics off disk with a path built at runtime
   * (`rubrics/${org}/${category}/${slug}.rubric.json`). Next's file tracer only follows
   * STATIC imports, so it has no way to know those files are needed and leaves them out
   * of the bundle — the app then works perfectly on a laptop and throws ENOENT the moment
   * it's deployed. Tracing them in explicitly is the fix.
   *
   * The source PDFs are deliberately NOT included: nothing reads them at runtime, they're
   * the orgs' IP (plan.md §20), and they'd bloat the function for no reason.
   */
  outputFileTracingIncludes: {
    "/": ["./rubrics/**/*.json"],
    "/api/grade": ["./rubrics/**/*.json"],
    "/api/qa-grade": ["./rubrics/**/*.json"],
    "/api/rubrics": ["./rubrics/**/*.json"],
  },
};

export default nextConfig;
