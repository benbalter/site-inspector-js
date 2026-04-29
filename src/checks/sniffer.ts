import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

interface CmsPattern {
  name: string;
  patterns: RegExp[];
}

interface TechPattern {
  name: string;
  patterns: RegExp[];
}

const CMS_PATTERNS: CmsPattern[] = [
  {
    name: "WordPress",
    patterns: [
      /wp-content/,
      /wp-includes/,
      /<meta\s+name="generator"\s+content="WordPress/i,
    ],
  },
  {
    name: "Drupal",
    patterns: [
      /Drupal\.settings/,
      /<meta\s+name="generator"\s+content="Drupal/i,
    ],
  },
  {
    name: "Joomla",
    patterns: [/<meta\s+name="generator"\s+content="Joomla/i],
  },
  {
    name: "Ghost",
    patterns: [/<meta\s+name="generator"\s+content="Ghost/i],
  },
  {
    name: "Squarespace",
    patterns: [
      /squarespace\.com/,
      /<meta\s+name="generator"\s+content="Squarespace/i,
    ],
  },
  {
    name: "Hugo",
    patterns: [/<meta\s+name="generator"\s+content="Hugo/i],
  },
  {
    name: "Jekyll",
    patterns: [/<meta\s+name="generator"\s+content="Jekyll/i],
  },
];

const JS_FRAMEWORK_PATTERNS: TechPattern[] = [
  {
    name: "React",
    patterns: [/react-root/, /data-reactroot/],
  },
  {
    name: "Next.js",
    patterns: [/__NEXT_DATA__/, /_next\//],
  },
  {
    name: "Vue.js",
    patterns: [/__VUE__/, /data-v-/],
  },
  {
    name: "Nuxt",
    patterns: [/__NUXT__/, /_nuxt\//],
  },
  {
    name: "Angular",
    patterns: [/ng-version/, /ng-app/],
  },
  {
    name: "Svelte",
    patterns: [/__svelte/],
  },
  {
    name: "jQuery",
    patterns: [/jquery\.min\.js/, /jquery-/],
  },
];

const ANALYTICS_PATTERNS: TechPattern[] = [
  {
    name: "Google Analytics",
    patterns: [
      /google-analytics\.com\/analytics\.js/,
      /googletagmanager\.com\/gtag/,
      /ga\('create/,
    ],
  },
  {
    name: "Google Tag Manager",
    patterns: [/googletagmanager\.com\/gtm\.js/],
  },
  {
    name: "Plausible",
    patterns: [/plausible\.io\/js/],
  },
  {
    name: "Matomo",
    patterns: [/matomo\.js/, /piwik\.js/],
  },
];

const ADVERTISING_PATTERNS: TechPattern[] = [
  {
    name: "Google AdSense",
    patterns: [/pagead2\.googlesyndication\.com/],
  },
  {
    name: "DoubleClick",
    patterns: [/doubleclick\.net/],
  },
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function detectCms(body: string): string | null {
  for (const cms of CMS_PATTERNS) {
    if (matchesAny(body, cms.patterns)) {
      return cms.name;
    }
  }
  return null;
}

function detectAll(body: string, patterns: TechPattern[]): string[] {
  return patterns
    .filter((tech) => matchesAny(body, tech.patterns))
    .map((tech) => tech.name);
}

function detectCdn(headers: Record<string, string>): string | null {
  const server = headers["server"] ?? "";
  if (/cloudflare/i.test(server)) {
    return "Cloudflare";
  }

  const xServedBy = headers["x-served-by"] ?? "";
  if (/cache-/i.test(xServedBy)) {
    return "Fastly";
  }

  if (headers["x-amz-cf-id"]) {
    return "AWS CloudFront";
  }

  const xCache = headers["x-cache"] ?? "";
  const via = headers["via"] ?? "";
  if (/HIT|MISS/i.test(xCache) && /cloudfront/i.test(via)) {
    return "AWS CloudFront";
  }

  return null;
}

export class SnifferCheck implements Check {
  name = "sniffer";

  async run(endpoint: EndpointData): Promise<CheckResult> {
    const { body, headers } = endpoint;

    return {
      name: this.name,
      data: {
        cms: detectCms(body),
        jsFrameworks: detectAll(body, JS_FRAMEWORK_PATTERNS),
        analytics: detectAll(body, ANALYTICS_PATTERNS),
        advertising: detectAll(body, ADVERTISING_PATTERNS),
        cdn: detectCdn(headers),
      },
    };
  }
}
