/**
 * ═══════════════════════════════════════════════════════════════
 * Portable crypto primitives for the backup engine
 * ═══════════════════════════════════════════════════════════════
 * Pure TypeScript (no DOM / Capacitor / Node imports) so the exact same code
 * runs in the WebView, in Node for tests, and inside any JS engine used to
 * cross-check the Java implementation.
 *
 * AES-256-GCM is implemented against the Web Crypto global when available
 * (WebView + Node), and the byte/base64 plumbing is hand-written to stay
 * dependency free.
 */

export interface SealedPayload {
  ciphertext: Uint8Array;
  tag: Uint8Array;
  keyId: string;
}

/** Raw 256-bit key used by the engine. */
export interface BackupKeyMaterial {
  rawKey: Uint8Array;
  passphrase?: string;
}

const te = new TextEncoder();
const td = new TextDecoder();

// ── Encoding helpers ────────────────────────────────────────────────────────

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) map[B64_ALPHABET[i]] = i;
  map["-"] = 62;
  map["_"] = 63;
  return map;
})();

/** Standard base64 (with padding) — acceptable for Node and Android's Base64.DEFAULT. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = (b64 || "").replace(/[^A-Za-z0-9+/_-]/g, "");
  const usable = clean.length - (clean.length % 4 === 1 ? 1 : 0);
  const out = new Uint8Array(Math.floor((usable * 3) / 4));
  let o = 0;
  for (let i = 0; i < usable; i += 4) {
    const c0 = B64_LOOKUP[clean[i]] ?? 0;
    const c1 = B64_LOOKUP[clean[i + 1]] ?? 0;
    const c2 = i + 2 < usable ? B64_LOOKUP[clean[i + 2]] ?? 0 : 0;
    const c3 = i + 3 < usable ? B64_LOOKUP[clean[i + 3]] ?? 0 : 0;
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < usable) out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (i + 3 < usable) out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, o);
}

export function utf8Encode(value: string): Uint8Array {
  return te.encode(value);
}

export function utf8Decode(bytes: Uint8Array): string {
  return td.decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Structural comparison without early exit (no timing signal on key material). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── SHA-256 (pure TS fallback + WebView/Node WebCrypto) ─────────────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Pure JS SHA-256 — used when WebCrypto is unavailable and by the Node tests. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function getSubtle(): SubtleCrypto | null {
  const g: any = typeof globalThis !== "undefined" ? globalThis : undefined;
  return g?.crypto?.subtle ?? null;
}

/** SHA-256 hex digest. Uses WebCrypto when present, pure TS otherwise. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = getSubtle();
  if (subtle) {
    try {
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const digest = await subtle.digest("SHA-256", buf);
      return toHex(new Uint8Array(digest));
    } catch {
      // fall through to the portable implementation
    }
  }
  return toHex(sha256Bytes(data));
}

// ── AES-256-GCM seal / open ────────────────────────────────────────────────

/**
 * Derives a non-secret key identifier from raw key bytes.
 * It identifies the key that sealed a backup, and is useless for decryption.
 */
export async function deriveKeyId(rawKey: Uint8Array): Promise<string> {
  const digest = await sha256Hex(concatBytes(utf8Encode("ta-backup-keyid:"), rawKey));
  return digest.slice(0, 16);
}

export function encryptionAvailable(): boolean {
  return getSubtle() !== null;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  if (!subtle) throw new Error("ENCRYPTION_UNAVAILABLE");
  if (rawKey.length !== 32) throw new Error("Invalid AES-256 key length: " + rawKey.length);
  return subtle.importKey("raw", rawKey as unknown as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function getSecureRandomBytes(length: number): Uint8Array {
  const g = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }) : undefined;
  if (!g?.crypto?.getRandomValues) {
    throw new Error("CSPRNG_UNAVAILABLE");
  }
  const bytes = new Uint8Array(length);
  g.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Seals `plaintext` with AES-256-GCM under a random 96-bit IV and optional AAD.
 * The output is iv(12) || ciphertext || tag(16).
 */
export async function sealPayloadWithAad(
  plaintext: Uint8Array,
  rawKey: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const subtle = getSubtle();
  if (!subtle) throw new Error("ENCRYPTION_UNAVAILABLE");
  const key = await importAesKey(rawKey);
  const iv = getSecureRandomBytes(12);
  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
    tagLength: 128,
  };
  if (aad && aad.length > 0) {
    params.additionalData = aad as unknown as BufferSource;
  }

  const sealed = await subtle.encrypt(params, key, plaintext as unknown as BufferSource);
  return concatBytes(iv, new Uint8Array(sealed));
}

/**
 * Seals `plaintext` with AES-256-GCM under a random 96-bit IV.
 * The output is iv(12) || ciphertext || tag(16).
 */
export async function sealPayload(plaintext: Uint8Array, rawKey: Uint8Array): Promise<Uint8Array> {
  return sealPayloadWithAad(plaintext, rawKey);
}

