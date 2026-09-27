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
        },
      };
    }

    const cookies = endpoint.setCookies.map(parseCookie);

    return {
      name: this.name,
      data: {
        hasCookies: true,
        count: cookies.length,
        cookies,
        allSecure: cookies.every((c) => c.secure),
        allHttpOnly: cookies.every((c) => c.httpOnly),
      },
    };
  }
}
