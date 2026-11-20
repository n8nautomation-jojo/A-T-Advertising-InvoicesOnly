import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  BACKUP_ARCHIVE_FORMAT_VERSION_V2,
  BACKUP_ARCHIVE_PREFIX_LEN,
  BACKUP_ARCHIVE_V2_PREFIX_LEN,
  BACKUP_FILE_PREFIX,
  BACKUP_FILE_SUFFIX,
  BACKUP_FORMAT_ID,
  BACKUP_GCM_TAG_LEN,
  type BackupManifest,
} from "@/lib/backup/types";
import {
  ArchiveFormatError,
  encodeArchive,
  encodeArchiveV2,
  encodePayloadEnvelope,
  openArchive,
  parseArchive,
  parseArchiveV2,
} from "@/lib/backup/codec";
import {
  base64ToBytes,
  bytesToBase64,
  deriveKeyId,
  formatRecoveryKey,
  generateKeyBase64,
  openPayload,
  parseRecoveryKey,
  sha256Bytes,
  sha256Hex,
  utf8Encode,
} from "@/lib/backup/crypto";

function manifestFor(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    format: BACKUP_FORMAT_ID,
    manifestVersion: 1,
    backupId: "20261111-123456-manual-abcdef",
    kind: "manual",
    createdAt: "2026-11-11T10:00:00.000Z",
    appVersion: "1.3.1-INVOICE",
    databaseSchemaVersion: 1,
    databaseSchemaCurrent: 1,
    databaseFilename: "ta_invoicing_dbSQLite.db",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    payloadSha256: "a".repeat(64),
    encrypted: false,
    keyId: "",
    databaseMagic: "SQLite format 3\0",
    counts: { custom_invoices: 2 },
    quickCheck: "ok",
    integrity: "ok",
    invoiceCount: 2,
    installationId: "inst",
    appId: "com.taadvertising.invoicing",
    device: "test",
    ...overrides,
  };
}

/**
 * Reproduces BackupArchive.encode() in Java byte-for-byte:
 *  magic | version | flags | keyIdLen(2) | reserved(2) | payloadLen(8) | keyId | payload | slot
 */
function javaShapeArchive(payload: Uint8Array, keyId: string, sealed = false): Uint8Array {
  const keyIdBytes = utf8Encode(keyId);
  const prefix = new Uint8Array(18);
  prefix.set(utf8Encode("TABK"), 0);
  prefix[4] = 1;
  prefix[5] = sealed ? 1 : 0;
  prefix[6] = (keyIdBytes.length >> 8) & 0xff;
  prefix[7] = keyIdBytes.length & 0xff;
  const view = new DataView(prefix.buffer);
  view.setBigUint64(10, BigInt(payload.length));
  const out = new Uint8Array(prefix.length + keyIdBytes.length + payload.length + (sealed ? BACKUP_GCM_TAG_LEN : 0));
  out.set(prefix, 0);
  out.set(keyIdBytes, prefix.length);
  out.set(payload, prefix.length + keyIdBytes.length);
  return out;
}

