// src/tools/core/x402Payment.ts
import { registry } from "../registry";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../../utils/logger";

let client: x402Client | null = null;
let httpClient: x402HTTPClient | null = null;
let paidFetch: typeof fetch | null = null;
let walletAddress: `0x${string}` | null = null;

function assertHexPrivateKey(pk: string): asserts pk is `0x${string}` {
  if (!pk.startsWith("0x"))
    throw new Error("X402_PRIVATE_KEY must start with 0x");
  if (pk.length !== 66)
    throw new Error("X402_PRIVATE_KEY must be 32 bytes (0x + 64 hex chars)");
}

function initOnce() {
  if (client && httpClient && paidFetch && walletAddress) return;

  const pk = process.env.X402_PRIVATE_KEY;
  if (!pk) throw new Error("X402_PRIVATE_KEY not configured");
  assertHexPrivateKey(pk);

  const signer = privateKeyToAccount(pk);
  walletAddress = signer.address;

  client = new x402Client();
  registerExactEvmScheme(client, { signer });

  httpClient = new x402HTTPClient(client);
  paidFetch = wrapFetchWithPayment(fetch, client);

  logger.info(`x402_fetch initialized (payer): ${walletAddress}`);
}

async function handleX402Fetch(input: {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, any>;
  body?: any;
}): Promise<any> {
  initOnce();
  if (!paidFetch || !httpClient) throw new Error("x402 not initialized");

  const method = (input.method ?? "GET").toUpperCase();

  const qs =
    input.params && Object.keys(input.params).length
      ? `?${new URLSearchParams(
          Object.entries(input.params).reduce(
            (acc, [k, v]) => {
              if (v === undefined || v === null) return acc;
              acc[k] = String(v);
              return acc;
            },
            {} as Record<string, string>,
          ),
        )}`
      : "";

  const url = `${input.url}${qs}`;

  const hasBody =
    method !== "GET" &&
    method !== "HEAD" &&
    input.body !== undefined &&
    input.body !== null;

  const resp = await paidFetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
  });

  const ct = resp.headers.get("content-type") || "";
  const payload = ct.includes("application/json")
    ? await resp.json()
    : await resp.text();

  if (!resp.ok) {
    // If you're still seeing "X-PAYMENT required" here, your server isn't the Coinbase @x402/express server.
    return { success: false, status: resp.status, body: payload };
  }

  const settle = httpClient.getPaymentSettleResponse((name) =>
    resp.headers.get(name),
  );
  return {
    success: true,
    data: payload,
    payment: settle
      ? { txHash: settle.transaction, networkId: settle.network, settled: true }
      : null,
  };
}

registry.register({
  name: "x402_fetch",
  description:
    "Make an HTTP request to a Coinbase x402 payment-gated endpoint, handling payment negotiation automatically. " +
    "Input: url (required), method (default GET), optional params object (query string), optional body object (POST/PUT). " +
    "Output on success: { success: true, data: <response payload>, payment: { txHash, networkId, settled } }. " +
    "Output on failure: { success: false, status: <http status>, body: <response> }.",
  category: "core",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
      params: { type: "object" },
      body: { type: "object" },
    },
    required: ["url"],
  },
  function: handleX402Fetch,
  enabled: process.env.X402_ENABLED === "true",
});

logger.info(
  `x402_fetch tool registered (enabled: ${process.env.X402_ENABLED === "true"})`,
);
