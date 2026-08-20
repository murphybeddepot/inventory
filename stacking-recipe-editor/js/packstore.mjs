// packstore.mjs — squeeze the bulky part of a recipe so the library fits.
//
// Zac 2026-08-20, with the SKU on screen and the layout finished:
//   "SAVE FAILED — QBZ-V3-WHITE-2 was NOT saved.
//    QuotaExceededError: Setting the value of 'mbd_stacking_library_v1'
//    exceeded the quota."
//
// WHY IT GOT THAT BIG. A recipe carries importedParts[], and each part keeps the
// VERBATIM CabProdPart XML it was imported from — that is what makes the Mozaik
// round-trip exact, and it is not optional. For Boaz V3 that is 367 KB of XML,
// ~0.82 MB once JSON-escaped and stored as UTF-16. localStorage gives about 5 MB
// PER ORIGIN, shared with the whole Bedrock PWA, so five or six recipes fill it
// and then every save fails forever.
//
// WHAT DOES NOT WORK, measured before writing this: deduping identical parts
// saves 0% — all 66 CabProdPart blocks in Boaz V3 are distinct, because each
// carries its own op IDs and coordinates. Stripping indentation saves 8%.
//
// WHAT DOES: the XML is enormously repetitive, so LZW takes the same payload to
// 0.060 MB — 93% off, thirteen times more recipes in the same bucket. Deflate
// would do better still (15 KB) but CompressionStream is ASYNC, and both the
// save handler and the boot-time restore are synchronous; making them async is a
// far riskier change than compressing.
//
// The codes are packed 15 bits per UTF-16 char. Not 16: a lone surrogate is not
// a valid string and some browsers mangle it on the way to storage. The
// dictionary FREEZES at 32767 entries rather than resetting, so a code can never
// need a 16th bit. Freezing is deterministic on both sides; a reset has to be
// mirrored exactly by the reader and my first attempt at one round-tripped
// wrong on every real payload — caught because the test compares bytes.
//
// Round-trip is exact and gated: quarry/tests and scripts/test-sre-guided-rebind
// both compress real product XML and demand the original back, byte for byte.

const BITS = 15;
const MAX_CODE = (1 << BITS) - 1;        // 32767
export const MAGIC = 'LZW1:';            // a stored value that lacks it is plain

// LZW gives codes 0..255 to single symbols, so the symbols have to BE bytes.
// Compressing the JS string directly looked fine on every XML payload and then
// round-tripped wrong on 'café — naïve': an em-dash is code 8212, the writer
// emitted it as a literal code, and the reader saw 8212 >= 256 and went looking
// in the dictionary. Recipe names and notes are free text, so that is a real
// path, not a curiosity. Encoding to UTF-8 first makes every symbol a byte and
// the question cannot arise.
const toBytes = (s) => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i++) o += String.fromCharCode(b[i]); return o; };
const fromBytes = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return new TextDecoder().decode(b); };

export function compress(input) {
  const s = toBytes(String(input));
  if (!s) return MAGIC;
  const out = [];
  const dict = new Map();
  let next = 256, w = '';
  for (const ch of s) {
    const wc = w + ch;
    if (wc.length === 1 || dict.has(wc)) { w = wc; continue; }
    out.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
    // FULL means STOP GROWING, never reset. A reset has to be mirrored exactly
    // by the reader and is easy to get subtly wrong; freezing the dictionary is
    // deterministic on both sides and still gives 90%+ on this data.
    if (next <= MAX_CODE) dict.set(wc, next++);
    w = ch;
  }
  if (w !== '') out.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));

  // pack: BITS per char, low bits first
  let bitbuf = 0, bitcnt = 0, packed = '';
  for (const code of out) {
    bitbuf |= code << bitcnt; bitcnt += BITS;
    while (bitcnt >= BITS) { packed += String.fromCharCode(bitbuf & MAX_CODE); bitbuf >>>= BITS; bitcnt -= BITS; }
  }
  if (bitcnt > 0) packed += String.fromCharCode(bitbuf & MAX_CODE);
  return MAGIC + out.length + ':' + packed;
}

export function decompress(stored) {
  const s = String(stored || '');
  if (!s.startsWith(MAGIC)) return s;                    // plain, from an older save
  const head = s.indexOf(':', MAGIC.length);
  const count = +s.slice(MAGIC.length, head);
  const packed = s.slice(head + 1);
  if (!count) return '';

  const codes = [];
  let bitbuf = 0, bitcnt = 0;
  for (let i = 0; i < packed.length && codes.length < count; i++) {
    bitbuf |= packed.charCodeAt(i) << bitcnt; bitcnt += BITS;
    while (bitcnt >= BITS && codes.length < count) { codes.push(bitbuf & MAX_CODE); bitbuf >>>= BITS; bitcnt -= BITS; }
  }
  if (codes.length !== count) throw new Error('packstore: truncated payload');

  const dict = [];                                       // dict[i] is code 256+i
  let next = 256;
  let prev = codes[0] < 256 ? String.fromCharCode(codes[0]) : dict[codes[0] - 256];
  let out = prev;
  for (let i = 1; i < codes.length; i++) {
    const code = codes[i];
    // the classic LZW edge case: a code one past the end means prev + prev[0]
    const cur = code < 256 ? String.fromCharCode(code)
      : (code - 256 < dict.length ? dict[code - 256] : prev + prev[0]);
    out += cur;
    if (next <= MAX_CODE) { dict.push(prev + cur[0]); next++; }
    prev = cur;
  }
  return fromBytes(out);
}

// How much a value costs in localStorage, in bytes (UTF-16).
export const storedBytes = (v) => String(v == null ? '' : v).length * 2;
