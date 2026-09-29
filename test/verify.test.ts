import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { InMemoryBsbDirectory, normalizeAccountNumber, normalizeBsb } from "../src/bsb.js";
import { verifyBankAccount } from "../src/middleware.js";
import { matchNames } from "../src/nameMatch.js";
import { MockProvider, type AccountVerificationProvider } from "../src/providers/types.js";

const provider = new MockProvider({ "062-000:12345678": "John Smith" });
const bsbDirectory = new InMemoryBsbDirectory([{ bsb: "062-000", bank: "CBA", branch: "Sydney" }]);

function app(opts: Partial<Parameters<typeof verifyBankAccount>[0]> = {}) {
  const a = express();
  a.use(express.json());
  a.post("/", verifyBankAccount({ provider, bsbDirectory, ...opts }), (req, res) =>
    res.json(req.bankVerification),
  );
  return a;
}
const body = (o = {}) => ({ bsb: "062000", accountNumber: "12345678", accountName: "John Smith", ...o });

describe("normalizers", () => {
  it("normalizes BSB", () => {
    expect(normalizeBsb("062000")).toBe("062-000");
    expect(normalizeBsb("062-000")).toBe("062-000");
    expect(normalizeBsb("62-000")).toBeUndefined();
  });
  it("validates account number", () => {
    expect(normalizeAccountNumber("1234 5678")).toBe("12345678");
    expect(normalizeAccountNumber("123")).toBeUndefined();
  });
});

describe("matchNames", () => {
  it("handles order, case, titles", () => {
    expect(matchNames("SMITH john", "Mr John Smith").result).toBe("match");
  });
  it("close match on typo", () => {
    expect(matchNames("Jon Smith", "John Smith").result).toBe("close_match");
  });
  it("initial matches full name", () => {
    expect(matchNames("J Smith", "John Smith").result).not.toBe("no_match");
  });
  it("different first name is not a close match", () => {
    expect(matchNames("Jane Smith", "John Smith").result).toBe("no_match");
  });
  it("no match", () => {
    expect(matchNames("Alice Nguyen", "John Smith").result).toBe("no_match");
  });
});

describe("verifyBankAccount", () => {
  it("passes on verified", async () => {
    const r = await request(app()).post("/").send(body());
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("verified");
    expect(r.body.bank.bank).toBe("CBA");
  });
  it("rejects mismatch without leaking real name", async () => {
    const r = await request(app()).post("/").send(body({ accountName: "Alice Nguyen" }));
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).not.toContain("John");
  });
  it("close match rejected by default, allowed by option, name suggested", async () => {
    const strict = await request(app()).post("/").send(body({ accountName: "Jon Smith" }));
    expect(strict.status).toBe(422);
    expect(strict.body.verification.suggestedName).toBe("John Smith");
    const lax = await request(app({ allowCloseMatch: true })).post("/").send(body({ accountName: "Jon Smith" }));
    expect(lax.status).toBe(200);
  });
  it("400 on invalid input", async () => {
    const r = await request(app()).post("/").send(body({ bsb: "abc" }));
    expect(r.status).toBe(400);
  });
  it("unknown BSB and unknown account", async () => {
    expect((await request(app()).post("/").send(body({ bsb: "999999" }))).body.error).toBe("bsb_not_found");
    expect((await request(app()).post("/").send(body({ accountNumber: "99999999" }))).body.error).toBe("account_not_found");
  });
  it("502 when provider fails or times out", async () => {
    const bad: AccountVerificationProvider = { lookupAccount: () => new Promise(() => {}) };
    const r = await request(app({ provider: bad, timeoutMs: 20 })).post("/").send(body());
    expect(r.status).toBe(502);
  });
  it("annotate mode always continues", async () => {
    const r = await request(app({ mode: "annotate" })).post("/").send(body({ accountName: "Alice Nguyen" }));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("name_mismatch");
  });
});
