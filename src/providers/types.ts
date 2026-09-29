/**
 * A provider answers: "who owns BSB + account?" Implement this against your real
 * source (Confirmation of Payee / bank-verification vendor / open banking).
 */
export interface AccountLookup {
  /** Account holder name as recorded by the bank. */
  accountName?: string;
  /** Whether the account exists and is open. */
  exists: boolean;
}

export interface AccountVerificationProvider {
  lookupAccount(bsb: string, accountNumber: string): Promise<AccountLookup>;
}

/** Test/dev provider backed by a static map keyed "BSB:ACCOUNT". */
export class MockProvider implements AccountVerificationProvider {
  constructor(private readonly accounts: Record<string, string>) {}

  async lookupAccount(bsb: string, accountNumber: string): Promise<AccountLookup> {
    const name = this.accounts[`${bsb}:${accountNumber}`];
    return name === undefined ? { exists: false } : { exists: true, accountName: name };
  }
}
