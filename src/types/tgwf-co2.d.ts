// @tgwf/co2 ships no type declarations; this covers the parts site-inspector uses.
declare module "@tgwf/co2" {
  export interface CO2Options {
    model?: "swd" | "1byte";
    version?: 3 | 4;
  }

  export interface CO2EstimateComponents {
    networkCO2: number;
    dataCenterCO2: number;
    consumerDeviceCO2: number;
    productionCO2: number;
    total: number;
  }

  export class co2 {
    constructor(options?: CO2Options);
    /** Grams of CO2 for transferring `bytes`, optionally on green hosting. */
    perByte(bytes: number, green?: boolean): number | CO2EstimateComponents;
  }
}
