// src/tools/sendMessage.ts (create this new file)

import { ChannelGateway } from "../channels/gateway";
import { directory } from "../memory/directory";

let gatewayInstance: ChannelGateway | null = null;

export function setGatewayForTools(gateway: ChannelGateway) {
  gatewayInstance = gateway;
}

export async function sendMessage(input: {
  channel: string;
  recipient: string; // Can be alias like "zaan" or full ID
  message: string;
}): Promise<string> {
  if (!gatewayInstance) {
    throw new Error("Gateway not initialized");
  }
  // Try resolving alias first
  let actualRecipient =
    directory.resolveContact(input.recipient, input.channel) || input.recipient;

  const isSelf = directory.isOwner(`${input.channel}:${actualRecipient}`);
  // const signature = isSelf
  //   ? "\n\n— Noni (Your AI Assistant)"
  //   : "\n\n— Noni (Maniya's AI Assistant)";

  await gatewayInstance.sendMessage(
    input.channel,
    actualRecipient,
    // input.message + signature,
    input.message,
  );
  return `✅ Message sent to ${input.recipient}`;
}
