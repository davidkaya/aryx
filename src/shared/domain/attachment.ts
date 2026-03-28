export type ChatMessageAttachmentType = 'file' | 'blob';

export interface ChatMessageAttachment {
  type: ChatMessageAttachmentType;
  path?: string;
  data?: string;
  mimeType?: string;
  displayName?: string;
}

const supportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function isImageAttachment(attachment: ChatMessageAttachment): boolean {
  if (attachment.mimeType) {
    return supportedImageMimeTypes.has(attachment.mimeType);
  }

  if (attachment.path) {
    const ext = attachment.path.split('.').pop()?.toLowerCase();
    return ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif' || ext === 'webp';
  }

  return false;
}

export function getAttachmentDisplayName(attachment: ChatMessageAttachment): string {
  if (attachment.displayName) {
    return attachment.displayName;
  }

  if (attachment.path) {
    const parts = attachment.path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || attachment.path;
  }

  return attachment.mimeType ?? 'Attachment';
}