describe("Backup crypto primitives", () => {
  it("SHA-256 matches Node's crypto for binary and empty input", () => {
    const vectors = [new Uint8Array(0), utf8Encode("اختبر SHA-256"), randomBytes(4096)];
    for (const v of vectors) {
      const expected = createHash("sha256").update(Buffer.from(v)).digest("hex");
      expect(Buffer.from(sha256Bytes(v)).toString("hex")).toBe(expected);
    }
  });

  it("async sha256Hex agrees with the synchronous implementation", async () => {
    const data = randomBytes(100_000);
    expect(await sha256Hex(new Uint8Array(data))).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("base64 round-trips arbitrary bytes (Android Base64 compatible)", () => {
    for (const size of [0, 1, 2, 3, 4, 5, 255, 1024]) {
      const bytes = randomBytes(size);
      const encoded = bytesToBase64(new Uint8Array(bytes));
      expect(encoded).toBe(bytes.toString("base64"));
      expect(Buffer.from(base64ToBytes(encoded)).toString("hex")).toBe(bytes.toString("hex"));
    }
  });

  it("key ids are stable, 16 hex chars and unusable for decryption", async () => {
    const key = base64ToBytes(generateKeyBase64());
    const id = await deriveKeyId(key);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).toBe(await deriveKeyId(key));
    expect(id).not.toBe(Buffer.from(key).toString("hex"));
  });

  it("AES-256-GCM rejects a wrong key and detects a flipped byte", async () => {
    const key = randomBytes(32);
    const plaintext = utf8Encode("invoice data");
    const sealed = await (await import("@/lib/backup/crypto")).sealPayload(plaintext, new Uint8Array(key));
    const opened = await openPayload(sealed, new Uint8Array(key));
    expect(Buffer.from(opened!).toString()).toBe("invoice data");

    const wrongKey = randomBytes(32);
    expect(await openPayload(sealed, new Uint8Array(wrongKey))).toBeNull();

    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    expect(await openPayload(tampered, new Uint8Array(key))).toBeNull();
  });

  it("Recovery Key formats and parses a 256-bit key with checksum verification", async () => {
    const rawKey = new Uint8Array(randomBytes(32));
    const keyIdBefore = await deriveKeyId(rawKey);
    const formatted = await formatRecoveryKey(rawKey);

    expect(formatted).toMatch(/^TAKEY-([0-9A-F]{4}-){16}[0-9A-F]{4}$/);

    // Exact round-trip
    const parsed = await parseRecoveryKey(formatted);
    expect(Buffer.from(parsed).toString("hex")).toBe(Buffer.from(rawKey).toString("hex"));
    expect(await deriveKeyId(parsed)).toBe(keyIdBefore);

    // Tolerates lowercase, whitespace, and stripped prefix/dashes
    const loose = "  " + formatted.toLowerCase().replace(/^takey-/, "").replace(/-/g, " ") + "  ";
    const parsedLoose = await parseRecoveryKey(loose);
    expect(Buffer.from(parsedLoose).toString("hex")).toBe(Buffer.from(rawKey).toString("hex"));

    // Rejects a single-character typo via SHA-256 checksum
    const lastChar = formatted[formatted.length - 1];
    const mutatedLast = lastChar === "0" ? "1" : "0";
    const typo = formatted.slice(0, -1) + mutatedLast;
    await expect(parseRecoveryKey(typo)).rejects.toThrow(/فشل التحقق/);

    // Rejects truncated or invalid length codes
    await expect(parseRecoveryKey("TAKEY-1234-5678")).rejects.toThrow(/غير صالحة/);
    await expect(formatRecoveryKey(new Uint8Array(16))).rejects.toThrow(/32/);
  });
});

describe("Archive container (.tabk)", () => {
  it("round-trips an unencrypted payload", async () => {
    const payload = utf8Encode("hello backup");
    const archive = await encodeArchive(payload);
    const parsed = parseArchive(archive);
    expect(parsed.sealed).toBe(false);
    expect(parsed.keyId).toBe("");
    expect(Buffer.from(parsed.payload).toString()).toBe("hello backup");
    expect(archive[0]).toBe("T".charCodeAt(0));
  });

  it("round-trips an encrypted payload and records the key id", async () => {
    const key = randomBytes(32);
    const keyId = await deriveKeyId(new Uint8Array(key));
    const envelope = encodePayloadEnvelope(manifestFor({ encrypted: true }), utf8Encode("db-bytes"));
    const archive = await encodeArchive(envelope, { rawKey: new Uint8Array(key), keyId });
    const parsed = parseArchive(archive);
    expect(parsed.sealed).toBe(true);
    expect(parsed.keyId).toBe(keyId);
    // The plaintext must not be visible anywhere in the stored bytes.
    expect(Buffer.from(parsed.payload).toString()).not.toContain("TA-BACKUP");
    const opened = await openArchive(archive, new Uint8Array(key));
    expect(opened.manifest.backupId).toBe(manifestFor().backupId);
    expect(Buffer.from(opened.database).toString()).toBe("db-bytes");
  });

  it("matches the Java encoder byte layout exactly", async () => {
    const payload = utf8Encode(JSON.stringify({ header: manifestFor(), databaseBase64: "AAEC" }));
    const ts = await encodeArchive(payload);
    const java = javaShapeArchive(payload, "");
    expect(ts.length).toBe(java.length);
    expect(Buffer.from(ts).toString("hex")).toBe(Buffer.from(java).toString("hex"));
  });

  it("reads a Java-shaped archive with a non-empty key id", () => {
    const payload = utf8Encode("x");
    const parsed = parseArchive(javaShapeArchive(payload, "0123456789abcdef"));
    expect(parsed.keyId).toBe("0123456789abcdef");
    expect(parsed.totalLength).toBe(BACKUP_ARCHIVE_PREFIX_LEN + 16 + 1);
  });

  it("rejects bad magic, truncation and unsupported versions with distinct codes", async () => {
    const archive = await encodeArchive(utf8Encode("payload"));
    const truncated = archive.subarray(0, archive.length - 1);
    expect(() => parseArchive(truncated)).toThrow(ArchiveFormatError);
    try {
      parseArchive(truncated);
    } catch (e) {
      expect((e as ArchiveFormatError).code).toBe("TRUNCATED");
    }

    const badMagic = new Uint8Array(archive);
    badMagic[0] = 0x58;
    try {
      parseArchive(badMagic);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ArchiveFormatError).code).toBe("BAD_MAGIC");
    }

    const badVersion = new Uint8Array(archive);
    badVersion[4] = 9;
    try {
      parseArchive(badVersion);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ArchiveFormatError).code).toBe("UNSUPPORTED_VERSION");
    }
  });

  it("rejects an appended-bytes attack (length must match header exactly)", async () => {
    const archive = await encodeArchive(utf8Encode("payload"));
    const longer = new Uint8Array(archive.length + 4);
    longer.set(archive);
    expect(() => parseArchive(longer)).toThrow(/length mismatch/);
  });

  it("refuses to decode a sealed archive without a key", async () => {
    const key = randomBytes(32);
    const keyId = await deriveKeyId(new Uint8Array(key));
    const archive = await encodeArchive(utf8Encode("secret"), { rawKey: new Uint8Array(key), keyId });
    await expect(openArchive(archive)).rejects.toThrow("ENCRYPTED_NEEDS_KEY");
  });

  it("encrypts the manifest too: editing the header breaks the seal", async () => {
    const key = randomBytes(32);
    const keyId = await deriveKeyId(new Uint8Array(key));
    const envelope = encodePayloadEnvelope(manifestFor(), utf8Encode("db-bytes"));
    const archive = await encodeArchive(envelope, { rawKey: new Uint8Array(key), keyId });
    // Flip one byte inside the ciphertext region.
    const parsed = parseArchive(archive);
    const payloadStart = BACKUP_ARCHIVE_PREFIX_LEN + parsed.keyId.length;
    const tampered = new Uint8Array(archive);
    tampered[payloadStart + 5] ^= 0x40;
    await expect(openArchive(tampered, new Uint8Array(key))).rejects.toThrow("BAD_SEAL");
  });

  it("uses file names that the discovery contract recognises", () => {
    const name = `${BACKUP_FILE_PREFIX}20261111-100000-daily-abcdef${BACKUP_FILE_SUFFIX}`;
    expect(name).toMatch(/^ta-backup-.*\.tabk$/);
  });
});

