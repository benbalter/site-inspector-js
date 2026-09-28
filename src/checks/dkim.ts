import { createPublicKey } from "node:crypto";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { findTxtRecords } from "../utils.js";

/** Selectors used by common mail providers and platforms. */
export const COMMON_SELECTORS = [
  "google",
  "selector1",
  "selector2",
  "k1",
  "k2",
  "k3",
  "default",
  "s1",
  "s2",
  "mail",
  "dkim",
  "smtp",
  "mandrill",
  "mxvault",
  "sig1",
  "everlytickey1",
  "zendesk1",
  "zendesk2",
  "protonmail",
  "protonmail2",
  "protonmail3",
  "fm1",
  "fm2",
  "fm3",
];

export interface DkimSelector {
  selector: string;
  keyType: string;
  /** Key size in bits, or null if the key couldn't be parsed. */
  keyBits: number | null;
  /** The record has an empty `p=`, meaning the key was revoked (RFC 6376 §3.6.1). */
  revoked: boolean;
}

function tags(record: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of record.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    map.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).replace(/\s+/g, ""));
  }
  return map;
}

function keyBits(keyType: string, p: string): number | null {
  if (keyType === "ed25519") return 256;
  try {
    const key = createPublicKey({ key: Buffer.from(p, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyDetails?.modulusLength ?? null;
  } catch {
    return null;
  }
}

/** Parse a DKIM key record into what we report about it. */
export function parseDkimRecord(selector: string, record: string): DkimSelector {
  const t = tags(record);
  const keyType = (t.get("k") ?? "rsa").toLowerCase();
  const p = t.get("p") ?? "";
  return {
    selector,
    keyType,
    keyBits: p ? keyBits(keyType, p) : null,
    revoked: t.has("p") && p === "",
  };
}

/**
 * Looks for DKIM public keys at commonly used selectors. DKIM selectors
 * can't be enumerated, so not finding one here doesn't prove the domain
 * doesn't sign its mail: it may use a selector we didn't guess.
 */
export class DkimCheck implements Check {
  name = "dkim";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const lookups = await Promise.all(
      COMMON_SELECTORS.map(async (selector) => ({
        selector,
        ...(await findTxtRecords(`${selector}._domainkey.${domain}`, /v=DKIM1|k=rsa|p=/i)),
      })),
    );

    const selectors = lookups.flatMap((l) =>
      l.records[0] === undefined ? [] : [parseDkimRecord(l.selector, l.records[0])],
    );
    const lookupErrors = lookups.filter((l) => l.error !== null).length;
    const rsaBits = selectors.flatMap((s) =>
      s.keyType === "rsa" && !s.revoked && s.keyBits !== null ? [s.keyBits] : [],
    );

    return {
      name: this.name,
      data: {
        // If nothing turned up but some lookups failed, we can't say.
        found: selectors.length > 0 ? true : lookupErrors > 0 ? null : false,
        // Domains that send no mail publish revoked (empty p=) keys on purpose,
        // so only an active key means DKIM is signing.
        hasActiveKey: selectors.some((s) => !s.revoked) ? true : lookupErrors > 0 ? null : false,
        selectors,
        probed: COMMON_SELECTORS.length,
        lookupErrors,
        // The weakest active RSA key, since array items aren't graded individually.
        minRsaKeyBits: rsaBits.length > 0 ? Math.min(...rsaBits) : null,
      },
    };
  }
}
