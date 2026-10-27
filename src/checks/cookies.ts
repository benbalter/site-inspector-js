import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

interface CookieInfo {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

function parseCookie(raw: string): CookieInfo {
  const parts = raw.split(";").map((p) => p.trim());
  const nameValue = parts[0] ?? "";
  const name = nameValue.split("=")[0] ?? "";

  let secure = false;
  let httpOnly = false;
  let sameSite: string | null = null;

  for (const part of parts.slice(1)) {
    const lower = part.toLowerCase();
    if (lower === "secure") {
      secure = true;
    } else if (lower === "httponly") {
      httpOnly = true;
    } else if (lower.startsWith("samesite=")) {
      const val = part.split("=")[1]?.trim() ?? "";
      // Normalize to title case
      sameSite = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
    }
  }

  return { name, secure, httpOnly, sameSite };
}

/**
 * Whether a cookie uses a name prefix (RFC 6265bis §4.1.3) and breaks its
 * rules. Browsers silently drop such cookies, so it's a real bug, not style.
 */
function prefixStatus(raw: string): { prefixed: boolean; valid: boolean } {
  const parts = raw.split(";").map((p) => p.trim().toLowerCase());
  const name = parts[0]?.split("=")[0] ?? "";
  const attributes = parts.slice(1);
  const secure = attributes.includes("secure");
  if (name.startsWith("__secure-")) return { prefixed: true, valid: secure };
  if (name.startsWith("__host-")) {
    const hasDomain = attributes.some((a) => a.startsWith("domain="));
    const rootPath = attributes.some((a) => a.replace(/\s/g, "") === "path=/");
    return { prefixed: true, valid: secure && !hasDomain && rootPath };
  }
  return { prefixed: false, valid: true };
}

export class CookiesCheck implements Check {
  name = "cookies";

  async run(endpoint: EndpointData, _domain?: string): Promise<CheckResult> {
    if (endpoint.setCookies.length === 0) {
      return {
        name: this.name,
        data: {
          hasCookies: false,
          count: 0,
          cookies: [],
          allSecure: true,
          allHttpOnly: true,
          prefixedCount: 0,
          invalidPrefixed: [],
          prefixViolation: false,
        },
      };
    }

    const cookies = endpoint.setCookies.map(parseCookie);
    const prefixes = endpoint.setCookies.map(prefixStatus);
    const invalidPrefixed = cookies.filter((_c, i) => !prefixes[i].valid).map((c) => c.name);

    return {
      name: this.name,
      data: {
        hasCookies: true,
        count: cookies.length,
        cookies,
        allSecure: cookies.every((c) => c.secure),
        allHttpOnly: cookies.every((c) => c.httpOnly),
        prefixedCount: prefixes.filter((p) => p.prefixed).length,
        invalidPrefixed,
        prefixViolation: invalidPrefixed.length > 0,
      },
    };
  }
}
