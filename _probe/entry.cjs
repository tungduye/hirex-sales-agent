var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// empty.js
var require_empty = __commonJS({
  "empty.js"(exports2, module2) {
    module2.exports = {};
  }
});

// entry.ts
var entry_exports = {};
__export(entry_exports, {
  FB: () => checker_fb_exports,
  POST: () => checker_fbpost_exports,
  WC: () => web_client_exports
});
module.exports = __toCommonJS(entry_exports);

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/checker-fb.ts
var checker_fb_exports = {};
__export(checker_fb_exports, {
  FB_JUNK: () => FB_JUNK,
  FB_METAS: () => FB_METAS,
  Stopped: () => Stopped,
  __reset: () => __reset,
  __t: () => __t,
  classify: () => classify,
  fbCheck: () => fbCheck,
  fbMod: () => fbMod,
  fbpageMod: () => fbpageMod,
  hooks: () => hooks,
  norm: () => norm,
  parseGql: () => parseGql,
  parseHtml: () => parseHtml,
  parseName: () => parseName,
  parsePlugin2: () => parsePlugin2,
  readName: () => readName,
  route: () => route
});
var import_server_only = __toESM(require_empty());

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/web-client.ts
var web_client_exports = {};
__export(web_client_exports, {
  NetError: () => NetError,
  impersonating: () => impersonating,
  normProxy: () => normProxy,
  open: () => open,
  request: () => request
});
var import_node_http = __toESM(require("node:http"));
var import_node_https = __toESM(require("node:https"));
var import_node_module = require("node:module");
var import_node_path = __toESM(require("node:path"));
var import_node_tls = __toESM(require("node:tls"));
var import_node_zlib = __toESM(require("node:zlib"));
var NetError = class extends Error {
  constructor(kind) {
    super("L\u1ED7i m\u1EA1ng (" + kind + ")");
    this.kind = kind;
  }
};
var G = globalThis;
var loadFlag = () => (process.env.AHS_HTTP || "").trim().toLowerCase();
function envProxy(url) {
  const u = new URL(url), np = (process.env.no_proxy || process.env.NO_PROXY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = u.hostname.toLowerCase();
  for (const p of np) {
    if (p === "*" || h === p.replace(/^\*?\./, "") || h.endsWith("." + p.replace(/^\*?\./, ""))) return "";
  }
  const v = u.protocol === "https:" ? process.env.https_proxy || process.env.HTTPS_PROXY : process.env.http_proxy || process.env.HTTP_PROXY;
  return (v || "").trim();
}
function impit(proxy) {
  if (loadFlag() === "fetch") return null;
  const cache = G.__ahsImpit ??= /* @__PURE__ */ new Map();
  if (cache.has(proxy)) return cache.get(proxy) ?? null;
  let v = null;
  try {
    const req = (0, import_node_module.createRequire)(import_node_path.default.join(process.cwd(), "package.json"));
    const mod = req("impit");
    v = new mod.Impit({ browser: "chrome142", followRedirects: false, ...proxy ? { proxyUrl: proxy } : {} });
  } catch {
    v = null;
  }
  if (cache.size > 8) cache.clear();
  cache.set(proxy, v);
  return v;
}
function impersonating() {
  return impit("") !== null;
}
var MAX_REDIRECTS = 30;
function kindOf(e) {
  const n = (e && typeof e === "object" && "name" in e ? String(e.name) : "") || "Error";
  const codes = [];
  const dig = (x, d) => {
    if (!x || typeof x !== "object" || d > 3) return;
    const o = x;
    if (typeof o.code === "string") codes.push(o.code);
    dig(o.cause, d + 1);
    for (const y of o.errors || []) dig(y, d + 1);
  };
  dig(e, 0);
  const code = codes.find((c) => /^(E|UND_ERR)/.test(c)) || codes[0] || "";
  if (n === "AbortError" || n === "TimeoutError" || /Timeout/i.test(n) || /TIMEDOUT|TIMEOUT/.test(String(code))) return "Timeout";
  if (/^(ECONN|ENOTFOUND|EAI_|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_(SOCKET|CLOSED|INFO))/.test(String(code)) || /Connect|Network|Read|Write|Close|Proxy/.test(n)) return "ConnectionError";
  if (/CERT|SSL|TLS|ERR_SSL/i.test(String(code)) || /SSL|TLS/i.test(n)) return "SSLError";
  if (n === "TooManyRedirects") return "TooManyRedirects";
  return n === "TypeError" ? "RequestError" : n;
}
async function request(url, o) {
  const t0 = Date.now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (o.timeout ?? 30) * 1e3);
  try {
    let cur = url, method = o.method || "GET", body = o.body;
    for (let hop = 0; ; hop++) {
      const proxy = o.proxy ? normProxy(o.proxy) : envProxy(cur), im = impit(proxy);
      const init = { method, headers: o.headers.map(([k, v]) => [k, v]), redirect: "manual", signal: ctl.signal };
      if (body !== void 0 && method !== "GET") init.body = body;
      let res;
      if (!im && o.proxy) {
        const left = Math.max(1, (o.timeout ?? 30) - (Date.now() - t0) / 1e3);
        const head = await open(cur, { method, headers: o.headers, body, timeout: left, proxy: o.proxy });
        res = { status: head.status, url: cur, headers: new Headers(head.location ? { location: head.location } : {}), text: async () => (await head.read(Infinity)).toString("utf8") };
      } else res = im ? await im.fetch(cur, init) : await fetch(cur, init);
      const loc = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        if (hop >= MAX_REDIRECTS) throw Object.assign(new Error("redirects"), { name: "TooManyRedirects" });
        try {
          await res.arrayBuffer?.();
        } catch {
        }
        cur = new URL(loc, cur).toString();
        if (res.status === 303 || (res.status === 301 || res.status === 302) && method === "POST") {
          method = "GET";
          body = void 0;
        }
        continue;
      }
      const text = await res.text();
      return { text, url: cur, status: res.status };
    }
  } catch (e) {
    throw new NetError(kindOf(e));
  } finally {
    clearTimeout(timer);
  }
}
var normProxy = (p) => {
  const t = (p || "").trim();
  return !t ? "" : t.includes("://") ? t : "http://" + t;
};
var TAIL = 13e4;
function wrapStream(status, location, setCookies, it, closeUp, finish) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      void it.return?.();
    } catch {
    }
    try {
      closeUp();
    } catch {
    }
    finish();
  };
  return {
    status,
    location,
    setCookies,
    close,
    async read(cap, stop) {
      const parts = [];
      let n = 0;
      try {
        for (; ; ) {
          const r = await it.next();
          if (r.done) break;
          const b = Buffer.from(r.value);
          parts.push(b);
          n += b.length;
          if (n >= cap) break;
          if (stop) {
            const t = [];
            let m = 0;
            for (let i = parts.length - 1; i >= 0 && m < TAIL; i--) {
              t.unshift(parts[i]);
              m += parts[i].length;
            }
            const all = Buffer.concat(t);
            if (stop(all.length > TAIL ? all.subarray(all.length - TAIL) : all)) break;
          }
        }
      } catch (e) {
        close();
        throw new NetError(kindOf(e));
      }
      close();
      return Buffer.concat(parts);
    }
  };
}
var setCookiesOf = (h) => {
  const hh = h;
  if (typeof hh.getSetCookie === "function") return hh.getSetCookie();
  const v = h.get("set-cookie");
  return v ? [v] : [];
};
async function* webBody(body) {
  if (!body) return;
  const rd = body.getReader();
  try {
    for (; ; ) {
      const r = await rd.read();
      if (r.done) return;
      yield r.value;
    }
  } finally {
    try {
      await rd.cancel();
    } catch {
    }
  }
}
async function open(url, o) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (o.timeout ?? 30) * 1e3), finish = () => clearTimeout(timer);
  try {
    const method = o.method || "GET", explicit = normProxy(o.proxy || "");
    const im = impit(explicit || envProxy(url));
    if (im || !explicit) {
      const init = { method, headers: o.headers.map(([k, v]) => [k, v]), redirect: "manual", signal: ctl.signal };
      if (o.body !== void 0 && method !== "GET") init.body = o.body;
      const res = im ? await im.fetch(url, init) : await fetch(url, init);
      const it = webBody(res.body)[Symbol.asyncIterator]();
      return wrapStream(res.status, res.headers.get("location") || "", setCookiesOf(res.headers), it, () => ctl.abort(), finish);
    }
    return await viaProxy(url, { method, headers: o.headers, body: o.body }, explicit, ctl, finish);
  } catch (e) {
    finish();
    throw e instanceof NetError ? e : new NetError(kindOf(e));
  }
}
async function viaProxy(url, o, proxy, ctl, finish) {
  const u = new URL(url), pu = new URL(proxy);
  if (pu.protocol !== "http:" && pu.protocol !== "https:") throw new NetError("ProxyError");
  const auth = pu.username ? "Basic " + Buffer.from(decodeURIComponent(pu.username) + ":" + decodeURIComponent(pu.password)).toString("base64") : "";
  const hdr2 = { Host: u.host };
  for (const [k, v] of o.headers) hdr2[k] = v;
  if (o.body !== void 0 && o.method !== "GET") hdr2["Content-Length"] = String(Buffer.byteLength(o.body));
  const pport = Number(pu.port) || (pu.protocol === "https:" ? 443 : 80);
  const pmod = pu.protocol === "https:" ? import_node_https.default : import_node_http.default;
  const ph = auth ? { "Proxy-Authorization": auth } : {};
  const res = await new Promise((ok, bad) => {
    const go = (req) => {
      req.on("response", ok);
      req.on("error", bad);
      if (o.body !== void 0 && o.method !== "GET") req.write(o.body);
      req.end();
    };
    if (u.protocol === "http:") {
      go(import_node_http.default.request({ host: pu.hostname, port: pport, method: o.method, path: url, headers: { ...hdr2, ...ph }, signal: ctl.signal }));
      return;
    }
    const c = pmod.request({ host: pu.hostname, port: pport, method: "CONNECT", path: `${u.hostname}:${u.port || 443}`, headers: { Host: `${u.hostname}:${u.port || 443}`, ...ph }, signal: ctl.signal });
    c.on("error", bad);
    c.on("connect", (cres, sock) => {
      if (cres.statusCode !== 200) {
        sock.destroy();
        bad(Object.assign(new Error("proxy"), { name: "ProxyError" }));
        return;
      }
      go(import_node_https.default.request({ host: u.hostname, port: Number(u.port) || 443, method: o.method, path: u.pathname + u.search, headers: hdr2, signal: ctl.signal, agent: false, createConnection: () => import_node_tls.default.connect({ socket: sock, servername: u.hostname }) }));
    });
    c.end();
  });
  let stream = res;
  const enc = String(res.headers["content-encoding"] || "").toLowerCase();
  if (enc === "gzip") stream = res.pipe(import_node_zlib.default.createGunzip());
  else if (enc === "deflate") stream = res.pipe(import_node_zlib.default.createInflate());
  else if (enc === "br") stream = res.pipe(import_node_zlib.default.createBrotliDecompress());
  const sc = res.headers["set-cookie"] || [];
  return wrapStream(res.statusCode || 0, String(res.headers.location || ""), Array.isArray(sc) ? sc : [String(sc)], stream[Symbol.asyncIterator](), () => {
    stream.destroy();
    res.destroy();
  }, finish);
}

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/html-entities-data.ts
var INVALID_CHARREFS = { "0": "\uFFFD", "13": "\r", "128": "\u20AC", "129": "\x81", "130": "\u201A", "131": "\u0192", "132": "\u201E", "133": "\u2026", "134": "\u2020", "135": "\u2021", "136": "\u02C6", "137": "\u2030", "138": "\u0160", "139": "\u2039", "140": "\u0152", "141": "\x8D", "142": "\u017D", "143": "\x8F", "144": "\x90", "145": "\u2018", "146": "\u2019", "147": "\u201C", "148": "\u201D", "149": "\u2022", "150": "\u2013", "151": "\u2014", "152": "\u02DC", "153": "\u2122", "154": "\u0161", "155": "\u203A", "156": "\u0153", "157": "\x9D", "158": "\u017E", "159": "\u0178" };
var INVALID_CODEPOINTS = [1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 64976, 64977, 64978, 64979, 64980, 64981, 64982, 64983, 64984, 64985, 64986, 64987, 64988, 64989, 64990, 64991, 64992, 64993, 64994, 64995, 64996, 64997, 64998, 64999, 65e3, 65001, 65002, 65003, 65004, 65005, 65006, 65007, 65534, 65535, 131070, 131071, 196606, 196607, 262142, 262143, 327678, 327679, 393214, 393215, 458750, 458751, 524286, 524287, 589822, 589823, 655358, 655359, 720894, 720895, 786430, 786431, 851966, 851967, 917502, 917503, 983038, 983039, 1048574, 1048575, 1114110, 1114111];
var HTML5 = { "Aacute": "\xC1", "aacute": "\xE1", "Aacute;": "\xC1", "aacute;": "\xE1", "Abreve;": "\u0102", "abreve;": "\u0103", "ac;": "\u223E", "acd;": "\u223F", "acE;": "\u223E\u0333", "Acirc": "\xC2", "acirc": "\xE2", "Acirc;": "\xC2", "acirc;": "\xE2", "acute": "\xB4", "acute;": "\xB4", "Acy;": "\u0410", "acy;": "\u0430", "AElig": "\xC6", "aelig": "\xE6", "AElig;": "\xC6", "aelig;": "\xE6", "af;": "\u2061", "Afr;": "\u{1D504}", "afr;": "\u{1D51E}", "Agrave": "\xC0", "agrave": "\xE0", "Agrave;": "\xC0", "agrave;": "\xE0", "alefsym;": "\u2135", "aleph;": "\u2135", "Alpha;": "\u0391", "alpha;": "\u03B1", "Amacr;": "\u0100", "amacr;": "\u0101", "amalg;": "\u2A3F", "AMP": "&", "amp": "&", "AMP;": "&", "amp;": "&", "And;": "\u2A53", "and;": "\u2227", "andand;": "\u2A55", "andd;": "\u2A5C", "andslope;": "\u2A58", "andv;": "\u2A5A", "ang;": "\u2220", "ange;": "\u29A4", "angle;": "\u2220", "angmsd;": "\u2221", "angmsdaa;": "\u29A8", "angmsdab;": "\u29A9", "angmsdac;": "\u29AA", "angmsdad;": "\u29AB", "angmsdae;": "\u29AC", "angmsdaf;": "\u29AD", "angmsdag;": "\u29AE", "angmsdah;": "\u29AF", "angrt;": "\u221F", "angrtvb;": "\u22BE", "angrtvbd;": "\u299D", "angsph;": "\u2222", "angst;": "\xC5", "angzarr;": "\u237C", "Aogon;": "\u0104", "aogon;": "\u0105", "Aopf;": "\u{1D538}", "aopf;": "\u{1D552}", "ap;": "\u2248", "apacir;": "\u2A6F", "apE;": "\u2A70", "ape;": "\u224A", "apid;": "\u224B", "apos;": "'", "ApplyFunction;": "\u2061", "approx;": "\u2248", "approxeq;": "\u224A", "Aring": "\xC5", "aring": "\xE5", "Aring;": "\xC5", "aring;": "\xE5", "Ascr;": "\u{1D49C}", "ascr;": "\u{1D4B6}", "Assign;": "\u2254", "ast;": "*", "asymp;": "\u2248", "asympeq;": "\u224D", "Atilde": "\xC3", "atilde": "\xE3", "Atilde;": "\xC3", "atilde;": "\xE3", "Auml": "\xC4", "auml": "\xE4", "Auml;": "\xC4", "auml;": "\xE4", "awconint;": "\u2233", "awint;": "\u2A11", "backcong;": "\u224C", "backepsilon;": "\u03F6", "backprime;": "\u2035", "backsim;": "\u223D", "backsimeq;": "\u22CD", "Backslash;": "\u2216", "Barv;": "\u2AE7", "barvee;": "\u22BD", "Barwed;": "\u2306", "barwed;": "\u2305", "barwedge;": "\u2305", "bbrk;": "\u23B5", "bbrktbrk;": "\u23B6", "bcong;": "\u224C", "Bcy;": "\u0411", "bcy;": "\u0431", "bdquo;": "\u201E", "becaus;": "\u2235", "Because;": "\u2235", "because;": "\u2235", "bemptyv;": "\u29B0", "bepsi;": "\u03F6", "bernou;": "\u212C", "Bernoullis;": "\u212C", "Beta;": "\u0392", "beta;": "\u03B2", "beth;": "\u2136", "between;": "\u226C", "Bfr;": "\u{1D505}", "bfr;": "\u{1D51F}", "bigcap;": "\u22C2", "bigcirc;": "\u25EF", "bigcup;": "\u22C3", "bigodot;": "\u2A00", "bigoplus;": "\u2A01", "bigotimes;": "\u2A02", "bigsqcup;": "\u2A06", "bigstar;": "\u2605", "bigtriangledown;": "\u25BD", "bigtriangleup;": "\u25B3", "biguplus;": "\u2A04", "bigvee;": "\u22C1", "bigwedge;": "\u22C0", "bkarow;": "\u290D", "blacklozenge;": "\u29EB", "blacksquare;": "\u25AA", "blacktriangle;": "\u25B4", "blacktriangledown;": "\u25BE", "blacktriangleleft;": "\u25C2", "blacktriangleright;": "\u25B8", "blank;": "\u2423", "blk12;": "\u2592", "blk14;": "\u2591", "blk34;": "\u2593", "block;": "\u2588", "bne;": "=\u20E5", "bnequiv;": "\u2261\u20E5", "bNot;": "\u2AED", "bnot;": "\u2310", "Bopf;": "\u{1D539}", "bopf;": "\u{1D553}", "bot;": "\u22A5", "bottom;": "\u22A5", "bowtie;": "\u22C8", "boxbox;": "\u29C9", "boxDL;": "\u2557", "boxDl;": "\u2556", "boxdL;": "\u2555", "boxdl;": "\u2510", "boxDR;": "\u2554", "boxDr;": "\u2553", "boxdR;": "\u2552", "boxdr;": "\u250C", "boxH;": "\u2550", "boxh;": "\u2500", "boxHD;": "\u2566", "boxHd;": "\u2564", "boxhD;": "\u2565", "boxhd;": "\u252C", "boxHU;": "\u2569", "boxHu;": "\u2567", "boxhU;": "\u2568", "boxhu;": "\u2534", "boxminus;": "\u229F", "boxplus;": "\u229E", "boxtimes;": "\u22A0", "boxUL;": "\u255D", "boxUl;": "\u255C", "boxuL;": "\u255B", "boxul;": "\u2518", "boxUR;": "\u255A", "boxUr;": "\u2559", "boxuR;": "\u2558", "boxur;": "\u2514", "boxV;": "\u2551", "boxv;": "\u2502", "boxVH;": "\u256C", "boxVh;": "\u256B", "boxvH;": "\u256A", "boxvh;": "\u253C", "boxVL;": "\u2563", "boxVl;": "\u2562", "boxvL;": "\u2561", "boxvl;": "\u2524", "boxVR;": "\u2560", "boxVr;": "\u255F", "boxvR;": "\u255E", "boxvr;": "\u251C", "bprime;": "\u2035", "Breve;": "\u02D8", "breve;": "\u02D8", "brvbar": "\xA6", "brvbar;": "\xA6", "Bscr;": "\u212C", "bscr;": "\u{1D4B7}", "bsemi;": "\u204F", "bsim;": "\u223D", "bsime;": "\u22CD", "bsol;": "\\", "bsolb;": "\u29C5", "bsolhsub;": "\u27C8", "bull;": "\u2022", "bullet;": "\u2022", "bump;": "\u224E", "bumpE;": "\u2AAE", "bumpe;": "\u224F", "Bumpeq;": "\u224E", "bumpeq;": "\u224F", "Cacute;": "\u0106", "cacute;": "\u0107", "Cap;": "\u22D2", "cap;": "\u2229", "capand;": "\u2A44", "capbrcup;": "\u2A49", "capcap;": "\u2A4B", "capcup;": "\u2A47", "capdot;": "\u2A40", "CapitalDifferentialD;": "\u2145", "caps;": "\u2229\uFE00", "caret;": "\u2041", "caron;": "\u02C7", "Cayleys;": "\u212D", "ccaps;": "\u2A4D", "Ccaron;": "\u010C", "ccaron;": "\u010D", "Ccedil": "\xC7", "ccedil": "\xE7", "Ccedil;": "\xC7", "ccedil;": "\xE7", "Ccirc;": "\u0108", "ccirc;": "\u0109", "Cconint;": "\u2230", "ccups;": "\u2A4C", "ccupssm;": "\u2A50", "Cdot;": "\u010A", "cdot;": "\u010B", "cedil": "\xB8", "cedil;": "\xB8", "Cedilla;": "\xB8", "cemptyv;": "\u29B2", "cent": "\xA2", "cent;": "\xA2", "CenterDot;": "\xB7", "centerdot;": "\xB7", "Cfr;": "\u212D", "cfr;": "\u{1D520}", "CHcy;": "\u0427", "chcy;": "\u0447", "check;": "\u2713", "checkmark;": "\u2713", "Chi;": "\u03A7", "chi;": "\u03C7", "cir;": "\u25CB", "circ;": "\u02C6", "circeq;": "\u2257", "circlearrowleft;": "\u21BA", "circlearrowright;": "\u21BB", "circledast;": "\u229B", "circledcirc;": "\u229A", "circleddash;": "\u229D", "CircleDot;": "\u2299", "circledR;": "\xAE", "circledS;": "\u24C8", "CircleMinus;": "\u2296", "CirclePlus;": "\u2295", "CircleTimes;": "\u2297", "cirE;": "\u29C3", "cire;": "\u2257", "cirfnint;": "\u2A10", "cirmid;": "\u2AEF", "cirscir;": "\u29C2", "ClockwiseContourIntegral;": "\u2232", "CloseCurlyDoubleQuote;": "\u201D", "CloseCurlyQuote;": "\u2019", "clubs;": "\u2663", "clubsuit;": "\u2663", "Colon;": "\u2237", "colon;": ":", "Colone;": "\u2A74", "colone;": "\u2254", "coloneq;": "\u2254", "comma;": ",", "commat;": "@", "comp;": "\u2201", "compfn;": "\u2218", "complement;": "\u2201", "complexes;": "\u2102", "cong;": "\u2245", "congdot;": "\u2A6D", "Congruent;": "\u2261", "Conint;": "\u222F", "conint;": "\u222E", "ContourIntegral;": "\u222E", "Copf;": "\u2102", "copf;": "\u{1D554}", "coprod;": "\u2210", "Coproduct;": "\u2210", "COPY": "\xA9", "copy": "\xA9", "COPY;": "\xA9", "copy;": "\xA9", "copysr;": "\u2117", "CounterClockwiseContourIntegral;": "\u2233", "crarr;": "\u21B5", "Cross;": "\u2A2F", "cross;": "\u2717", "Cscr;": "\u{1D49E}", "cscr;": "\u{1D4B8}", "csub;": "\u2ACF", "csube;": "\u2AD1", "csup;": "\u2AD0", "csupe;": "\u2AD2", "ctdot;": "\u22EF", "cudarrl;": "\u2938", "cudarrr;": "\u2935", "cuepr;": "\u22DE", "cuesc;": "\u22DF", "cularr;": "\u21B6", "cularrp;": "\u293D", "Cup;": "\u22D3", "cup;": "\u222A", "cupbrcap;": "\u2A48", "CupCap;": "\u224D", "cupcap;": "\u2A46", "cupcup;": "\u2A4A", "cupdot;": "\u228D", "cupor;": "\u2A45", "cups;": "\u222A\uFE00", "curarr;": "\u21B7", "curarrm;": "\u293C", "curlyeqprec;": "\u22DE", "curlyeqsucc;": "\u22DF", "curlyvee;": "\u22CE", "curlywedge;": "\u22CF", "curren": "\xA4", "curren;": "\xA4", "curvearrowleft;": "\u21B6", "curvearrowright;": "\u21B7", "cuvee;": "\u22CE", "cuwed;": "\u22CF", "cwconint;": "\u2232", "cwint;": "\u2231", "cylcty;": "\u232D", "Dagger;": "\u2021", "dagger;": "\u2020", "daleth;": "\u2138", "Darr;": "\u21A1", "dArr;": "\u21D3", "darr;": "\u2193", "dash;": "\u2010", "Dashv;": "\u2AE4", "dashv;": "\u22A3", "dbkarow;": "\u290F", "dblac;": "\u02DD", "Dcaron;": "\u010E", "dcaron;": "\u010F", "Dcy;": "\u0414", "dcy;": "\u0434", "DD;": "\u2145", "dd;": "\u2146", "ddagger;": "\u2021", "ddarr;": "\u21CA", "DDotrahd;": "\u2911", "ddotseq;": "\u2A77", "deg": "\xB0", "deg;": "\xB0", "Del;": "\u2207", "Delta;": "\u0394", "delta;": "\u03B4", "demptyv;": "\u29B1", "dfisht;": "\u297F", "Dfr;": "\u{1D507}", "dfr;": "\u{1D521}", "dHar;": "\u2965", "dharl;": "\u21C3", "dharr;": "\u21C2", "DiacriticalAcute;": "\xB4", "DiacriticalDot;": "\u02D9", "DiacriticalDoubleAcute;": "\u02DD", "DiacriticalGrave;": "`", "DiacriticalTilde;": "\u02DC", "diam;": "\u22C4", "Diamond;": "\u22C4", "diamond;": "\u22C4", "diamondsuit;": "\u2666", "diams;": "\u2666", "die;": "\xA8", "DifferentialD;": "\u2146", "digamma;": "\u03DD", "disin;": "\u22F2", "div;": "\xF7", "divide": "\xF7", "divide;": "\xF7", "divideontimes;": "\u22C7", "divonx;": "\u22C7", "DJcy;": "\u0402", "djcy;": "\u0452", "dlcorn;": "\u231E", "dlcrop;": "\u230D", "dollar;": "$", "Dopf;": "\u{1D53B}", "dopf;": "\u{1D555}", "Dot;": "\xA8", "dot;": "\u02D9", "DotDot;": "\u20DC", "doteq;": "\u2250", "doteqdot;": "\u2251", "DotEqual;": "\u2250", "dotminus;": "\u2238", "dotplus;": "\u2214", "dotsquare;": "\u22A1", "doublebarwedge;": "\u2306", "DoubleContourIntegral;": "\u222F", "DoubleDot;": "\xA8", "DoubleDownArrow;": "\u21D3", "DoubleLeftArrow;": "\u21D0", "DoubleLeftRightArrow;": "\u21D4", "DoubleLeftTee;": "\u2AE4", "DoubleLongLeftArrow;": "\u27F8", "DoubleLongLeftRightArrow;": "\u27FA", "DoubleLongRightArrow;": "\u27F9", "DoubleRightArrow;": "\u21D2", "DoubleRightTee;": "\u22A8", "DoubleUpArrow;": "\u21D1", "DoubleUpDownArrow;": "\u21D5", "DoubleVerticalBar;": "\u2225", "DownArrow;": "\u2193", "Downarrow;": "\u21D3", "downarrow;": "\u2193", "DownArrowBar;": "\u2913", "DownArrowUpArrow;": "\u21F5", "DownBreve;": "\u0311", "downdownarrows;": "\u21CA", "downharpoonleft;": "\u21C3", "downharpoonright;": "\u21C2", "DownLeftRightVector;": "\u2950", "DownLeftTeeVector;": "\u295E", "DownLeftVector;": "\u21BD", "DownLeftVectorBar;": "\u2956", "DownRightTeeVector;": "\u295F", "DownRightVector;": "\u21C1", "DownRightVectorBar;": "\u2957", "DownTee;": "\u22A4", "DownTeeArrow;": "\u21A7", "drbkarow;": "\u2910", "drcorn;": "\u231F", "drcrop;": "\u230C", "Dscr;": "\u{1D49F}", "dscr;": "\u{1D4B9}", "DScy;": "\u0405", "dscy;": "\u0455", "dsol;": "\u29F6", "Dstrok;": "\u0110", "dstrok;": "\u0111", "dtdot;": "\u22F1", "dtri;": "\u25BF", "dtrif;": "\u25BE", "duarr;": "\u21F5", "duhar;": "\u296F", "dwangle;": "\u29A6", "DZcy;": "\u040F", "dzcy;": "\u045F", "dzigrarr;": "\u27FF", "Eacute": "\xC9", "eacute": "\xE9", "Eacute;": "\xC9", "eacute;": "\xE9", "easter;": "\u2A6E", "Ecaron;": "\u011A", "ecaron;": "\u011B", "ecir;": "\u2256", "Ecirc": "\xCA", "ecirc": "\xEA", "Ecirc;": "\xCA", "ecirc;": "\xEA", "ecolon;": "\u2255", "Ecy;": "\u042D", "ecy;": "\u044D", "eDDot;": "\u2A77", "Edot;": "\u0116", "eDot;": "\u2251", "edot;": "\u0117", "ee;": "\u2147", "efDot;": "\u2252", "Efr;": "\u{1D508}", "efr;": "\u{1D522}", "eg;": "\u2A9A", "Egrave": "\xC8", "egrave": "\xE8", "Egrave;": "\xC8", "egrave;": "\xE8", "egs;": "\u2A96", "egsdot;": "\u2A98", "el;": "\u2A99", "Element;": "\u2208", "elinters;": "\u23E7", "ell;": "\u2113", "els;": "\u2A95", "elsdot;": "\u2A97", "Emacr;": "\u0112", "emacr;": "\u0113", "empty;": "\u2205", "emptyset;": "\u2205", "EmptySmallSquare;": "\u25FB", "emptyv;": "\u2205", "EmptyVerySmallSquare;": "\u25AB", "emsp13;": "\u2004", "emsp14;": "\u2005", "emsp;": "\u2003", "ENG;": "\u014A", "eng;": "\u014B", "ensp;": "\u2002", "Eogon;": "\u0118", "eogon;": "\u0119", "Eopf;": "\u{1D53C}", "eopf;": "\u{1D556}", "epar;": "\u22D5", "eparsl;": "\u29E3", "eplus;": "\u2A71", "epsi;": "\u03B5", "Epsilon;": "\u0395", "epsilon;": "\u03B5", "epsiv;": "\u03F5", "eqcirc;": "\u2256", "eqcolon;": "\u2255", "eqsim;": "\u2242", "eqslantgtr;": "\u2A96", "eqslantless;": "\u2A95", "Equal;": "\u2A75", "equals;": "=", "EqualTilde;": "\u2242", "equest;": "\u225F", "Equilibrium;": "\u21CC", "equiv;": "\u2261", "equivDD;": "\u2A78", "eqvparsl;": "\u29E5", "erarr;": "\u2971", "erDot;": "\u2253", "Escr;": "\u2130", "escr;": "\u212F", "esdot;": "\u2250", "Esim;": "\u2A73", "esim;": "\u2242", "Eta;": "\u0397", "eta;": "\u03B7", "ETH": "\xD0", "eth": "\xF0", "ETH;": "\xD0", "eth;": "\xF0", "Euml": "\xCB", "euml": "\xEB", "Euml;": "\xCB", "euml;": "\xEB", "euro;": "\u20AC", "excl;": "!", "exist;": "\u2203", "Exists;": "\u2203", "expectation;": "\u2130", "ExponentialE;": "\u2147", "exponentiale;": "\u2147", "fallingdotseq;": "\u2252", "Fcy;": "\u0424", "fcy;": "\u0444", "female;": "\u2640", "ffilig;": "\uFB03", "fflig;": "\uFB00", "ffllig;": "\uFB04", "Ffr;": "\u{1D509}", "ffr;": "\u{1D523}", "filig;": "\uFB01", "FilledSmallSquare;": "\u25FC", "FilledVerySmallSquare;": "\u25AA", "fjlig;": "fj", "flat;": "\u266D", "fllig;": "\uFB02", "fltns;": "\u25B1", "fnof;": "\u0192", "Fopf;": "\u{1D53D}", "fopf;": "\u{1D557}", "ForAll;": "\u2200", "forall;": "\u2200", "fork;": "\u22D4", "forkv;": "\u2AD9", "Fouriertrf;": "\u2131", "fpartint;": "\u2A0D", "frac12": "\xBD", "frac12;": "\xBD", "frac13;": "\u2153", "frac14": "\xBC", "frac14;": "\xBC", "frac15;": "\u2155", "frac16;": "\u2159", "frac18;": "\u215B", "frac23;": "\u2154", "frac25;": "\u2156", "frac34": "\xBE", "frac34;": "\xBE", "frac35;": "\u2157", "frac38;": "\u215C", "frac45;": "\u2158", "frac56;": "\u215A", "frac58;": "\u215D", "frac78;": "\u215E", "frasl;": "\u2044", "frown;": "\u2322", "Fscr;": "\u2131", "fscr;": "\u{1D4BB}", "gacute;": "\u01F5", "Gamma;": "\u0393", "gamma;": "\u03B3", "Gammad;": "\u03DC", "gammad;": "\u03DD", "gap;": "\u2A86", "Gbreve;": "\u011E", "gbreve;": "\u011F", "Gcedil;": "\u0122", "Gcirc;": "\u011C", "gcirc;": "\u011D", "Gcy;": "\u0413", "gcy;": "\u0433", "Gdot;": "\u0120", "gdot;": "\u0121", "gE;": "\u2267", "ge;": "\u2265", "gEl;": "\u2A8C", "gel;": "\u22DB", "geq;": "\u2265", "geqq;": "\u2267", "geqslant;": "\u2A7E", "ges;": "\u2A7E", "gescc;": "\u2AA9", "gesdot;": "\u2A80", "gesdoto;": "\u2A82", "gesdotol;": "\u2A84", "gesl;": "\u22DB\uFE00", "gesles;": "\u2A94", "Gfr;": "\u{1D50A}", "gfr;": "\u{1D524}", "Gg;": "\u22D9", "gg;": "\u226B", "ggg;": "\u22D9", "gimel;": "\u2137", "GJcy;": "\u0403", "gjcy;": "\u0453", "gl;": "\u2277", "gla;": "\u2AA5", "glE;": "\u2A92", "glj;": "\u2AA4", "gnap;": "\u2A8A", "gnapprox;": "\u2A8A", "gnE;": "\u2269", "gne;": "\u2A88", "gneq;": "\u2A88", "gneqq;": "\u2269", "gnsim;": "\u22E7", "Gopf;": "\u{1D53E}", "gopf;": "\u{1D558}", "grave;": "`", "GreaterEqual;": "\u2265", "GreaterEqualLess;": "\u22DB", "GreaterFullEqual;": "\u2267", "GreaterGreater;": "\u2AA2", "GreaterLess;": "\u2277", "GreaterSlantEqual;": "\u2A7E", "GreaterTilde;": "\u2273", "Gscr;": "\u{1D4A2}", "gscr;": "\u210A", "gsim;": "\u2273", "gsime;": "\u2A8E", "gsiml;": "\u2A90", "GT": ">", "gt": ">", "GT;": ">", "Gt;": "\u226B", "gt;": ">", "gtcc;": "\u2AA7", "gtcir;": "\u2A7A", "gtdot;": "\u22D7", "gtlPar;": "\u2995", "gtquest;": "\u2A7C", "gtrapprox;": "\u2A86", "gtrarr;": "\u2978", "gtrdot;": "\u22D7", "gtreqless;": "\u22DB", "gtreqqless;": "\u2A8C", "gtrless;": "\u2277", "gtrsim;": "\u2273", "gvertneqq;": "\u2269\uFE00", "gvnE;": "\u2269\uFE00", "Hacek;": "\u02C7", "hairsp;": "\u200A", "half;": "\xBD", "hamilt;": "\u210B", "HARDcy;": "\u042A", "hardcy;": "\u044A", "hArr;": "\u21D4", "harr;": "\u2194", "harrcir;": "\u2948", "harrw;": "\u21AD", "Hat;": "^", "hbar;": "\u210F", "Hcirc;": "\u0124", "hcirc;": "\u0125", "hearts;": "\u2665", "heartsuit;": "\u2665", "hellip;": "\u2026", "hercon;": "\u22B9", "Hfr;": "\u210C", "hfr;": "\u{1D525}", "HilbertSpace;": "\u210B", "hksearow;": "\u2925", "hkswarow;": "\u2926", "hoarr;": "\u21FF", "homtht;": "\u223B", "hookleftarrow;": "\u21A9", "hookrightarrow;": "\u21AA", "Hopf;": "\u210D", "hopf;": "\u{1D559}", "horbar;": "\u2015", "HorizontalLine;": "\u2500", "Hscr;": "\u210B", "hscr;": "\u{1D4BD}", "hslash;": "\u210F", "Hstrok;": "\u0126", "hstrok;": "\u0127", "HumpDownHump;": "\u224E", "HumpEqual;": "\u224F", "hybull;": "\u2043", "hyphen;": "\u2010", "Iacute": "\xCD", "iacute": "\xED", "Iacute;": "\xCD", "iacute;": "\xED", "ic;": "\u2063", "Icirc": "\xCE", "icirc": "\xEE", "Icirc;": "\xCE", "icirc;": "\xEE", "Icy;": "\u0418", "icy;": "\u0438", "Idot;": "\u0130", "IEcy;": "\u0415", "iecy;": "\u0435", "iexcl": "\xA1", "iexcl;": "\xA1", "iff;": "\u21D4", "Ifr;": "\u2111", "ifr;": "\u{1D526}", "Igrave": "\xCC", "igrave": "\xEC", "Igrave;": "\xCC", "igrave;": "\xEC", "ii;": "\u2148", "iiiint;": "\u2A0C", "iiint;": "\u222D", "iinfin;": "\u29DC", "iiota;": "\u2129", "IJlig;": "\u0132", "ijlig;": "\u0133", "Im;": "\u2111", "Imacr;": "\u012A", "imacr;": "\u012B", "image;": "\u2111", "ImaginaryI;": "\u2148", "imagline;": "\u2110", "imagpart;": "\u2111", "imath;": "\u0131", "imof;": "\u22B7", "imped;": "\u01B5", "Implies;": "\u21D2", "in;": "\u2208", "incare;": "\u2105", "infin;": "\u221E", "infintie;": "\u29DD", "inodot;": "\u0131", "Int;": "\u222C", "int;": "\u222B", "intcal;": "\u22BA", "integers;": "\u2124", "Integral;": "\u222B", "intercal;": "\u22BA", "Intersection;": "\u22C2", "intlarhk;": "\u2A17", "intprod;": "\u2A3C", "InvisibleComma;": "\u2063", "InvisibleTimes;": "\u2062", "IOcy;": "\u0401", "iocy;": "\u0451", "Iogon;": "\u012E", "iogon;": "\u012F", "Iopf;": "\u{1D540}", "iopf;": "\u{1D55A}", "Iota;": "\u0399", "iota;": "\u03B9", "iprod;": "\u2A3C", "iquest": "\xBF", "iquest;": "\xBF", "Iscr;": "\u2110", "iscr;": "\u{1D4BE}", "isin;": "\u2208", "isindot;": "\u22F5", "isinE;": "\u22F9", "isins;": "\u22F4", "isinsv;": "\u22F3", "isinv;": "\u2208", "it;": "\u2062", "Itilde;": "\u0128", "itilde;": "\u0129", "Iukcy;": "\u0406", "iukcy;": "\u0456", "Iuml": "\xCF", "iuml": "\xEF", "Iuml;": "\xCF", "iuml;": "\xEF", "Jcirc;": "\u0134", "jcirc;": "\u0135", "Jcy;": "\u0419", "jcy;": "\u0439", "Jfr;": "\u{1D50D}", "jfr;": "\u{1D527}", "jmath;": "\u0237", "Jopf;": "\u{1D541}", "jopf;": "\u{1D55B}", "Jscr;": "\u{1D4A5}", "jscr;": "\u{1D4BF}", "Jsercy;": "\u0408", "jsercy;": "\u0458", "Jukcy;": "\u0404", "jukcy;": "\u0454", "Kappa;": "\u039A", "kappa;": "\u03BA", "kappav;": "\u03F0", "Kcedil;": "\u0136", "kcedil;": "\u0137", "Kcy;": "\u041A", "kcy;": "\u043A", "Kfr;": "\u{1D50E}", "kfr;": "\u{1D528}", "kgreen;": "\u0138", "KHcy;": "\u0425", "khcy;": "\u0445", "KJcy;": "\u040C", "kjcy;": "\u045C", "Kopf;": "\u{1D542}", "kopf;": "\u{1D55C}", "Kscr;": "\u{1D4A6}", "kscr;": "\u{1D4C0}", "lAarr;": "\u21DA", "Lacute;": "\u0139", "lacute;": "\u013A", "laemptyv;": "\u29B4", "lagran;": "\u2112", "Lambda;": "\u039B", "lambda;": "\u03BB", "Lang;": "\u27EA", "lang;": "\u27E8", "langd;": "\u2991", "langle;": "\u27E8", "lap;": "\u2A85", "Laplacetrf;": "\u2112", "laquo": "\xAB", "laquo;": "\xAB", "Larr;": "\u219E", "lArr;": "\u21D0", "larr;": "\u2190", "larrb;": "\u21E4", "larrbfs;": "\u291F", "larrfs;": "\u291D", "larrhk;": "\u21A9", "larrlp;": "\u21AB", "larrpl;": "\u2939", "larrsim;": "\u2973", "larrtl;": "\u21A2", "lat;": "\u2AAB", "lAtail;": "\u291B", "latail;": "\u2919", "late;": "\u2AAD", "lates;": "\u2AAD\uFE00", "lBarr;": "\u290E", "lbarr;": "\u290C", "lbbrk;": "\u2772", "lbrace;": "{", "lbrack;": "[", "lbrke;": "\u298B", "lbrksld;": "\u298F", "lbrkslu;": "\u298D", "Lcaron;": "\u013D", "lcaron;": "\u013E", "Lcedil;": "\u013B", "lcedil;": "\u013C", "lceil;": "\u2308", "lcub;": "{", "Lcy;": "\u041B", "lcy;": "\u043B", "ldca;": "\u2936", "ldquo;": "\u201C", "ldquor;": "\u201E", "ldrdhar;": "\u2967", "ldrushar;": "\u294B", "ldsh;": "\u21B2", "lE;": "\u2266", "le;": "\u2264", "LeftAngleBracket;": "\u27E8", "LeftArrow;": "\u2190", "Leftarrow;": "\u21D0", "leftarrow;": "\u2190", "LeftArrowBar;": "\u21E4", "LeftArrowRightArrow;": "\u21C6", "leftarrowtail;": "\u21A2", "LeftCeiling;": "\u2308", "LeftDoubleBracket;": "\u27E6", "LeftDownTeeVector;": "\u2961", "LeftDownVector;": "\u21C3", "LeftDownVectorBar;": "\u2959", "LeftFloor;": "\u230A", "leftharpoondown;": "\u21BD", "leftharpoonup;": "\u21BC", "leftleftarrows;": "\u21C7", "LeftRightArrow;": "\u2194", "Leftrightarrow;": "\u21D4", "leftrightarrow;": "\u2194", "leftrightarrows;": "\u21C6", "leftrightharpoons;": "\u21CB", "leftrightsquigarrow;": "\u21AD", "LeftRightVector;": "\u294E", "LeftTee;": "\u22A3", "LeftTeeArrow;": "\u21A4", "LeftTeeVector;": "\u295A", "leftthreetimes;": "\u22CB", "LeftTriangle;": "\u22B2", "LeftTriangleBar;": "\u29CF", "LeftTriangleEqual;": "\u22B4", "LeftUpDownVector;": "\u2951", "LeftUpTeeVector;": "\u2960", "LeftUpVector;": "\u21BF", "LeftUpVectorBar;": "\u2958", "LeftVector;": "\u21BC", "LeftVectorBar;": "\u2952", "lEg;": "\u2A8B", "leg;": "\u22DA", "leq;": "\u2264", "leqq;": "\u2266", "leqslant;": "\u2A7D", "les;": "\u2A7D", "lescc;": "\u2AA8", "lesdot;": "\u2A7F", "lesdoto;": "\u2A81", "lesdotor;": "\u2A83", "lesg;": "\u22DA\uFE00", "lesges;": "\u2A93", "lessapprox;": "\u2A85", "lessdot;": "\u22D6", "lesseqgtr;": "\u22DA", "lesseqqgtr;": "\u2A8B", "LessEqualGreater;": "\u22DA", "LessFullEqual;": "\u2266", "LessGreater;": "\u2276", "lessgtr;": "\u2276", "LessLess;": "\u2AA1", "lesssim;": "\u2272", "LessSlantEqual;": "\u2A7D", "LessTilde;": "\u2272", "lfisht;": "\u297C", "lfloor;": "\u230A", "Lfr;": "\u{1D50F}", "lfr;": "\u{1D529}", "lg;": "\u2276", "lgE;": "\u2A91", "lHar;": "\u2962", "lhard;": "\u21BD", "lharu;": "\u21BC", "lharul;": "\u296A", "lhblk;": "\u2584", "LJcy;": "\u0409", "ljcy;": "\u0459", "Ll;": "\u22D8", "ll;": "\u226A", "llarr;": "\u21C7", "llcorner;": "\u231E", "Lleftarrow;": "\u21DA", "llhard;": "\u296B", "lltri;": "\u25FA", "Lmidot;": "\u013F", "lmidot;": "\u0140", "lmoust;": "\u23B0", "lmoustache;": "\u23B0", "lnap;": "\u2A89", "lnapprox;": "\u2A89", "lnE;": "\u2268", "lne;": "\u2A87", "lneq;": "\u2A87", "lneqq;": "\u2268", "lnsim;": "\u22E6", "loang;": "\u27EC", "loarr;": "\u21FD", "lobrk;": "\u27E6", "LongLeftArrow;": "\u27F5", "Longleftarrow;": "\u27F8", "longleftarrow;": "\u27F5", "LongLeftRightArrow;": "\u27F7", "Longleftrightarrow;": "\u27FA", "longleftrightarrow;": "\u27F7", "longmapsto;": "\u27FC", "LongRightArrow;": "\u27F6", "Longrightarrow;": "\u27F9", "longrightarrow;": "\u27F6", "looparrowleft;": "\u21AB", "looparrowright;": "\u21AC", "lopar;": "\u2985", "Lopf;": "\u{1D543}", "lopf;": "\u{1D55D}", "loplus;": "\u2A2D", "lotimes;": "\u2A34", "lowast;": "\u2217", "lowbar;": "_", "LowerLeftArrow;": "\u2199", "LowerRightArrow;": "\u2198", "loz;": "\u25CA", "lozenge;": "\u25CA", "lozf;": "\u29EB", "lpar;": "(", "lparlt;": "\u2993", "lrarr;": "\u21C6", "lrcorner;": "\u231F", "lrhar;": "\u21CB", "lrhard;": "\u296D", "lrm;": "\u200E", "lrtri;": "\u22BF", "lsaquo;": "\u2039", "Lscr;": "\u2112", "lscr;": "\u{1D4C1}", "Lsh;": "\u21B0", "lsh;": "\u21B0", "lsim;": "\u2272", "lsime;": "\u2A8D", "lsimg;": "\u2A8F", "lsqb;": "[", "lsquo;": "\u2018", "lsquor;": "\u201A", "Lstrok;": "\u0141", "lstrok;": "\u0142", "LT": "<", "lt": "<", "LT;": "<", "Lt;": "\u226A", "lt;": "<", "ltcc;": "\u2AA6", "ltcir;": "\u2A79", "ltdot;": "\u22D6", "lthree;": "\u22CB", "ltimes;": "\u22C9", "ltlarr;": "\u2976", "ltquest;": "\u2A7B", "ltri;": "\u25C3", "ltrie;": "\u22B4", "ltrif;": "\u25C2", "ltrPar;": "\u2996", "lurdshar;": "\u294A", "luruhar;": "\u2966", "lvertneqq;": "\u2268\uFE00", "lvnE;": "\u2268\uFE00", "macr": "\xAF", "macr;": "\xAF", "male;": "\u2642", "malt;": "\u2720", "maltese;": "\u2720", "Map;": "\u2905", "map;": "\u21A6", "mapsto;": "\u21A6", "mapstodown;": "\u21A7", "mapstoleft;": "\u21A4", "mapstoup;": "\u21A5", "marker;": "\u25AE", "mcomma;": "\u2A29", "Mcy;": "\u041C", "mcy;": "\u043C", "mdash;": "\u2014", "mDDot;": "\u223A", "measuredangle;": "\u2221", "MediumSpace;": "\u205F", "Mellintrf;": "\u2133", "Mfr;": "\u{1D510}", "mfr;": "\u{1D52A}", "mho;": "\u2127", "micro": "\xB5", "micro;": "\xB5", "mid;": "\u2223", "midast;": "*", "midcir;": "\u2AF0", "middot": "\xB7", "middot;": "\xB7", "minus;": "\u2212", "minusb;": "\u229F", "minusd;": "\u2238", "minusdu;": "\u2A2A", "MinusPlus;": "\u2213", "mlcp;": "\u2ADB", "mldr;": "\u2026", "mnplus;": "\u2213", "models;": "\u22A7", "Mopf;": "\u{1D544}", "mopf;": "\u{1D55E}", "mp;": "\u2213", "Mscr;": "\u2133", "mscr;": "\u{1D4C2}", "mstpos;": "\u223E", "Mu;": "\u039C", "mu;": "\u03BC", "multimap;": "\u22B8", "mumap;": "\u22B8", "nabla;": "\u2207", "Nacute;": "\u0143", "nacute;": "\u0144", "nang;": "\u2220\u20D2", "nap;": "\u2249", "napE;": "\u2A70\u0338", "napid;": "\u224B\u0338", "napos;": "\u0149", "napprox;": "\u2249", "natur;": "\u266E", "natural;": "\u266E", "naturals;": "\u2115", "nbsp": "\xA0", "nbsp;": "\xA0", "nbump;": "\u224E\u0338", "nbumpe;": "\u224F\u0338", "ncap;": "\u2A43", "Ncaron;": "\u0147", "ncaron;": "\u0148", "Ncedil;": "\u0145", "ncedil;": "\u0146", "ncong;": "\u2247", "ncongdot;": "\u2A6D\u0338", "ncup;": "\u2A42", "Ncy;": "\u041D", "ncy;": "\u043D", "ndash;": "\u2013", "ne;": "\u2260", "nearhk;": "\u2924", "neArr;": "\u21D7", "nearr;": "\u2197", "nearrow;": "\u2197", "nedot;": "\u2250\u0338", "NegativeMediumSpace;": "\u200B", "NegativeThickSpace;": "\u200B", "NegativeThinSpace;": "\u200B", "NegativeVeryThinSpace;": "\u200B", "nequiv;": "\u2262", "nesear;": "\u2928", "nesim;": "\u2242\u0338", "NestedGreaterGreater;": "\u226B", "NestedLessLess;": "\u226A", "NewLine;": "\n", "nexist;": "\u2204", "nexists;": "\u2204", "Nfr;": "\u{1D511}", "nfr;": "\u{1D52B}", "ngE;": "\u2267\u0338", "nge;": "\u2271", "ngeq;": "\u2271", "ngeqq;": "\u2267\u0338", "ngeqslant;": "\u2A7E\u0338", "nges;": "\u2A7E\u0338", "nGg;": "\u22D9\u0338", "ngsim;": "\u2275", "nGt;": "\u226B\u20D2", "ngt;": "\u226F", "ngtr;": "\u226F", "nGtv;": "\u226B\u0338", "nhArr;": "\u21CE", "nharr;": "\u21AE", "nhpar;": "\u2AF2", "ni;": "\u220B", "nis;": "\u22FC", "nisd;": "\u22FA", "niv;": "\u220B", "NJcy;": "\u040A", "njcy;": "\u045A", "nlArr;": "\u21CD", "nlarr;": "\u219A", "nldr;": "\u2025", "nlE;": "\u2266\u0338", "nle;": "\u2270", "nLeftarrow;": "\u21CD", "nleftarrow;": "\u219A", "nLeftrightarrow;": "\u21CE", "nleftrightarrow;": "\u21AE", "nleq;": "\u2270", "nleqq;": "\u2266\u0338", "nleqslant;": "\u2A7D\u0338", "nles;": "\u2A7D\u0338", "nless;": "\u226E", "nLl;": "\u22D8\u0338", "nlsim;": "\u2274", "nLt;": "\u226A\u20D2", "nlt;": "\u226E", "nltri;": "\u22EA", "nltrie;": "\u22EC", "nLtv;": "\u226A\u0338", "nmid;": "\u2224", "NoBreak;": "\u2060", "NonBreakingSpace;": "\xA0", "Nopf;": "\u2115", "nopf;": "\u{1D55F}", "not": "\xAC", "Not;": "\u2AEC", "not;": "\xAC", "NotCongruent;": "\u2262", "NotCupCap;": "\u226D", "NotDoubleVerticalBar;": "\u2226", "NotElement;": "\u2209", "NotEqual;": "\u2260", "NotEqualTilde;": "\u2242\u0338", "NotExists;": "\u2204", "NotGreater;": "\u226F", "NotGreaterEqual;": "\u2271", "NotGreaterFullEqual;": "\u2267\u0338", "NotGreaterGreater;": "\u226B\u0338", "NotGreaterLess;": "\u2279", "NotGreaterSlantEqual;": "\u2A7E\u0338", "NotGreaterTilde;": "\u2275", "NotHumpDownHump;": "\u224E\u0338", "NotHumpEqual;": "\u224F\u0338", "notin;": "\u2209", "notindot;": "\u22F5\u0338", "notinE;": "\u22F9\u0338", "notinva;": "\u2209", "notinvb;": "\u22F7", "notinvc;": "\u22F6", "NotLeftTriangle;": "\u22EA", "NotLeftTriangleBar;": "\u29CF\u0338", "NotLeftTriangleEqual;": "\u22EC", "NotLess;": "\u226E", "NotLessEqual;": "\u2270", "NotLessGreater;": "\u2278", "NotLessLess;": "\u226A\u0338", "NotLessSlantEqual;": "\u2A7D\u0338", "NotLessTilde;": "\u2274", "NotNestedGreaterGreater;": "\u2AA2\u0338", "NotNestedLessLess;": "\u2AA1\u0338", "notni;": "\u220C", "notniva;": "\u220C", "notnivb;": "\u22FE", "notnivc;": "\u22FD", "NotPrecedes;": "\u2280", "NotPrecedesEqual;": "\u2AAF\u0338", "NotPrecedesSlantEqual;": "\u22E0", "NotReverseElement;": "\u220C", "NotRightTriangle;": "\u22EB", "NotRightTriangleBar;": "\u29D0\u0338", "NotRightTriangleEqual;": "\u22ED", "NotSquareSubset;": "\u228F\u0338", "NotSquareSubsetEqual;": "\u22E2", "NotSquareSuperset;": "\u2290\u0338", "NotSquareSupersetEqual;": "\u22E3", "NotSubset;": "\u2282\u20D2", "NotSubsetEqual;": "\u2288", "NotSucceeds;": "\u2281", "NotSucceedsEqual;": "\u2AB0\u0338", "NotSucceedsSlantEqual;": "\u22E1", "NotSucceedsTilde;": "\u227F\u0338", "NotSuperset;": "\u2283\u20D2", "NotSupersetEqual;": "\u2289", "NotTilde;": "\u2241", "NotTildeEqual;": "\u2244", "NotTildeFullEqual;": "\u2247", "NotTildeTilde;": "\u2249", "NotVerticalBar;": "\u2224", "npar;": "\u2226", "nparallel;": "\u2226", "nparsl;": "\u2AFD\u20E5", "npart;": "\u2202\u0338", "npolint;": "\u2A14", "npr;": "\u2280", "nprcue;": "\u22E0", "npre;": "\u2AAF\u0338", "nprec;": "\u2280", "npreceq;": "\u2AAF\u0338", "nrArr;": "\u21CF", "nrarr;": "\u219B", "nrarrc;": "\u2933\u0338", "nrarrw;": "\u219D\u0338", "nRightarrow;": "\u21CF", "nrightarrow;": "\u219B", "nrtri;": "\u22EB", "nrtrie;": "\u22ED", "nsc;": "\u2281", "nsccue;": "\u22E1", "nsce;": "\u2AB0\u0338", "Nscr;": "\u{1D4A9}", "nscr;": "\u{1D4C3}", "nshortmid;": "\u2224", "nshortparallel;": "\u2226", "nsim;": "\u2241", "nsime;": "\u2244", "nsimeq;": "\u2244", "nsmid;": "\u2224", "nspar;": "\u2226", "nsqsube;": "\u22E2", "nsqsupe;": "\u22E3", "nsub;": "\u2284", "nsubE;": "\u2AC5\u0338", "nsube;": "\u2288", "nsubset;": "\u2282\u20D2", "nsubseteq;": "\u2288", "nsubseteqq;": "\u2AC5\u0338", "nsucc;": "\u2281", "nsucceq;": "\u2AB0\u0338", "nsup;": "\u2285", "nsupE;": "\u2AC6\u0338", "nsupe;": "\u2289", "nsupset;": "\u2283\u20D2", "nsupseteq;": "\u2289", "nsupseteqq;": "\u2AC6\u0338", "ntgl;": "\u2279", "Ntilde": "\xD1", "ntilde": "\xF1", "Ntilde;": "\xD1", "ntilde;": "\xF1", "ntlg;": "\u2278", "ntriangleleft;": "\u22EA", "ntrianglelefteq;": "\u22EC", "ntriangleright;": "\u22EB", "ntrianglerighteq;": "\u22ED", "Nu;": "\u039D", "nu;": "\u03BD", "num;": "#", "numero;": "\u2116", "numsp;": "\u2007", "nvap;": "\u224D\u20D2", "nVDash;": "\u22AF", "nVdash;": "\u22AE", "nvDash;": "\u22AD", "nvdash;": "\u22AC", "nvge;": "\u2265\u20D2", "nvgt;": ">\u20D2", "nvHarr;": "\u2904", "nvinfin;": "\u29DE", "nvlArr;": "\u2902", "nvle;": "\u2264\u20D2", "nvlt;": "<\u20D2", "nvltrie;": "\u22B4\u20D2", "nvrArr;": "\u2903", "nvrtrie;": "\u22B5\u20D2", "nvsim;": "\u223C\u20D2", "nwarhk;": "\u2923", "nwArr;": "\u21D6", "nwarr;": "\u2196", "nwarrow;": "\u2196", "nwnear;": "\u2927", "Oacute": "\xD3", "oacute": "\xF3", "Oacute;": "\xD3", "oacute;": "\xF3", "oast;": "\u229B", "ocir;": "\u229A", "Ocirc": "\xD4", "ocirc": "\xF4", "Ocirc;": "\xD4", "ocirc;": "\xF4", "Ocy;": "\u041E", "ocy;": "\u043E", "odash;": "\u229D", "Odblac;": "\u0150", "odblac;": "\u0151", "odiv;": "\u2A38", "odot;": "\u2299", "odsold;": "\u29BC", "OElig;": "\u0152", "oelig;": "\u0153", "ofcir;": "\u29BF", "Ofr;": "\u{1D512}", "ofr;": "\u{1D52C}", "ogon;": "\u02DB", "Ograve": "\xD2", "ograve": "\xF2", "Ograve;": "\xD2", "ograve;": "\xF2", "ogt;": "\u29C1", "ohbar;": "\u29B5", "ohm;": "\u03A9", "oint;": "\u222E", "olarr;": "\u21BA", "olcir;": "\u29BE", "olcross;": "\u29BB", "oline;": "\u203E", "olt;": "\u29C0", "Omacr;": "\u014C", "omacr;": "\u014D", "Omega;": "\u03A9", "omega;": "\u03C9", "Omicron;": "\u039F", "omicron;": "\u03BF", "omid;": "\u29B6", "ominus;": "\u2296", "Oopf;": "\u{1D546}", "oopf;": "\u{1D560}", "opar;": "\u29B7", "OpenCurlyDoubleQuote;": "\u201C", "OpenCurlyQuote;": "\u2018", "operp;": "\u29B9", "oplus;": "\u2295", "Or;": "\u2A54", "or;": "\u2228", "orarr;": "\u21BB", "ord;": "\u2A5D", "order;": "\u2134", "orderof;": "\u2134", "ordf": "\xAA", "ordf;": "\xAA", "ordm": "\xBA", "ordm;": "\xBA", "origof;": "\u22B6", "oror;": "\u2A56", "orslope;": "\u2A57", "orv;": "\u2A5B", "oS;": "\u24C8", "Oscr;": "\u{1D4AA}", "oscr;": "\u2134", "Oslash": "\xD8", "oslash": "\xF8", "Oslash;": "\xD8", "oslash;": "\xF8", "osol;": "\u2298", "Otilde": "\xD5", "otilde": "\xF5", "Otilde;": "\xD5", "otilde;": "\xF5", "Otimes;": "\u2A37", "otimes;": "\u2297", "otimesas;": "\u2A36", "Ouml": "\xD6", "ouml": "\xF6", "Ouml;": "\xD6", "ouml;": "\xF6", "ovbar;": "\u233D", "OverBar;": "\u203E", "OverBrace;": "\u23DE", "OverBracket;": "\u23B4", "OverParenthesis;": "\u23DC", "par;": "\u2225", "para": "\xB6", "para;": "\xB6", "parallel;": "\u2225", "parsim;": "\u2AF3", "parsl;": "\u2AFD", "part;": "\u2202", "PartialD;": "\u2202", "Pcy;": "\u041F", "pcy;": "\u043F", "percnt;": "%", "period;": ".", "permil;": "\u2030", "perp;": "\u22A5", "pertenk;": "\u2031", "Pfr;": "\u{1D513}", "pfr;": "\u{1D52D}", "Phi;": "\u03A6", "phi;": "\u03C6", "phiv;": "\u03D5", "phmmat;": "\u2133", "phone;": "\u260E", "Pi;": "\u03A0", "pi;": "\u03C0", "pitchfork;": "\u22D4", "piv;": "\u03D6", "planck;": "\u210F", "planckh;": "\u210E", "plankv;": "\u210F", "plus;": "+", "plusacir;": "\u2A23", "plusb;": "\u229E", "pluscir;": "\u2A22", "plusdo;": "\u2214", "plusdu;": "\u2A25", "pluse;": "\u2A72", "PlusMinus;": "\xB1", "plusmn": "\xB1", "plusmn;": "\xB1", "plussim;": "\u2A26", "plustwo;": "\u2A27", "pm;": "\xB1", "Poincareplane;": "\u210C", "pointint;": "\u2A15", "Popf;": "\u2119", "popf;": "\u{1D561}", "pound": "\xA3", "pound;": "\xA3", "Pr;": "\u2ABB", "pr;": "\u227A", "prap;": "\u2AB7", "prcue;": "\u227C", "prE;": "\u2AB3", "pre;": "\u2AAF", "prec;": "\u227A", "precapprox;": "\u2AB7", "preccurlyeq;": "\u227C", "Precedes;": "\u227A", "PrecedesEqual;": "\u2AAF", "PrecedesSlantEqual;": "\u227C", "PrecedesTilde;": "\u227E", "preceq;": "\u2AAF", "precnapprox;": "\u2AB9", "precneqq;": "\u2AB5", "precnsim;": "\u22E8", "precsim;": "\u227E", "Prime;": "\u2033", "prime;": "\u2032", "primes;": "\u2119", "prnap;": "\u2AB9", "prnE;": "\u2AB5", "prnsim;": "\u22E8", "prod;": "\u220F", "Product;": "\u220F", "profalar;": "\u232E", "profline;": "\u2312", "profsurf;": "\u2313", "prop;": "\u221D", "Proportion;": "\u2237", "Proportional;": "\u221D", "propto;": "\u221D", "prsim;": "\u227E", "prurel;": "\u22B0", "Pscr;": "\u{1D4AB}", "pscr;": "\u{1D4C5}", "Psi;": "\u03A8", "psi;": "\u03C8", "puncsp;": "\u2008", "Qfr;": "\u{1D514}", "qfr;": "\u{1D52E}", "qint;": "\u2A0C", "Qopf;": "\u211A", "qopf;": "\u{1D562}", "qprime;": "\u2057", "Qscr;": "\u{1D4AC}", "qscr;": "\u{1D4C6}", "quaternions;": "\u210D", "quatint;": "\u2A16", "quest;": "?", "questeq;": "\u225F", "QUOT": '"', "quot": '"', "QUOT;": '"', "quot;": '"', "rAarr;": "\u21DB", "race;": "\u223D\u0331", "Racute;": "\u0154", "racute;": "\u0155", "radic;": "\u221A", "raemptyv;": "\u29B3", "Rang;": "\u27EB", "rang;": "\u27E9", "rangd;": "\u2992", "range;": "\u29A5", "rangle;": "\u27E9", "raquo": "\xBB", "raquo;": "\xBB", "Rarr;": "\u21A0", "rArr;": "\u21D2", "rarr;": "\u2192", "rarrap;": "\u2975", "rarrb;": "\u21E5", "rarrbfs;": "\u2920", "rarrc;": "\u2933", "rarrfs;": "\u291E", "rarrhk;": "\u21AA", "rarrlp;": "\u21AC", "rarrpl;": "\u2945", "rarrsim;": "\u2974", "Rarrtl;": "\u2916", "rarrtl;": "\u21A3", "rarrw;": "\u219D", "rAtail;": "\u291C", "ratail;": "\u291A", "ratio;": "\u2236", "rationals;": "\u211A", "RBarr;": "\u2910", "rBarr;": "\u290F", "rbarr;": "\u290D", "rbbrk;": "\u2773", "rbrace;": "}", "rbrack;": "]", "rbrke;": "\u298C", "rbrksld;": "\u298E", "rbrkslu;": "\u2990", "Rcaron;": "\u0158", "rcaron;": "\u0159", "Rcedil;": "\u0156", "rcedil;": "\u0157", "rceil;": "\u2309", "rcub;": "}", "Rcy;": "\u0420", "rcy;": "\u0440", "rdca;": "\u2937", "rdldhar;": "\u2969", "rdquo;": "\u201D", "rdquor;": "\u201D", "rdsh;": "\u21B3", "Re;": "\u211C", "real;": "\u211C", "realine;": "\u211B", "realpart;": "\u211C", "reals;": "\u211D", "rect;": "\u25AD", "REG": "\xAE", "reg": "\xAE", "REG;": "\xAE", "reg;": "\xAE", "ReverseElement;": "\u220B", "ReverseEquilibrium;": "\u21CB", "ReverseUpEquilibrium;": "\u296F", "rfisht;": "\u297D", "rfloor;": "\u230B", "Rfr;": "\u211C", "rfr;": "\u{1D52F}", "rHar;": "\u2964", "rhard;": "\u21C1", "rharu;": "\u21C0", "rharul;": "\u296C", "Rho;": "\u03A1", "rho;": "\u03C1", "rhov;": "\u03F1", "RightAngleBracket;": "\u27E9", "RightArrow;": "\u2192", "Rightarrow;": "\u21D2", "rightarrow;": "\u2192", "RightArrowBar;": "\u21E5", "RightArrowLeftArrow;": "\u21C4", "rightarrowtail;": "\u21A3", "RightCeiling;": "\u2309", "RightDoubleBracket;": "\u27E7", "RightDownTeeVector;": "\u295D", "RightDownVector;": "\u21C2", "RightDownVectorBar;": "\u2955", "RightFloor;": "\u230B", "rightharpoondown;": "\u21C1", "rightharpoonup;": "\u21C0", "rightleftarrows;": "\u21C4", "rightleftharpoons;": "\u21CC", "rightrightarrows;": "\u21C9", "rightsquigarrow;": "\u219D", "RightTee;": "\u22A2", "RightTeeArrow;": "\u21A6", "RightTeeVector;": "\u295B", "rightthreetimes;": "\u22CC", "RightTriangle;": "\u22B3", "RightTriangleBar;": "\u29D0", "RightTriangleEqual;": "\u22B5", "RightUpDownVector;": "\u294F", "RightUpTeeVector;": "\u295C", "RightUpVector;": "\u21BE", "RightUpVectorBar;": "\u2954", "RightVector;": "\u21C0", "RightVectorBar;": "\u2953", "ring;": "\u02DA", "risingdotseq;": "\u2253", "rlarr;": "\u21C4", "rlhar;": "\u21CC", "rlm;": "\u200F", "rmoust;": "\u23B1", "rmoustache;": "\u23B1", "rnmid;": "\u2AEE", "roang;": "\u27ED", "roarr;": "\u21FE", "robrk;": "\u27E7", "ropar;": "\u2986", "Ropf;": "\u211D", "ropf;": "\u{1D563}", "roplus;": "\u2A2E", "rotimes;": "\u2A35", "RoundImplies;": "\u2970", "rpar;": ")", "rpargt;": "\u2994", "rppolint;": "\u2A12", "rrarr;": "\u21C9", "Rrightarrow;": "\u21DB", "rsaquo;": "\u203A", "Rscr;": "\u211B", "rscr;": "\u{1D4C7}", "Rsh;": "\u21B1", "rsh;": "\u21B1", "rsqb;": "]", "rsquo;": "\u2019", "rsquor;": "\u2019", "rthree;": "\u22CC", "rtimes;": "\u22CA", "rtri;": "\u25B9", "rtrie;": "\u22B5", "rtrif;": "\u25B8", "rtriltri;": "\u29CE", "RuleDelayed;": "\u29F4", "ruluhar;": "\u2968", "rx;": "\u211E", "Sacute;": "\u015A", "sacute;": "\u015B", "sbquo;": "\u201A", "Sc;": "\u2ABC", "sc;": "\u227B", "scap;": "\u2AB8", "Scaron;": "\u0160", "scaron;": "\u0161", "sccue;": "\u227D", "scE;": "\u2AB4", "sce;": "\u2AB0", "Scedil;": "\u015E", "scedil;": "\u015F", "Scirc;": "\u015C", "scirc;": "\u015D", "scnap;": "\u2ABA", "scnE;": "\u2AB6", "scnsim;": "\u22E9", "scpolint;": "\u2A13", "scsim;": "\u227F", "Scy;": "\u0421", "scy;": "\u0441", "sdot;": "\u22C5", "sdotb;": "\u22A1", "sdote;": "\u2A66", "searhk;": "\u2925", "seArr;": "\u21D8", "searr;": "\u2198", "searrow;": "\u2198", "sect": "\xA7", "sect;": "\xA7", "semi;": ";", "seswar;": "\u2929", "setminus;": "\u2216", "setmn;": "\u2216", "sext;": "\u2736", "Sfr;": "\u{1D516}", "sfr;": "\u{1D530}", "sfrown;": "\u2322", "sharp;": "\u266F", "SHCHcy;": "\u0429", "shchcy;": "\u0449", "SHcy;": "\u0428", "shcy;": "\u0448", "ShortDownArrow;": "\u2193", "ShortLeftArrow;": "\u2190", "shortmid;": "\u2223", "shortparallel;": "\u2225", "ShortRightArrow;": "\u2192", "ShortUpArrow;": "\u2191", "shy": "\xAD", "shy;": "\xAD", "Sigma;": "\u03A3", "sigma;": "\u03C3", "sigmaf;": "\u03C2", "sigmav;": "\u03C2", "sim;": "\u223C", "simdot;": "\u2A6A", "sime;": "\u2243", "simeq;": "\u2243", "simg;": "\u2A9E", "simgE;": "\u2AA0", "siml;": "\u2A9D", "simlE;": "\u2A9F", "simne;": "\u2246", "simplus;": "\u2A24", "simrarr;": "\u2972", "slarr;": "\u2190", "SmallCircle;": "\u2218", "smallsetminus;": "\u2216", "smashp;": "\u2A33", "smeparsl;": "\u29E4", "smid;": "\u2223", "smile;": "\u2323", "smt;": "\u2AAA", "smte;": "\u2AAC", "smtes;": "\u2AAC\uFE00", "SOFTcy;": "\u042C", "softcy;": "\u044C", "sol;": "/", "solb;": "\u29C4", "solbar;": "\u233F", "Sopf;": "\u{1D54A}", "sopf;": "\u{1D564}", "spades;": "\u2660", "spadesuit;": "\u2660", "spar;": "\u2225", "sqcap;": "\u2293", "sqcaps;": "\u2293\uFE00", "sqcup;": "\u2294", "sqcups;": "\u2294\uFE00", "Sqrt;": "\u221A", "sqsub;": "\u228F", "sqsube;": "\u2291", "sqsubset;": "\u228F", "sqsubseteq;": "\u2291", "sqsup;": "\u2290", "sqsupe;": "\u2292", "sqsupset;": "\u2290", "sqsupseteq;": "\u2292", "squ;": "\u25A1", "Square;": "\u25A1", "square;": "\u25A1", "SquareIntersection;": "\u2293", "SquareSubset;": "\u228F", "SquareSubsetEqual;": "\u2291", "SquareSuperset;": "\u2290", "SquareSupersetEqual;": "\u2292", "SquareUnion;": "\u2294", "squarf;": "\u25AA", "squf;": "\u25AA", "srarr;": "\u2192", "Sscr;": "\u{1D4AE}", "sscr;": "\u{1D4C8}", "ssetmn;": "\u2216", "ssmile;": "\u2323", "sstarf;": "\u22C6", "Star;": "\u22C6", "star;": "\u2606", "starf;": "\u2605", "straightepsilon;": "\u03F5", "straightphi;": "\u03D5", "strns;": "\xAF", "Sub;": "\u22D0", "sub;": "\u2282", "subdot;": "\u2ABD", "subE;": "\u2AC5", "sube;": "\u2286", "subedot;": "\u2AC3", "submult;": "\u2AC1", "subnE;": "\u2ACB", "subne;": "\u228A", "subplus;": "\u2ABF", "subrarr;": "\u2979", "Subset;": "\u22D0", "subset;": "\u2282", "subseteq;": "\u2286", "subseteqq;": "\u2AC5", "SubsetEqual;": "\u2286", "subsetneq;": "\u228A", "subsetneqq;": "\u2ACB", "subsim;": "\u2AC7", "subsub;": "\u2AD5", "subsup;": "\u2AD3", "succ;": "\u227B", "succapprox;": "\u2AB8", "succcurlyeq;": "\u227D", "Succeeds;": "\u227B", "SucceedsEqual;": "\u2AB0", "SucceedsSlantEqual;": "\u227D", "SucceedsTilde;": "\u227F", "succeq;": "\u2AB0", "succnapprox;": "\u2ABA", "succneqq;": "\u2AB6", "succnsim;": "\u22E9", "succsim;": "\u227F", "SuchThat;": "\u220B", "Sum;": "\u2211", "sum;": "\u2211", "sung;": "\u266A", "sup1": "\xB9", "sup1;": "\xB9", "sup2": "\xB2", "sup2;": "\xB2", "sup3": "\xB3", "sup3;": "\xB3", "Sup;": "\u22D1", "sup;": "\u2283", "supdot;": "\u2ABE", "supdsub;": "\u2AD8", "supE;": "\u2AC6", "supe;": "\u2287", "supedot;": "\u2AC4", "Superset;": "\u2283", "SupersetEqual;": "\u2287", "suphsol;": "\u27C9", "suphsub;": "\u2AD7", "suplarr;": "\u297B", "supmult;": "\u2AC2", "supnE;": "\u2ACC", "supne;": "\u228B", "supplus;": "\u2AC0", "Supset;": "\u22D1", "supset;": "\u2283", "supseteq;": "\u2287", "supseteqq;": "\u2AC6", "supsetneq;": "\u228B", "supsetneqq;": "\u2ACC", "supsim;": "\u2AC8", "supsub;": "\u2AD4", "supsup;": "\u2AD6", "swarhk;": "\u2926", "swArr;": "\u21D9", "swarr;": "\u2199", "swarrow;": "\u2199", "swnwar;": "\u292A", "szlig": "\xDF", "szlig;": "\xDF", "Tab;": "	", "target;": "\u2316", "Tau;": "\u03A4", "tau;": "\u03C4", "tbrk;": "\u23B4", "Tcaron;": "\u0164", "tcaron;": "\u0165", "Tcedil;": "\u0162", "tcedil;": "\u0163", "Tcy;": "\u0422", "tcy;": "\u0442", "tdot;": "\u20DB", "telrec;": "\u2315", "Tfr;": "\u{1D517}", "tfr;": "\u{1D531}", "there4;": "\u2234", "Therefore;": "\u2234", "therefore;": "\u2234", "Theta;": "\u0398", "theta;": "\u03B8", "thetasym;": "\u03D1", "thetav;": "\u03D1", "thickapprox;": "\u2248", "thicksim;": "\u223C", "ThickSpace;": "\u205F\u200A", "thinsp;": "\u2009", "ThinSpace;": "\u2009", "thkap;": "\u2248", "thksim;": "\u223C", "THORN": "\xDE", "thorn": "\xFE", "THORN;": "\xDE", "thorn;": "\xFE", "Tilde;": "\u223C", "tilde;": "\u02DC", "TildeEqual;": "\u2243", "TildeFullEqual;": "\u2245", "TildeTilde;": "\u2248", "times": "\xD7", "times;": "\xD7", "timesb;": "\u22A0", "timesbar;": "\u2A31", "timesd;": "\u2A30", "tint;": "\u222D", "toea;": "\u2928", "top;": "\u22A4", "topbot;": "\u2336", "topcir;": "\u2AF1", "Topf;": "\u{1D54B}", "topf;": "\u{1D565}", "topfork;": "\u2ADA", "tosa;": "\u2929", "tprime;": "\u2034", "TRADE;": "\u2122", "trade;": "\u2122", "triangle;": "\u25B5", "triangledown;": "\u25BF", "triangleleft;": "\u25C3", "trianglelefteq;": "\u22B4", "triangleq;": "\u225C", "triangleright;": "\u25B9", "trianglerighteq;": "\u22B5", "tridot;": "\u25EC", "trie;": "\u225C", "triminus;": "\u2A3A", "TripleDot;": "\u20DB", "triplus;": "\u2A39", "trisb;": "\u29CD", "tritime;": "\u2A3B", "trpezium;": "\u23E2", "Tscr;": "\u{1D4AF}", "tscr;": "\u{1D4C9}", "TScy;": "\u0426", "tscy;": "\u0446", "TSHcy;": "\u040B", "tshcy;": "\u045B", "Tstrok;": "\u0166", "tstrok;": "\u0167", "twixt;": "\u226C", "twoheadleftarrow;": "\u219E", "twoheadrightarrow;": "\u21A0", "Uacute": "\xDA", "uacute": "\xFA", "Uacute;": "\xDA", "uacute;": "\xFA", "Uarr;": "\u219F", "uArr;": "\u21D1", "uarr;": "\u2191", "Uarrocir;": "\u2949", "Ubrcy;": "\u040E", "ubrcy;": "\u045E", "Ubreve;": "\u016C", "ubreve;": "\u016D", "Ucirc": "\xDB", "ucirc": "\xFB", "Ucirc;": "\xDB", "ucirc;": "\xFB", "Ucy;": "\u0423", "ucy;": "\u0443", "udarr;": "\u21C5", "Udblac;": "\u0170", "udblac;": "\u0171", "udhar;": "\u296E", "ufisht;": "\u297E", "Ufr;": "\u{1D518}", "ufr;": "\u{1D532}", "Ugrave": "\xD9", "ugrave": "\xF9", "Ugrave;": "\xD9", "ugrave;": "\xF9", "uHar;": "\u2963", "uharl;": "\u21BF", "uharr;": "\u21BE", "uhblk;": "\u2580", "ulcorn;": "\u231C", "ulcorner;": "\u231C", "ulcrop;": "\u230F", "ultri;": "\u25F8", "Umacr;": "\u016A", "umacr;": "\u016B", "uml": "\xA8", "uml;": "\xA8", "UnderBar;": "_", "UnderBrace;": "\u23DF", "UnderBracket;": "\u23B5", "UnderParenthesis;": "\u23DD", "Union;": "\u22C3", "UnionPlus;": "\u228E", "Uogon;": "\u0172", "uogon;": "\u0173", "Uopf;": "\u{1D54C}", "uopf;": "\u{1D566}", "UpArrow;": "\u2191", "Uparrow;": "\u21D1", "uparrow;": "\u2191", "UpArrowBar;": "\u2912", "UpArrowDownArrow;": "\u21C5", "UpDownArrow;": "\u2195", "Updownarrow;": "\u21D5", "updownarrow;": "\u2195", "UpEquilibrium;": "\u296E", "upharpoonleft;": "\u21BF", "upharpoonright;": "\u21BE", "uplus;": "\u228E", "UpperLeftArrow;": "\u2196", "UpperRightArrow;": "\u2197", "Upsi;": "\u03D2", "upsi;": "\u03C5", "upsih;": "\u03D2", "Upsilon;": "\u03A5", "upsilon;": "\u03C5", "UpTee;": "\u22A5", "UpTeeArrow;": "\u21A5", "upuparrows;": "\u21C8", "urcorn;": "\u231D", "urcorner;": "\u231D", "urcrop;": "\u230E", "Uring;": "\u016E", "uring;": "\u016F", "urtri;": "\u25F9", "Uscr;": "\u{1D4B0}", "uscr;": "\u{1D4CA}", "utdot;": "\u22F0", "Utilde;": "\u0168", "utilde;": "\u0169", "utri;": "\u25B5", "utrif;": "\u25B4", "uuarr;": "\u21C8", "Uuml": "\xDC", "uuml": "\xFC", "Uuml;": "\xDC", "uuml;": "\xFC", "uwangle;": "\u29A7", "vangrt;": "\u299C", "varepsilon;": "\u03F5", "varkappa;": "\u03F0", "varnothing;": "\u2205", "varphi;": "\u03D5", "varpi;": "\u03D6", "varpropto;": "\u221D", "vArr;": "\u21D5", "varr;": "\u2195", "varrho;": "\u03F1", "varsigma;": "\u03C2", "varsubsetneq;": "\u228A\uFE00", "varsubsetneqq;": "\u2ACB\uFE00", "varsupsetneq;": "\u228B\uFE00", "varsupsetneqq;": "\u2ACC\uFE00", "vartheta;": "\u03D1", "vartriangleleft;": "\u22B2", "vartriangleright;": "\u22B3", "Vbar;": "\u2AEB", "vBar;": "\u2AE8", "vBarv;": "\u2AE9", "Vcy;": "\u0412", "vcy;": "\u0432", "VDash;": "\u22AB", "Vdash;": "\u22A9", "vDash;": "\u22A8", "vdash;": "\u22A2", "Vdashl;": "\u2AE6", "Vee;": "\u22C1", "vee;": "\u2228", "veebar;": "\u22BB", "veeeq;": "\u225A", "vellip;": "\u22EE", "Verbar;": "\u2016", "verbar;": "|", "Vert;": "\u2016", "vert;": "|", "VerticalBar;": "\u2223", "VerticalLine;": "|", "VerticalSeparator;": "\u2758", "VerticalTilde;": "\u2240", "VeryThinSpace;": "\u200A", "Vfr;": "\u{1D519}", "vfr;": "\u{1D533}", "vltri;": "\u22B2", "vnsub;": "\u2282\u20D2", "vnsup;": "\u2283\u20D2", "Vopf;": "\u{1D54D}", "vopf;": "\u{1D567}", "vprop;": "\u221D", "vrtri;": "\u22B3", "Vscr;": "\u{1D4B1}", "vscr;": "\u{1D4CB}", "vsubnE;": "\u2ACB\uFE00", "vsubne;": "\u228A\uFE00", "vsupnE;": "\u2ACC\uFE00", "vsupne;": "\u228B\uFE00", "Vvdash;": "\u22AA", "vzigzag;": "\u299A", "Wcirc;": "\u0174", "wcirc;": "\u0175", "wedbar;": "\u2A5F", "Wedge;": "\u22C0", "wedge;": "\u2227", "wedgeq;": "\u2259", "weierp;": "\u2118", "Wfr;": "\u{1D51A}", "wfr;": "\u{1D534}", "Wopf;": "\u{1D54E}", "wopf;": "\u{1D568}", "wp;": "\u2118", "wr;": "\u2240", "wreath;": "\u2240", "Wscr;": "\u{1D4B2}", "wscr;": "\u{1D4CC}", "xcap;": "\u22C2", "xcirc;": "\u25EF", "xcup;": "\u22C3", "xdtri;": "\u25BD", "Xfr;": "\u{1D51B}", "xfr;": "\u{1D535}", "xhArr;": "\u27FA", "xharr;": "\u27F7", "Xi;": "\u039E", "xi;": "\u03BE", "xlArr;": "\u27F8", "xlarr;": "\u27F5", "xmap;": "\u27FC", "xnis;": "\u22FB", "xodot;": "\u2A00", "Xopf;": "\u{1D54F}", "xopf;": "\u{1D569}", "xoplus;": "\u2A01", "xotime;": "\u2A02", "xrArr;": "\u27F9", "xrarr;": "\u27F6", "Xscr;": "\u{1D4B3}", "xscr;": "\u{1D4CD}", "xsqcup;": "\u2A06", "xuplus;": "\u2A04", "xutri;": "\u25B3", "xvee;": "\u22C1", "xwedge;": "\u22C0", "Yacute": "\xDD", "yacute": "\xFD", "Yacute;": "\xDD", "yacute;": "\xFD", "YAcy;": "\u042F", "yacy;": "\u044F", "Ycirc;": "\u0176", "ycirc;": "\u0177", "Ycy;": "\u042B", "ycy;": "\u044B", "yen": "\xA5", "yen;": "\xA5", "Yfr;": "\u{1D51C}", "yfr;": "\u{1D536}", "YIcy;": "\u0407", "yicy;": "\u0457", "Yopf;": "\u{1D550}", "yopf;": "\u{1D56A}", "Yscr;": "\u{1D4B4}", "yscr;": "\u{1D4CE}", "YUcy;": "\u042E", "yucy;": "\u044E", "yuml": "\xFF", "Yuml;": "\u0178", "yuml;": "\xFF", "Zacute;": "\u0179", "zacute;": "\u017A", "Zcaron;": "\u017D", "zcaron;": "\u017E", "Zcy;": "\u0417", "zcy;": "\u0437", "Zdot;": "\u017B", "zdot;": "\u017C", "zeetrf;": "\u2128", "ZeroWidthSpace;": "\u200B", "Zeta;": "\u0396", "zeta;": "\u03B6", "Zfr;": "\u2128", "zfr;": "\u{1D537}", "ZHcy;": "\u0416", "zhcy;": "\u0436", "zigrarr;": "\u21DD", "Zopf;": "\u2124", "zopf;": "\u{1D56B}", "Zscr;": "\u{1D4B5}", "zscr;": "\u{1D4CF}", "zwj;": "\u200D", "zwnj;": "\u200C" };

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/pyish.ts
var PyError = class extends Error {
  constructor(pyName, msg = "") {
    super(msg || pyName);
    this.pyName = pyName;
  }
};
var WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var WS_L = new RegExp("^[" + WS + "]+");
var WS_R = new RegExp("[" + WS + "]+$");
var strip = (s) => s.replace(WS_L, "").replace(WS_R, "");
var cut = (s, n) => {
  if (s.length <= n) return s;
  let i = 0, c = 0;
  while (i < s.length && c < n) {
    const u = s.charCodeAt(i);
    i += u >= 55296 && u < 56320 && i + 1 < s.length ? 2 : 1;
    c++;
  }
  return s.slice(0, i);
};
var plen = (s) => {
  let n = 0;
  for (const _c of s) {
    void _c;
    n++;
  }
  return n;
};
var truthy = (v) => !(v === null || v === void 0 || v === false || v === "" || v === 0);
var PW = "[\\p{L}\\p{N}_]";
var PYB = `(?:(?<=${PW})(?!${PW})|(?<!${PW})(?=${PW}))`;
function pyRe(src, flags = "") {
  let out = "", inCls = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      i++;
      if (n === "s") out += inCls ? WS : `[${WS}]`;
      else if (n === "S") out += inCls ? "\\S" : `[^${WS}]`;
      else if (n === "b" && !inCls) out += PYB;
      else if (n === "d") out += "\\p{Nd}";
      else if (n === "D") out += inCls ? "\\P{Nd}" : "\\P{Nd}";
      else if (n === "w") out += inCls ? "\\p{L}\\p{N}_" : PW;
      else out += "\\" + n;
    } else if (c === "[" && !inCls) {
      inCls = true;
      out += c;
      if (src[i + 1] === "^") {
        out += "^";
        i++;
      }
    } else if (c === "]" && inCls) {
      inCls = false;
      out += c;
    } else if (c === "." && !inCls) out += flags.includes("s") ? "[\\s\\S]" : "[^\\n]";
    else out += c;
  }
  return new RegExp(out, flags.replace("s", "") + "u");
}
var reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var INVALID_SET = new Set(INVALID_CODEPOINTS);
var CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;
function htmlUnescape(s) {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_m, g) => {
    if (g[0] === "#") {
      const hex = g[1] === "x" || g[1] === "X";
      const digits = (hex ? g.slice(2) : g.slice(1)).replace(/;+$/, "");
      const big = BigInt((hex ? "0x" : "") + digits);
      if (big <= BigInt(1114111)) {
        const num = Number(big);
        if (Object.prototype.hasOwnProperty.call(INVALID_CHARREFS, num)) return INVALID_CHARREFS[num];
        if (num >= 55296 && num <= 57343) return "\uFFFD";
        if (INVALID_SET.has(num)) return "";
        return String.fromCodePoint(num);
      }
      return "\uFFFD";
    }
    if (Object.prototype.hasOwnProperty.call(HTML5, g)) return HTML5[g];
    const cp = Array.from(g);
    for (let x = cp.length - 1; x > 1; x--) {
      const k = cp.slice(0, x).join("");
      if (Object.prototype.hasOwnProperty.call(HTML5, k)) return HTML5[k] + cp.slice(x).join("");
    }
    return "&" + g;
  });
}
var SCHEME_CHARS = /^[A-Za-z0-9+\-.]*$/;
var USES_RELATIVE = /* @__PURE__ */ new Set(["", "ftp", "http", "gopher", "nntp", "imap", "wais", "file", "https", "shttp", "mms", "prospero", "rtsp", "rtsps", "rtspu", "sftp", "svn", "svn+ssh", "ws", "wss"]);
var USES_NETLOC = /* @__PURE__ */ new Set(["", "ftp", "http", "gopher", "nntp", "telnet", "imap", "wais", "file", "mms", "https", "shttp", "snews", "prospero", "rtsp", "rtspu", "rsync", "svn", "svn+ssh", "sftp", "nfs", "git", "git+ssh", "ws", "wss"]);
var USES_PARAMS = /* @__PURE__ */ new Set(["", "ftp", "hdl", "prospero", "http", "imap", "https", "shttp", "rtsp", "rtsps", "mms", "sftp", "tel"]);
function urlsplit(url0, scheme0 = "") {
  let url = url0.replace(/^[\u0000- ]+/, "");
  let scheme = scheme0.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  url = url.replace(/[\t\r\n]/g, "");
  scheme = scheme.replace(/[\t\r\n]/g, "");
  let netloc = "", query = "", fragment = "";
  const i = url.indexOf(":");
  if (i > 0 && /^[A-Za-z]/.test(url[0]) && SCHEME_CHARS.test(url.slice(0, i))) {
    scheme = url.slice(0, i).toLowerCase();
    url = url.slice(i + 1);
  }
  if (url.slice(0, 2) === "//") {
    let delim = url.length;
    for (const c of "/?#") {
      const w = url.indexOf(c, 2);
      if (w >= 0 && w < delim) delim = w;
    }
    netloc = url.slice(2, delim);
    url = url.slice(delim);
    if (netloc.includes("[") && !netloc.includes("]") || netloc.includes("]") && !netloc.includes("[")) throw new PyError("ValueError", "Invalid IPv6 URL");
  }
  const h = url.indexOf("#");
  if (h >= 0) {
    fragment = url.slice(h + 1);
    url = url.slice(0, h);
  }
  const q = url.indexOf("?");
  if (q >= 0) {
    query = url.slice(q + 1);
    url = url.slice(0, q);
  }
  return { scheme, netloc, path: url, query, fragment };
}
function urlparse(url, scheme = "") {
  const s = urlsplit(url, scheme);
  let path2 = s.path, params = "";
  if (USES_PARAMS.has(s.scheme) && path2.includes(";")) {
    let i;
    if (path2.includes("/")) {
      i = path2.indexOf(";", path2.lastIndexOf("/"));
      if (i < 0) i = -1;
    } else i = path2.indexOf(";");
    if (i >= 0) {
      params = path2.slice(i + 1);
      path2 = path2.slice(0, i);
    }
  }
  return { ...s, path: path2, params };
}
function urlunsplit(c) {
  let url = c.path;
  if (c.netloc) {
    if (url && url[0] !== "/") url = "/" + url;
    url = "//" + c.netloc + url;
  } else if (url.slice(0, 2) === "//") url = "//" + url;
  else if (c.scheme && USES_NETLOC.has(c.scheme) && (!url || url[0] === "/")) url = "//" + url;
  if (c.scheme) url = c.scheme + ":" + url;
  if (c.query) url = url + "?" + c.query;
  if (c.fragment) url = url + "#" + c.fragment;
  return url;
}
function urlunparse(c) {
  return urlunsplit({ ...c, path: c.params ? `${c.path};${c.params}` : c.path });
}
function urljoin(base, url) {
  if (!base) return url;
  if (!url) return base;
  const b = urlparse(base, ""), u = urlparse(url, b.scheme);
  if (u.scheme !== b.scheme || !USES_RELATIVE.has(u.scheme)) return url;
  let netloc = u.netloc, path2 = u.path, params = u.params, query = u.query;
  if (USES_NETLOC.has(u.scheme)) {
    if (netloc) return urlunparse({ ...u });
    netloc = b.netloc;
  }
  if (!path2 && !params) {
    path2 = b.path;
    params = b.params;
    if (!query) query = b.query;
    return urlunparse({ scheme: u.scheme, netloc, path: path2, params, query, fragment: u.fragment });
  }
  const baseParts = b.path.split("/");
  if (baseParts[baseParts.length - 1] !== "") baseParts.pop();
  let segments;
  if (path2[0] === "/") segments = path2.split("/");
  else {
    segments = baseParts.concat(path2.split("/"));
    if (segments.length > 2) segments = [segments[0], ...segments.slice(1, -1).filter(Boolean), segments[segments.length - 1]];
  }
  return urlunparse({ scheme: u.scheme, netloc, path: resolve(segments) || "/", params, query, fragment: u.fragment });
}
function resolve(segments) {
  const out = [];
  for (const seg of segments) {
    if (seg === "..") out.pop();
    else if (seg === ".") continue;
    else out.push(seg);
  }
  if (segments[segments.length - 1] === "." || segments[segments.length - 1] === "..") out.push("");
  return out.join("/");
}
function hostnameOf(url) {
  const netloc = urlsplit(url).netloc;
  const hostinfo = netloc.slice(netloc.lastIndexOf("@") + 1);
  let host;
  const ob = hostinfo.indexOf("[");
  if (ob >= 0) {
    const br = hostinfo.slice(ob + 1);
    const e = br.indexOf("]");
    host = e >= 0 ? br.slice(0, e) : br;
  } else {
    const c = hostinfo.indexOf(":");
    host = c >= 0 ? hostinfo.slice(0, c) : hostinfo;
  }
  if (!host) return null;
  const p = host.indexOf("%");
  return p >= 0 ? host.slice(0, p).toLowerCase() + host.slice(p) : host.toLowerCase();
}
var pathOf = (url) => urlparse(url).path;
var ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/;
function quote(s, safe = "/") {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 55296 && cp <= 57343) throw new PyError("UnicodeEncodeError", "surrogates not allowed");
    if (ch.length === 1 && cp < 128 && (ALWAYS_SAFE.test(ch) || safe.includes(ch))) {
      out += ch;
      continue;
    }
    for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
