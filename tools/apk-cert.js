#!/usr/bin/env node
/**
 * THE SIGNING CERTIFICATE OF AN APK, as a SHA-256 hex digest.
 *
 * WHY THIS EXISTS RATHER THAN `apksigner verify --print-certs`. Android refuses
 * to install an APK over one signed by a different key, reporting it only as
 * "The app wasn't installed", so the release has to assert its own signing
 * identity. The obvious tool for that printed NOTHING on the release runner —
 * no digest, no error, no non-zero exit — and a check that fails without
 * saying why is not a check. This reads the APK itself, so there is no second
 * tool's output format to depend on and it can be run anywhere Node runs.
 *
 * WHAT IT READS. The APK Signing Block sits between the zip entries and the
 * central directory (v2 scheme, and v3 which supersedes it):
 *
 *   u64 size | id-value pairs | u64 size | "APK Sig Block 42"
 *   pair   := u64 length, u32 id, value
 *   v2/v3  := u32 seq-len, then u32-length-prefixed signers
 *   signer := signed-data, signatures, public key   (each u32-length-prefixed)
 *   signed-data := digests, CERTIFICATES, attributes (each u32-length-prefixed)
 *   certificates := u32-length-prefixed DER X.509 certs
 *
 * The digest is over the first certificate's DER bytes, which is the same
 * value apksigner calls "certificate SHA-256 digest" — so a fingerprint
 * recorded from either tool stays comparable.
 *
 * USAGE
 *   node tools/apk-cert.js <apk>            print the digest
 *   node tools/apk-cert.js <apk> --verbose  also print the public key digest,
 *                                           which is what distinguishes two
 *                                           keys when certs differ cosmetically
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAGIC = Buffer.from('APK Sig Block 42');
const V2_ID = 0x7109871a;
const V3_ID = 0xf05368c0;

/** The id-value pairs of the APK Signing Block. */
function signingBlock(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset < 24 || buf.subarray(cdOffset - 16, cdOffset).compare(MAGIC) !== 0) {
    throw new Error('no APK Signing Block — the APK is unsigned, or v1 (JAR) only');
  }
  const sizeEnd = Number(buf.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - 8 - sizeEnd;
  const sizeStart = Number(buf.readBigUInt64LE(start));
  if (sizeStart !== sizeEnd) throw new Error('APK Signing Block size fields disagree');
  return buf.subarray(start + 8, cdOffset - 24);
}

/** Walk u32-length-prefixed elements of a sequence. */
function* elements(buf) {
  let o = 0;
  while (o + 4 <= buf.length) {
    const len = buf.readUInt32LE(o);
    if (o + 4 + len > buf.length) throw new Error('truncated length-prefixed element');
    yield buf.subarray(o + 4, o + 4 + len);
    o += 4 + len;
  }
}

/** The first signer's certificate and public key, from a v2/v3 block value. */
function firstSigner(value) {
  const seqLen = value.readUInt32LE(0);
  const signers = value.subarray(4, 4 + seqLen);
  for (const signer of elements(signers)) {
    const parts = [...elements(signer)];
    if (parts.length < 3) throw new Error('signer has too few fields');
    const [signedData, , publicKey] = parts;
    const [, certificates] = [...elements(signedData)];
    const cert = [...elements(certificates)][0];
    if (!cert) throw new Error('signer carries no certificate');
    return { cert, publicKey };
  }
  throw new Error('no signers in the block');
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const [, , path, ...flags] = process.argv;
if (!path) {
  console.error('usage: node tools/apk-cert.js <apk> [--verbose]');
  process.exit(2);
}
const buf = readFileSync(path);
let found = null;
for (const pair of (function* (block) {
  let o = 0;
  while (o + 12 <= block.length) {
    const len = Number(block.readBigUInt64LE(o));
    yield { id: block.readUInt32LE(o + 8), value: block.subarray(o + 12, o + 8 + len) };
    o += 8 + len;
  }
})(signingBlock(buf))) {
  // v3 wins where both are present: it is the scheme Android prefers, and its
  // signer is the identity that has to match.
  if (pair.id === V3_ID) { found = firstSigner(pair.value); break; }
  if (pair.id === V2_ID && !found) found = firstSigner(pair.value);
}
if (!found) throw new Error('no v2 or v3 signature block found');
console.log(sha256(found.cert));
if (flags.includes('--verbose')) {
  console.error(`public key sha256: ${sha256(found.publicKey)}`);
}
