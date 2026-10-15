import { describe, expect, it } from "vitest";
import { cleanFolio, detectCounty, detectCountyFromFolio } from "../src/index.js";

const c = (long: string, types: string[]) => ({ long_name: long, short_name: long, types });

describe("detectCounty", () => {
  it("uses administrative_area_level_2 first", () => {
    expect(detectCounty({ address_components: [c("Miami-Dade County", ["administrative_area_level_2"]), c("Hollywood", ["locality"])] })).toBe("miami-dade");
    expect(detectCounty({ address_components: [c("Broward County", ["administrative_area_level_2"])] })).toBe("broward");
    expect(detectCounty({ address_components: [c("Palm Beach County", ["administrative_area_level_2"])] })).toBe("palm-beach");
  });
  it("is undefined for other counties", () => {
    expect(detectCounty({ address_components: [c("Monroe County", ["administrative_area_level_2"]), c("Key West", ["locality"])] })).toBeUndefined();
  });
  it("reads formatted_address text", () => {
    expect(detectCounty({ formatted_address: "1 Main St, Foo, Broward County, FL" })).toBe("broward");
  });
  it("falls back to the city table, from components or text", () => {
    expect(detectCounty({ address_components: [c("Hialeah", ["locality"])] })).toBe("miami-dade");
    expect(detectCounty("1 Main St, Delray Beach, FL 33444")).toBe("palm-beach");
  });
  it("is undefined when nothing identifies a county", () => {
    expect(detectCounty("1 Main St, Orlando, FL")).toBeUndefined();
    expect(detectCounty("1 Main St")).toBeUndefined();
  });
  it("does not mistake a street named Broward for the county", () => {
    expect(detectCounty("1 Broward Blvd, Orlando, FL")).toBeUndefined();
  });
});

describe("folio helpers", () => {
  it("cleans separators and case", () => {
    expect(cleanFolio("01-4102-089-0001")).toBe("0141020890001");
    expect(cleanFolio("4742 31 aa 0030")).toBe("474231AA0030");
  });
  it("detects county from shape", () => {
    expect(detectCountyFromFolio("0141020890001")).toBe("miami-dade");
    expect(detectCountyFromFolio("50-43-43-03-04-000-0130")).toBe("palm-beach");
    expect(detectCountyFromFolio("5042 34 01 0010")).toBe("broward");
    expect(detectCountyFromFolio("474331AA0030")).toBe("broward");
    expect(detectCountyFromFolio("123")).toBeUndefined();
  });
});
