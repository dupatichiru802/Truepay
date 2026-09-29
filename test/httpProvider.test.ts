import { describe, expect, it, vi } from "vitest";
import { HttpProvider } from "../src/providers/http.js";

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("HttpProvider", () => {
  it("posts bsb/account with headers and maps the default response", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { exists: true, accountName: "John Smith" }));
    const p = new HttpProvider({ url: "https://x.test/v", headers: { authorization: "Bearer k" }, fetch: f });
    expect(await p.lookupAccount("062-000", "123")).toEqual({ exists: true, accountName: "John Smith" });
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ bsb: "062-000", accountNumber: "123" });
    expect(init.headers.authorization).toBe("Bearer k");
  });
  it("supports custom request/response mapping", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { data: { holder: "A B" } }));
    const p = new HttpProvider({
      url: "https://x.test/v",
      fetch: f,
      buildRequest: (b, a) => ({ branch: b, acct: a }),
      mapResponse: (j) => ({ exists: true, accountName: (j as any).data.holder }),
    });
    expect((await p.lookupAccount("1", "2")).accountName).toBe("A B");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ branch: "1", acct: "2" });
  });
  it("treats 404 as not found", async () => {
    const p = new HttpProvider({ url: "https://x.test/v", fetch: vi.fn().mockResolvedValue(json(404)) });
    expect(await p.lookupAccount("1", "2")).toEqual({ exists: false });
  });
  it("retries 5xx once then succeeds; throws when exhausted", async () => {
    const ok = vi.fn().mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(200, { exists: false }));
    expect(await new HttpProvider({ url: "https://x.test/v", fetch: ok }).lookupAccount("1", "2")).toEqual({ exists: false });
    const bad = vi.fn().mockResolvedValue(json(500));
    await expect(new HttpProvider({ url: "https://x.test/v", fetch: bad }).lookupAccount("1", "2")).rejects.toThrow();
    expect(bad).toHaveBeenCalledTimes(2);
  });
  it("does not retry 4xx and rejects insecure urls", async () => {
    const f = vi.fn().mockResolvedValue(json(401));
    await expect(new HttpProvider({ url: "https://x.test/v", fetch: f }).lookupAccount("1", "2")).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    expect(() => new HttpProvider({ url: "http://evil.example/v" })).toThrow(/https/);
  });
});
