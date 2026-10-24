/* Trang dịch cho khách trên điện thoại (link /api/hs/record/j/<mã>): khách nói bằng tiếng của mình (日本語 / English),
   điện thoại nghe bằng micro riêng → không cần ai bấm đổi người nói. Màn hình 2 cột VI | JP như máy chủ trì, dòng mới nhất ở trên.
   Dòng đang nói dở: tự dịch nháp bằng Google Dịch trên máy; dòng chốt: máy chủ sửa theo từ điển HireX + dịch chuẩn. */
const COLS = { vi: 'VI', ja: 'JP', en: 'EN' }, SRC = { vi: 'vi-VN', ja: 'ja-JP', en: 'en-US' };
const TXT = {
  ja: { start: 'タップして話す', stop: '停止', on: '聞いています', hint: '日本語で話してください。ベトナム語に自動で通訳されます。', say: '読み上げ', conn: '接続済み', off: 'オフライン', mic: 'マイクが使えません。ブラウザの設定を確認してください。', nosr: 'このブラウザは音声認識に対応していません。Chrome または Safari で開いてください。', empty: '会話はここに表示されます' },
  en: { start: 'Tap to speak', stop: 'Stop', on: 'Listening', hint: 'Speak in English — it is translated into Vietnamese automatically.', say: 'Read aloud', conn: 'Connected', off: 'Offline', mic: 'Microphone unavailable. Check browser permissions.', nosr: 'This browser has no speech recognition. Please open in Chrome or Safari.', empty: 'The conversation appears here' },
  vi: { start: 'Bấm để nói', stop: 'Dừng', on: 'Đang nghe', hint: 'Nói tiếng Việt, máy tự dịch.', say: 'Đọc to', conn: 'Đã kết nối', off: 'Mất kết nối', mic: 'Không dùng được micro.', nosr: 'Trình duyệt không hỗ trợ nhận giọng nói. Mở bằng Chrome hoặc Safari.', empty: 'Hội thoại hiện ở đây' },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SEG = { vi: { max: 64, min: 6, keep: 2 }, en: { max: 70, min: 6, keep: 2 }, ja: { max: 26, min: 10, keep: 4 } };
const toks = (t, lang) => (lang === 'ja' ? Array.from(t.replace(/\s+/g, '')) : t.split(' ').filter(Boolean));
const join = (a, lang) => a.join(lang === 'ja' ? '' : ' ');
const PUNCT = /[,.;:!?、。！？，]$/, JA_AFTER = /[はがをにでとへもね]/;
const EN_START = new Set('and but so because that which when if to for with of in on at from about'.split(' '));
function cutAt(rest, lim, C, lang) {
  for (let j = lim; j >= C.min; j--) if (PUNCT.test(rest[j - 1])) return j;
  if (lang === 'ja') { for (let j = lim; j >= C.min; j--) if (JA_AFTER.test(rest[j - 1])) return j; }
  else for (let j = lim; j >= C.min; j--) if (EN_START.has(rest[j].toLowerCase())) return j;
  return lim >= C.min + 4 && join(rest, lang).length > C.max * 1.5 ? lim : 0;
}

export function mount(root, cfg) {
  const me = cfg.me, pair = cfg.pair?.length === 2 ? cfg.pair : ['vi', me], T = TXT[me] || TXT.en, base = `/api/hs/record/j/${cfg.token}`;
  let dev = ''; try { dev = sessionStorage.getItem('hs-dev') || ''; } catch { /* không lưu được */ }
  if (!dev) { dev = 'g' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('hs-dev', dev); } catch { /* bỏ qua */ } }
  const S = { lines: new Map(), seq: 0, t0: Date.now(), k: 0, rec: null, want: false, live: null, nF: 0, cI: 0, lastF: [], prev: [], online: true, peers: 0, say: false, mute: false, cache: new Map() };
  root.innerHTML = `<header class="g-h"><b>HireX</b><span class="g-p">${pair.map(x => COLS[x]).join(' ⇄ ')}</span><span class="g-s" id="gS"></span><button type="button" class="g-say" id="gSay">${T.say}</button></header>
    <div class="g-cols"><span></span>${pair.map(x => `<b class="${x === me ? 'me' : ''}">${COLS[x]}</b>`).join('')}</div>
    <main class="g-b" id="gB"><div class="g-e">${esc(T.empty)}</div></main>
    <footer class="g-f"><p class="g-hint" id="gHint">${esc(SR ? T.hint : T.nosr)}</p><button type="button" class="g-mic" id="gMic"${SR ? '' : ' disabled'}><i></i><span>${T.start}</span></button></footer>`;
  const $ = id => root.querySelector('#' + id), B = $('gB');

  /* ---------- hiển thị: 2 cột, mới nhất ở trên ---------- */
  const mmss = t => { const s = Math.max(0, Math.round((t - S.t0) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  let raf = 0; const render = () => { if (!raf) raf = requestAnimationFrame(draw); };
  function draw() {
    raf = 0; const L = [...S.lines.values()].filter(l => l.text && !l.drop).sort((a, b) => b.t - a.t || b.k - a.k).slice(0, 300);
    if (!L.length) { if (!B.querySelector('.g-e')) B.innerHTML = `<div class="g-e">${esc(T.empty)}</div>`; return; }
    B.querySelector('.g-e')?.remove();
    const keep = new Set(L.map(l => l.id)); for (const el of [...B.children]) if (!keep.has(el.dataset.id)) el.remove();
    L.forEach((l, i) => {
      let el = B.querySelector(`[data-id="${CSS.escape(l.id)}"]`); if (!el) { el = document.createElement('div'); el.className = 'g-r in'; el.dataset.id = l.id; }
      const cell = x => x === l.lang ? `<div class="c src" lang="${x}">${esc(l.text)}${l.fin ? '' : '<i class="caret"></i>'}</div>` : `<div class="c" lang="${x}">${l.tr[x] ? esc(l.tr[x]) : '<span class="w">…</span>'}</div>`;
      const h = `<span class="t">${mmss(l.t)}</span>${pair.map(cell).join('')}`; if (el._h !== h) { el.innerHTML = h; el._h = h; }
      el.classList.toggle('part', !l.fin); el.classList.toggle('mine', !!l.mine);
      if (B.children[i] !== el) B.insertBefore(el, B.children[i] || null);
    });
    const s = $('gS'); s.textContent = S.online ? T.conn + (S.peers ? ` · ${S.peers}` : '') : T.off; s.className = 'g-s' + (S.online ? ' ok' : '');
  }

  /* ---------- dịch nháp ngay trên máy (Google Dịch, ~0,2 giây) ---------- */
  async function gtx(text, from, to) {
    const key = from + to + text; if (S.cache.has(key)) return S.cache.get(key);
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`); if (!r.ok) throw new Error('gtx');
    const j = await r.json(), out = (Array.isArray(j?.[0]) ? j[0].map(x => (Array.isArray(x) ? String(x[0] ?? '') : '')).join('') : '').replace(/\s+/g, ' ').trim();
    S.cache.set(key, out); if (S.cache.size > 300) S.cache.delete(S.cache.keys().next().value); return out;
  }
  function quick(l) {
    for (const to of pair) {
      if (to === l.lang || (l.fin && l.srv)) continue;
      if (l.qb) { l.qa = 1; continue; }
      const text = l.text; l.qb = 1; l.qa = 0;
      gtx(text, l.lang, to).then(o => { if (o && !l.srv) { l.tr[to] = o; render(); } }).catch(() => {}).finally(() => { l.qb = 0; if (l.qa && l.text !== text) quick(l); });
    }
  }

  /* ---------- nghe trên điện thoại này ---------- */
  const newMine = () => { const l = { id: dev + ':' + (S.k), dev, k: S.k++, lang: me, text: '', tr: {}, fin: false, t: Date.now(), mine: 1 }; S.lines.set(l.id, l); return l; };
  let pushT = 0, pushL = null;
  // gửi ngay chữ đầu tiên, sau đó tối đa ~4 lần/giây (luôn gửi bản mới nhất)
  let pushAt = 0;
  function pushLive(l) {
    pushL = l; if (pushT) return; const go = () => { pushT = 0; pushAt = Date.now(); const x = pushL; if (x && !x.fin) send({ k: x.k, text: x.text, fin: 0, ts: x.t }); };
    const wait = 250 - (Date.now() - pushAt); if (wait <= 0) go(); else pushT = setTimeout(go, wait);
  }
  async function send(b) {
    try { const r = await fetch(base + '/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dev, lang: me, ...b }) }); S.online = r.ok; return r.ok ? await r.json() : null; }
    catch { S.online = false; render(); return null; }
  }
  async function close(l, text, conf = 0) {
    l.text = text.trim(); l.fin = true; if (!l.text) { S.lines.delete(l.id); send({ k: l.k, drop: 1 }); render(); return; }
    quick(l); render();
    const o = await send({ k: l.k, text: l.text, fin: 1, conf, ts: l.t });
    if (o?.ok) { if (o.drop) { l.drop = true; } else { l.text = o.text || l.text; l.tr = { ...l.tr, ...(o.tr || {}) }; l.srv = 1; } render(); }
  }
  function liveText(text) {
    if (!text) { if (S.live && !S.live.fin) { S.lines.delete(S.live.id); send({ k: S.live.k, drop: 1 }); S.live = null; } return; }
    if (!S.live) S.live = newMine();
    if (S.live.text !== text) { S.live.text = text; quick(S.live); pushLive(S.live); }
  }
  function flush() { const l = S.live; S.live = null; S.nF = S.cI = 0; S.prev = []; S.lastF = []; if (l && !l.fin) close(l, l.text); }
  /** Đếm theo số thứ tự kết quả đã chốt; resultIndex lùi = danh sách bắt đầu lại (Android / Safari); Android trả câu chốt gồm cả câu trước → bỏ phần trùng. */
  function scan(e, W) {
    const reset = e.resultIndex < W.nF; if (reset) { W.nF = e.resultIndex; W.cI = 0; W.prev = []; }
    const nf = []; let j = W.nF, conf = 0;
    while (j < e.results.length && e.results[j].isFinal) { nf.push(String(e.results[j][0]?.transcript || '')); conf = Math.max(conf, +e.results[j][0]?.confidence || 0); j++; }
    const itr = []; for (let i = j; i < e.results.length; i++) if (!e.results[i].isFinal) itr.push(String(e.results[i][0]?.transcript || ''));
    let fin = null;
    if (nf.length) {
      let F = toks(nf.join(' ').replace(/\s+/g, ' ').trim(), me); const L = W.lastF || [];
      if (reset && L.length && F.length > L.length && L.every((w, i) => F[i] === w)) F = F.slice(L.length);
      W.lastF = F.length ? F : L; fin = join(F.slice(W.cI), me); W.nF = j; W.cI = 0; W.prev = [];
    }
    return { fin, conf, I: toks(itr.join(' ').replace(/\s+/g, ' ').trim(), me) };
  }
  function start() {
    if (!SR || S.rec || S.mute) return;
    const r = new SR(); r.lang = SRC[me]; r.continuous = true; r.interimResults = true; S.nF = S.cI = 0; S.prev = []; S.lastF = [];
    r.onresult = e => {
      const C = SEG[me] || SEG.en, x = scan(e, S);
      if (x.fin != null) { const l = S.live || newMine(); S.live = null; close(l, x.fin, x.conf); }
      const I = x.I;
      let rest = I.slice(S.cI);
      if (join(rest, me).length > C.max) {
        let k = 0; while (k < rest.length && k < S.prev.length && rest[k] === S.prev[k]) k++;
        const cut = cutAt(rest, k - C.keep, C, me);
        if (cut) { const l = S.live || newMine(); S.live = null; close(l, join(rest.slice(0, cut), me)); S.cI += cut; rest = rest.slice(cut); }
      }
      S.prev = rest; liveText(join(rest, me)); render();
    };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { S.want = false; $('gHint').textContent = T.mic; paintMic(); } };
    r.onend = () => { if (S.rec !== r) return; S.rec = null; flush(); if (S.want && !S.mute) setTimeout(start, 150); paintMic(); };
    S.rec = r; try { r.start(); } catch { S.rec = null; } paintMic();
  }
  function stop() { const r = S.rec; S.rec = null; if (r) { r.onend = null; try { r.stop(); } catch { /* đã dừng */ } } flush(); paintMic(); }
  let lock = null;
  function paintMic() {
    const b = $('gMic'), on = S.want; b.classList.toggle('on', on); b.querySelector('span').textContent = on ? (S.mute ? '…' : T.on) : T.start;
    if (on && !lock && navigator.wakeLock) navigator.wakeLock.request('screen').then(x => { lock = x; }).catch(() => {});
    if (!on && lock) { lock.release().catch(() => {}); lock = null; }
  }
  $('gMic').onclick = () => { S.want = !S.want; if (S.want) start(); else stop(); paintMic(); };

  /* ---------- đọc to bản dịch của bên kia (tạm ngừng nghe khi đang đọc) ---------- */
  const said = new Set(), q = []; let speaking = false;
  $('gSay').onclick = () => { S.say = !S.say; $('gSay').classList.toggle('on', S.say); for (const l of S.lines.values()) said.add(l.id); if (!S.say) { q.length = 0; try { speechSynthesis.cancel(); } catch { /* bỏ qua */ } } };
  function sayNext() {
    if (speaking) return; const t = q.shift();
    if (!t) { if (S.mute) { S.mute = false; if (S.want) start(); paintMic(); } return; }
    const u = new SpeechSynthesisUtterance(t); u.lang = SRC[me]; u.rate = 1.05; speaking = true;
    if (S.rec) { S.mute = true; const r = S.rec; S.rec = null; r.onend = null; try { r.abort(); } catch { /* bỏ qua */ } flush(); paintMic(); }
    u.onend = u.onerror = () => { speaking = false; sayNext(); }; try { speechSynthesis.speak(u); } catch { speaking = false; }
  }
  const maybeSay = l => { if (!S.say || l.mine || !l.fin || l.drop || said.has(l.id) || !l.tr[me] || !('speechSynthesis' in window)) return; said.add(l.id); q.push(l.tr[me]); sayNext(); };

  /* ---------- nhận dòng của mọi máy trong phòng (hỏi dài) ---------- */
  async function loop() {
    for (;;) {
      try {
        const r = await fetch(`${base}/poll?after=${S.seq}&dv=${S.dv ?? -1}&dev=${dev}&lang=${me}`, { cache: 'no-store' });
        if (r.status === 404) { S.online = false; $('gHint').textContent = 'Phòng dịch đã đóng · 通訳ルームは終了しました'; render(); return; }
        const d = await r.json(); S.online = true; S.seq = d.seq; S.dv = d.dv; if (S.ep && d.ep !== S.ep) { for (const [id, l] of S.lines) if (!l.mine || l.fin) S.lines.delete(id); } S.ep = d.ep; S.t0 = d.t0 || S.t0; S.peers = (d.devs || []).filter(x => x.dev !== dev).length;
        for (const x of d.lines || []) {
          if (x.dev === dev) { const l = S.lines.get(x.id); if (l && x.drop) l.drop = true; continue; }
          let l = S.lines.get(x.id); if (!l) { l = { ...x, tr: {} }; S.lines.set(x.id, l); }
          const was = l.text; Object.assign(l, { text: x.text, fin: !!x.fin, drop: !!x.drop, t: x.t, lang: x.lang });
          if (x.fin && Object.keys(x.tr || {}).length) { l.tr = { ...l.tr, ...x.tr }; l.srv = 1; } else if (was !== x.text || !x.fin) { l.srv = 0; quick(l); }
          maybeSay(l);
        }
        render();
      } catch { S.online = false; render(); await new Promise(z => setTimeout(z, 1500)); }
    }
  }
  loop(); render();
}
