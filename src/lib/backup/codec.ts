/**
 * ═══════════════════════════════════════════════════════════════
 * Archive codec — TS reference implementation of the .tabk container
 * ═══════════════════════════════════════════════════════════════
 * This module is the executable specification of the byte format produced by
 * the dependency-free Java code in
 * android/app/src/main/java/com/futureprint/calculator/backup/BackupArchive.java.
 * The Node test-suite round-trips Java-shaped archives through it and checks
 * that both sides agree, so drift in either implementation fails CI.
 *
 * Why a JSON-in-binary envelope instead of a ZIP:
 *  - Java can read it with no APK-size cost;
 *  - the header (schema version, counts, hashes) lives inside the AES-GCM
 *    authenticated region, so it cannot be edited without breaking the seal;
 *  - SQLite already stores text compactly, so a ZIP buys little and adds a
 *    ZIP-Slip attack surface we would otherwise have to harden.
 */

import type { BackupKind, BackupManifest } from "./types";
import {
  BACKUP_ARCHIVE_FORMAT_VERSION,
  BACKUP_ARCHIVE_FORMAT_VERSION_V2,
  BACKUP_ARCHIVE_MAGIC,
  BACKUP_ARCHIVE_PREFIX_LEN,
  BACKUP_ARCHIVE_V2_PREFIX_LEN,
  BACKUP_COMPRESSED_FLAG,
  BACKUP_GCM_TAG_LEN,
  BACKUP_SEALED_FLAG,
} from "./types";
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  deriveKeyId,
  openPayload,
  openPayloadWithAad,
  sealPayload,
  sealPayloadWithAad,
  utf8Decode,
  utf8Encode,
} from "./crypto";

export interface ParsedArchive {
  archiveVersion: number;
  sealed: boolean;
  compressed?: boolean;
  keyId: string;
  /** Stored payload bytes (v1: envelope/ciphertext; v2: dbBlock). */
  payload: Uint8Array;
  /** v2 only: UTF-8 JSON manifest block (or AES-GCM sealed header block). */
  headerBlock?: Uint8Array;
  /** v2 only: raw/gzip database block (or AES-GCM sealed with AAD=headerBlock). */
  dbBlock?: Uint8Array;
  totalLength: number;
}

export interface ParsedArchiveV2 {
  archiveVersion: typeof BACKUP_ARCHIVE_FORMAT_VERSION_V2;
  sealed: boolean;
  compressed: boolean;
  keyId: string;
  headerBlock: Uint8Array;
  dbBlock: Uint8Array;
  totalLength: number;
}

export class ArchiveFormatError extends Error {
  code: "BAD_MAGIC" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "BAD_LENGTHS";
  constructor(code: ArchiveFormatError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ArchiveFormatError";
  }
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
}

function u64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(Math.max(0, Math.trunc(value))));
  return out;
}

function readU64(view: DataView, offset: number): number {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 0x100000000 + lo;
}

// ── Portable GZIP helpers (WebView CompressionStream + Node zlib fallback) ───

async function loadNodeZlib(): Promise<{ gzipSync: (b: Uint8Array) => Uint8Array; gunzipSync: (b: Uint8Array) => Uint8Array } | null> {
  const g: any = typeof globalThis !== "undefined" ? globalThis : undefined;
  if (!g?.process?.versions?.node) return null;
  try {
    const modName = "node:" + "zlib";
    return await import(/* @vite-ignore */ modName);
  } catch {
    return null;
  }
}

async function runTransformStream(
  stream: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> },
  input: Uint8Array
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);

  const writePromise = (async () => {
    await writer.write(copy);
    await writer.close();
  })();

  const readPromise = (async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  })();

  const [, out] = await Promise.all([writePromise, readPromise]);
  return out;
}

/** GZIP-compresses bytes using Web CompressionStream with a safe Node zlib fallback. */
export async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "function") {
    return runTransformStream(new CompressionStream("gzip"), input);
  }
  const zlib = await loadNodeZlib();
  if (zlib) {
    return new Uint8Array(zlib.gzipSync(input));
  }
  throw new Error("GZIP_UNAVAILABLE");
}

