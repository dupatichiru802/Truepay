import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBsbDirectory, parseBsbCsv, parseBsbJson } from "../src/bsbLoader.js";

const CSV = [
  "BSB,Bank,Branch,Street,Suburb,State,Postcode,Flags",
  '062-000,CBA,"Sydney, Town Hall",1 Main St,Sydney,NSW,2000,PEH',
  "\"012-003\",ANZ,ANZ Branch,2 High St,Melbourne,VIC,3000,PEH",
  "",
  "bad,XX,Nope,,,,,",
].join("\r\n");

describe("parseBsbCsv", () => {
  it("parses rows, quoted commas, and skips header/invalid lines", () => {
    const { records, skipped } = parseBsbCsv("﻿" + CSV);
    expect(records).toEqual([
      { bsb: "062-000", bank: "CBA", branch: "Sydney, Town Hall", state: "NSW" },
      { bsb: "012-003", bank: "ANZ", branch: "ANZ Branch", state: "VIC" },
    ]);
    expect(skipped).toBe(2);
  });
  it("supports custom column mapping", () => {
    const { records } = parseBsbCsv("VIC,Bank X,Branch Y,062000", { bsb: 3, bank: 1, branch: 2, state: 0 });
    expect(records[0]).toEqual({ bsb: "062-000", bank: "Bank X", branch: "Branch Y", state: "VIC" });
  });
});

describe("parseBsbJson", () => {
  it("parses and skips invalid entries", () => {
    const { records, skipped } = parseBsbJson('[{"bsb":"062000","bank":"CBA","branch":"S"},{"bsb":"x"}]');
    expect(records).toHaveLength(1);
    expect(skipped).toBe(1);
  });
  it("rejects non-arrays", () => {
    expect(() => parseBsbJson("{}")).toThrow();
  });
});

describe("loadBsbDirectory", () => {
  it("loads a csv file into a working directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bsb-"));
    const file = join(dir, "bsb.csv");
    await writeFile(file, CSV);
    const { directory, count } = await loadBsbDirectory(file);
    expect(count).toBe(2);
    expect(directory.lookup("062000")?.bank).toBe("CBA");
    expect(directory.lookup("999-999")).toBeUndefined();
  });
  it("errors on empty results and unsupported types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bsb-"));
    const empty = join(dir, "e.csv");
    await writeFile(empty, "header only\n");
    await expect(loadBsbDirectory(empty)).rejects.toThrow(/No valid BSB/);
    await expect(loadBsbDirectory(join(dir, "x.txt"))).rejects.toThrow(/Unsupported/);
  });
});
