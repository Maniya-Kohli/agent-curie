// // src/x402/client.ts

// import { wrapFetchWithPayment } from "@x402/fetch";
// import { x402Client, x402HTTPClient } from "@x402/core/client";
// import { registerExactEvmScheme } from "@x402/evm/exact/client";
// import { privateKeyToAccount } from "viem/accounts";
// import { logger } from "../utils/logger";
// import type { X402Config } from "./types";

// /**
//  * Official x402 Client Implementation
//  *
//  * This replaces your custom manager.ts with the official SDK
//  */
// export class X402ClientWrapper {
//   private client: x402Client;
//   private fetchWithPayment: typeof fetch;
//   private httpClient: x402HTTPClient;
//   private config: X402Config;

//   constructor(config: X402Config) {
//     this.config = config;

//     // 1. Create wallet signer (viem account)
//     const signer = privateKeyToAccount(config.privateKey as `0x${string}`);

//     // 2. Create x402 client
//     this.client = new x402Client();

//     // 3. Register EVM payment scheme
//     registerExactEvmScheme(this.client, { signer });

//     // 4. Create HTTP client wrapper
//     this.httpClient = new x402HTTPClient(this.client);

//     // 5. Wrap fetch with automatic payment handling
//     this.fetchWithPayment = wrapFetchWithPayment(fetch, this.client);

//     logger.info(
//       `x402 Client initialized with address: ${signer.address} on ${config.network}`,
//     );
//   }

//   /**
//    * Make a request - payment is handled automatically by the SDK
//    */
//   async fetch(url: string, options?: RequestInit): Promise<any> {
//     try {
//       logger.info(`x402 request to: ${url}`);

//       const response = await this.fetchWithPayment(url, {
//         method: options?.method || "GET",
//         headers: {
//           "Content-Type": "application/json",
//           ...(options?.headers || {}),
//         },
//         body: options?.body,
//       });

//       if (!response.ok) {
//         throw new Error(`Request failed with status ${response.status}`);
//       }

//       const data = await response.json();

//       // Extract payment settlement info from response headers
//       const paymentResponse = this.httpClient.getPaymentSettleResponse((name) =>
//         response.headers.get(name),
//       );

//       if (paymentResponse) {
//         logger.success(
//           `Payment settled! Tx: ${paymentResponse.transaction || "pending"}`,
//         );
//       }

//       return {
//         data,
//         payment: paymentResponse
//           ? {
//               txHash: paymentResponse.transaction,
//               networkId: paymentResponse.network,
//               settled: true,
//             }
//           : null,
//       };
//     } catch (error: any) {
//       logger.error(`x402 request failed:`, error.message);

//       // Handle specific x402 errors
//       if (error.message.includes("No scheme registered")) {
//         throw new Error(
//           `Network not supported. Configure X402_NETWORK correctly.`,
//         );
//       }

//       throw error;
//     }
//   }

//   /**
//    * Get wallet address
//    */
//   getAddress(): string {
//     // The signer address is embedded in the registered scheme
//     // For now, extract from config
//     const signer = privateKeyToAccount(this.config.privateKey as `0x${string}`);
//     return signer.address;
//   }
// }

// src/x402/client.ts

import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../utils/logger";
import type { X402Config } from "./types";

function assertHexPrivateKey(pk: string): asserts pk is `0x${string}` {
  if (!pk.startsWith("0x")) throw new Error("privateKey must start with 0x");
  if (pk.length !== 66)
    throw new Error("privateKey must be 32 bytes (0x + 64 hex chars)");
}

function pickInterestingHeaders(headers: Headers) {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    const lk = k.toLowerCase();
    if (
      lk.includes("x402") ||
      lk.includes("payment") ||
      lk.includes("authorization") ||
      lk.includes("signature") ||
      lk.includes("settle") ||
      lk.includes("facilitator")
    ) {
      out[k] = v;
    }
  }
  return out;
}

async function fetchWithTimeout(
  fn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return fn(url, init);

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Official x402 Client Implementation (SDK-based)
 */
export class X402ClientWrapper {
  private client: x402Client;
  private fetchWithPayment: typeof fetch;
  private httpClient: x402HTTPClient;
  private config: X402Config;
  private address: `0x${string}`;

  constructor(config: X402Config) {
    this.config = config;

    assertHexPrivateKey(config.privateKey);
    const signer = privateKeyToAccount(config.privateKey);

    this.address = signer.address;

    this.client = new x402Client();
    registerExactEvmScheme(this.client, { signer });

    this.httpClient = new x402HTTPClient(this.client);
    this.fetchWithPayment = wrapFetchWithPayment(fetch, this.client);

    // Note: actual network is taken from the server’s 402 challenge (e.g. eip155:84532).
    logger.info(
      `x402 Client initialized (payer): ${this.address} | network hint: ${config.network}`,
    );
  }

  /**
   * Make a request - payment handled automatically by SDK
   */
  async fetch(
    url: string,
    options?: RequestInit & { timeoutMs?: number },
  ): Promise<{
    data: any;
    payment: null | { txHash?: string; networkId?: string; settled: boolean };
    debug?: { status: number; headers?: Record<string, string>; body?: string };
  }> {
    const method = (options?.method || "GET").toUpperCase();
    const hasBody =
      options?.body !== undefined &&
      options?.body !== null &&
      method !== "GET" &&
      method !== "HEAD";

    // Don’t force JSON content-type on GET
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options?.headers as any),
    };
    if (hasBody && !("Content-Type" in headers))
      headers["Content-Type"] = "application/json";

    const init: RequestInit = {
      ...options,
      method,
      headers,
      body: options?.body,
    };

    logger.info(`x402 request: ${method} ${url}`);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.fetchWithPayment,
        url,
        init,
        options?.timeoutMs,
      );
    } catch (e: any) {
      const msg =
        e?.name === "AbortError"
          ? `Request timed out after ${options?.timeoutMs}ms`
          : e?.message;
      logger.error(`x402 fetch error: ${msg}`);
      throw new Error(msg || "Request failed");
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const interesting = pickInterestingHeaders(response.headers);

      if (response.status === 402) {
        logger.error(
          `x402 402: payment required but not satisfied. Inspect headers for payTo/asset/network/amount.`,
        );
        logger.error(`x402 headers: ${JSON.stringify(interesting, null, 2)}`);
      } else {
        logger.error(`x402 request failed (${response.status}): ${text}`);
      }

      return {
        data: null,
        payment: null,
        debug: {
          status: response.status,
          headers: Object.keys(interesting).length ? interesting : undefined,
          body: text || undefined,
        },
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    const settle = this.httpClient.getPaymentSettleResponse((name) =>
      response.headers.get(name),
    );
    if (settle) {
      logger.success(
        `Payment settled! Tx: ${settle.transaction || "pending"} | network: ${settle.network || "?"}`,
      );
      return {
        data,
        payment: {
          txHash: settle.transaction,
          networkId: settle.network,
          settled: true,
        },
      };
    }

    return { data, payment: null };
  }

  getAddress(): `0x${string}` {
    return this.address;
  }
}