/** GZIP-decompresses bytes using Web DecompressionStream with a safe Node zlib fallback. */
export async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "function") {
    return runTransformStream(new DecompressionStream("gzip"), input);
  }
  const zlib = await loadNodeZlib();
  if (zlib) {
    return new Uint8Array(zlib.gunzipSync(input));
  }
  throw new Error("GZIP_UNAVAILABLE");
}

// ── Archive v1 encoder ──────────────────────────────────────────────────────

/**
 * Builds the variable-length header:
 *   magic | version | flags | keyIdLen(2) | reserved(2) | payloadLen(8) | keyId
 * The field order is fixed in this one place because both the JS and Java
 * encoders are validated against it by the byte-parity test.
 */
export function buildArchivePrefix(keyId: string, payloadLength: number, sealed: boolean): Uint8Array {
  const keyIdBytes = utf8Encode(keyId);
  return concatBytes(
    utf8Encode(BACKUP_ARCHIVE_MAGIC),
    new Uint8Array([BACKUP_ARCHIVE_FORMAT_VERSION, sealed ? BACKUP_SEALED_FLAG : 0]),
    u16(keyIdBytes.length),
    new Uint8Array([0, 0]),
    u64(payloadLength),
    keyIdBytes
  );
}

/**
 * Builds a complete v1 archive.
 * When `rawKey` is provided the plaintext is AES-256-GCM sealed; the keyId is
 * written in the header and a 16-byte slot is reserved after the payload
 * (the tag itself is embedded at the end of the sealed bytes).
 */
export async function encodeArchive(
  plaintext: Uint8Array,
  options: { rawKey?: Uint8Array; keyId?: string } = {}
): Promise<Uint8Array> {
  const sealed = Boolean(options.rawKey);
  const payload = sealed ? await sealPayload(plaintext, options.rawKey!) : plaintext;
  const keyId = sealed ? options.keyId ?? "" : "";
  if (sealed && keyId.length === 0) throw new Error("keyId is required for encrypted archives");
  const prefix = buildArchivePrefix(keyId, payload.length, sealed);
  const tagSlot = sealed ? new Uint8Array(BACKUP_GCM_TAG_LEN) : new Uint8Array(0);
  return concatBytes(prefix, payload, tagSlot);
}

// ── Archive v2 encoder & parser ─────────────────────────────────────────────

/**
 * Builds a v2 archive matching Android BackupArchive.encodeV2 byte-for-byte:
 *   magic("TABK",4) | version(2,1) | flags(1: bit0=sealed, bit1=compressed)
 *   | keyIdLen(2 BE) | headerLen(4 BE) | dbBlockLen(8 BE)
 *   | keyId | headerBlock | dbBlock
 *
 * When sealed, `headerBlock` is AES-256-GCM sealed JSON manifest, and `dbBlock`
 * is AES-256-GCM sealed (with AAD = headerBlock) over the raw or GZIP database.
 */
export async function encodeArchiveV2(
  manifest: BackupManifest,
  database: Uint8Array,
  options: { rawKey?: Uint8Array; keyId?: string; compress?: boolean } = {}
): Promise<Uint8Array> {
  const sealed = Boolean(options.rawKey);
  const compressed = options.compress ?? true;
  const flags = (sealed ? BACKUP_SEALED_FLAG : 0) | (compressed ? BACKUP_COMPRESSED_FLAG : 0);

  const keyId = sealed ? options.keyId || (await deriveKeyId(options.rawKey!)) : "";
  const keyIdBytes = utf8Encode(keyId);

  const headerJson = utf8Encode(JSON.stringify(manifest));
  const headerBlock = sealed ? await sealPayload(headerJson, options.rawKey!) : headerJson;

  const dbPayload = compressed ? await gzipBytes(database) : database;
  const dbBlock = sealed ? await sealPayloadWithAad(dbPayload, options.rawKey!, headerBlock) : dbPayload;

  return concatBytes(
    utf8Encode(BACKUP_ARCHIVE_MAGIC),
    new Uint8Array([BACKUP_ARCHIVE_FORMAT_VERSION_V2, flags]),
    u16(keyIdBytes.length),
    u32(headerBlock.length),
    u64(dbBlock.length),
    keyIdBytes,
    headerBlock,
    dbBlock
  );
}