/**
 * Opens an AES-256-GCM payload produced by {@link sealPayloadWithAad}.
 * Returns null when authentication fails (wrong key, wrong AAD, or tampered bytes).
 */
export async function openPayloadWithAad(
  sealed: Uint8Array,
  rawKey: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array | null> {
  const subtle = getSubtle();
  if (!subtle) throw new Error("ENCRYPTION_UNAVAILABLE");
  if (sealed.length < 12 + 16) return null;
  try {
    const key = await importAesKey(rawKey);
    const iv = sealed.subarray(0, 12);
    const body = sealed.subarray(12);
    const params: AesGcmParams = {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      tagLength: 128,
    };
    if (aad && aad.length > 0) {
      params.additionalData = aad as unknown as BufferSource;
    }
    const opened = await subtle.decrypt(params, key, body as unknown as BufferSource);
    return new Uint8Array(opened);
  } catch {
    return null;
  }
}

/**
 * Opens an AES-256-GCM payload produced by {@link sealPayload}.
 * Returns null when authentication fails (wrong key or tampered bytes).
 */
export async function openPayload(sealed: Uint8Array, rawKey: Uint8Array): Promise<Uint8Array | null> {
  return openPayloadWithAad(sealed, rawKey);
}

const RECOVERY_KEY_CHECKSUM_PREFIX = "ta-backup-recovery:";

/**
 * Formats a raw 256-bit key into a checksummed, human-printable recovery code:
 * `TAKEY-XXXX-XXXX-...` (17 4-char uppercase hex groups = 32 key bytes + 2-byte SHA-256 checksum).
 * Matches Android BackupArchive.formatRecoveryKey byte-for-byte.
 */
export async function formatRecoveryKey(rawKey: Uint8Array): Promise<string> {
  if (!rawKey || rawKey.length !== 32) {
    throw new Error("طول مفتاح التشفير غير صالح (يجب أن يكون 32 بايت).");
  }
  const digest = sha256Bytes(concatBytes(utf8Encode(RECOVERY_KEY_CHECKSUM_PREFIX), rawKey));
  const payload = concatBytes(rawKey, digest.subarray(0, 2));
  const hex = toHex(payload).toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return "TAKEY-" + groups.join("-");
}

/**
 * Parses and checksum-verifies a `TAKEY-...` recovery key string back into 32 raw key bytes.
 * Matches Android BackupArchive.parseRecoveryKey byte-for-byte.
 */
export async function parseRecoveryKey(code: string): Promise<Uint8Array> {
  let clean = String(code ?? "").trim().replace(/[\s-]+/g, "");
  if (/^TAKEY/i.test(clean)) {
    clean = clean.slice(5);
  }
  if (clean.length !== 68 || !/^[0-9a-fA-F]{68}$/.test(clean)) {
    throw new Error("صيغة مفتاح الاسترداد غير صالحة — تأكد من إدخال الرمز كاملاً بدون نقص.");
  }
  const decoded = new Uint8Array(34);
  for (let i = 0; i < 34; i++) {
    decoded[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const rawKey = decoded.subarray(0, 32);
  const checksum = decoded.subarray(32, 34);
  const expected = sha256Bytes(concatBytes(utf8Encode(RECOVERY_KEY_CHECKSUM_PREFIX), rawKey)).subarray(0, 2);
  if (!constantTimeEqual(checksum, expected)) {
    throw new Error("مفتاح الاسترداد غير صحيح — فشل التحقق من رمز الفحص، تأكد من عدم وجود خطأ في الكتابة.");
  }
  return new Uint8Array(rawKey);
}

/**
 * Deterministically stretches a user passphrase into 256 key bits using
 * PBKDF2-HMAC-SHA-256. Used only as a recovery path when the device keystore
 * key is gone (e.g. restore on another device with a passphrase-protected backup).
 */
export async function deriveKeyFromPassphrase(passphrase: string, saltHex: string, iterations = 210000): Promise<Uint8Array> {
  const subtle = getSubtle();
  if (!subtle) throw new Error("ENCRYPTION_UNAVAILABLE");
  if (typeof saltHex !== "string" || !/^[0-9a-f]{32,}$/i.test(saltHex) || saltHex.length % 2 !== 0) {
    throw new Error("INVALID_SALT_HEX");
  }
  const saltBytes = saltHex.match(/.{2}/g);
  if (!saltBytes || saltBytes.length < 16) {
    throw new Error("INVALID_SALT_HEX");
  }
  const salt = new Uint8Array(saltBytes.map((b) => parseInt(b, 16)));
  const base = await subtle.importKey("raw", utf8Encode(passphrase) as unknown as BufferSource, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    base,
    256
  );
  return new Uint8Array(bits);
}

/** Generates a fresh random 256-bit key, encoded as base64. */
export function generateKeyBase64(): string {
  const raw = getSecureRandomBytes(32);
  return bytesToBase64(raw);
}
