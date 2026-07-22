import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * D-031: expose the deployed commit to the browser so "is the deploy stale?" is a
   * fact, not a guess. Vercel sets VERCEL_GIT_COMMIT_SHA per build; JudgeApp logs it on
   * load ("[build] rubrix <sha>"). In an incognito window (no cache) this shows exactly
   * what production is actually serving.
   */
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
  },
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