/** Parses and length-validates a v2 archive without decrypting or decompressing it. */
export function parseArchiveV2(bytes: Uint8Array): ParsedArchiveV2 {
  if (bytes.length < BACKUP_ARCHIVE_V2_PREFIX_LEN) {
    throw new ArchiveFormatError("TRUNCATED", "Archive is shorter than its v2 header (" + bytes.length + " bytes).");
  }
  const magic = utf8Decode(bytes.subarray(0, 4));
  if (magic !== BACKUP_ARCHIVE_MAGIC) {
    throw new ArchiveFormatError("BAD_MAGIC", "Not a T.A backup archive.");
  }
  const version = bytes[4];
  if (version !== BACKUP_ARCHIVE_FORMAT_VERSION_V2) {
    throw new ArchiveFormatError("UNSUPPORTED_VERSION", "Unsupported archive version " + version + ".");
  }
  const flags = bytes[5];
  const sealed = (flags & BACKUP_SEALED_FLAG) !== 0;
  const compressed = (flags & BACKUP_COMPRESSED_FLAG) !== 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyIdLen = view.getUint16(6);
  const headerLen = view.getUint32(8);
  const dbBlockLen = readU64(view, 12);

  if (keyIdLen > 128) {
    throw new ArchiveFormatError("BAD_LENGTHS", "Archive header contains an invalid keyId length.");
  }
  if (headerLen === 0 || headerLen > 16 * 1024 * 1024) {
    throw new ArchiveFormatError("BAD_LENGTHS", "Archive header contains an invalid manifest block length.");
  }
  const expected = BACKUP_ARCHIVE_V2_PREFIX_LEN + keyIdLen + headerLen + dbBlockLen;
  if (bytes.length !== expected) {
    throw new ArchiveFormatError(
      "TRUNCATED",
      "Archive length mismatch: header promises " + expected + " bytes but file has " + bytes.length + "."
    );
  }
  const keyIdStart = BACKUP_ARCHIVE_V2_PREFIX_LEN;
  const headerStart = keyIdStart + keyIdLen;
  const dbStart = headerStart + headerLen;
  return {
    archiveVersion: BACKUP_ARCHIVE_FORMAT_VERSION_V2,
    sealed,
    compressed,
    keyId: utf8Decode(bytes.subarray(keyIdStart, headerStart)),
    headerBlock: bytes.subarray(headerStart, dbStart),
    dbBlock: bytes.subarray(dbStart, dbStart + dbBlockLen),
    totalLength: bytes.length,
  };
}

/** Parses and length-validates a v1 or v2 archive without decrypting it. */
export function parseArchive(bytes: Uint8Array): ParsedArchive {
  if (bytes.length < BACKUP_ARCHIVE_PREFIX_LEN) {
    throw new ArchiveFormatError("TRUNCATED", "Archive is shorter than its header (" + bytes.length + " bytes).");
  }
  const magic = utf8Decode(bytes.subarray(0, 4));
  if (magic !== BACKUP_ARCHIVE_MAGIC) {
    throw new ArchiveFormatError("BAD_MAGIC", "Not a T.A backup archive.");
  }
  const version = bytes[4];
  if (version === BACKUP_ARCHIVE_FORMAT_VERSION_V2) {
    const v2 = parseArchiveV2(bytes);
    return {
      archiveVersion: v2.archiveVersion,
      sealed: v2.sealed,
      compressed: v2.compressed,
      keyId: v2.keyId,
      payload: v2.dbBlock,
      headerBlock: v2.headerBlock,
      dbBlock: v2.dbBlock,
      totalLength: v2.totalLength,
    };
  }
  if (version !== BACKUP_ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveFormatError("UNSUPPORTED_VERSION", "Unsupported archive version " + version + ".");
  }
  const sealed = (bytes[5] & BACKUP_SEALED_FLAG) !== 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyIdLen = view.getUint16(6);
  const payloadLen = readU64(view, 10);
  if (keyIdLen > 128) {
    throw new ArchiveFormatError("BAD_LENGTHS", "Archive header contains an invalid keyId length.");
  }
  const expected = BACKUP_ARCHIVE_PREFIX_LEN + keyIdLen + payloadLen + (sealed ? BACKUP_GCM_TAG_LEN : 0);
  if (bytes.length !== expected) {
    throw new ArchiveFormatError(
      "TRUNCATED",
      "Archive length mismatch: header promises " + expected + " bytes but file has " + bytes.length + "."
    );
  }
  const keyId = utf8Decode(bytes.subarray(BACKUP_ARCHIVE_PREFIX_LEN, BACKUP_ARCHIVE_PREFIX_LEN + keyIdLen));
  const payloadStart = BACKUP_ARCHIVE_PREFIX_LEN + keyIdLen;
  return {
    archiveVersion: version,
    sealed,
    keyId,
    payload: bytes.subarray(payloadStart, payloadStart + payloadLen),
    totalLength: bytes.length,
  };
}

