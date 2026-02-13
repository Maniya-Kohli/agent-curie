// src/tools/core/imageOps.ts

import * as fs from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { logger } from "../../utils/logger";
import { registry } from "../registry";

import { db } from "../../db";
import { savedImages } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

let gatewayInstance: any = null;
let currentUserId: string | null = null;
let currentChatId: string | null = null;

export function setCurrentChatId(chatId: string) {
  currentChatId = chatId;
}

export function getCurrentChatId() {
  return currentChatId;
}

export function setGatewayInstance(gateway: any) {
  gatewayInstance = gateway;
}

export function getGatewayInstance() {
  return gatewayInstance;
}

export function setCurrentUserId(userId: string) {
  currentUserId = userId;
}

export function getCurrentUserId() {
  return currentUserId;
}

const IMAGE_STORAGE = path.join(process.cwd(), "stored_images");

type CachedImage = {
  base64: string;
  mediaType: string;
  caption?: string;
  timestamp?: string;
  notes?: string;
  chatId?: string;
  channel?: string;
};

const lastImageByUser = new Map<string, CachedImage>();

export function cacheIncomingImage(
  userId: string,
  base64: string,
  mediaType: string,
  meta?: {
    caption?: string;
    timestamp?: string;
    notes?: string;
    chatId?: string;
    channel?: string;
  },
) {
  lastImageByUser.set(userId, {
    base64,
    mediaType,
    caption: meta?.caption,
    timestamp: meta?.timestamp ?? new Date().toISOString(),
    notes: meta?.notes,
    chatId: meta?.chatId,
    channel: meta?.channel,
  });
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class ImageOps {
  private async resolveImageFileName(fileName: string): Promise<string> {
    await fs.mkdir(IMAGE_STORAGE, { recursive: true });

    const sanitized = sanitizeFileName(fileName);

    const exactPath = path.join(IMAGE_STORAGE, sanitized);
    if (await fileExists(exactPath)) return sanitized;

    const files = await fs.readdir(IMAGE_STORAGE);
    const candidates = files
      .filter(
        (f) =>
          !f.endsWith(".json") &&
          f.endsWith(`_${sanitized}`) &&
          (f.endsWith(".jpg") ||
            f.endsWith(".jpeg") ||
            f.endsWith(".png") ||
            f.endsWith(".webp")),
      )
      .sort()
      .reverse();

    if (candidates.length === 0) {
      throw new Error(
        `Image not found: ${fileName}. (Tried exact and timestamped variants)`,
      );
    }

    return candidates[0];
  }

  async saveImage(
    base64Data: string,
    fileName: string,
    metadata?: {
      userId?: string;
      caption?: string;
      timestamp?: string;
      notes?: string;
      chatId?: string;
      channel?: string;
      mediaType?: string;
    },
  ): Promise<string> {
    try {
      await fs.mkdir(IMAGE_STORAGE, { recursive: true });

      const buffer = Buffer.from(base64Data, "base64");

      const sanitizedName = sanitizeFileName(fileName);
      const ts = Date.now();
      const finalName = `${ts}_${sanitizedName}`;
      const filePath = path.join(IMAGE_STORAGE, finalName);

      await fs.writeFile(filePath, buffer);
      const createdAt = new Date().toISOString();

      await db.insert(savedImages).values({
        id: randomUUID(),
        userId: metadata?.userId ?? "unknown",
        channel: metadata?.channel,
        chatId: metadata?.chatId,

        originalName: sanitizedName,
        storedName: finalName,
        filePath,

        mediaType: metadata?.mediaType ?? "image/jpeg",
        caption: metadata?.caption,
        notes: metadata?.notes,

        sizeBytes: buffer.length,
        createdAt,
      });

      logger.success(`Image saved: ${finalName}`);
      return `✅ Image saved as: ${finalName}\nLocation: ${filePath}`;
    } catch (error: any) {
      logger.error("Failed to save image:", error);
      throw new Error(`Failed to save image: ${error.message}`);
    }
  }

  async sendSavedImage(args: {
    fileName: string;
    caption?: string;
  }): Promise<string> {
    logger.info(`sendSavedImage: start file=${args.fileName}`);

    const userId = getCurrentUserId();
    if (!userId) {
      logger.error("sendSavedImage: missing currentUserId");
      throw new Error("Cannot determine current user");
    }

    const [channel, ...idParts] = userId.split(":");
    const actualUserId = idParts.join(":") || userId;

    logger.info(
      `sendSavedImage: channel=${channel} actualUserId=${actualUserId} file=${args.fileName}`,
    );

    let base64: string;
    let mediaType: string;
    let metadata: any;
    try {
      const read = await this.readImage(args.fileName);
      base64 = read.base64;
      mediaType = read.mediaType;
      metadata = read.metadata;
      logger.info(
        `sendSavedImage: image loaded mediaType=${mediaType} base64Len=${base64.length}`,
      );
    } catch (err) {
      logger.error(
        `sendSavedImage: failed to read image file=${args.fileName}`,
        err,
      );
      throw err;
    }

    const gateway = getGatewayInstance();
    if (!gateway) {
      logger.error(
        "sendSavedImage: gateway not initialized (setGatewayInstance missing)",
      );
      throw new Error("Gateway not initialized (setGatewayInstance missing)");
    }

    const adapter = gateway.getAdapter(channel);
    if (!adapter) {
      logger.error(`sendSavedImage: no adapter for channel=${channel}`);
      throw new Error(`No adapter found for channel: ${channel}`);
    }

    const cached = lastImageByUser.get(userId);
    const cachedChannel = cached?.channel;
    const metaChannel = metadata?.channel;
    const chatIdFromContext: string | undefined =
      getCurrentChatId() ?? undefined;
    const chatIdFromFile = metadata?.chatId as string | undefined;
    const cachedChatId = cached?.chatId;

    logger.info(
      `sendSavedImage: contextChat=${chatIdFromContext ?? "none"} fileChat=${chatIdFromFile ?? "none"} cachedChat=${cachedChatId ?? "none"} metaChannel=${metaChannel ?? "none"} cachedChannel=${cachedChannel ?? "none"}`,
    );

    let targetId = actualUserId;

    if (channel === "whatsapp") {
      // Priority: context > file > cached > user
      // Also accept valid WhatsApp JIDs even without channel validation
      if (chatIdFromContext && cachedChannel === channel) {
        targetId = chatIdFromContext;
        logger.info(
          `sendSavedImage: using context chatId (cached channel match)`,
        );
      } else if (chatIdFromFile && metaChannel === channel) {
        targetId = chatIdFromFile;
        logger.info(`sendSavedImage: using file chatId (meta channel match)`);
      } else if (cachedChatId && cachedChannel === channel) {
        targetId = cachedChatId;
        logger.info(`sendSavedImage: using cached chatId (channel match)`);
      } else if (
        chatIdFromContext &&
        (chatIdFromContext.includes("@s.whatsapp.net") ||
          chatIdFromContext.includes("@g.us"))
      ) {
        targetId = chatIdFromContext;
        logger.info(
          `sendSavedImage: using context chatId (valid WhatsApp JID)`,
        );
      } else {
        targetId = actualUserId;
        logger.info(`sendSavedImage: fallback to actualUserId=${actualUserId}`);
      }
    } else if (channel === "discord") {
      // For discord we prefer an explicit channel id from context or file
      if (
        typeof (globalThis as any).chatIdBelongsToChannel === "function" &&
        (globalThis as any).chatIdBelongsToChannel(
          chatIdFromContext,
          metaChannel ?? cachedChannel,
        ) &&
        chatIdFromContext
      ) {
        const ch =
          chatIdFromContext.startsWith("channel:") ||
          chatIdFromContext.startsWith("user:")
            ? chatIdFromContext
            : `channel:${chatIdFromContext}`;
        targetId = ch;
      } else if (
        typeof (globalThis as any).chatIdBelongsToChannel === "function" &&
        (globalThis as any).chatIdBelongsToChannel(
          chatIdFromFile,
          metaChannel,
        ) &&
        chatIdFromFile
      ) {
        const ch =
          chatIdFromFile.startsWith("channel:") ||
          chatIdFromFile.startsWith("user:")
            ? chatIdFromFile
            : `channel:${chatIdFromFile}`;
        targetId = ch;
      } else {
        targetId = `user:${actualUserId}`;
      }
      logger.info(`sendSavedImage: discord targetId=${targetId}`);
    } else if (channel === "telegram") {
      // Telegram chat ids can be negative (supergroups/channels: -100...)
      const isTelegramChatId = (v?: string) => !!v && /^-?\d+$/.test(String(v));

      if (chatIdFromContext && isTelegramChatId(chatIdFromContext)) {
        targetId = String(chatIdFromContext);
      } else if (chatIdFromFile && isTelegramChatId(chatIdFromFile)) {
        targetId = String(chatIdFromFile);
      } else if (cachedChatId && isTelegramChatId(cachedChatId)) {
        targetId = String(cachedChatId);
      } else {
        targetId = actualUserId;
      }
      logger.info(`sendSavedImage: telegram targetId=${targetId}`);
    } else {
      targetId = actualUserId;
      logger.info(`sendSavedImage: other channel targetId=${targetId}`);
    }

    if (typeof (adapter as any).sendImage !== "function") {
      logger.error(
        `sendSavedImage: adapter for channel=${channel} does not implement sendImage()`,
      );
      throw new Error(
        `Sending images not supported for channel: ${channel}. Please implement adapter.sendImage().`,
      );
    }

    try {
      const result = await (adapter as any).sendImage(
        targetId,
        base64,
        args.caption,
        mediaType,
      );
      logger.success(
        `sendSavedImage: sent file=${args.fileName} to ${channel}:${targetId} result=${result ?? "ok"}`,
      );
      return `✅ Image sent: ${args.fileName}`;
    } catch (err: any) {
      logger.error(
        `sendSavedImage: failed sending file=${args.fileName} to ${channel}:${targetId}`,
        err,
      );
      throw new Error(`Failed to send image: ${err?.message ?? String(err)}`);
    }
  }

  async saveLastImage(args: {
    fileName: string;
    notes?: string;
    base64Data?: string;
    mediaType?: string;
    caption?: string;
  }): Promise<string> {
    const userId = getCurrentUserId();
    if (!userId) throw new Error("Cannot determine current user");

    let base64 = args.base64Data;
    let caption = args.caption;
    let chatId: string | undefined = getCurrentChatId() ?? undefined;
    let channelFromCtx: string | undefined = undefined;

    // If current chat id is channel-prefixed like "whatsapp:+91...@s.whatsapp.net"
    if (chatId && chatId.includes(":")) {
      const parts = chatId.split(":");
      channelFromCtx = parts[0];
      chatId = parts.slice(1).join(":");
    }

    if (!base64) {
      const cached = lastImageByUser.get(userId);
      if (!cached?.base64) {
        throw new Error(
          "No recent image found for this user. Make sure an image was received and cached.",
        );
      }

      const currentChannel = userId.split(":")[0];

      // Only use cached chatId if it explicitly belongs to the same channel
      if (!chatId && cached.chatId && cached.channel === currentChannel) {
        chatId = cached.chatId;
        logger.info(
          `saveLastImage: using cached chatId="${chatId}" from channel="${cached.channel}"`,
        );
      } else if (!chatId && cached.chatId && !cached.channel) {
        logger.warn(
          `saveLastImage: cached chatId="${cached.chatId}" has no channel metadata, not using it`,
        );
      } else if (
        !chatId &&
        cached.chatId &&
        cached.channel !== currentChannel
      ) {
        logger.warn(
          `saveLastImage: cached chatId="${cached.chatId}" from channel="${cached.channel}" doesn't match current channel="${currentChannel}", not using it`,
        );
      }

      base64 = cached.base64;
      caption = caption ?? cached.caption;
    }

    return this.saveImage(base64, args.fileName, {
      userId,
      caption,
      notes: args.notes,
      timestamp: new Date().toISOString(),
      chatId,
      channel: getCurrentUserId()?.split(":")[0],
      mediaType: args.mediaType,
    });
  }

  async listImages(limit: number = 20): Promise<string> {
    try {
      await fs.mkdir(IMAGE_STORAGE, { recursive: true });

      const files = await fs.readdir(IMAGE_STORAGE);
      const imageFiles = files.filter(
        (f) =>
          !f.endsWith(".json") &&
          (f.endsWith(".jpg") ||
            f.endsWith(".jpeg") ||
            f.endsWith(".png") ||
            f.endsWith(".webp")),
      );

      if (imageFiles.length === 0) {
        return "No images saved yet.";
      }

      const stats = await Promise.all(
        imageFiles.slice(0, limit).map(async (file) => {
          const filePath = path.join(IMAGE_STORAGE, file);
          const stat = await fs.stat(filePath);
          const metadataPath = filePath + ".json";

          let metadata: any = {};
          try {
            const metadataContent = await fs.readFile(metadataPath, "utf8");
            metadata = JSON.parse(metadataContent);
          } catch {
            // No metadata
          }

          return {
            file,
            size: (stat.size / 1024).toFixed(2) + " KB",
            created: stat.mtime.toLocaleString(),
            caption: metadata.caption || "No caption",
          };
        }),
      );

      let output = `📁 Saved Images (${imageFiles.length} total, showing ${stats.length}):\n\n`;
      stats.forEach((s, i) => {
        output += `${i + 1}. ${s.file}\n`;
        output += `   Size: ${s.size} | Created: ${s.created}\n`;
        output += `   Caption: ${s.caption}\n\n`;
      });

      return output;
    } catch (error: any) {
      throw new Error(`Failed to list images: ${error.message}`);
    }
  }

  async readImage(fileName: string): Promise<{
    base64: string;
    mediaType: string;
    metadata?: any;
  }> {
    try {
      const resolved = await this.resolveImageFileName(fileName);
      const filePath = path.join(IMAGE_STORAGE, resolved);

      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString("base64");

      const ext = path.extname(resolved).toLowerCase();
      const mediaTypeMap: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
      };
      const mediaType = mediaTypeMap[ext] || "image/jpeg";

      let metadata: any = undefined;
      try {
        const metadataPath = filePath + ".json";
        const metadataContent = await fs.readFile(metadataPath, "utf8");
        metadata = JSON.parse(metadataContent);
      } catch {
        // No metadata
      }

      return { base64, mediaType, metadata };
    } catch (error: any) {
      throw new Error(`Failed to read image: ${error.message}`);
    }
  }

  async deleteImage(fileName: string): Promise<string> {
    try {
      const resolved = await this.resolveImageFileName(fileName);
      const filePath = path.join(IMAGE_STORAGE, resolved);

      await fs.unlink(filePath);

      try {
        await fs.unlink(filePath + ".json");
      } catch {
        // No metadata file
      }

      return `✅ Deleted: ${resolved}`;
    } catch (error: any) {
      throw new Error(`Failed to delete image: ${error.message}`);
    }
  }
}

