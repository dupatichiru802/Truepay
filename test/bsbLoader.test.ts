import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBsbDirectory, parseBsbCsv, parseBsbFixedWidth, parseBsbJson } from "../src/bsbLoader.js";

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
    await expect(loadBsbDirectory(join(dir, "x.xml"))).rejects.toThrow(/Unsupported/);
  });
});

const pad = (s: string, n: number) => s.padEnd(n);
const line = (bsb: string, bank: string, branch: string, addr: string, sub: string, st: string, pc: string, fl: string) =>
  bsb + bank + pad(branch, 35) + pad(addr, 0) + pad(sub, 20) + st + pc + fl;
const FW = [
  "HEADER RECORD  Effective Date: 29 Sep 2026",
  line("062-000", "CBA", "Sydney Town Hall", "", "Sydney", "NSW", "2000", "PEH "),
  line("012-003", "ANZ", "Merged", "Refer to BSB 012-019".padEnd(35), "Sydney", "NSW", "2000", "PEH "),
  line("066-100", "CTB", "Perth\tBranch", "1 St".padEnd(35), "Perth", "WA", "6000", "PE  "),
  "garbage line",
  "TRAILER RECORD  Number of records: 3",
].join("\n");

describe("parseBsbFixedWidth", () => {
  it("parses records, header date, trailer count, merged BSBs", () => {
    const r = parseBsbFixedWidth(FW);
    expect(r.effectiveDate).toBeTruthy();
    expect(r.declaredCount).toBe(3);
    expect(r.records.map((x) => x.bsb)).toEqual(["062-000", "012-003", "066-100"]);
    const merged = r.records[1];
    expect(merged.active).toBe(false);
    expect(merged.mergedInto).toBe("012-019");
    expect(r.records[2].state).toBe("WA");
    expect(r.records[0].active).not.toBe(false);
  });
  it("loads .txt and throws on count mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bsb-"));
    const f = join(dir, "bsb.txt");
    await writeFile(f, FW);
    expect((await loadBsbDirectory(f)).count).toBe(3);
    await writeFile(f, FW.replace("records: 3", "records: 9"));
    await expect(loadBsbDirectory(f)).rejects.toThrow();
    expect((await loadBsbDirectory(f, { allowCountMismatch: true })).count).toBe(3);
  });
});