export interface OpenedArchive {
  manifest: BackupManifest;
  database: Uint8Array;
}

/** Builds the JSON envelope that is sealed inside a v1 archive (exported for tests). */
export function encodePayloadEnvelope(manifest: BackupManifest, database: Uint8Array): Uint8Array {
  return utf8Encode(JSON.stringify({ header: manifest, databaseBase64: bytesToBase64(database) }));
}

/**
 * Decrypts (if needed), decompresses (v2 if compressed), and decodes either a v1 or v2 archive.
 * In v1, header fields travel inside the authenticated payload.
 * In v2, the database block is authenticated with AAD = headerBlock so tampering with either fails the seal.
 */
export async function openArchive(archive: Uint8Array, rawKey?: Uint8Array): Promise<OpenedArchive> {
  const parsed = parseArchive(archive);

  if (parsed.archiveVersion === BACKUP_ARCHIVE_FORMAT_VERSION_V2) {
    const headerBlock = parsed.headerBlock!;
    const dbBlock = parsed.dbBlock!;
    let headerPlain: Uint8Array;
    let dbPayload: Uint8Array;

    if (parsed.sealed) {
      if (!rawKey) throw new Error("ENCRYPTED_NEEDS_KEY");
      const openedHeader = await openPayload(headerBlock, rawKey);
      if (!openedHeader) throw new Error("BAD_SEAL");
      const openedDb = await openPayloadWithAad(dbBlock, rawKey, headerBlock);
      if (!openedDb) throw new Error("BAD_SEAL");
      headerPlain = openedHeader;
      dbPayload = openedDb;
    } else {
      headerPlain = headerBlock;
      dbPayload = dbBlock;
    }

    let manifest: BackupManifest;
    try {
      const parsedHeader = JSON.parse(utf8Decode(headerPlain));
      if (!parsedHeader || typeof parsedHeader !== "object") {
        throw new Error("BAD_ENVELOPE");
      }
      manifest = parsedHeader as BackupManifest;
    } catch {
      throw new Error("BAD_ENVELOPE");
    }

    let database: Uint8Array;
    if (parsed.compressed) {
      try {
        database = await gunzipBytes(dbPayload);
      } catch {
        throw new Error("BAD_ENVELOPE");
      }
    } else {
      database = dbPayload;
    }
    return { manifest, database };
  }

  let plaintext: Uint8Array;
  if (parsed.sealed) {
    if (!rawKey) throw new Error("ENCRYPTED_NEEDS_KEY");
    const opened = await openPayload(parsed.payload, rawKey);
    if (!opened) throw new Error("BAD_SEAL");
    plaintext = opened;
  } else {
    plaintext = parsed.payload;
  }

  let envelope: any;
  try {
    envelope = JSON.parse(utf8Decode(plaintext));
  } catch {
    throw new Error("BAD_ENVELOPE");
  }
  if (!envelope?.header || typeof envelope?.databaseBase64 !== "string") {
    throw new Error("BAD_ENVELOPE");
  }
  return { manifest: envelope.header as BackupManifest, database: base64ToBytes(envelope.databaseBase64) };
}

export type { BackupKind };
