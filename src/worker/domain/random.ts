const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : undefined;

    out += BASE64URL_ALPHABET.charAt(b0 >> 2);
    out += BASE64URL_ALPHABET.charAt(((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4));
    if (b1 === undefined) break;
    out += BASE64URL_ALPHABET.charAt(((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6));
    if (b2 === undefined) break;
    out += BASE64URL_ALPHABET.charAt(b2 & 0b111111);
  }
  return out;
}
