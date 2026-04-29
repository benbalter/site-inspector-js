import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { safeFetch } from "../utils.js";

async function fetchWellKnown(
  baseUrl: string,
  path: string,
): Promise<{ ok: boolean; body: string }> {
  const url = new URL(path, baseUrl).href;
  const res = await safeFetch(url, 5000);
  if (!res) return { ok: false, body: "" };
  return {
    ok: res.statusCode === 200,
    body: res.statusCode === 200 ? res.body : "",
  };
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

    const [
      securityRes,
      changePasswordRes,
      openidRes,
      webfingerRes,
      mtaStsRes,
      assetlinksRes,
      appleAppRes,
      nodeInfoRes,
      humansRes,
    ] = await Promise.all([
      fetchWellKnown(origin, "/.well-known/security.txt"),
      fetchWellKnown(origin, "/.well-known/change-password"),
      fetchWellKnown(origin, "/.well-known/openid-configuration"),
      fetchWellKnown(origin, "/.well-known/webfinger?resource=acct:test@test"),
      fetchWellKnown(origin, "/.well-known/mta-sts.txt"),
      fetchWellKnown(origin, "/.well-known/assetlinks.json"),
      fetchWellKnown(origin, "/.well-known/apple-app-site-association"),
      fetchWellKnown(origin, "/.well-known/nodeinfo"),
      fetchWellKnown(origin, "/humans.txt"),
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
        openidConfiguration: openidRes.ok,
        webfinger: webfingerRes.ok,
        mtaSts: mtaStsRes.ok,
        assetlinks: assetlinksRes.ok,
        appleAppSiteAssociation: appleAppRes.ok,
        nodeinfo: nodeInfoRes.ok,
        humansTxt: humansRes.ok,
      },
    };
  }
}
