/**
 * Utility functions to convert between different message formats
 */

// WhatsApp message format
export interface WhatsAppMessage {
  id: string;
  from: string;
  to: string;
  author?: string;
  pushname?: string;
  ack?: string;
  type: string;
  body: string;
  media?: string;
  fromMe: boolean;
  self: boolean;
  isForwarded: boolean;
  isMentioned: boolean;
  quotedMsg: unknown;
  mentionedIds: string[];
  time: number;
  // Additional custom properties
  filename?: string;
  noteType?: string;
  systemMessageType?: string;
  [key: string]: unknown; // Allow unknown additional properties
}

// Legacy message content format
export interface LegacyMessageContent {
  text?: { value: string };
  image?: { value: string };
  document?: { value: string; name: string };
  media?: { value: string };
  type: string;
}

/**
 * Converts a WhatsApp message to our legacy format
 * @param whatsappMsg WhatsApp message format
 * @returns Array of legacy message content objects
 */
export function whatsappToLegacy(
  whatsappMsg: WhatsAppMessage
): LegacyMessageContent[] {
  const result: LegacyMessageContent[] = [];

  // Always add text content if body is present, regardless of message type
  if (whatsappMsg.body) {
    result.push({
      text: { value: whatsappMsg.body || "" },
      type: "text",
    });
  }

  // Add media content based on type
  if (whatsappMsg.type === "image" && whatsappMsg.media) {
    result.push({
      image: { value: whatsappMsg.media },
      type: "image",
    });
  }

  if (whatsappMsg.type === "document" && whatsappMsg.media) {
    result.push({
      document: {
        value: whatsappMsg.media,
        name: whatsappMsg.filename || "Document",
      },
      type: "document",
    });
  }

  if (
    (whatsappMsg.type === "audio" ||
      whatsappMsg.type === "video" ||
      whatsappMsg.type === "ptt") &&
    whatsappMsg.media
  ) {
    result.push({
      media: { value: whatsappMsg.media },
      type: whatsappMsg.type,
    });
  }

  // If no content was added (unlikely), add a default text item
  if (result.length === 0) {
    result.push({
      text: { value: whatsappMsg.body || "(No content)" },
      type: "text",
    });
  }

  return result;
}

/**
 * Converts our legacy format to a WhatsApp message
 * @param legacyContent Legacy message content array
 * @param userId User ID to use as sender
 * @param contactId Contact ID to use as recipient
 * @returns WhatsApp message format
 */
export function legacyToWhatsapp(
  legacyContent: LegacyMessageContent[],
  userId: string,
  contactId: string
): WhatsAppMessage {
  const whatsappMsg: WhatsAppMessage = {
    id: crypto.randomUUID(),
    from: userId,
    to: contactId,
    type: "text", // Default type
    body: "",
    fromMe: true,
    self: true,
    isForwarded: false,
    isMentioned: false,
    quotedMsg: {},
    mentionedIds: [],
    time: Math.floor(Date.now() / 1000),
  };

  // Collect all text content first
  const textItems = legacyContent.filter(
    (item) => item.type === "text" && item.text?.value
  );
  if (textItems.length > 0) {
    whatsappMsg.body = textItems.map((item) => item.text?.value).join("\n\n");
  }

  // Process media items and set the message type based on the first media item
  const mediaItems = legacyContent.filter(
    (item) =>
      item.type === "image" ||
      item.type === "document" ||
      item.type === "audio" ||
      item.type === "video"
  );

  if (mediaItems.length > 0) {
    const firstMedia = mediaItems[0];

    if (firstMedia.type === "image" && firstMedia.image?.value) {
      whatsappMsg.type = "image";
      whatsappMsg.media = firstMedia.image.value;
    } else if (firstMedia.type === "document" && firstMedia.document?.value) {
      whatsappMsg.type = "document";
      whatsappMsg.media = firstMedia.document.value;
      whatsappMsg.filename = firstMedia.document.name;
    } else if (
      (firstMedia.type === "audio" || firstMedia.type === "video") &&
      firstMedia.media?.value
    ) {
      whatsappMsg.type = firstMedia.type;
      whatsappMsg.media = firstMedia.media.value;
    }
  }

  return whatsappMsg;
}

/**
 * Detects the format of a message content
 * @param content Message content to detect
 * @returns 'whatsapp' | 'legacy' | 'unknown'
 */
export function detectMessageFormat(
  content: unknown
): "whatsapp" | "legacy" | "unknown" {
  // Check if it's a WhatsApp message
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    "type" in content &&
    "fromMe" in content &&
    ("body" in content || "media" in content)
  ) {
    return "whatsapp";
  }

  // Check if it's our legacy format
  if (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((item) => typeof item === "object" && "type" in item)
  ) {
    return "legacy";
  }

  return "unknown";
}
