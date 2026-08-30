var VeilTest = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // eval/e2e-entry.js
  var e2e_entry_exports = {};
  __export(e2e_entry_exports, {
    capture: () => capture,
    execute: () => execute,
    run: () => run
  });

  // extension/src/lib/pii.js
  var Severity = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
  var VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];
  var VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];
  function isValidAadhaar(digits) {
    if (!/^[2-9]\d{11}$/.test(digits)) return false;
    let c = 0;
    const rev = digits.split("").reverse().map(Number);
    for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][rev[i]]];
    return c === 0;
  }
  function isValidLuhn(digits) {
    if (!/^\d{13,19}$/.test(digits)) return false;
    let sum = 0, dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  var AADHAAR_CONTEXT = /(aadhaar|aadhar|uidai|\buid\b|आधार)/i;
  var ID_CONTEXT = /(driver'?s?\s*licen[cs]e|licen[cs]e\s*(no|num|#)|social\s*(security\s*)?(number|num)?|ssn|passport|id\s*card|\bid\b\s*[:#]|applicant|account\s*(no|num|#)|employee\s*id|registration\s*(no|num))\s*[:#-]?\s*$/i;
  var DOB_CONTEXT = /(date\s*of\s*birth|\bd\.?o\.?b\.?\b|\bborn\b|birth\s*(day|date)?|janm|जन्म)[^.]{0,40}$/i;
  var MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  var PATTERNS = [
    {
      kind: "aadhaar",
      severity: Severity.CRITICAL,
      re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      // Separated form (`1234 5678 9012`) collides with ticket numbers, invoice
      // refs and grouped digits generally, and roughly 1 in 10 of those pass
      // Verhoeff by chance. Bare 12-digit runs are accepted on the checksum
      // alone; separated ones additionally need a nearby identifying label.
      verify: (m, ctx) => {
        if (!isValidAadhaar(m.replace(/[\s-]/g, ""))) return false;
        if (!/[\s-]/.test(m)) return true;
        return AADHAAR_CONTEXT.test(ctx.before.slice(-40));
      }
    },
    {
      kind: "card",
      severity: Severity.CRITICAL,
      re: /\b(?:\d[ -]?){13,19}\b/g,
      verify: (m) => isValidLuhn(m.replace(/[\s-]/g, ""))
    },
    {
      // PAN: 5 letters, 4 digits, 1 letter. 4th char encodes holder type.
      kind: "pan",
      severity: Severity.CRITICAL,
      re: /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/g
    },
    { kind: "ifsc", severity: Severity.HIGH, re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
    { kind: "upi", severity: Severity.HIGH, re: /\b[\w.\-]{2,}@(?:oksbi|okhdfcbank|okicici|okaxis|paytm|ybl|ibl|axl|upi)\b/gi },
    { kind: "email", severity: Severity.HIGH, re: /\b[\w.+\-]+@[\w\-]+\.[\w.\-]{2,}\b/g },
    {
      kind: "phone_in",
      severity: Severity.HIGH,
      re: /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g,
      // A 10-digit mobile inside a longer digit run is probably not a phone.
      verify: (m, ctx) => !/\d/.test(ctx.before.slice(-1)) && !/\d/.test(ctx.after[0] || "") && !ID_CONTEXT.test(ctx.before)
    },
    {
      kind: "dob",
      severity: Severity.MEDIUM,
      re: /\b(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/g,
      verify: (m, ctx) => DOB_CONTEXT.test(ctx.before)
    },
    // ISO, optionally with a time component: 1977-04-07, 1977-04-07T00:00:00
    {
      kind: "dob",
      severity: Severity.MEDIUM,
      re: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T\d{2}:\d{2}(?::\d{2})?)?\b/g,
      verify: (m, ctx) => DOB_CONTEXT.test(ctx.before)
    },
    // 17th February 1946 · 5 May 1966
    {
      kind: "dob",
      severity: Severity.MEDIUM,
      re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}\\b`, "gi"),
      verify: (m, ctx) => DOB_CONTEXT.test(ctx.before)
    },
    // May 5th, 1966 · October 18 1980
    {
      kind: "dob",
      severity: Severity.MEDIUM,
      re: new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b`, "gi"),
      verify: (m, ctx) => DOB_CONTEXT.test(ctx.before)
    },
    // January/88 — month with a two-digit year
    {
      kind: "dob",
      severity: Severity.MEDIUM,
      re: new RegExp(`\\b(?:${MONTHS})\\/\\d{2}\\b`, "gi"),
      verify: (m, ctx) => DOB_CONTEXT.test(ctx.before)
    },
    // Labelled government or account identifier. Alphanumeric, because real
    // passport and licence numbers mix letters and digits (VDO631913G). The
    // label is required, so a bare token is never swept up on shape alone -
    // that requirement is what keeps precision high on a pattern this loose.
    {
      kind: "id_number",
      severity: Severity.CRITICAL,
      re: /\b(?=[A-Z0-9-]{6,18}\b)(?=[^\s]*\d)[A-Z0-9][A-Z0-9-]{4,16}[A-Z0-9]\b/gi,
      verify: (m, ctx) => ID_CONTEXT.test(ctx.before)
    }
  ];
  var SENSITIVE_AUTOCOMPLETE = /* @__PURE__ */ new Set([
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-name",
    "cc-exp-month",
    "cc-exp-year",
    "tel",
    "tel-national",
    "email",
    "street-address",
    "postal-code",
    "address-line1",
    "address-line2",
    "bday",
    "name",
    "given-name",
    "family-name",
    "new-password",
    "current-password",
    "one-time-code"
  ]);
  var SENSITIVE_NAME_RE = /(pass|pwd|secret|token|otp|cvv|cvc|aadhaar|aadhar|uidai|pan\b|ssn|passport|account|acct|ifsc|upi|card|phone|mobile|email|dob|birth|salary|income)/i;
  function classifyElement(el) {
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
      return { kind: "visual_candidate", severity: Severity.MEDIUM, source: "structural" };
    }
    return null;
  }
  function scanText(text) {
    if (!text || text.length < 4) return [];
    const found = [];
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        const raw = m[0];
        const ctx = { before: text.slice(Math.max(0, m.index - 48), m.index), after: text.slice(m.index + raw.length) };
        if (p.verify && !p.verify(raw, ctx)) continue;
        found.push({ kind: p.kind, severity: p.severity, start: m.index, end: m.index + raw.length, length: raw.length, source: "textual" });
      }
    }
    found.sort((a, b) => a.start - b.start || b.severity - a.severity || b.length - a.length);
    const kept = [];
    for (const f of found) {
      const last = kept[kept.length - 1];
      if (last && f.start < last.end) continue;
      kept.push(f);
    }
    return kept;
  }

  // extension/src/lib/redact.js
  var PLACEHOLDER = {
    aadhaar: "[[AADHAAR]]",
    pan: "[[PAN]]",
    card: "[[CARD]]",
    ifsc: "[[IFSC]]",
    upi: "[[UPI]]",
    email: "[[EMAIL]]",
    phone_in: "[[PHONE]]",
    dob: "[[DOB]]",
    id_number: "[[ID_NUMBER]]",
    password: "[[PASSWORD]]",
    sensitive_field: "[[SENSITIVE]]",
    visual_candidate: "[[IMAGE]]"
  };
  function placeholderFor(kind) {
    if (PLACEHOLDER[kind]) return PLACEHOLDER[kind];
    if (kind.startsWith("autocomplete:")) return `[[${kind.slice(13).toUpperCase().replace(/-/g, "_")}]]`;
    return "[[REDACTED]]";
  }
  function redactText(text, spans) {
    if (!spans.length) return { text, count: 0 };
    let out = text;
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i];
      out = out.slice(0, s.start) + placeholderFor(s.kind) + out.slice(s.end);
    }
    return { text: out, count: spans.length };
  }
  function describeFieldState(el) {
    const v = el.value || "";
    return { filled: v.length > 0, length: v.length };
  }
  function boxesFromRegions(regions, dpr = 1) {
    return regions.map((r) => ({
      x: Math.round(r.x / dpr),
      y: Math.round(r.y / dpr),
      w: Math.round(r.w / dpr),
      h: Math.round(r.h / dpr),
      kind: r.kind,
      mode: r.severity >= 3 ? "blackout" : "blur"
    }));
  }

  // extension/src/lib/perf.js
  function heapBytes() {
    const m = performance.memory;
    return m && typeof m.usedJSHeapSize === "number" ? m.usedJSHeapSize : null;
  }
  var Budget = class {
    #t0 = performance.now();
    #last = this.#t0;
    #heap0 = heapBytes();
    phases = {};
    mark(name) {
      const now = performance.now();
      this.phases[name] = +(now - this.#last).toFixed(2);
      this.#last = now;
    }
    finish() {
      const heap1 = heapBytes();
      return {
        totalMs: +(performance.now() - this.#t0).toFixed(2),
        phases: this.phases,
        // Delta can read negative if GC ran mid-scan. Reported as-is rather than
        // clamped, because a clamped zero would hide that the number is noisy.
        heapDeltaBytes: this.#heap0 !== null && heap1 !== null ? heap1 - this.#heap0 : null,
        heapUsedBytes: heap1
      };
    }
  };

  // extension/src/lib/dom.js
  var INTERACTIVE = "a,button,input,select,textarea,[role=button],[role=link],[role=textbox],[contenteditable=true]";
  var SKIP_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "HEAD"]);
  function interactiveElements(root = document) {
    return root.querySelectorAll(INTERACTIVE);
  }
  function viewportSize() {
    const vv = globalThis.visualViewport;
    const doc = globalThis.document;
    const cands = [
      [globalThis.innerWidth, globalThis.innerHeight],
      [vv?.width, vv?.height],
      [doc?.documentElement?.clientWidth, doc?.documentElement?.clientHeight],
      [doc?.body?.clientWidth, doc?.body?.clientHeight]
    ];
    for (const [w, h] of cands) if (w > 0 && h > 0) return { w, h };
    return null;
  }
  var HAS_CHECK_VISIBILITY = typeof Element.prototype.checkVisibility === "function";
  function visibleRect(el, vp) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (vp && (r.bottom < 0 || r.top > vp.h || r.right < 0 || r.left > vp.w)) return null;
    if (HAS_CHECK_VISIBILITY) {
      if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
        return null;
      }
      return r;
    }
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return null;
    return r;
  }
  function boxOf(r) {
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // extension/src/lib/serialize.js
  var INLINE_TAGS = /* @__PURE__ */ new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BDO",
    "CITE",
    "CODE",
    "DATA",
    "DFN",
    "EM",
    "I",
    "KBD",
    "MARK",
    "Q",
    "RP",
    "RT",
    "RUBY",
    "S",
    "SAMP",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
    "VAR",
    "WBR",
    "LABEL",
    "FONT",
    "INS",
    "DEL"
  ]);
  function blockAncestor(el) {
    let cur = el;
    while (cur && cur !== document.body && INLINE_TAGS.has(cur.tagName)) {
      cur = cur.parentElement;
    }
    return cur || document.body;
  }
  function safeLabel(raw) {
    const t = (raw || "").trim().slice(0, 120);
    if (!t) return "";
    const spans = scanText(t);
    return spans.length ? redactText(t, spans).text : t;
  }
  function buildContext({ maxElements = 120 } = {}) {
    const budget = new Budget();
    const vp = viewportSize();
    const stats = { scanned: 0, redactedElements: 0, redactedSpans: 0, byKind: {} };
    const bump = (k, n = 1) => {
      stats.byKind[k] = (stats.byKind[k] || 0) + n;
    };
    const elements = [];
    const visualCandidates = [];
    const all = interactiveElements();
    for (let idx = 0; idx < all.length; idx++) {
      const el = all[idx];
      if (SKIP_TAGS.has(el.tagName)) continue;
      const r = visibleRect(el, vp);
      if (!r) continue;
      stats.scanned++;
      const cls = classifyElement(el);
      const isSensitive = cls && cls.kind !== "visual_candidate";
      if (!isSensitive && elements.length >= maxElements) {
        stats.truncated = (stats.truncated || 0) + 1;
        continue;
      }
      const entry = {
        i: idx,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || null,
        role: el.getAttribute("role") || null,
        label: safeLabel(el.getAttribute("aria-label") || el.placeholder || el.innerText || el.value && "" || ""),
        box: boxOf(r)
      };
      if (isSensitive) {
        entry.sensitive = cls.kind;
        entry.placeholder = placeholderFor(cls.kind);
        if (el.tagName === "INPUT") entry.state = describeFieldState(el);
        stats.redactedElements++;
        bump(cls.kind);
      } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        entry.state = describeFieldState(el);
      }
      elements.push(entry);
    }
    budget.mark("elements");
    for (const el of document.querySelectorAll("img,video,canvas")) {
      const r = visibleRect(el, vp);
      if (!r) continue;
      visualCandidates.push({ el, tag: el.tagName.toLowerCase(), box: boxOf(r), alt: safeLabel(el.getAttribute("alt")) });
    }
    budget.mark("visualCandidates");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const groups = /* @__PURE__ */ new Map();
    let node;
    while (node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) continue;
      const raw = node.nodeValue;
      if (!raw || !raw.trim()) continue;
      const block = blockAncestor(parent);
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push(raw);
    }
    const chunks = [];
    let textBudget = 8e3;
    let prevTail = "";
    for (const parts of groups.values()) {
      if (textBudget <= 0) break;
      const raw = parts.join("").replace(/\s+/g, " ").trim();
      if (raw.length < 3) {
        prevTail = raw;
        continue;
      }
      const prefix = prevTail ? prevTail.slice(-48) + " " : "";
      const spans = scanText(prefix + raw).filter((s) => s.start >= prefix.length).map((s) => ({ ...s, start: s.start - prefix.length, end: s.end - prefix.length }));
      prevTail = raw;
      if (spans.length) {
        stats.redactedSpans += spans.length;
        for (const s of spans) bump(s.kind);
      }
      const { text } = redactText(raw, spans);
      chunks.push(text);
      textBudget -= text.length;
    }
    budget.mark("text");
    const cost = budget.finish();
    return {
      schema: "veil/1",
      url: location.origin + location.pathname,
      // query string dropped: it carries PII
      title: safeLabel(document.title),
      viewport: { w: vp?.w ?? null, h: vp?.h ?? null, dpr: devicePixelRatio, culled: !!vp },
      elements,
      visualCandidates,
      text: chunks.join(" ").slice(0, 8e3),
      redactionScheme: "typed-placeholder/[[KIND]]",
      stats,
      cost,
      buildMs: cost.totalMs
    };
  }

  // extension/src/vision/yunet.js
  var INPUT_SIZE = 640;
  var STRIDES = [8, 16, 32];
  function preprocess(source, width, height, ctx2d) {
    const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
    const dw = Math.round(width * scale);
    const dh = Math.round(height * scale);
    const padX = Math.floor((INPUT_SIZE - dw) / 2);
    const padY = Math.floor((INPUT_SIZE - dh) / 2);
    ctx2d.fillStyle = "#000";
    ctx2d.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx2d.drawImage(source, 0, 0, width, height, padX, padY, dw, dh);
    const { data } = ctx2d.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const px = INPUT_SIZE * INPUT_SIZE;
    const out = new Float32Array(3 * px);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      out[p] = data[i + 2];
      out[px + p] = data[i + 1];
      out[2 * px + p] = data[i];
    }
    return { tensor: out, scale, padX, padY };
  }
  function decodeLevel(out, stride, threshold) {
    const cls = out[`cls_${stride}`], obj = out[`obj_${stride}`], box = out[`bbox_${stride}`];
    if (!cls || !obj || !box) return [];
    const cols = INPUT_SIZE / stride;
    const found = [];
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.max(0, cls[i]) * Math.max(0, obj[i]));
      if (score < threshold) continue;
      const col = i % cols, row = Math.floor(i / cols);
      const b = i * 4;
      const cx = (col + box[b]) * stride;
      const cy = (row + box[b + 1]) * stride;
      const w = Math.exp(box[b + 2]) * stride;
      const h = Math.exp(box[b + 3]) * stride;
      found.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
    return found;
  }
  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / (a.w * a.h + b.w * b.h - inter || 1);
  }
  function nms(boxes, iouThreshold = 0.3) {
    const sorted = [...boxes].sort((p, q) => q.score - p.score);
    const kept = [];
    for (const b of sorted) {
      if (!kept.some((k) => iou(k, b) > iouThreshold)) kept.push(b);
    }
    return kept;
  }
  function postprocess(outputs, { scale, padX, padY }, { threshold = 0.6, iouThreshold = 0.3, maxFaces = 32 } = {}) {
    let boxes = [];
    for (const s of STRIDES) boxes = boxes.concat(decodeLevel(outputs, s, threshold));
    return nms(boxes, iouThreshold).slice(0, maxFaces).map((b) => ({
      x: (b.x - padX) / scale,
      y: (b.y - padY) / scale,
      w: b.w / scale,
      h: b.h / scale,
      score: +b.score.toFixed(3)
    }));
  }

  // extension/src/vision/engine.js
  var MODEL_PATH = "models/yunet_face.onnx";
  function assetUrl(path) {
    const rt = globalThis.chrome?.runtime ?? globalThis.browser?.runtime;
    return rt?.getURL ? rt.getURL(path) : path;
  }
  var VisionEngine = class {
    #session = null;
    #ort = null;
    #canvas = null;
    #ctx = null;
    #backend = "none";
    #initPromise = null;
    #failed = false;
    get backend() {
      return this.#backend;
    }
    get ready() {
      return this.#session !== null;
    }
    /** Idempotent, and safe to call concurrently. */
    async init() {
      if (this.#session || this.#failed) return this.#backend;
      if (this.#initPromise) return this.#initPromise;
      this.#initPromise = this.#doInit().catch((e) => {
        this.#failed = true;
        this.#backend = `unavailable (${e?.message ?? e})`;
        return this.#backend;
      });
      return this.#initPromise;
    }
    async #doInit() {
      const ort = globalThis.ort ?? await import(
        /* webpackIgnore: true */
        assetUrl("vendor/ort.webgpu.min.js")
      ).then(() => globalThis.ort);
      if (!ort) throw new Error("onnxruntime not available");
      this.#ort = ort;
      ort.env.wasm.wasmPaths = new URL(assetUrl("vendor/"), location.href).href;
      ort.env.wasm.numThreads = 1;
      const providers = globalThis.navigator && "gpu" in globalThis.navigator ? ["webgpu", "wasm"] : ["wasm"];
      this.#session = await ort.InferenceSession.create(assetUrl(MODEL_PATH), {
        executionProviders: providers,
        graphOptimizationLevel: "all"
      });
      this.#backend = this.#session.handler?._ep ?? providers[0];
      this.#canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
      this.#ctx = this.#canvas.getContext("2d", { willReadFrequently: true });
      return this.#backend;
    }
    /**
     * @param {Array<{tag:string, box:{x,y,w,h}, alt:string}>} candidates
     * @returns {Promise<Array<{x,y,w,h,kind:string,severity:number,score?:number}>>}
     */
    async findSensitiveRegions(candidates, { budgetMs = 400, minArea = 48 * 48 } = {}) {
      if (!candidates?.length) return [];
      const t0 = performance.now();
      await this.init();
      const out = [];
      for (const c of candidates) {
        const area = c.box.w * c.box.h;
        if (area < minArea) continue;
        if (!this.#session || performance.now() - t0 > budgetMs) {
          out.push({ ...c.box, kind: "unscanned", severity: 3 });
          continue;
        }
        try {
          for (const f of await this.#detect(c)) out.push(f);
        } catch {
          out.push({ ...c.box, kind: "unscanned", severity: 3 });
        }
      }
      return out;
    }
    async #detect(candidate) {
      const el = candidate.el;
      if (!el || !(el instanceof HTMLImageElement || el instanceof HTMLCanvasElement || el instanceof HTMLVideoElement)) {
        return [{ ...candidate.box, kind: "unscanned", severity: 3 }];
      }
      const w = el.naturalWidth ?? el.videoWidth ?? el.width;
      const h = el.naturalHeight ?? el.videoHeight ?? el.height;
      if (!w || !h) return [];
      const tf = preprocess(el, w, h, this.#ctx);
      const input = new this.#ort.Tensor("float32", tf.tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const results = await this.#session.run({ [this.#session.inputNames[0]]: input });
      const raw = {};
      for (const [k, v] of Object.entries(results)) raw[k] = v.data;
      const faces = postprocess(raw, tf);
      const sx = candidate.box.w / w, sy = candidate.box.h / h;
      return faces.map((f) => ({
        x: Math.round(candidate.box.x + f.x * sx),
        y: Math.round(candidate.box.y + f.y * sy),
        w: Math.round(f.w * sx),
        h: Math.round(f.h * sy),
        kind: "face",
        severity: 2,
        score: f.score
      }));
    }
  };

  // eval/e2e-entry.js
  var vision = new VisionEngine();
  async function capture() {
    const t0 = performance.now();
    const context = buildContext();
    const regions = await vision.findSensitiveRegions(context.visualCandidates);
    context.visualRedactions = boxesFromRegions(regions, context.viewport.dpr);
    delete context.visualCandidates;
    context.totalMs = +(performance.now() - t0).toFixed(2);
    return context;
  }
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function execute(action) {
    const el = interactiveElements()[action.index];
    switch (action.type) {
      case "click":
        el?.click();
        return !!el;
      case "type":
        if (!el) return false;
        el.focus();
        setValue(el, action.text ?? "");
        return true;
      case "scroll":
        scrollBy({ top: action.dy ?? 400 });
        return true;
      case "noop":
        return true;
      default:
        return false;
    }
  }
  async function run(goal, serverUrl = "http://127.0.0.1:8000") {
    const t0 = performance.now();
    const context = await capture();
    const tCap = performance.now();
    const res = await fetch(`${serverUrl}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, context })
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const plan = await res.json();
    const tSrv = performance.now();
    const executed = plan.action ? execute(plan.action) : null;
    return {
      plan,
      executed,
      context,
      timing: {
        captureMs: +(tCap - t0).toFixed(2),
        serverMs: +(tSrv - tCap).toFixed(2),
        totalMs: +(performance.now() - t0).toFixed(2)
      }
    };
  }
  return __toCommonJS(e2e_entry_exports);
})();
