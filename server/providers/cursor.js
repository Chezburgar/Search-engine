// Opaque pagination cursors handed to the browser.
export const encodeCursor = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function decodeCursor(str) {
  try {
    return JSON.parse(Buffer.from(String(str), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
