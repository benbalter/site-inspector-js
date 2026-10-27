// @tgwf/co2 ships without type declarations; these cover the parts we use.
declare module "@tgwf/co2" {
  export interface Co2Options {
    model?: "swd" | "1byte";
    version?: 3 | 4;
    rating?: boolean;
  }

  export interface RatedEstimate {
    /** Grams of CO2e. */
    total: number;
    /** Sustainable Web Design rating, A+ (best) to F. */
    rating: string;
  }

  export class co2 {
    constructor(options?: Co2Options);
    /** Grams of CO2e for one page view, or a rated estimate when `rating` is set. */
    perVisit(bytes: number, green?: boolean): number | RatedEstimate;
  }
}
