import express from "express";
import { InMemoryBsbDirectory } from "./bsb.js";
import { verifyBankAccount } from "./middleware.js";
import { MockProvider } from "./providers/types.js";

// Demo wiring only: swap MockProvider for a real AccountVerificationProvider.
const provider = new MockProvider({ "062-000:12345678": "John Smith" });
const bsbDirectory = new InMemoryBsbDirectory([
  { bsb: "062-000", bank: "CBA", branch: "Sydney", state: "NSW" },
]);

const app = express();
app.use(express.json());

app.post("/payees", verifyBankAccount({ provider, bsbDirectory }), (req, res) => {
  res.status(201).json({ ok: true, verification: req.bankVerification });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Truepay listening on :${port}`));
