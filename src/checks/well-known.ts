import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { safeFetch } from "../utils.js";

async function fetchWellKnown(
  baseUrl: string,
  path: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = new URL(path, baseUrl).href;
  const res = await safeFetch(url, 5000);
  if (!res) return { ok: false, status: 0, body: "" };
  return {
    ok: res.statusCode === 200,
    status: res.statusCode,
    body: res.statusCode === 200 ? res.body : "",
  };
}

interface SecurityTxtResult {
  present: boolean;
  /** Every Contact field (RFC 9116 allows several). */
  contact: string[];
  expires: string | null;
  /** Every Encryption field. */
  encryption: string[];
  policy: string | null;
  acknowledgments: string | null;
}

function parseSecurityTxt(body: string): Omit<SecurityTxtResult, "present"> {
  const fields: Omit<SecurityTxtResult, "present"> = {
    contact: [],
    expires: null,
    encryption: [],
    policy: null,
    acknowledgments: null,
  };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key === "contact") fields.contact.push(value);
    else if (key === "expires") fields.expires = value;
    else if (key === "encryption") fields.encryption.push(value);
    else if (key === "policy") fields.policy = value;
    else if (key === "acknowledgments") fields.acknowledgments = value;
  }

  return fields;
}

export class WellKnownCheck implements Check {
  name = "well-known";

  async run(endpoint: EndpointData, domain: string): Promise<CheckResult> {
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
      // A request without a resource must get a 400 from a WebFinger server
      // (RFC 7033 §4.2); unknown resources get 404, which is indistinguishable
      // from no server at all.
      fetchWellKnown(origin, "/.well-known/webfinger"),
      // The MTA-STS policy is served from the mta-sts subdomain (RFC 8461 §3.2).
      fetchWellKnown(`https://mta-sts.${domain}`, "/.well-known/mta-sts.txt"),
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
        webfinger: webfingerRes.status === 400 || webfingerRes.status === 200,
        mtaSts: mtaStsRes.ok,
        assetlinks: assetlinksRes.ok,
        appleAppSiteAssociation: appleAppRes.ok,
        nodeinfo: nodeInfoRes.ok,
        humansTxt: humansRes.ok,
      },
    };
  }
}
