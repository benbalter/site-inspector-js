import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

async function fetchWellKnown(
  baseUrl: string,
  path: string,
): Promise<{ ok: boolean; body: string }> {
  try {
    const url = new URL(path, baseUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const body = res.status === 200 ? await res.text() : "";
    return {
      ok: res.status === 200 || (res.status >= 300 && res.status < 400),
      body,
    };
  } catch {
    return { ok: false, body: "" };
  }
}

interface SecurityTxtResult {
  present: boolean;
  contact: string | null;
  expires: string | null;
  encryption: string | null;
  policy: string | null;
}

function parseSecurityTxt(body: string): Omit<SecurityTxtResult, "present"> {
  const fields: Record<string, string | null> = {
    contact: null,
    expires: null,
    encryption: null,
    policy: null,
  };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key === "contact") fields.contact = value;
    else if (key === "expires") fields.expires = value;
    else if (key === "encryption") fields.encryption = value;
    else if (key === "policy" || key === "acknowledgments")
      fields.policy = value;
  }

  return fields as Omit<SecurityTxtResult, "present">;
}

export class WellKnownCheck implements Check {
  name = "well-known";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const origin = new URL(endpoint.url).origin;

    const [securityRes, changePasswordRes] = await Promise.all([
      fetchWellKnown(origin, "/.well-known/security.txt"),
      fetchWellKnown(origin, "/.well-known/change-password"),
    ]);

    const parsed = parseSecurityTxt(securityRes.body);
    const securityTxt: SecurityTxtResult = {
      present: securityRes.ok,
      ...parsed,
    };

    return {
      name: this.name,
      data: {
        securityTxt,
        changePassword: changePasswordRes.ok,
      },
    };
  }
}
