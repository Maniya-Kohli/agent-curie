// src/tools/core/sendMessage.ts

import { ChannelGateway } from "../../channels/gateway";
import { directory } from "../../memory/directory";
import { registry } from "../registry";

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

  let actualRecipient =
    directory.resolveContact(input.recipient, input.channel) || input.recipient;
  await gatewayInstance.sendMessage(
    input.channel,
    actualRecipient,
    input.message,
  );
  return `✅ Message sent to ${input.recipient}`;
}

// Build contact list dynamically for the tool description
const buildContactList = (): string => {
  return Array.from(directory.contacts.values())
    .map((c) => c.aliases.join("/"))
    .join(", ");
};

registry.register({
  name: "send_message",
  description:
    `Send a message to a contact via WhatsApp, Telegram, or Discord. ` +
    `Input: channel ('whatsapp' | 'telegram' | 'discord'), recipient as alias or full channel ID, message text. ` +
    `Known contact aliases: ${buildContactList()}. ` +
    `Output: '✅ Message sent to <recipient>', or an error if the contact or channel is not found.`,
  category: "communication",
  input_schema: {
    type: "object",
    properties: {
      channel: { type: "string", enum: ["whatsapp", "telegram", "discord"] },
      recipient: { type: "string", description: "Contact alias or full ID" },
      message: { type: "string" },
    },
    required: ["channel", "recipient", "message"],
  },
  function: sendMessage,
});
