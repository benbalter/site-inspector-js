import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const SENSITIVE_FEATURES = [
  "camera",
  "microphone",
  "geolocation",
  "payment",
  "usb",
  "bluetooth",
  "serial",
  "hid",
  "display-capture",
  "screen-wake-lock",
];

// Permissions-Policy format: feature=allowlist, feature2=allowlist
// e.g. "camera=(), microphone=(self), geolocation=*"
function parsePermissionsPolicy(
  header: string,
): Record<string, string> {
  const features: Record<string, string> = {};
  // Split on comma, then parse each directive
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const value = trimmed.slice(eqIdx + 1).trim();
    features[name] = value;
  }
  return features;
}

export class PermissionsPolicyCheck implements Check {
  name = "permissions-policy";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const ppHeader = endpoint.headers["permissions-policy"] ?? null;
    const fpHeader = endpoint.headers["feature-policy"] ?? null;
    const raw = ppHeader ?? fpHeader ?? null;
    const headerType = ppHeader
      ? "permissions-policy"
      : fpHeader
        ? "feature-policy"
        : null;

    if (!raw) {
      return {
        name: this.name,
        data: {
          present: false,
          headerType: null,
          features: {},
          blocked: [],
          allowed: [],
          dangerousGrants: [],
          rawHeader: null,
        },
      };
    }

    const features = parsePermissionsPolicy(raw);
    const blocked = Object.entries(features)
      .filter(([, v]) => v === "()" || v === "'none'")
      .map(([k]) => k);
    const allowed = Object.entries(features)
      .filter(([, v]) => v !== "()" && v !== "'none'")
      .map(([k]) => k);
    // Features granted to * (wildcard) that are sensitive
    const dangerousGrants = Object.entries(features)
      .filter(([k, v]) => v === "*" && SENSITIVE_FEATURES.includes(k))
      .map(([k]) => k);

    return {
      name: this.name,
      data: {
        present: true,
        headerType,
        features,
        blocked,
        allowed,
        dangerousGrants,
        rawHeader: raw,
      },
    };
  }
}