export const imageOps = new ImageOps();

//  REGISTRY REGISTRATIONS

registry.register({
  name: "save_image",
  description:
    "Save the image from the current message to disk. " +
    "Input: logical fileName with extension, e.g. 'abc.jpg'. No path, no timestamp prefix. Optional notes string. " +
    "Output: '✅ Image saved as: <timestamped_name>'. " +
    "Use the same logical fileName when calling send_saved_image later.",
  category: "system",
  input_schema: {
    type: "object",
    properties: {
      fileName: {
        type: "string",
        description: "Logical filename with extension, e.g. 'abc.jpg'.",
      },
      notes: {
        type: "string",
        description: "Optional notes about the image.",
      },
    },
    required: ["fileName"],
  },
  function: (args: { fileName: string; notes?: string; base64Data?: string }) =>
    imageOps.saveLastImage(args),
});

registry.register({
  name: "list_saved_images",
  description:
    "List all images saved to disk. " +
    "Input: optional limit (default 20). " +
    "Output: each image's stored filename, size in KB, creation date, and caption.",
  category: "system",
  input_schema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Max images to list. Default: 20.",
        default: 20,
      },
    },
  },
  function: (args: { limit?: number }) => imageOps.listImages(args.limit || 20),
});

registry.register({
  name: "delete_image",
  description:
    "Delete a saved image by logical filename. Timestamp prefix resolved automatically. " +
    "Output: '✅ Deleted: <stored_filename>', or an error if not found.",
  category: "system",
  input_schema: {
    type: "object",
    properties: {
      fileName: {
        type: "string",
        description: "Logical filename with extension, e.g. 'abc.jpg'.",
      },
    },
    required: ["fileName"],
  },
  function: (args: { fileName: string }) => imageOps.deleteImage(args.fileName),
});

registry.register({
  name: "send_saved_image",
  description:
    "Send a previously saved image to the current user. " +
    "Input: logical fileName with extension, e.g. 'abc.jpg'. Timestamp prefix resolved automatically. Optional caption string. " +
    "Output: '✅ Image sent: <fileName>', or an error if not found.",
  category: "system",
  input_schema: {
    type: "object",
    properties: {
      fileName: {
        type: "string",
        description:
          "Logical filename with extension, e.g. 'abc.jpg'. No timestamp prefix.",
      },
      caption: {
        type: "string",
        description: "Optional caption to send with the image.",
      },
    },
    required: ["fileName"],
  },
  function: (args: { fileName: string; caption?: string }) =>
    imageOps.sendSavedImage(args),
});
