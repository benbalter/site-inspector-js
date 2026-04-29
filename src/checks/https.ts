import { sslChecker } from "ssl-checker";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const EXPIRING_SOON_DAYS = 30;

export class HttpsCheck implements Check {
  name = "https";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    try {
      const result = await sslChecker(domain, { timeout: DEFAULT_TIMEOUT_MS });

      return {
        name: this.name,
        data: {
          valid: result.valid,
          validationError: result.validationError ?? null,
          certIssuer: result.issuer?.CN ?? "Unknown",
          certSubject: result.subject?.CN ?? "Unknown",
          validFrom: result.validFrom,
          validTo: result.validTo,
          certDaysRemaining: result.daysRemaining,
          expiringSoon: result.daysRemaining <= EXPIRING_SOON_DAYS,
          protocol: result.protocol,
          cipher: result.cipher,
          bits: result.bits,
          fingerprint256: result.fingerprint256,
          chainComplete: result.chainComplete,
          chainLength: result.chain?.length ?? 0,
          error: null,
        },
      };
    } catch (err) {
      return {
        name: this.name,
        data: {
          valid: false,
          validationError: null,
          certIssuer: null,
          certSubject: null,
          validFrom: null,
          validTo: null,
          certDaysRemaining: null,
          expiringSoon: null,
          protocol: null,
          cipher: null,
          bits: null,
          fingerprint256: null,
          chainComplete: null,
          chainLength: null,
          error: (err as Error).message,
        },
      };
    }
  }
}