describe("Archive v2 container (binary + GZIP + AES-256-GCM AAD)", () => {
  it("round-trips a compressed unencrypted v2 archive and shrinks repetitive SQLite pages", async () => {
    const dbBytes = utf8Encode("SQLite format 3\0" + "INVOICE-ROW-DATA-".repeat(400));
    const manifest = manifestFor({
      sha256: await sha256Hex(dbBytes),
      sizeBytes: dbBytes.length,
      totalBusinessRecords: 12,
    });
    const archive = await encodeArchiveV2(manifest, dbBytes, { compress: true });
    const parsed = parseArchiveV2(archive);
    expect(parsed.archiveVersion).toBe(BACKUP_ARCHIVE_FORMAT_VERSION_V2);
    expect(parsed.sealed).toBe(false);
    expect(parsed.compressed).toBe(true);
    expect(parsed.totalLength).toBe(
      BACKUP_ARCHIVE_V2_PREFIX_LEN + parsed.keyId.length + parsed.headerBlock.length + parsed.dbBlock.length
    );
    expect(parsed.dbBlock.length).toBeLessThan(dbBytes.length / 4);

    const opened = await openArchive(archive);
    expect(opened.manifest.backupId).toBe(manifest.backupId);
    expect(opened.manifest.totalBusinessRecords).toBe(12);
    expect(Buffer.from(opened.database).toString("hex")).toBe(Buffer.from(dbBytes).toString("hex"));
  });

  it("round-trips an uncompressed v2 archive", async () => {
    const dbBytes = new Uint8Array(randomBytes(2048));
    const manifest = manifestFor({ sha256: await sha256Hex(dbBytes), sizeBytes: dbBytes.length });
    const archive = await encodeArchiveV2(manifest, dbBytes, { compress: false });
    const parsed = parseArchive(archive);
    expect(parsed.archiveVersion).toBe(BACKUP_ARCHIVE_FORMAT_VERSION_V2);
    expect(parsed.compressed).toBe(false);
    expect(parsed.sealed).toBe(false);

    const opened = await openArchive(archive);
    expect(Buffer.from(opened.database).toString("hex")).toBe(Buffer.from(dbBytes).toString("hex"));
  });

  it("seals v2 header + dbBlock with AAD binding (rejects wrong key, missing key, and header swap)", async () => {
    const key = new Uint8Array(randomBytes(32));
    const keyId = await deriveKeyId(key);
    const dbA = utf8Encode("SQLite format 3\0" + "SECRET-CLIENT-A-".repeat(100));
    const dbB = utf8Encode("SQLite format 3\0" + "SECRET-CLIENT-B-".repeat(100));
    const manifestA = manifestFor({ backupId: "bk-aaaa-01", encrypted: true, keyId, sha256: await sha256Hex(dbA), sizeBytes: dbA.length });
    const manifestB = manifestFor({ backupId: "bk-bbbb-02", encrypted: true, keyId, sha256: await sha256Hex(dbB), sizeBytes: dbB.length });

    const archiveA = await encodeArchiveV2(manifestA, dbA, { rawKey: key, keyId, compress: true });
    const archiveB = await encodeArchiveV2(manifestB, dbB, { rawKey: key, keyId, compress: true });

    // No plaintext leakage in v2 sealed bytes
    expect(Buffer.from(archiveA).toString("utf8")).not.toContain("SECRET-CLIENT-A");
    expect(Buffer.from(archiveA).toString("utf8")).not.toContain("bk-aaaa-01");

    // Missing key & wrong key rejected
    await expect(openArchive(archiveA)).rejects.toThrow("ENCRYPTED_NEEDS_KEY");
    await expect(openArchive(archiveA, new Uint8Array(randomBytes(32)))).rejects.toThrow("BAD_SEAL");

    // Valid open succeeds
    const opened = await openArchive(archiveA, key);
    expect(opened.manifest.backupId).toBe("bk-aaaa-01");
    expect(Buffer.from(opened.database).toString("hex")).toBe(Buffer.from(dbA).toString("hex"));

    // AAD binding check: swapping headerBlock from archiveB into archiveA (same key!) must fail BAD_SEAL
    const parsedA = parseArchiveV2(archiveA);
    const parsedB = parseArchiveV2(archiveB);
    const swapped = new Uint8Array(
      BACKUP_ARCHIVE_V2_PREFIX_LEN + parsedA.keyId.length + parsedB.headerBlock.length + parsedA.dbBlock.length
    );
    const prefix = new Uint8Array(archiveA.subarray(0, BACKUP_ARCHIVE_V2_PREFIX_LEN));
    new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).setUint32(8, parsedB.headerBlock.length, false);
    let off = 0;
    swapped.set(prefix, off);
    off += prefix.length;
    swapped.set(utf8Encode(parsedA.keyId), off);
    off += parsedA.keyId.length;
    swapped.set(parsedB.headerBlock, off);
    off += parsedB.headerBlock.length;
    swapped.set(parsedA.dbBlock, off);

    await expect(openArchive(swapped, key)).rejects.toThrow("BAD_SEAL");
  });
});

