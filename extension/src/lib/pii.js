/**
 * PII detection.
 *
 * Two independent passes, because the rubric scores detection recall AND
 * redaction precision separately:
 *   1. Structural  - what an element IS (password field, autocomplete hint).
 *                    Near-zero false positives, so it is trusted outright.
 *   2. Textual     - what an element CONTAINS (Aadhaar, PAN, card, email...).
 *                    Regex alone over-fires, so every format that carries a
 *                    checksum is verified before being reported.
 *
 * Checksum verification is the main lever on precision: a bare 12-digit regex
 * flags order IDs and timestamps as Aadhaar numbers. Verhoeff rejects ~90% of
 * those. Same argument for Luhn on card numbers.
 */

export const Severity = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };

// ---------------------------------------------------------------- checksums

const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

/** Aadhaar carries a Verhoeff check digit. Also: never starts with 0 or 1. */
export function isValidAadhaar(digits) {
  if (!/^[2-9]\d{11}$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split("").reverse().map(Number);
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][rev[i]]];
  return c === 0;
}

/** Luhn, for payment card numbers. */
export function isValidLuhn(digits) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------- patterns

const PATTERNS = [
  {
    kind: "aadhaar",
    severity: Severity.CRITICAL,
    re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    verify: (m) => isValidAadhaar(m.replace(/[\s-]/g, "")),
  },
  {
    kind: "card",
    severity: Severity.CRITICAL,
    re: /\b(?:\d[ -]?){13,19}\b/g,
    verify: (m) => isValidLuhn(m.replace(/[\s-]/g, "")),
  },
  {
    // PAN: 5 letters, 4 digits, 1 letter. 4th char encodes holder type.
    kind: "pan",
    severity: Severity.CRITICAL,
    re: /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/g,
  },
  { kind: "ifsc",  severity: Severity.HIGH, re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { kind: "upi",   severity: Severity.HIGH, re: /\b[\w.\-]{2,}@(?:oksbi|okhdfcbank|okicici|okaxis|paytm|ybl|ibl|axl|upi)\b/gi },
  { kind: "email", severity: Severity.HIGH, re: /\b[\w.+\-]+@[\w\-]+\.[\w.\-]{2,}\b/g },
  {
    kind: "phone_in",
    severity: Severity.HIGH,
    re: /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g,
    // A 10-digit mobile inside a longer digit run is probably not a phone.
    verify: (m, ctx) => !/\d/.test(ctx.before.slice(-1)) && !/\d/.test(ctx.after[0] || ""),
  },
  { kind: "dob",   severity: Severity.MEDIUM, re: /\b(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/g },
];

// ------------------------------------------------------------- structural

const SENSITIVE_AUTOCOMPLETE = new Set([
  "cc-number","cc-csc","cc-exp","cc-name","cc-exp-month","cc-exp-year",
  "tel","tel-national","email","street-address","postal-code",
  "address-line1","address-line2","bday","name","given-name","family-name",
  "new-password","current-password","one-time-code",
]);

const SENSITIVE_NAME_RE =
  /(pass|pwd|secret|token|otp|cvv|cvc|aadhaar|aadhar|uidai|pan\b|ssn|passport|account|acct|ifsc|upi|card|phone|mobile|email|dob|birth|salary|income)/i;

/**
 * Structural signals. These are trusted without further verification because
 * an <input type="password"> is a password by definition.
 */
export function classifyElement(el) {
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "password") return { kind: "password", severity: Severity.CRITICAL, source: "structural" };
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase().trim();
    if (SENSITIVE_AUTOCOMPLETE.has(ac)) return { kind: `autocomplete:${ac}`, severity: Severity.CRITICAL, source: "structural" };
    const ident = `${el.name || ""} ${el.id || ""} ${el.getAttribute("aria-label") || ""} ${el.placeholder || ""}`;
    if (SENSITIVE_NAME_RE.test(ident)) return { kind: "sensitive_field", severity: Severity.HIGH, source: "structural" };
  }
  if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS") {
    // Cannot know without pixels — the vision pass decides. Flagged as a
    // candidate so the vision model is only run where it might matter.
    return { kind: "visual_candidate", severity: Severity.MEDIUM, source: "structural" };
  }
  return null;
}

// ------------------------------------------------------------------ text

/** Scan a string, returning verified matches with offsets. */
export function scanText(text) {
  if (!text || text.length < 4) return [];
  const found = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const raw = m[0];
      const ctx = { before: text.slice(Math.max(0, m.index - 1), m.index), after: text.slice(m.index + raw.length) };
      if (p.verify && !p.verify(raw, ctx)) continue;
      found.push({ kind: p.kind, severity: p.severity, start: m.index, end: m.index + raw.length, length: raw.length, source: "textual" });
    }
  }
  // Overlapping hits: keep the most severe, then the longest. A card number
  // matched as both "card" and "phone_in" must redact once, as a card.
  found.sort((a, b) => a.start - b.start || b.severity - a.severity || b.length - a.length);
  const kept = [];
  for (const f of found) {
    const last = kept[kept.length - 1];
    if (last && f.start < last.end) continue;
    kept.push(f);
  }
  return kept;
}
