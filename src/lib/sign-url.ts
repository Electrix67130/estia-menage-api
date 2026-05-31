import { createHmac } from 'crypto';
import env from '@/config/env';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Generate a signed URL for a file path like /files/abc-123.pdf */
export function signFileUrl(fileUrl: string): string {
  const filename = fileUrl.split('/').pop();
  if (!filename) return fileUrl;

  const expires = Date.now() + TOKEN_TTL_MS;
  const data = `${filename}:${expires}`;
  const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
  const token = Buffer.from(JSON.stringify({ f: filename, e: expires, s: signature })).toString('base64url');

  return `${env.APP_URL}/files/${filename}?t=${token}`;
}

/** Sign all url/thumbnail_url fields in an array of objects */
export function signUrlsInList<T extends Record<string, unknown>>(items: T[], fields: string[] = ['url', 'thumbnail_url']): T[] {
  return items.map((item) => {
    const signed = { ...item };
    for (const field of fields) {
      const val = signed[field];
      if (typeof val === 'string' && val.includes('/files/')) {
        (signed as Record<string, unknown>)[field] = signFileUrl(val);
      }
    }
    return signed;
  });
}
