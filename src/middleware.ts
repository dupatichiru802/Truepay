import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  type BsbDirectory,
  type BsbRecord,
  normalizeAccountNumber,
  normalizeBsb,
} from "./bsb.js";
import { matchNames, type NameMatchOptions, type NameMatchResult } from "./nameMatch.js";
import type { AccountVerificationProvider } from "./providers/types.js";

export type VerificationStatus =
  | "verified" // BSB valid, account exists, name matches
  | "close_match" // name is similar but not identical
  | "name_mismatch"
  | "account_not_found"
  | "bsb_not_found"
  | "invalid_input"
  | "provider_error";

export interface BankVerification {
  status: VerificationStatus;
  bsb?: string;
  bank?: BsbRecord;
  nameMatch?: NameMatchResult;
  score?: number;
  /** Only set for close_match, to support "Did you mean…?" UX. Never set on mismatch. */
  suggestedName?: string;
  message?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    bankVerification?: BankVerification;
  }
}

export interface VerifyBankAccountOptions {
  provider: AccountVerificationProvider;
  bsbDirectory?: BsbDirectory;
  /** Pull inputs from the request. Defaults to body.{bsb,accountNumber,accountName}. */
  extract?: (req: Request) => { bsb?: unknown; accountNumber?: unknown; accountName?: unknown };
  nameMatch?: NameMatchOptions;
  /** Treat close_match as a pass. Default false. */
  allowCloseMatch?: boolean;
  /** "reject" (default) responds 4xx; "annotate" always calls next() with req.bankVerification set. */
  mode?: "reject" | "annotate";
  /** Provider timeout in ms. Default 5000. */
  timeoutMs?: number;
}

const HTTP_STATUS: Record<VerificationStatus, number> = {
  verified: 200,
  close_match: 422,
  name_mismatch: 422,
  account_not_found: 422,
  bsb_not_found: 422,
  invalid_input: 400,
  provider_error: 502,
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("provider timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function verifyBankAccount(opts: VerifyBankAccountOptions): RequestHandler {
  const {
    provider,
    bsbDirectory,
    extract = (req) => req.body ?? {},
    nameMatch,
    allowCloseMatch = false,
    mode = "reject",
    timeoutMs = 5000,
  } = opts;

  const finish = (req: Request, res: Response, next: NextFunction, v: BankVerification) => {
    req.bankVerification = v;
    const pass = v.status === "verified" || (allowCloseMatch && v.status === "close_match");
    if (pass || mode === "annotate") return next();
    res.status(HTTP_STATUS[v.status]).json({ error: v.status, verification: v });
  };

  return async (req, res, next) => {
    const raw = extract(req);
    const bsb = normalizeBsb(raw.bsb);
    const accountNumber = normalizeAccountNumber(raw.accountNumber);
    const name = typeof raw.accountName === "string" ? raw.accountName.trim() : "";

    if (!bsb || !accountNumber || !name) {
      const missing = [!bsb && "bsb", !accountNumber && "accountNumber", !name && "accountName"]
        .filter(Boolean)
        .join(", ");
      return finish(req, res, next, {
        status: "invalid_input",
        message: `Missing or malformed: ${missing}`,
      });
    }

    let bank: BsbRecord | undefined;
    if (bsbDirectory) {
      bank = await bsbDirectory.lookup(bsb);
      if (!bank) return finish(req, res, next, { status: "bsb_not_found", bsb });
    }

    let lookup;
    try {
      lookup = await withTimeout(provider.lookupAccount(bsb, accountNumber), timeoutMs);
    } catch {
      return finish(req, res, next, {
        status: "provider_error",
        bsb,
        bank,
        message: "Account verification is temporarily unavailable",
      });
    }

    if (!lookup.exists || !lookup.accountName) {
      return finish(req, res, next, { status: "account_not_found", bsb, bank });
    }

    const { result, score } = matchNames(name, lookup.accountName, nameMatch);
    const status: VerificationStatus =
      result === "match" ? "verified" : result === "close_match" ? "close_match" : "name_mismatch";

    // Never leak the real account name on a mismatch (account-enumeration / privacy risk).
    finish(req, res, next, {
      status,
      bsb,
      bank,
      nameMatch: result,
      score,
      ...(status === "close_match" ? { suggestedName: lookup.accountName } : {}),
    });
  };
}
