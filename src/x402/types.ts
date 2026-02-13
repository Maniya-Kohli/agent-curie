// src/x402/types.ts

/**
 * x402 protocol types based on the official specification
 * https://www.x402.org
 */

export interface X402PaymentRequirement {
  x402Version: number;
  accepts: X402AcceptSpec[];
}

export interface X402AcceptSpec {
  scheme: "exact" | "maximum";
  network: string; // e.g., "eip155:84532" (Base Sepolia)
  maxAmountRequired: string; // Amount in atomic units (e.g., "5000" = 0.005 USDC)
  resource: string; // Path that was requested
  payTo: string; // Recipient address
  asset: string; // Token contract address
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, any>;
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: "exact" | "maximum";
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

export interface EIP712Message {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
}

export interface X402SettlementResponse {
  success: boolean;
  txHash?: string;
  networkId?: string;
  error?: string;
}

export interface X402FetchOptions {
  maxAmount?: string; // Max willing to pay in USDC (e.g., "0.005")
  params?: Record<string, any>; // Query parameters
  timeout?: number; // Request timeout in ms
  method?: string; // HTTP method (default: "GET")
  body?: any; // Request body for POST/PUT
}

export interface X402Transaction {
  id: string;
  userId: string;
  url: string;
  amount: string; // Atomic units
  txHash?: string;
  networkId?: string;
  status: "pending" | "success" | "failed" | "timeout";
  requestedAt: string;
  settledAt?: string;
  metadata?: string; // JSON stringified
}

export interface X402Config {
  enabled: boolean;
  network: string; // "base-sepolia" or "base"
  privateKey: string;
  facilitatorUrl: string;
  maxAmountPerRequest: string; // USDC
  dailySpendingLimit: string; // USDC
  logTransactions: boolean;
}
