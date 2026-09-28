import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { USER_AGENT, readBody } from "../utils.js";

/**
 * Green Web Foundation greencheck v3 response. A domain that isn't green
 * comes back as just `{ green: false, url, data: false }`.
 */
interface GreenCheck {
  green?: boolean;
  hosted_by?: string;
  hosted_by_website?: string;
  supporting_documents?: unknown[];
}

const MAX_RESPONSE_BYTES = 256 * 1024;

export class GreenHostingCheck implements Check {
  name = "green-hosting";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const url = `https://api.thegreenwebfoundation.org/api/v3/greencheck/${encodeURIComponent(domain)}`;
    const timeout = AbortSignal.timeout(ctx?.timeoutMs ?? 10_000);

    let result: GreenCheck;
    try {
      const res = await fetch(url, {
        signal: ctx ? AbortSignal.any([timeout, ctx.signal]) : timeout,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`Green Web Foundation API returned HTTP ${res.status}`);
      }
      result = JSON.parse(await readBody(res, MAX_RESPONSE_BYTES)) as GreenCheck;
      if (typeof result?.green !== "boolean") {
        throw new Error("Green Web Foundation API returned an invalid response");
      }
    } catch (err) {
      return {
        name: this.name,
        data: {
          available: false,
          green: null,
          hostedBy: null,
          hostedByWebsite: null,
          supportingDocuments: null,
          error: timeout.aborted
            ? "Green Web Foundation API timed out"
            : err instanceof Error
              ? err.message
              : String(err),
        },
      };
    }

    return {
      name: this.name,
      data: {
        available: true,
        green: result.green,
        hostedBy: result.hosted_by || null,
        hostedByWebsite: result.hosted_by_website || null,
        supportingDocuments: Array.isArray(result.supporting_documents)
          ? result.supporting_documents.length
          : 0,
        error: null,
      },
    };
  }
}