var quotePlus = (s, safe = "") => s.includes(" ") ? quote(s, safe + " ").replace(/ /g, "+") : quote(s, safe);
var urlencode = (d) => d.map(([k, v]) => quotePlus(k) + "=" + quotePlus(v)).join("&");
function fixUrl(loc, base) {
  const SUR = "\u{F0001}";
  const l = strip(loc).replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => {
    const n = parseInt(h, 16);
    return n >= 55296 && n <= 57343 ? SUR : String.fromCharCode(n);
  });
  const p = urlsplit(urljoin(base, l));
  if (p.path.includes(SUR) || p.query.includes(SUR)) throw new PyError("UnicodeEncodeError", "surrogates not allowed");
  return urlunsplit({ scheme: p.scheme, netloc: p.netloc, path: quote(p.path, "/%:@!$&'()*+,;=-._~"), query: quote(p.query, "=&%:/?+,;@-._~"), fragment: "" });
}
function jsonDumps(v, compact = false) {
  const esc = (s) => {
    let o = '"';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === '"') o += '\\"';
      else if (ch === "\\") o += "\\\\";
      else if (ch === "\n") o += "\\n";
      else if (ch === "\r") o += "\\r";
      else if (ch === "	") o += "\\t";
      else if (ch === "\b") o += "\\b";
      else if (ch === "\f") o += "\\f";
      else if (c < 32 || c > 126 && c < 65536) o += "\\u" + c.toString(16).padStart(4, "0");
      else if (c >= 65536) {
        const h = c - 65536;
        o += "\\u" + (55296 + (h >> 10)).toString(16) + "\\u" + (56320 + (h & 1023)).toString(16);
      } else o += ch;
    }
    return o + '"';
  };
  const sep = compact ? [",", ":"] : [", ", ": "];
  const go = (x) => {
    if (x === null || x === void 0) return "null";
    if (typeof x === "boolean") return x ? "true" : "false";
    if (typeof x === "number") return Number.isInteger(x) ? String(x) : String(x);
    if (typeof x === "string") return esc(x);
    if (Array.isArray(x)) return "[" + x.map(go).join(sep[0]) + "]";
    return "{" + Object.entries(x).map(([k, y]) => esc(k) + sep[1] + go(y)).join(sep[0]) + "}";
  };
  return go(v);
}
var ISDIGIT = /^[\u{30}-\u{39}\u{b2}-\u{b3}\u{b9}\u{660}-\u{669}\u{6f0}-\u{6f9}\u{7c0}-\u{7c9}\u{966}-\u{96f}\u{9e6}-\u{9ef}\u{a66}-\u{a6f}\u{ae6}-\u{aef}\u{b66}-\u{b6f}\u{be6}-\u{bef}\u{c66}-\u{c6f}\u{ce6}-\u{cef}\u{d66}-\u{d6f}\u{de6}-\u{def}\u{e50}-\u{e59}\u{ed0}-\u{ed9}\u{f20}-\u{f29}\u{1040}-\u{1049}\u{1090}-\u{1099}\u{1369}-\u{1371}\u{17e0}-\u{17e9}\u{1810}-\u{1819}\u{1946}-\u{194f}\u{19d0}-\u{19da}\u{1a80}-\u{1a89}\u{1a90}-\u{1a99}\u{1b50}-\u{1b59}\u{1bb0}-\u{1bb9}\u{1c40}-\u{1c49}\u{1c50}-\u{1c59}\u{2070}\u{2074}-\u{2079}\u{2080}-\u{2089}\u{2460}-\u{2468}\u{2474}-\u{247c}\u{2488}-\u{2490}\u{24ea}\u{24f5}-\u{24fd}\u{24ff}\u{2776}-\u{277e}\u{2780}-\u{2788}\u{278a}-\u{2792}\u{a620}-\u{a629}\u{a8d0}-\u{a8d9}\u{a900}-\u{a909}\u{a9d0}-\u{a9d9}\u{a9f0}-\u{a9f9}\u{aa50}-\u{aa59}\u{abf0}-\u{abf9}\u{ff10}-\u{ff19}\u{104a0}-\u{104a9}\u{10a40}-\u{10a43}\u{10d30}-\u{10d39}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{11066}-\u{1106f}\u{110f0}-\u{110f9}\u{11136}-\u{1113f}\u{111d0}-\u{111d9}\u{112f0}-\u{112f9}\u{11450}-\u{11459}\u{114d0}-\u{114d9}\u{11650}-\u{11659}\u{116c0}-\u{116c9}\u{11730}-\u{11739}\u{118e0}-\u{118e9}\u{11950}-\u{11959}\u{11c50}-\u{11c59}\u{11d50}-\u{11d59}\u{11da0}-\u{11da9}\u{11f50}-\u{11f59}\u{16a60}-\u{16a69}\u{16ac0}-\u{16ac9}\u{16b50}-\u{16b59}\u{1d7ce}-\u{1d7ff}\u{1e140}-\u{1e149}\u{1e2f0}-\u{1e2f9}\u{1e4f0}-\u{1e4f9}\u{1e950}-\u{1e959}\u{1f100}-\u{1f10a}\u{1fbf0}-\u{1fbf9}]+$/u;
var isdigit = (s) => s.length > 0 && ISDIGIT.test(s);
var ND_ZEROS = [48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472, 43504, 43600, 44016, 65296, 66720, 68912, 69734, 69872, 69942, 70096, 70384, 70736, 70864, 71248, 71360, 71472, 71904, 72016, 72784, 73040, 73120, 73552, 92768, 92864, 93008, 120782, 120792, 120802, 120812, 120822, 123200, 123632, 124144, 125264, 130032];
function asciiDigits(s) {
  return s.replace(/\p{Nd}/gu, (ch) => {
    const c = ch.codePointAt(0);
    let z = 0;
    for (const x of ND_ZEROS) {
      if (x <= c) z = x;
      else break;
    }
    return String(c - z);
  });
}

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/fb-http.ts
var CookieJar = class {
  constructor() {
    this.c = [];
  }
  clear() {
    this.c = [];
  }
  add(url, lines) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    const host = u.hostname.toLowerCase(), now = Date.now() / 1e3;
    for (const line of lines) {
      const parts = line.split(";"), first = parts[0], eq = first.indexOf("=");
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim(), value = first.slice(eq + 1).trim();
      if (!name) continue;
      let domain = host, hostOnly = true, path2 = "", secure = false, exp = null, maxAge = null;
      for (const a of parts.slice(1)) {
        const i = a.indexOf("="), k = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase(), v = i < 0 ? "" : a.slice(i + 1).trim();
        if (k === "domain" && v) {
          const d = v.replace(/^\./, "").toLowerCase();
          if (d === host || host.endsWith("." + d)) {
            domain = d;
            hostOnly = false;
          } else {
            domain = "";
          }
        } else if (k === "path" && v.startsWith("/")) path2 = v;
        else if (k === "secure") secure = true;
        else if (k === "max-age" && /^-?\d+$/.test(v)) maxAge = Number(v);
        else if (k === "expires") {
          const t = Date.parse(v);
          if (!Number.isNaN(t)) exp = t / 1e3;
        }
      }
      if (!domain) continue;
      if (!hostOnly && !domain.includes(".")) continue;
      if (!path2) {
        const p = u.pathname, i = p.lastIndexOf("/");
        path2 = i <= 0 ? "/" : p.slice(0, i);
      }
      if (maxAge !== null) exp = now + maxAge;
      this.c = this.c.filter((x) => !(x.name === name && x.domain === domain && x.path === path2));
      if (exp !== null && exp <= now) continue;
      this.c.push({ name, value, domain, hostOnly, path: path2, secure, exp });
    }
  }
  header(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return "";
    }
    const host = u.hostname.toLowerCase(), now = Date.now() / 1e3, p = u.pathname || "/", https2 = u.protocol === "https:";
    this.c = this.c.filter((x) => x.exp === null || x.exp > now);
    const hit = this.c.filter((x) => (x.hostOnly ? host === x.domain : host === x.domain || host.endsWith("." + x.domain)) && (!x.secure || https2) && (p === x.path || p.startsWith(x.path) && (x.path.endsWith("/") || p[x.path.length] === "/")));
    hit.sort((a, b) => b.path.length - a.path.length);
    return hit.map((x) => x.name + "=" + x.value).join("; ");
  }
};
var JAR = new CookieJar();
var okHost = (h) => h === "facebook.com" || h.endsWith(".facebook.com");
var RT_B = /canonicalRouteName":"comet\.fbweb\.[A-Za-z0-9_]+"/;
var CFFI_KEEP = /* @__PURE__ */ new Set(["Cookie", "Referer", "Accept-Language", "Sec-Fetch-Site", "Sec-Fetch-Dest", "Content-Type", "Origin", "X-FB-Friendly-Name"]);
var REDIR = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
async function readHead(url, hdr2, timeout, proxy, cap = 45e4, data) {
  const cffi = impersonating();
  const explicit = hdr2.some(([k, v]) => k.toLowerCase() === "cookie" && v);
  const jar = explicit ? new CookieJar() : JAR;
  for (let hop = 0; hop < 6; hop++) {
    let h = cffi ? hdr2.filter(([k]) => CFFI_KEEP.has(k)) : hdr2.slice();
    if (!explicit) {
      const ck = jar.header(url);
      if (ck) h = [...h, ["Cookie", ck]];
    }
    const head = await open(url, { method: data !== void 0 ? "POST" : "GET", headers: h, body: data, timeout, proxy });
    jar.add(url, head.setCookies);
    const code = head.status;
    if (REDIR.has(code) && head.location && hop < 5) {
      head.close();
      const nxt = fixUrl(head.location, url);
      if (!okHost(hostnameOf(nxt) || "")) return [code, nxt, ""];
      url = nxt;
      continue;
    }
    const stop = (t) => RT_B.test(t.toString("latin1"));
    if (cffi) {
      const buf2 = await head.read(cap, code === 200 ? stop : void 0);
      return [code, url, cut(buf2.toString("utf8"), cap)];
    }
    if (code < 200 || code >= 300) {
      const buf2 = await head.read(6e3);
      return [code, url, buf2.toString("utf8")];
    }
    const buf = await head.read(cap, stop);
    return [code, url, buf.toString("utf8")];
  }
  return [310, url, ""];
}
async function warmGet(url, hdr2, timeout, proxy) {
  const explicit = hdr2.some(([k, v]) => k.toLowerCase() === "cookie" && v);
  try {
    let cur = url;
    for (let hop = 0; hop < 10; hop++) {
      let h = hdr2.slice();
      if (!explicit) {
        const ck = JAR.header(cur);
        if (ck) h = [...h, ["Cookie", ck]];
      }
      const head = await open(cur, { headers: h, timeout, proxy });
      JAR.add(cur, head.setCookies);
      if (REDIR.has(head.status) && head.location) {
        head.close();
        cur = new URL(head.location, cur).toString();
        continue;
      }
      await head.read(2048);
      return;
    }
  } catch {
  }
}

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/owl-postfb.ts
var TZ_OFF = 7 * 3600;
var WS2 = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var WS_L2 = new RegExp("^[" + WS2 + "]+");
var WS_R2 = new RegExp("[" + WS2 + "]+$");
var PW2 = "[\\p{L}\\p{N}_]";
var PYB2 = `(?:(?<=${PW2})(?!${PW2})|(?<!${PW2})(?=${PW2}))`;
var KEY_NUM = /^(?:0|[1-9]\d{0,9})$/;
var mkKey = (k) => KEY_NUM.test(k) && Number(k) < 4294967295 ? "" + k : k;
function jsonLoads(src) {
  let i = 0;
  const n = src.length;
  const fail = () => {
    throw new SyntaxError("JSON kh\xF4ng h\u1EE3p l\u1EC7 t\u1EA1i v\u1ECB tr\xED " + i);
  };
  const ws = () => {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const str = () => {
    const a = i++;
    for (; ; ) {
      if (i >= n) fail();
      const c = src.charCodeAt(i);
      if (c === 34) {
        i++;
        break;
      }
      if (c < 32) fail();
      i += c === 92 ? 2 : 1;
    }
    return JSON.parse(src.slice(a, i));
  };
  const NUM2 = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
  const val = () => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const o = /* @__PURE__ */ Object.create(null);
      ws();
      if (src[i] === "}") {
        i++;
        return o;
      }
      for (; ; ) {
        ws();
        if (src[i] !== '"') fail();
        const k = str();
        ws();
        if (src[i++] !== ":") fail();
        o[mkKey(k)] = val();
        ws();
        const d = src[i++];
        if (d === "}") return o;
        if (d !== ",") fail();
      }
    }
    if (c === "[") {
      i++;
      const a = [];
      ws();
      if (src[i] === "]") {
        i++;
        return a;
      }
      for (; ; ) {
        a.push(val());
        ws();
        const d = src[i++];
        if (d === "]") return a;
        if (d !== ",") fail();
      }
    }
    if (c === '"') return str();
    if (src.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (src.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (src.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (src.startsWith("NaN", i)) {
      i += 3;
      return NaN;
    }
    if (src.startsWith("Infinity", i)) {
      i += 8;
      return Infinity;
    }
    if (src.startsWith("-Infinity", i)) {
      i += 9;
      return -Infinity;
    }
    NUM2.lastIndex = i;
    const m = NUM2.exec(src);
    if (!m) fail();
    i = NUM2.lastIndex;
    const t = m[0], v = Number(t);
    return !m[1] && !m[2] && !Number.isSafeInteger(v) ? BigInt(t) : v;
  };
  const out = val();
  ws();
  if (i < n) fail();
  return out;
}
var SP = { Y: "(\\d\\d\\d\\d)", m: "(1[0-2]|0[1-9]|[1-9])", d: "(3[0-1]|[1-2]\\d|0[1-9]|[1-9]| [1-9])", H: "(2[0-3]|[0-1]\\d|\\d)", M: "([0-5]\\d|\\d)" };
var FORMATS = [
  ["%Y-%m-%dT%H:%M", new RegExp(`^${SP.Y}-${SP.m}-${SP.d}T${SP.H}:${SP.M}$`, "i")],
  ["%Y-%m-%d %H:%M", new RegExp(`^${SP.Y}-${SP.m}-${SP.d}\\s+${SP.H}:${SP.M}$`, "i")],
  ["%Y-%m-%d", new RegExp(`^${SP.Y}-${SP.m}-${SP.d}$`, "i")]
];

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/checker-fb.ts
var FB_JUNK = String.raw`^\s*(redirecting|đang chuyển hướng|log in|log into|login|sign up|sign in|đăng nhập|đăng ký|facebook\s*$|security check|kiểm tra bảo mật|` + String.raw`error\b|lỗi\b|page not found|content not found|something went wrong|you must log in|you're temporarily|bạn tạm thời|` + String.raw`this content isn|nội dung này hiện|this page isn|trang này hiện|oops|sorry|xin lỗi|checkpoint|connect with|kết nối với)|log in or sign up|đăng nhập hoặc đăng ký`;
var JUNK = pyRe(FB_JUNK, "i");
var FB_FIELDS = [{ k: "cookie", label: "Cookie", secret: true, ph: "T\xF9y ch\u1ECDn \xB7 gi\xFAp \u0111\u1ECDc t\xEAn \u1ED5n \u0111\u1ECBnh h\u01A1n" }, { k: "refresh", label: "\u0110\u1ECDc l\u1EA1i t\xEAn", ph: "Tr\u1ED1ng = ch\u1EC9 \u0111\u1ECDc \xF4 t\xEAn c\xF2n tr\u1ED1ng \xB7 1 = \u0111\u1ECDc l\u1EA1i t\u1EA5t c\u1EA3" }];
var FB_METAS = [
  {
    id: "fb",
    name: "Facebook",
    icon: "facebook",
    value: "UID Facebook",
    hint_tab: ["facebook", "fb", "via", "clone"],
    hint_field: ["uid", "id facebook", "id fb", "fb id", "id"],
    fields: FB_FIELDS,
    extra: [{ k: "name", label: "T\xEAn FB", type: "text", icon: "user", match: ["ten fb", "ten facebook", "ten tai khoan", "fb name", "ten", "name", "ho ten"], hint: "Profile: T\xEAn \xB7 Page: Page (T\xEAn) \xB7 ch\u1EC9 ghi khi Live", skip_filled: true, junk: FB_JUNK, stale: String.raw`\s\|\s` }],
    desc: "Graph picture: c\xF3 \u1EA3nh th\u1EADt = Live \xB7 \u1EA3nh tr\u1ED1ng (rsrc.php, kh\xF4ng c\xF3 height) = Die \xB7 b\u1ECB gi\u1EDBi h\u1EA1n / l\u1ED7i = gi\u1EEF nguy\xEAn. Live th\xEC m\u1EDF facebook.com/<uid> \u0111\u1ECDc t\xEAn.",
    threads: 5,
    timeout: 12
  },
  {
    id: "fbpage",
    name: "FB Page",
    icon: "flag",
    value: "UID Page",
    hint_tab: ["fb page", "fanpage", "page"],
    hint_field: ["uid page", "page id", "id page", "uid", "id"],
    fields: FB_FIELDS,
    extra: [{ k: "name", label: "T\xEAn Page", type: "text", icon: "flag", match: ["ten page", "ten fanpage", "ten trang", "page name", "ten", "name"], hint: "Page: T\xEAn \xB7 l\u1EABn profile: Profile (T\xEAn) \xB7 ch\u1EC9 ghi khi Live", skip_filled: true, junk: FB_JUNK, stale: String.raw`\s\|\s` }],
    desc: "Gi\u1ED1ng Facebook (Graph picture + \u0111\u1ECDc t\xEAn Page t\u1EEB facebook.com/<id> khi Live).",
    threads: 5,
    timeout: 12
  }
];
var Stopped = class extends Error {
  constructor() {
    super(...arguments);
    this.name = "Stopped";
  }
};
var hooks = { random: () => Math.random(), now: () => Date.now() / 1e3, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
var uniform = (a, b) => a + (b - a) * hooks.random();
var randrange = (n) => Math.floor(hooks.random() * n);
var stoppedOf = (opt) => Boolean(opt?.stopped?.());
async function nap(sec, opt) {
  const end = hooks.now() + sec;
  for (; ; ) {
    if (stoppedOf(opt)) throw new Stopped();
    const left = end - hooks.now();
    if (left <= 0) return;
    await hooks.sleep(Math.min(100, left * 1e3));
  }
}
var ename = (e) => e instanceof NetError ? e.kind : e instanceof PyError ? e.pyName : e instanceof Stopped ? "Stopped" : e instanceof Error ? e.name !== "Error" ? e.name : e.constructor.name : "Exception";
var tmo = (opt, d) => Number(opt.timeout) || d;
var proxyOf = (opt) => String(opt.proxy || "");
var cookieOf = (opt) => {
  const c = opt.x?.cookie;
  return strip(truthy(c) ? String(c) : "");
};
var fmtS = (f, nm) => f.replace("%s", () => nm);
var Gate = class {
  constructor(ivmin, cap, n) {
    this.ivmin = ivmin;
    this.cap = cap;
    this.n = n;
    this.f = 0;
    this.next = 0;
    this.act = 0;
    this.waiters = [];
  }
  slots(n) {
    this.n = n;
  }
  iv() {
    return Math.min(this.cap, this.ivmin * (1 + 10 * this.f));
  }
  async acquire(opt) {
    while (this.act >= this.n) {
      await new Promise((ok) => {
        let t;
        const done = () => {
          if (t) clearTimeout(t);
          const i = this.waiters.indexOf(done);
          if (i >= 0) this.waiters.splice(i, 1);
          ok();
        };
        t = setTimeout(done, 100);
        this.waiters.push(done);
      });
      if (this.act >= this.n && stoppedOf(opt)) throw new Stopped();
    }
    this.act++;
  }
  release() {
    this.act--;
    const w = this.waiters.shift();
    if (w) w();
  }
  async run(fn, opt) {
    await this.acquire(opt);
    try {
      if (stoppedOf(opt)) throw new Stopped();
      const now = hooks.now(), slot = Math.max(now, this.next);
      this.next = slot + this.iv();
      if (slot > now) await nap(slot - now, opt);
      return await fn();
    } finally {
      this.release();
    }
  }
  note(ok, hard = false) {
    this.f = this.f * 0.85 + (ok ? 0 : 0.15);
    if (hard) this.next = Math.max(this.next, hooks.now() + 2);
  }
};
var G_HTML = new Gate(0.2, 2.5, 4);
var G_PLG = new Gate(0.1, 1.5, 6);
var G_GQL = new Gate(0.1, 1.5, 6);
var ST = { warm: 0, gqlTry: 0, gqlDoc: "28585259111117102" };
function __reset() {
  for (const g of [G_HTML, G_PLG, G_GQL]) {
    g.f = 0;
    g.next = 0;
  }
  ST.warm = 0;
  ST.gqlTry = 0;
  ST.gqlDoc = "28585259111117102";
  JAR.clear();
}
function gateSlots(threads) {
  const t = Math.trunc(Number(truthy(threads) ? threads : 10)) || 10;
  G_HTML.slots(Math.max(2, Math.min(6, Math.trunc(t / 5))));
  G_PLG.slots(Math.max(2, Math.min(10, Math.trunc(t / 4))));
  G_GQL.slots(Math.max(2, Math.min(10, Math.trunc(t / 4))));
}
var CH = ['"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"', '"Chromium";v="123", "Microsoft Edge";v="123", "Not:A-Brand";v="8"'];
var PROF = [
  // bộ header ĐỒNG BỘ theo từng trình duyệt (UA khớp sec-ch-ua / sec-fetch-*) — Facebook chặn 400 khi UA nói Chrome mà thiếu/lệch header đi kèm
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", CH[0]],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", ""],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0", CH[1]]
];
function hdr(opt, variant = 0, plugin = false) {
  const [ua, ch] = PROF[(randrange(PROF.length) + variant) % PROF.length];
  const h = /* @__PURE__ */ new Map();
  if (ch) {
    h.set("sec-ch-ua", ch);
    h.set("sec-ch-ua-mobile", "?0");
    h.set("sec-ch-ua-platform", '"Windows"');
  }
  h.set("Upgrade-Insecure-Requests", "1");
  h.set("User-Agent", ua);
  h.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
  h.set("Sec-Fetch-Site", plugin ? "cross-site" : "none");
  h.set("Sec-Fetch-Mode", "navigate");
  h.set("Sec-Fetch-Dest", plugin ? "iframe" : "document");
  h.set("Accept-Encoding", "gzip");
  h.set("Accept-Language", "en-US,en;q=0.9");
  if (!plugin) h.set("Sec-Fetch-User", "?1");
  else h.set("Referer", "https://developers.facebook.com/");
  const ck = cookieOf(opt);
  if (ck) h.set("Cookie", ck);
  return h;
}
var rh = (h) => [...h];
var UAS = PROF.map((p) => p[0]);
var RATE = /* @__PURE__ */ new Set([4, 17, 32, 341, 613]);
var isDict = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var dget = (d, k) => Object.prototype.hasOwnProperty.call(d, k) ? d[k] : void 0;
var pyStr = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "None" : typeof v === "boolean" ? v ? "True" : "False" : typeof v === "object" ? JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x) : String(v);
var inRate = (v) => {
  if (typeof v === "object" && v !== null) throw new PyError("TypeError", "unhashable type");
  return typeof v === "number" && RATE.has(v) || typeof v === "bigint" && RATE.has(Number(v));
};
async function graph(uid, opt) {
  let url = `https://graph.facebook.com/${uid}/picture?redirect=false&type=normal`;
  const h = [["User-Agent", UAS[randrange(UAS.length)]], ["Accept", "application/json"]];
  let code = 0, body = Buffer.alloc(0);
  for (let hop = 0; ; hop++) {
    const head = await open(url, { headers: h, timeout: tmo(opt, 10), proxy: proxyOf(opt) });
    if ([301, 302, 303, 307, 308].includes(head.status) && head.location) {
      head.close();
      if (hop >= 10) throw new NetError("HTTPError");
      url = new URL(head.location.replace(/ /g, "%20"), url).toString();
      continue;
    }
    code = head.status;
    body = await head.read(2e4);
    break;
  }
  let j;
  try {
    j = jsonLoads(body.toString("utf8") || "{}");
  } catch {
    j = {};
  }
  const err = isDict(j) ? dget(j, "error") : void 0;
  if (truthy(err)) {
    if (!isDict(err)) throw new PyError("AttributeError", "'" + (Array.isArray(err) ? "list" : typeof err === "string" ? "str" : "int") + "' object has no attribute 'get'");
    const ec = dget(err, "code");
    if (inRate(ec) || code === 429 || code === 403) return [null, "Facebook gi\u1EDBi h\u1EA1n t\u1ED1c \u0111\u1ED9 (gi\u1EA3m lu\u1ED3ng / d\xF9ng proxy)"];
    if (code === 400 || code === 404) return ["die", "Die \xB7 UID kh\xF4ng t\u1ED3n t\u1EA1i"];
    return [null, "l\u1ED7i Graph " + pyStr(ec)];
  }
  const d = isDict(j) ? dget(j, "data") : void 0;
  if (code === 200 && isDict(d)) {
    const u = truthy(dget(d, "url")) ? pyStr(dget(d, "url")) : "";
    if (truthy(dget(d, "height")) || u && !u.includes("rsrc.php")) return ["live", "Live"];
    if (u.includes("rsrc.php")) return ["die", "Die \xB7 kh\xF4ng kh\u1EA3 d\u1EE5ng"];
  }
  if (code === 400 || code === 404) return ["die", "Die \xB7 " + code];
  return [null, "HTTP " + code];
}
var UID_RE = pyRe("(\\d{5,20})");
function norm(value) {
  const m = UID_RE.exec(truthy(value) ? String(value) : "");
  return m ? m[1] : "";
}
var RT = pyRe('canonicalRouteName":"comet\\.fbweb\\.(\\w+)"');
var GENERIC = /* @__PURE__ */ new Set([
  "redirecting...",
  "redirecting\u2026",
  "redirecting",
  "\u0111ang chuy\u1EC3n h\u01B0\u1EDBng...",
  "facebook",
  "log in to facebook",
  "log into facebook",
  "\u0111\u0103ng nh\u1EADp facebook",
  "\u0111\u0103ng nh\u1EADp ho\u1EB7c \u0111\u0103ng k\xFD",
  "facebook - log in or sign up",
  "facebook \u2013 log in or sign up",
  "error",
  "l\u1ED7i",
  "security check",
  "page not found",
  "content not found",
  "n\u1ED9i dung n\xE0y hi\u1EC7n kh\xF4ng kh\u1EA3 d\u1EE5ng",
  "this content isn't available right now"
]);
var GOOD_RT = /^Comet(Profile|Page)/;
var META_TAG = pyRe("<meta\\b[^>]*>", "g");
var CONTENT = pyRe('content="([^"]*)"');
var metaRe = /* @__PURE__ */ new Map();
function meta(html, prop) {
  let re = metaRe.get(prop);
  if (!re) {
    re = pyRe('(?:property|name)="' + reEscape(prop) + '"');
    metaRe.set(prop, re);
  }
  META_TAG.lastIndex = 0;
  const head = cut(html, 6e4);
  for (let m = META_TAG.exec(head); m; m = META_TAG.exec(head)) {
    const t = m[0];
    if (re.test(t)) {
      const c = CONTENT.exec(t);
      if (c) return strip(htmlUnescape(c[1]));
    }
    if (m[0].length === 0) META_TAG.lastIndex++;
  }
  return "";
}
function route(html) {
  const m = RT.exec(html);
  return m ? m[1] : "";
}
var LOC = pyRe("^(.*\\S)\\s+\\|\\s+([^|]+?)\\s*$");
function stripLoc(nm, desc) {
  const m = LOC.exec(nm);
  if (!m) return nm;
  if (strip(desc || "").startsWith(nm)) return nm;
  return strip(m[1]);
}
var PLG_A = pyRe('<a\\b[^>]*class="[^"]*\\b_1drp\\b[^"]*"[^>]*>([^<]*)</a>');
var PLG_T = pyRe('\\btitle="([^"]*)"');
var PN = pyRe('"pageName":"((?:[^"\\\\]|\\\\.)*)"');
function parsePlugin2(html) {
  let nm, pg;
  const m = PLG_A.exec(html);
  if (m) {
    const t = PLG_T.exec(m[0]);
    nm = strip(htmlUnescape(truthy(t ? t[1] : m[1]) ? t ? t[1] : m[1] : ""));
    pg = true;
  } else {
    const p = PN.exec(html);
    if (!p) return ["", false];
    try {
      nm = strip(JSON.parse('"' + p[1] + '"'));
    } catch {
      return ["", false];
    }
    pg = false;
  }
  if (!nm || GENERIC.has(nm.toLowerCase()) || JUNK.test(nm)) return ["", pg];
  return [nm, pg];
}
var TITLE_RE = pyRe("<title[^>]*>([^<]*)</title>", "i");
var FB_TAIL = pyRe("\\s*[|\\-\u2013]\\s*Facebook\\s*$");
function parseHtml(html, uid) {
  const head = cut(html, 6e4);
  let nm = meta(html, "og:title");
  if (!nm) {
    const t = TITLE_RE.exec(head);
    nm = t ? strip(htmlUnescape(t[1])) : "";
  }
  nm = strip(nm.replace(FB_TAIL, ""));
  nm = stripLoc(nm, meta(html, "og:description"));
  if (!nm || GENERIC.has(nm.toLowerCase()) || JUNK.test(nm)) return ["", "", "ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (trang \u0111\u0103ng nh\u1EADp / b\u1ECB ch\u1EB7n)"];
  if (!head.includes(uid)) return ["", "", "ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (trang kh\xF4ng kh\u1EDBp UID)"];
  const rt = route(html);
  if (!GOOD_RT.test(rt)) return ["", "", "ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (" + (rt || "trang ch\u01B0a t\u1EA3i \u0111\u1EE7") + ")"];
  return [nm, rt.startsWith("CometPage") ? "page" : rt.includes("ProfilePlus") ? "plus" : "profile", ""];
}
function parseName(html, uid, fmt = ["Page (%s)", "%s"]) {
  const [nm, kind, why] = parseHtml(html, uid);
  if (!nm) return ["", why];
  if (kind === "plus") return ["", "ch\u01B0a ph\xE2n bi\u1EC7t Page / profile"];
  return [fmtS(kind === "page" ? fmt[0] : fmt[1], nm), ""];
}
function classify(uid, st, fu, html, fmt = ["Page (%s)", "%s"]) {
  const path2 = pathOf(fu || "").toLowerCase();
  if (st === 404) return ["die", "404", ""];
  if (st === 401 || st === 403 || st === 429 || st >= 500) return ["error", `HTTP ${st} (b\u1ECB ch\u1EB7n / l\u1ED7i Facebook)`, ""];
  if (path2.startsWith("/login") || path2.startsWith("/checkpoint") || path2.startsWith("/recover")) return ["error", "b\u1ECB \u0111\u1EA9y v\u1EC1 \u0111\u0103ng nh\u1EADp (th\u1EED proxy / cookie)", ""];
  const [nm] = parseName(html, uid, fmt);
  if (nm) return ["live", "Live", nm];
  const rt = route(html);
  if (rt.startsWith("CometProfilePlus")) return ["live", "Live", ""];
  if (rt === "CometErrorRoute") return ["die", "Die \xB7 n\u1ED9i dung kh\xF4ng kh\u1EA3 d\u1EE5ng", ""];
  if (!rt) return ["error", "ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c trang (b\u1ECB ch\u1EB7n / ch\u01B0a t\u1EA3i \u0111\u1EE7)", ""];
  return ["error", `ch\u01B0a x\xE1c \u0111\u1ECBnh (${rt})`, ""];
}
var wwwUrl = (uid) => `https://www.facebook.com/${uid}`;
var fetchHtml = (uid, opt, variant = 0) => readHead(wwwUrl(uid), rh(hdr(opt, variant)), tmo(opt, 10) + 5, proxyOf(opt));
var fetchGated = (uid, opt, variant = 0) => G_HTML.run(() => fetchHtml(uid, opt, variant), opt);
var pluginUrl = (uid) => "https://www.facebook.com/plugins/page.php?href=" + quote("https://www.facebook.com/" + uid, "") + "&tabs=&width=340&height=130&small_header=true";
var fetchPlugin = (uid, opt, variant = 0) => G_PLG.run(() => readHead(pluginUrl(uid), rh(hdr(opt, variant, true)), tmo(opt, 10) + 5, proxyOf(opt), 12e4), opt);
async function warm(opt) {
  if (hooks.now() - ST.warm < 1200 || truthy(opt.x?.cookie)) return;
  ST.warm = hooks.now();
  await warmGet("https://www.facebook.com/", rh(hdr(opt)), 10, proxyOf(opt));
}
var GQL_URL = "https://www.facebook.com/api/graphql/";
var GQL_NAME = "ProfilePlusCometLoggedOutRootQuery";
var KIND_WORDS = {
  page: /* @__PURE__ */ new Set(["page", "trang", "p\xE1gina", "pagina", "seite", "halaman", "\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430"]),
  profile: /* @__PURE__ */ new Set(["profile", "trang c\xE1 nh\xE2n", "perfil", "profil", "profilo", "profiel", "\u043F\u0440\u043E\u0444\u0438\u043B\u044C"])
};
var CAT = pyRe('InfluencerCategoryContextItemRenderer.{0,1500}?"text":"((?:[^"\\\\]|\\\\.)*)"', "s");
function parseGql(body) {
  const m = CAT.exec(body || "");
  if (!m) return [null, ""];
  let t;
  try {
    t = JSON.parse('"' + m[1] + '"');
  } catch {
    t = m[1];
  }
  const first = strip(t.split("\xB7")[0]).toLowerCase();
  for (const [k, ws] of Object.entries(KIND_WORDS)) if (ws.has(first)) return [k, t];
  return [null, t];
}
function gqlBody(uid, doc) {
  return urlencode([
    ["av", "0"],
    ["__a", "1"],
    ["__comet_req", "15"],
    ["fb_api_caller_class", "RelayModern"],
    ["fb_api_req_friendly_name", GQL_NAME],
    ["variables", jsonDumps({ scale: 1, userID: uid, __relay_internal__pv__ProfileCometFeaturedHighlightsPortraitAspectRatioGKrelayprovider: false }, true)],
    ["server_timestamps", "true"],
    ["doc_id", doc]
  ]);
}
var JS_URL = pyRe(`https:\\\\?/\\\\?/static\\.xx\\.fbcdn\\.net\\\\?/rsrc\\.php\\\\?/[^"'\\s\\\\]+?\\.js`, "g");
var DOC_RE = pyRe('__d\\("' + GQL_NAME + '_facebookRelayOperation",\\[\\],\\(function\\([^)]*\\)\\{[a-z]\\.exports="(\\d+)"');
async function gqlDiscover(uid, opt) {
  if (hooks.now() - ST.gqlTry < 600) return false;
  ST.gqlTry = hooks.now();
  try {
    const [, , html] = await readHead(wwwUrl(uid), rh(hdr(opt)), tmo(opt, 10) + 8, proxyOf(opt), 45e4);
    const urls = [];
    JS_URL.lastIndex = 0;
    for (let m = JS_URL.exec(html); m; m = JS_URL.exec(html)) {
      const u = m[0].replace(/\\\//g, "/").replace(/\\/g, "");
      if (!urls.includes(u)) urls.push(u);
    }
    for (const u of urls.slice(0, 14)) {
      const h2 = hdr(opt);
      h2.set("Accept", "*/*");
      const [, , js] = await readHead(u, rh(h2), 20, proxyOf(opt), 6e6);
      const m = DOC_RE.exec(js);
      if (m) {
        ST.gqlDoc = m[1];
        return true;
      }
    }
  } catch {
  }
  return false;
}
async function fetchGql(uid, opt, variant = 0) {
  const go = () => {
    const h = hdr(opt, variant);
    for (const [k, v] of [["Accept", "*/*"], ["Content-Type", "application/x-www-form-urlencoded"], ["Origin", "https://www.facebook.com"], ["Referer", "https://www.facebook.com/"], ["Sec-Fetch-Site", "same-origin"], ["Sec-Fetch-Mode", "cors"], ["Sec-Fetch-Dest", "empty"], ["X-FB-Friendly-Name", GQL_NAME]]) h.set(k, v);
    h.delete("Upgrade-Insecure-Requests");
    h.delete("Sec-Fetch-User");
    return readHead(GQL_URL, rh(h), tmo(opt, 10) + 5, proxyOf(opt), 16e3, gqlBody(uid, ST.gqlDoc));
  };
  const [st, , body] = await G_GQL.run(go, opt);
  if (st === 200) {
    const [k, t] = parseGql(body);
    G_GQL.note(true);
    if (k) return [k, t, ""];
    if (cut(body, 400).includes('"errors"') || !cut(body, 20).includes("data")) {
      if (await gqlDiscover(uid, opt)) return [null, "", "doc_id \u0111\xE3 \u0111\u1ED5i (\u0111\xE3 d\xF2 l\u1EA1i)"];
    }
    return [null, t, "kh\xF4ng th\u1EA5y d\xF2ng Page / Profile"];
  }
  G_GQL.note(false, st === 429);
  return [null, "", `gql HTTP ${st}`];
}
var REFRESH = pyRe(`http-equiv="refresh"[^>]*content="\\d+;\\s*url=([^"]+)"|(?:location\\.(?:replace|assign)\\(|location(?:\\.href)?\\s*=\\s*)["']([^"']+)["']`, "i");
async function readName(uid, opt, fmt = ["Page (%s)", "%s"]) {
  let q = opt.name_src === "plugin" ? ["plugin", "plugin", "html", "html"] : ["html", "html", "gql", "plugin", "gql", "plugin"];
  let last = "ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn";
  let hnm = "", hk = "";
  let pnm = "", ppage = false;
  let gk = null;
  let prog = true;
  const tagged = fmt[0] !== fmt[1];
  const decide = () => {
    const nm = pnm && (ppage || gk === "page" || hk === "page") ? pnm : hnm || pnm;
    if (!nm) return "";
    if (!tagged) return fmtS(fmt[0], nm);
    const kind = hk === "page" || hk === "profile" ? hk : gk || (ppage ? "page" : "");
    if (kind === "page") return fmtS(fmt[0], nm);
    if (kind === "profile") return fmtS(fmt[1], nm);
    return "";
  };
  const needKind = () => tagged && hk !== "page" && hk !== "profile" && gk === null && !ppage;
  let n = 0;
  while (q.length) {
    const src = q.shift();
    if (src === "plugin" && pnm || src === "html" && hnm || src === "gql" && !needKind()) continue;
    if (n && !prog) await nap([0.3, 0.8, 1.5][Math.min(n - 1, 2)] + hooks.random() * 0.4, opt);
    const i = n;
    n++;
    const snap = [hnm, gk, pnm];
    try {
      if (src === "gql") {
        const [k, , why] = await fetchGql(uid, opt, i);
        if (k) gk = k;
        else last = `ch\u01B0a ph\xE2n bi\u1EC7t \u0111\u01B0\u1EE3c Page / profile (${why})`;
      } else if (src === "plugin") {
        const [st, , html] = await fetchPlugin(uid, opt, i);
        if (st === 200) {
          G_PLG.note(true);
          [pnm, ppage] = parsePlugin2(html);
          if (!pnm) last = "ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (plugin kh\xF4ng c\xF3 t\xEAn)";
        } else {
          G_PLG.note(false, st === 429);
          last = `ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (plugin HTTP ${st})`;
        }
      } else {
        let [st, fu, html] = await fetchGated(uid, opt, i);
        for (let hop = 0; hop < 2; hop++) {
          const m = html.length < 6e4 || plen(html) < 6e4 || cut(html, 3e3).toLowerCase().includes("redirecting") ? REFRESH.exec(cut(html, 2e4)) : null;
          if (!m) break;
          const nxt = fixUrl(htmlUnescape(truthy(m[1]) ? m[1] : m[2]).replace(/\\\//g, "/"), fu);
          if (!okHost(hostnameOf(nxt) || "") || nxt.includes("login")) break;
          [st, fu, html] = await readHead(nxt, rh(hdr(opt, i)), tmo(opt, 10) + 5, proxyOf(opt));
        }
        const pth = pathOf(fu).toLowerCase();
        if (st === 200 && !(pth.startsWith("/login") || pth.startsWith("/checkpoint"))) {
          const [nm, kind, why] = parseHtml(html, uid);
          if (nm) {
            hnm = nm;
            hk = kind;
            G_HTML.note(true);
          } else {
            last = why;
            G_HTML.note(false);
          }
        } else {
          last = `ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (HTTP ${st})`;
          G_HTML.note(false, st === 429);
        }
      }
    } catch (e) {
      if (e instanceof Stopped) throw e;
      (src === "plugin" ? G_PLG : G_HTML).note(false);
      last = `ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c t\xEAn (${ename(e)})`;
    }
    prog = hnm !== snap[0] || gk !== snap[1] || pnm !== snap[2];
    const d = decide();
    if (d) return [d, ""];
    if (src === "html" && hnm && needKind()) q = ["gql", "gql", "plugin"];
    else if (src === "plugin" && pnm && needKind()) q = ["gql", "gql", "html"];
    else if (src === "gql" && gk && !(hnm || pnm)) q = ["plugin", "plugin", "html"];
  }
  if (!impersonating() && last.includes("400")) last += " \xB7 c\xE0i impit: npm i impit";
  return ["", last];
}
var REFRESH_YES = /* @__PURE__ */ new Set(["1", "x", "true", "c\xF3", "co"]);
async function fbCheck(value, opt) {
  try {
    return await fbCheckNow(value, opt);
  } catch (e) {
    if (e instanceof Stopped) return { res: "error", info: "\u0110\xE3 d\u1EEBng" };
    throw e;
  }
}
async function fbCheckNow(value, opt) {
  const uid = norm(value);
  if (!uid) return { res: "error", info: "UID kh\xF4ng h\u1EE3p l\u1EC7" };
  const fmt = opt.fmt || [opt.page_tag ?? true ? "Page (%s)" : "%s", "%s"];
  const want = (opt.xon ?? ["name"]).includes("name");
  let res = null, info = "";
  for (let i = 0; i < 2; i++) {
    await nap(uniform(0.02, 0.15), opt);
    try {
      [res, info] = await graph(uid, opt);
    } catch (e) {
      res = null;
      info = ename(e);
    }
    if (res) break;
    if (i === 0) await nap(0.5, opt);
  }
  if (!res) {
    let r2, i2, nm2;
    try {
      const [st, fu, html] = await fetchGated(uid, opt);
      [r2, i2, nm2] = classify(uid, st, fu, html, fmt);
    } catch (e) {
      return { res: "error", info: info || ename(e) };
    }
    if (r2 === "error") return { res: "error", info: info ? `${info} \xB7 ${i2}` : i2 };
    return r2 === "live" && want && nm2 ? { res: r2, info: i2, extra: { name: nm2 } } : { res: r2, info: i2 };
  }
  if (res === "die" || !want) return { res, info };
  const have = strip(String(opt.have?.name ?? ""));
  if (have && !JUNK.test(have) && !REFRESH_YES.has(strip(String(opt.x?.refresh ?? "")).toLowerCase()))
    return { res: "live", info: "Live \xB7 \u0111\xE3 c\xF3 t\xEAn" };
  gateSlots(opt.threads);
  await warm(opt);
  const [nm, why] = await readName(uid, opt, fmt);
  return nm ? { res: "live", info: `Live \xB7 ${nm}`, extra: { name: nm } } : { res: "live", info: `Live \xB7 ${why}` };
}
var fbMod = { CHECKER: FB_METAS[0], check: (value, opt) => fbCheck(value, opt) };
var fbpageMod = { CHECKER: FB_METAS[1], check: (value, opt) => fbCheck(value, { ...opt, fmt: ["%s", "Profile (%s)"], name_src: "plugin" }) };
var __t = { graph, norm, parseName, parseHtml, parsePlugin2, parseGql, classify, readName, route, meta, stripLoc, gateSlots, reset: __reset, gqlBody, pluginUrl, ST, hdr, rh, fetchGql, gqlDiscover, G_HTML, G_PLG, G_GQL };

// ../../../../../../home/claude/hirex/moduleHS/accountshs/server/checker-fbpost.ts
var checker_fbpost_exports = {};
__export(checker_fbpost_exports, {
  FBPOST_META: () => FBPOST_META,
  __t: () => __t2,
  classify: () => classify2,
  comments: () => comments,
  count: () => count,
  fbpostCheck: () => fbpostCheck,
  fbpostMod: () => fbpostMod,
  norm: () => norm2
});
var import_server_only2 = __toESM(require_empty());
var FBPOST_META = {
  id: "fbpost",
  name: "B\xE0i \u0111\u0103ng FB",
  icon: "note",
  value: "UID b\xE0i vi\u1EBFt",
  hint_tab: ["bai dang fb", "bai dang", "post fb", "fb post", "bai viet"],
  hint_field: ["uid bai viet", "uid bai dang", "post id", "id bai viet", "uid", "link bai viet", "link"],
  fields: [{ k: "cookie", label: "Cookie", secret: true, ph: "T\xF9y ch\u1ECDn \xB7 gi\xFAp \u0111\u1ECDc b\xE0i \u1ED5n \u0111\u1ECBnh h\u01A1n" }],
  // số liệu đọc thêm khi bài LIVE → ghi vào 1 cột của tab (Vọng gác tự tìm / tự tạo cột)
  extra: [{ k: "comments", label: "S\u1ED1 b\xECnh lu\u1EADn", type: "number", icon: "chat", match: ["so binh luan", "binh luan", "so comment", "comment", "comments", "so cmt", "cmt"], hint: "Ghi khi b\xE0i Live" }],
  threads: 5,
  timeout: 15
};
var UAS2 = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
];
var CHROME_CH = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
var DIE_CODES = ["1357031", "1357004", "1357001", "1357002", "1357033"];
var NORM_A = pyRe("(?:story_fbid=|fbid=|posts/|videos/|permalink/|reel/|/)(\\d{6,})");
var NORM_B = pyRe("\\d{6,}");
function norm2(value) {
  const s = strip(truthy(value) ? String(value) : "");
  if (!s) return "";
  if (isdigit(s)) return s;
  let m = NORM_A.exec(s);
  if (m) return m[1];
  m = NORM_B.exec(s);
  return m ? m[0] : "";
}
var RE_OGURL = pyRe('<meta[^>]+property="og:url"[^>]+content="([^"]+)"');
var RE_OGTYPE = pyRe('<meta[^>]+property="og:type"[^>]+content="([^"]+)"');
var RE_OGTITLE = pyRe('<meta[^>]+property="og:title"');
var RE_TITLE = pyRe("<title[^>]*>(.*?)</title>", "si");
var RE_NOTITLE = pyRe('property="og:title"');
var DIE_RE = DIE_CODES.map((c) => pyRe('"error"\\s*:\\s*' + c));
function classify2(uid, status, finalUrl, html) {
  const u = (finalUrl || "").toLowerCase();
  if (status === 404) return ["die", "HTTP 404"];
  if (status === 429 || status === 403) return ["error", `B\u1ECB ch\u1EB7n HTTP ${status} (gi\u1EA3m lu\u1ED3ng / \u0111\u1ED5i proxy)`];
  if (u.includes("/login") || u.includes("checkpoint") || u.includes("login.php")) return ["error", "B\u1ECB chuy\u1EC3n v\u1EC1 login/checkpoint"];
  const path2 = pathOf(finalUrl || "").replace(/\/+$/, "");
  if ((finalUrl || "").includes(uid) && path2 !== "/" + uid) return ["live", "Chuy\u1EC3n h\u01B0\u1EDBng v\u1EC1 URL b\xE0i vi\u1EBFt"];
  if (status >= 500) return ["error", `L\u1ED7i server HTTP ${status}`];
  for (let i = 0; i < DIE_CODES.length; i++) {
    const code = DIE_CODES[i];
    if (DIE_RE[i].test(html) || html.includes(`error_code":${code}`)) return ["die", `M\xE3 l\u1ED7i FB ${code}`];
  }
  if (pyRe('"(?:story_fbid|top_level_post_id|post_id|video_id)"\\s*:\\s*"?' + reEscape(uid)).test(html)) return ["live", "C\xF3 post_id/story_fbid"];
  let m = RE_OGURL.exec(html);
  if (m && m[1].includes(uid)) return ["live", "og:url ch\u1EE9a UID"];
  m = RE_OGTYPE.exec(html);
  if (m && ["article", "video.other", "video.movie", "website"].includes(m[1]) && RE_OGTITLE.test(html) && html.includes(uid)) return ["live", `og:type=${m[1]}`];
  if (status === 200 && !RE_NOTITLE.test(html) && !html.includes(uid)) return ["die", "Trang kh\xF4ng c\xF3 d\u1EEF li\u1EC7u b\xE0i vi\u1EBFt"];
  const t = RE_TITLE.exec(html);
  const title = t ? cut(strip(t[1]), 50) : "";
  if (status === 200 && path2 === "/" + uid && title.toLowerCase() === "facebook") return ["die", "Trang chung 'Facebook'"];
  return ["error", `Kh\xF4ng x\xE1c \u0111\u1ECBnh (HTTP ${status})`];
}
var NUM = "([\\d.,]+\\s?[KkMm]?)";
var CMT = [
  '"comment_count"\\s*:\\s*\\{\\s*"total_count"\\s*:\\s*(\\d+)',
  '"comment_rendering_instance"\\s*:\\s*\\{\\s*"comments"\\s*:\\s*\\{\\s*"total_count"\\s*:\\s*(\\d+)',
  '"comments"\\s*:\\s*\\{\\s*"total_count"\\s*:\\s*(\\d+)',
  '"total_comment_count"\\s*:\\s*(\\d+)',
  '"comment_total_count"\\s*:\\s*(\\d+)',
  '"i18n_comment_count"\\s*:\\s*"' + NUM + '"',
  '"commentCount"\\s*:\\s*"?(\\d+)',
  'CommentAction"[^}]{0,120}?"userInteractionCount"\\s*:\\s*"?(\\d+)',
  '"text"\\s*:\\s*"' + NUM + '\\s+(?:comments?|b\xECnh lu\u1EADn)"',
  ">" + NUM + "\\s+(?:comments?|b\xECnh lu\u1EADn)<"
].map((p) => pyRe(p, "gs"));
function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}
var FLOAT_OK = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function count(s0) {
  const s = strip(String(s0)).replace(/ /g, "");
  if (!s) return null;
  const last = s[s.length - 1];
  if ("KkMm".includes(last)) {
    const t = strip(asciiDigits(s.slice(0, -1).replace(/,/g, ".")));
    if (!FLOAT_OK.test(t)) return null;
    const f = parseFloat(t) * ("Kk".includes(last) ? 1e3 : 1e6);
    if (!Number.isFinite(f)) throw new PyError("OverflowError", "cannot convert float infinity to integer");
    return BigInt(pyRound(f));
  }
  const d = s.replace(/[.,]/g, "");
  if (!isdigit(d)) return null;
  if (!/^\p{Nd}+$/u.test(d)) throw new PyError("ValueError", "invalid literal for int()");
  return BigInt(asciiDigits(d));
}
var SCRIPT_JSON = pyRe('<script[^>]*type="application/json"[^>]*>(.*?)</script>', "gs");
function cmtListed(html) {
  const seen = /* @__PURE__ */ new Set();
  SCRIPT_JSON.lastIndex = 0;
  for (let m = SCRIPT_JSON.exec(html); m; m = SCRIPT_JSON.exec(html)) {
    const blob = m[1];
    if (!blob.includes('"Comment"')) continue;
    let root;
    try {
      root = jsonLoads(blob);
    } catch {
      continue;
    }
    const st = [root];
    while (st.length) {
      const o = st.pop();
      if (Array.isArray(o)) {
        for (const x of o) st.push(x);
      } else if (typeof o === "object" && o !== null) {
        const d = o;
        const au = d.author;
        if (d.__typename === "Comment" && typeof au === "object" && au !== null && !Array.isArray(au)) {
          const cid = truthy(d.legacy_fbid) ? String(d.legacy_fbid) : truthy(d.id) ? String(d.id) : "";
          if (cid) seen.add(cid);
        }
        for (const x of Object.values(d)) st.push(x);
      }
    }
  }
  return seen.size;
}
function comments(html, uid) {
  const astral = /[\ud800-\udbff]/.test(html);
  let pre = null;
  const cp = (i) => {
    if (!astral) return i;
    if (!pre) {
      pre = new Int32Array(html.length + 1);
      for (let k2 = 0; k2 < html.length; k2++) pre[k2 + 1] = pre[k2] + (html.charCodeAt(k2) >= 55296 && html.charCodeAt(k2) < 56320 ? 1 : 0);
    }
    return i - pre[i];
  };
  const ai = html.indexOf(uid), anchor = ai < 0 ? -1 : cp(ai);
  let zero = false, n = null;
  for (const pat of CMT) {
    pat.lastIndex = 0;
    const found = [];
    for (let m = pat.exec(html); m; m = pat.exec(html)) {
      const v = count(m[1]);
      if (v !== null) found.push([cp(m.index), v]);
      if (m[0].length === 0) pat.lastIndex++;
    }
    if (!found.length) continue;
    const pos = found.filter(([, v]) => v > BigInt(0));
    if (pos.length) {
      if (anchor >= 0) pos.sort((a, b) => Math.abs(a[0] - anchor) - Math.abs(b[0] - anchor));
      n = pos[0][1];
      break;
    }
    zero = true;
  }
  if (n === null && zero) n = BigInt(0);
  const k = cmtListed(html);
  if (n === null && !k) return null;
  const big = n !== null && n > BigInt(k) ? n : BigInt(k);
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}
async function getPage(url, hdr2, timeout, proxy) {
  const cffi = impersonating();
  const r = await request(url, { headers: cffi ? hdr2.filter(([k]) => k.toLowerCase() !== "user-agent") : hdr2, timeout, proxy });
  let text = r.text;
  if (!cffi && r.status >= 300 && text.length > 5e5) text = cut(text, 5e5);
  if (!cffi && text.length > 1e6 && Buffer.byteLength(text) > 2e6) text = Buffer.from(text).subarray(0, 2e6).toString("utf8");
  return [r.status, r.url, text];
}
var ename2 = (e) => e instanceof NetError ? e.kind : e instanceof PyError ? e.pyName : e instanceof Error ? e.name !== "Error" ? e.name : e.constructor.name : "Exception";
async function fbpostCheck(value, opt) {
  const uid = norm2(value);
  if (!uid) return { res: "error", info: "UID b\xE0i vi\u1EBFt kh\xF4ng h\u1EE3p l\u1EC7" };
  const ua = UAS2[Math.floor(hooks.random() * UAS2.length)];
  const hdr2 = impersonating() ? [
    ["User-Agent", ua],
    ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
    ["Accept-Language", "en-US,en;q=0.9"],
    // ép tiếng Anh để HTML ổn định
    ["Upgrade-Insecure-Requests", "1"]
  ] : [
    ["sec-ch-ua", CHROME_CH],
    ["sec-ch-ua-mobile", "?0"],
    ["sec-ch-ua-platform", '"Windows"'],
    ["Upgrade-Insecure-Requests", "1"],
    ["User-Agent", UAS2[0]],
    ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"],
    ["Sec-Fetch-Site", "none"],
    ["Sec-Fetch-Mode", "navigate"],
    ["Sec-Fetch-User", "?1"],
    ["Sec-Fetch-Dest", "document"],
    ["Accept-Encoding", "gzip, deflate, br"],
    ["Accept-Language", "en-US,en;q=0.9"]
  ];
  const ck = strip(truthy(opt.x?.cookie) ? String(opt.x?.cookie) : "");
  if (ck) hdr2.push(["Cookie", ck]);
  const timeout = Number(opt.timeout) || 15;
  let last = { res: "error", info: "L\u1ED7i k\u1EBFt n\u1ED1i" };
  const wait = async (sec) => {
    const end = hooks.now() + sec;
    while (hooks.now() < end) {
      if (opt.stopped?.()) throw new Stopped();
      await hooks.sleep(Math.min(100, (end - hooks.now()) * 1e3));
    }
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (opt.stopped?.()) throw new Stopped();
      try {
        const [st, fu, html] = await getPage(`https://www.facebook.com/${uid}`, hdr2, timeout, String(opt.proxy || ""));
        const res = classify2(uid, st, fu, html);
        if (res[0] === "live") {
          const n = comments(html, uid);
          if (n === null && attempt === 0) {
            last = { res: res[0], info: res[1] + " \xB7 ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c s\u1ED1 b\xECnh lu\u1EADn", extra: {} };
            await wait(0.6);
            continue;
          }
          return { res: res[0], info: res[1] + (n !== null ? ` \xB7 ${n} b\xECnh lu\u1EADn` : " \xB7 kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c s\u1ED1 b\xECnh lu\u1EADn (th\xEAm cookie)"), extra: n !== null ? { comments: n } : {} };
        }
        if (res[0] !== "error") return { res: res[0], info: res[1] };
        last = { res: res[0], info: res[1] };
      } catch (e) {
        if (e instanceof Stopped) throw e;
        last = { res: "error", info: ename2(e) };
      }
      await wait(0.6 + attempt);
    }
  } catch (e) {
    if (e instanceof Stopped) return { res: "error", info: "\u0110\xE3 d\u1EEBng" };
    throw e;
  }
  return last;
}
var fbpostMod = { CHECKER: FBPOST_META, check: (value, opt) => fbpostCheck(value, opt) };
var __t2 = { norm: norm2, classify: classify2, count, comments };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FB,
  POST,
  WC
});
