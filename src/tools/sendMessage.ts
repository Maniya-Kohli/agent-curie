// src/tools/sendMessage.ts (create this new file)

import { ChannelGateway } from "../channels/gateway";
import { directory } from "../memory/directory";

let gatewayInstance: ChannelGateway | null = null;

export function setGatewayForTools(gateway: ChannelGateway) {
  gatewayInstance = gateway;
}

export async function sendMessage(input: {
  channel: string;
  recipient: string;
  message: string;
}): Promise<string> {
  if (!gatewayInstance) {
    throw new Error("Gateway not initialized");
  }
  // Try resolving alias first
  let actualRecipient =
    directory.resolveContact(input.recipient, input.channel) || input.recipient;
  await gatewayInstance.sendMessage(
    input.channel,
    actualRecipient,
    input.message,
  );
  return `✅ Message sent to ${input.recipient}`;
}
