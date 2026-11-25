import { expect, it } from "vite-plus/test";

import { base64urlEncode } from "../../src/worker/domain/random";

it("encodes byte arrays according to unpadded RFC 4648 base64url", () => {
  expect(base64urlEncode(new Uint8Array([]))).toBe("");
  expect(base64urlEncode(new Uint8Array([0x66]))).toBe("Zg");
  expect(base64urlEncode(new Uint8Array([0x66, 0x6f]))).toBe("Zm8");
  expect(base64urlEncode(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe("Zm9v");
  expect(base64urlEncode(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]))).toBe("Zm9vYmFy");
});

it("uses url-safe characters instead of plus and slash", () => {
  expect(base64urlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
});
