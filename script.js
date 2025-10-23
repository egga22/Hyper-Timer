(() => {
  "use strict";
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];
  const now = () => Date.now();
  const pad2 = n => String(n).padStart(2, "0");
  const pad3 = n => String(n).padStart(3, "0");
  const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
  const uid = (p="id_") => p + Math.random().toString(36).slice(2);
  function normalizeColorString(str, fallback="#6c7bff"){
    if (typeof str === "string"){
      const trimmed = str.trim();
      const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
      if (match) return "#" + match[1].toLowerCase();
    }
    if (typeof fallback === "string" && fallback !== str){
      const trimmed = fallback.trim();
      const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
      if (match) return "#" + match[1].toLowerCase();
    }
    return "#6c7bff";
  }

  // --- START: Authentication and Sync Configuration ---
  const RESTDB_URL = 'https://timerapp-1f65.restdb.io/rest/accounts'; // <-- IMPORTANT: SET THIS
  const API_KEY = '68a65f75b349a309704b6cab'; // <-- IMPORTANT: SET THIS
  
  let currentUser = null;
  let isSyncing = false;
  // --- END: Authentication and Sync Configuration ---

  const grid = $("#grid");
  const editor = $("#editor");
  const addBtn = $("#addBtn");
  const fab = $("#fab");
  const exportBtn = $("#exportBtn");
  const importInput = $("#importInput");
  const templateMenu = $("#templateMenu");
  const tplBtn = $("#tplBtn");
  const pauseAllBtn = $("#pauseAllBtn");

  const accountControls = $("#accountControls");
  const userSession = $("#userSession");
  const loginBtn = $("#loginBtn");
  const signupBtn = $("#signupBtn");
  const logoutBtn = $("#logoutBtn");
  const syncBtn = $("#syncBtn");
  const userEmailDisplay = $("#userEmailDisplay");
  const authDialog = $("#authDialog");

  const f = {
    name: $("#f_name"), mode: $("#f_mode"), when: $("#f_when"),
    days: $("#f_days"), hours: $("#f_hours"), minutes: $("#f_minutes"), seconds: $("#f_seconds"),
    style: $("#f_style"), color: $("#f_color"), color2: $("#f_color2"), units: $("#f_units"),
    format: $("#f_format"), ring_thickness: $("#f_ring_thickness"),
    ease: $("#f_ease"), tick: $("#f_tick"), ms: $("#f_ms"),
    mb_bars: $("#f_mb_bars"), mb_ticks: $("#f_mb_ticks"), letters_n: $("#f_letters_n"), lettersPreview: $("#lettersPreview"),
    trList: $("#trList"), addPctBtn: $("#addPctBtn"), addTimeBtn: $("#addTimeBtn"), addIntBtn: $("#addIntBtn"),
    doneSound: $("#f_doneSound"), doneTts: $("#f_doneTts"),
    startWhen: $("#f_startWhen"),
    startPct: $("#f_startPct"),
    smartMethod: $("#f_smartMethod"), smartUrl: $("#f_smartUrl"),
  };
  const customFormatRow = $("#customFormatRow");

  let timers = [];
  let templates = [];
  let editId = null;

  const KEY_TIMERS = "hyperTimer_v6_timers";
  const KEY_LAST_MODIFIED = "hyperTimer_v6_lastModified";
  const KEY_USER = "hyperTimer_v6_user";
  const TPL = "hyperTimer_templates_v1";
  const PRO_SPLIT_STYLES = ["multibar", "letters", "color"];
  const PRO_SPLIT_LABELS = {
    multibar: "Multi Bar",
    letters: "Letters",
    color: "Color"
  };

  async function updateAndSaveTimers(newTimersArray = null) {
    if (newTimersArray) {
      timers = newTimersArray;
    }
    const newTimestamp = Date.now();
    localStorage.setItem(KEY_TIMERS, JSON.stringify(timers));
    localStorage.setItem(KEY_LAST_MODIFIED, String(newTimestamp));
    render();

    if (currentUser) {
      await pushTimersToCloud(timers, newTimestamp);
    }
  }
  
  function load(){
    try {
      const userRaw = localStorage.getItem(KEY_USER);
      if (userRaw) {
        currentUser = JSON.parse(userRaw);
        updateUIForLoginState();
      }
      const raw = localStorage.getItem(KEY_TIMERS);
      if (raw){ const data = JSON.parse(raw); if (Array.isArray(data)) timers = data.map(migrateTimer); }
      const rt = localStorage.getItem(TPL);
      if (rt){ const data = JSON.parse(rt); if (Array.isArray(data)) templates = data.map(migrateTemplate); }
    } catch(e){ console.warn("load failed", e); }
    if (currentUser) {
        syncTimers();
    }
    refreshSmartTimers();
  }

  function saveTemplates(){ localStorage.setItem(TPL, JSON.stringify(templates)); }

  function migrateTimer(t){
    const out = {...t};
    out.triggers = out.triggers || [];
    out.prestigeLevel = out.prestigeLevel || 0;
    out.color = normalizeColorString(out.color);
    out.color2 = normalizeColorString(out.color2, out.color);
    if (out.mode === "datetime" || out.mode === "smart"){
      if (typeof out.targetMs !== "number"){
        const guess = (typeof out.target === "string") ? Date.parse(out.target) : Number(out.target);
        out.targetMs = isNaN(guess)? Date.now() + 3600000 : guess;
      }
    }
    out.total0 = out.total0 || baseTotal(out);
    if (!out.mb_plan){ out.mb_plan = planMultiBar(Math.max(1000, out.total0), out.mb_bars||null, out.mb_ticks||null); }
    if (out.style === "pro"){
      ensureProSplitState(out);
    }
    return out;
  }

  function migrateTemplate(tpl){
    const out = {...tpl};
    out.color = normalizeColorString(out.color);
    out.color2 = normalizeColorString(out.color2, out.color);
    if (out.style === "pro"){
      ensureProSplitState(out);
    }
    return out;
  }

  async function getExpectedDate(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      const answers = data[0].answers;
      let weightedSum = 0;
      let probSum = 0;
      answers.forEach(ans => {
        weightedSum += ans.midpoint * ans.prob;
        probSum += ans.prob;
      });
      const expectedTimestamp = weightedSum / probSum;
      const date = new Date(expectedTimestamp);
      const ptDate = new Date(
        date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      );
      ptDate.setHours(0, 0, 0, 0);
      return ptDate.getTime();
    } catch (err) {
      console.error("Error:", err);
      return null;
    }
  }

  async function refreshSmartTimers(){
    let changed = false;
    await Promise.all(timers.map(async t => {
      if (t.mode === "smart" && t.smartMethod === "manifold" && t.smartUrl) {
        const ts = await getExpectedDate(t.smartUrl);
        if (ts && ts !== t.targetMs) {
          t.targetMs = ts;
          if (typeof t.startOverrideMs === "number") {
            t.start = t.startOverrideMs;
          } else if (typeof t.startOverridePct === "number") {
            const p = t.startOverridePct / 100;
            const nowTs = now();
            let candidate = (nowTs - p * ts) / (1 - p);
            if (!Number.isFinite(candidate)) candidate = nowTs;
            t.start = Math.min(nowTs, Math.floor(candidate));
          }
          t.total0 = baseTotal(t);
          t.mb_plan = planMultiBar(Math.max(1000, t.total0), t.mb_bars||null, t.mb_ticks||null);
          changed = true;
        }
      }
    }));
    if (changed) await updateAndSaveTimers();
  }

  function msOfDuration(d,h,m,s){ return ((+d||0)*86400 + (+h||0)*3600 + (+m||0)*60 + (+s||0)) * 1000; }

  function splitTime(t){
    if (t<0) t=0;
    const ms = Math.floor(t%1000);
    const totals = Math.floor(t/1000);
    const s = totals%60;
    const m = Math.floor(t/60000)%60;
    const h = Math.floor(t/3600000)%24;
    const d = Math.floor(t/86400000);
    return {d,h,m,s,ms,totals,totalm:Math.floor(t/60000), totalH:Math.floor(t/3600000), totalD:Math.floor(t/86400000)};
  }
  function fmtCustom(tmpl, S, name){
    const map = {"{DD}":String(S.d), "{HH}":pad2(S.h), "{mm}":pad2(S.m), "{ss}":pad2(S.s), "{ms3}":pad3(S.ms),
      "{totalD}":String(S.totalD), "{totalH}":String(S.totalH), "{totalm}":String(S.totalm), "{totals}":String(S.totals),
      "{name}": name || ""};
    let out = tmpl;
    for (const k in map) out = out.split(k).join(map[k]);
    return out;
  }
  function fmt(t, units="auto", showMs=false, tmpl=null, name=""){
    const S = splitTime(t);
    switch (units){
      case "d": return S.d + " day" + (S.d!==1?"s":"");
      case "dhm": { const parts=[]; if(S.d) parts.push(S.d+"d"); if(S.d||S.h) parts.push(S.h+"h"); parts.push(S.m+"m"); return parts.join(" "); }
      case "hms": return (S.d*24+S.h)+":"+pad2(S.m)+":"+pad2(S.s) + (showMs? "."+pad3(S.ms):"");
      case "ms":  return (S.d*24*60+S.h*60+S.m)+":"+pad2(S.s) + (showMs? "."+pad3(S.ms):"");
      case "s":   return (S.d*86400+S.h*3600+S.m*60+S.s) + (showMs? "."+pad3(S.ms):"") + "s";
      case "custom": return fmtCustom(tmpl || "{HH}:{mm}:{ss}", S, name);
      case "auto":
      default:{
        const totalSeconds = S.totals;
        if (totalSeconds >= 3600){
          const H=Math.floor(totalSeconds/3600), M=Math.floor((totalSeconds%3600)/60), SS=totalSeconds%60;
          return H+":"+pad2(M)+":"+pad2(SS);
        }else if (totalSeconds >= 60){
          const M=Math.floor(totalSeconds/60), SS=totalSeconds%60;
          return M+":"+pad2(SS);
        }else{
          return S.s + (showMs? "."+pad3(S.ms):"") + "s";
        }
      }
    }
  }

  const easings = { linear: x => x, easeOut: x => 1 - Math.pow(1-x, 2), easeInOut: x => x<.5 ? 2*x*x : 1 - Math.pow(-2*x+2,2)/2 };

  function tone(freq=880, dur=0.2, vol=0.6){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type="sine"; o.frequency.value=freq; o.connect(g); g.connect(ctx.destination);
      const t=ctx.currentTime; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.start(t); o.stop(t+dur+0.05);
      setTimeout(()=>ctx.close(), (dur+0.4)*1000);
    }catch(e){}
  }
  async function playDataUrl(dataUrl){ try{ const a=new Audio(dataUrl); a.volume=.85; await a.play(); }catch(e){} }
  function speak(text){ try{ const u=new SpeechSynthesisUtterance(text); speechSynthesis.speak(u);}catch(e){} }

  function baseTotal(t){ return (t.mode==="datetime" || t.mode==="smart") ? (t.targetMs - t.start) : t.duration; }
  function remainingMs(t){
    if (t.paused) return t.leftWhenPaused ?? 0;
    const target = (t.mode==="datetime" || t.mode==="smart") ? t.targetMs : (t.start + t.duration);
    return target - now();
  }
  function remainingForDisplay(t){ let rem = remainingMs(t); if (t.paused){ rem = Math.max(0, Math.ceil(rem/1000)*1000); } return rem; }
  function elapsedMs(t){ const total = t.total0 || baseTotal(t); return clamp(total - remainingMs(t), 0, total); }

  function visualProgress(t){
    const total = t.total0 || baseTotal(t);
    if (total <= 0) return 1;
    const rem = Math.max(0, remainingMs(t));
    const elapsed = Math.max(0, total - rem);
    const raw = total ? elapsed / total : 1;
    const ease = easings[t.ease||"linear"] || easings.linear;
    return ease(raw);
  }

  function parseHexColor(hex){
    if (typeof hex !== "string") return null;
    const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }
  function sanitizeRgb(rgb){
    const base = rgb || {};
    return {
      r: Math.min(255, Math.max(0, Math.round(base.r ?? 0))),
      g: Math.min(255, Math.max(0, Math.round(base.g ?? 0))),
      b: Math.min(255, Math.max(0, Math.round(base.b ?? 0)))
    };
  }
  function rgbToHex(rgb){
    const c = sanitizeRgb(rgb);
    return "#" + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  function rgbToCss(rgb){
    const c = sanitizeRgb(rgb);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
  function rgbaString(rgb, alpha){
    const c = sanitizeRgb(rgb);
    const a = Math.min(1, Math.max(0, alpha));
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
  }
  function blendRgb(a, b, t){
    const start = sanitizeRgb(a);
    const end = sanitizeRgb(b);
    const p = clamp(typeof t === "number" ? t : 0, 0, 1);
    return {
      r: start.r + (end.r - start.r) * p,
      g: start.g + (end.g - start.g) * p,
      b: start.b + (end.b - start.b) * p
    };
  }
  function relativeLuminance(rgb){
    const c = sanitizeRgb(rgb);
    const toLinear = (value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const r = toLinear(c.r);
    const g = toLinear(c.g);
    const b = toLinear(c.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function accentFromRgb(rgb, extra={}){
    const safe = sanitizeRgb(rgb);
    const lum = relativeLuminance(safe);
    return {
      rgb: safe,
      hex: rgbToHex(safe),
      css: rgbToCss(safe),
      luminance: lum,
      isLight: lum > 0.55,
      ...extra
    };
  }
  function currentAccentColor(t, progressOverride=null){
    const baseFallback = {r:108, g:123, b:255};
    const startRgb = sanitizeRgb(parseHexColor(t?.color) || baseFallback);
    const progress = clamp(typeof progressOverride === "number" ? progressOverride : visualProgress(t), 0, 1);
    const treatAsColor = t?.style === "color" || t?.style === "pro";
    if (treatAsColor){
      const endRgb = sanitizeRgb(parseHexColor(t.color2) || startRgb);
      const mix = blendRgb(startRgb, endRgb, progress);
      return accentFromRgb(mix, {
        progress,
        startRgb,
        endRgb,
        startCss: rgbToCss(startRgb),
        endCss: rgbToCss(endRgb)
      });
    }
    return accentFromRgb(startRgb, {
      progress,
      startRgb,
      endRgb: startRgb,
      startCss: rgbToCss(startRgb),
      endCss: rgbToCss(startRgb)
    });
  }
  function gradientBackgroundForAccent(accent, angle=140){
    if (!accent) return "";
    const prog = clamp(accent.progress ?? 0, 0, 1);
    const start = accent.startRgb || accent.rgb;
    const end = accent.endRgb || accent.rgb;
    const towardsStart = blendRgb(accent.rgb, start, 1 - prog);
    const towardsEnd = blendRgb(accent.rgb, end, prog);
    const lightEdge = blendRgb(towardsStart, {r:255, g:255, b:255}, 0.18);
    const darkEdge = blendRgb(towardsEnd, {r:0, g:0, b:0}, 0.25);
    return `linear-gradient(${angle}deg, ${rgbToCss(lightEdge)} 0%, ${accent.css} 48%, ${rgbToCss(darkEdge)} 100%)`;
  }
  function updateCardVisuals(card, t, accent){
    if (!card || !accent) return;
    const dot = card.querySelector('[data-role="accent-dot"]');
    if (dot){
      dot.style.background = accent.hex;
      dot.style.boxShadow = `0 0 20px ${rgbaString(accent.rgb, 0.28)}`;
    }
    const subtitle = card.querySelector('.subtitle');
    const pill = card.querySelector('[data-role="accent-pill"]');
    const actions = card.querySelectorAll('.actions .action-btn');
    const flip = card.querySelector('.big .flip');
    const etaNote = card.querySelector('.footer-row .note');

    const colorLike = t.style === 'color' || t.style === 'pro';
    if (colorLike){
      card.classList.add('color-style');
      card.classList.toggle('color-style-light', accent.isLight);
      card.classList.toggle('color-style-dark', !accent.isLight);
      const gradient = gradientBackgroundForAccent(accent);
      card.style.background = gradient;
      card.style.borderColor = rgbaString(accent.rgb, accent.isLight ? 0.28 : 0.36);
      const textColor = accent.isLight ? '#05070b' : '#f7f8ff';
      const muted = accent.isLight ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.78)';
      card.style.color = textColor;
      if (subtitle) subtitle.style.color = muted;
      if (etaNote) etaNote.style.color = muted;
      if (pill){
        pill.style.background = accent.isLight ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.18)';
        pill.style.color = textColor;
        pill.style.borderColor = accent.isLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.28)';
      }
      actions.forEach(btn => {
        btn.style.background = accent.isLight ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)';
        btn.style.borderColor = accent.isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.18)';
        btn.style.color = textColor;
      });
      if (flip){
        flip.style.background = accent.isLight ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
        flip.style.borderColor = accent.isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
      }
    } else {
      card.classList.remove('color-style', 'color-style-light', 'color-style-dark');
      card.style.background = '';
      card.style.borderColor = '';
      card.style.color = '';
      if (subtitle) subtitle.style.color = '';
      if (etaNote) etaNote.style.color = '';
      if (pill){
        pill.style.background = '';
        pill.style.color = accent.hex;
        pill.style.borderColor = rgbaString(accent.rgb, 0.45);
      }
      actions.forEach(btn => {
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
      });
      if (flip){
        flip.style.background = '';
        flip.style.borderColor = '';
      }
    }
  }

  function planMultiBar(totalMs, barsOverride=null, targetTicksPerBar=null){
    const S = Math.max(1, Math.round(totalMs/1000));
    const MINB=2, MAXB=5, MINT=8, MAXT=40, TARGET = clamp(targetTicksPerBar||20, MINT, MAXT);
    let best = null;
    function score(b, t){
      const P = Math.pow(t, b);
      const dt = totalMs / P;
      const tBias = Math.abs(t - TARGET) / TARGET;
      const dtBias = Math.abs(Math.log((dt||1)/1000));
      return tBias*0.7 + dtBias*0.3;
    }
    const barsCandidates = barsOverride? [clamp(barsOverride, MINB, MAXB)] : [2,3,4,5];
    for (const b of barsCandidates){
      let g = Math.round(Math.pow(S, 1/b));
      g = clamp(g, MINT, MAXT);
      for (let tt = clamp(g-6, MINT, MAXT); tt <= clamp(g+6, MINT, MAXT); tt++){
        const sc = score(b, tt);
        if (!best || sc < best.sc) best = {b, tt, sc};
      }
    }
    const bars = best.b;
    const ticks = Array(bars).fill(best.tt);
    const P = ticks.reduce((a,c)=>a*c,1);
    const dtMs = totalMs / P;
    return {bars, ticks, dtMs, product:P};
  }

  function parseLocalDateTime(value){
    if (!value) return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const [_, Y, M, D, h, mnt, s] = m;
    const dt = new Date(Number(Y), Number(M)-1, Number(D), Number(h), Number(mnt), Number(s||0), 0);
    return dt.getTime();
  }

  function pickTemplateName(tpl){
    const cands=[ tpl.style, `${tpl.style} • ${tpl.units}`, `${tpl.style} • ${tpl.triggers?.length||0} trig`,
      `${tpl.style} • ${tpl.units} • ${tpl.triggers?.length||0} • ${tpl.color}` ];
    for (const c of cands){ if (!templates.some(t=>t.name===c)) return c; }
    return `${tpl.style} • ${tpl.units} • ${Math.random().toString(36).slice(2,6)}`;
  }
  function saveTemplateFromTimer(t){
    if (t.style === "pro") ensureProSplitState(t);
    const tpl = { id:uid("tpl_"), style:t.style, color:t.color, color2:t.color2, units:t.units, format:t.format,
      ring_thickness:t.ring_thickness, ease:t.ease, tick:t.tick, ms:t.ms, dotsCount:t.dotsCount, mb_bars:t.mb_bars, mb_ticks:t.mb_ticks, letters_n:t.letters_n,
      triggers:t.triggers, doneSoundDataUrl:t.doneSoundDataUrl, doneTts:t.doneTts, name: pickTemplateName(t) };
    if (t.style === "pro"){
      tpl.splitStyles = [...(t.splitStyles||PRO_SPLIT_STYLES)];
      tpl.splitSettings = t.splitSettings ? JSON.parse(JSON.stringify(t.splitSettings)) : null;
    }
    templates.push(tpl); saveTemplates(); alert("Saved template: "+tpl.name);
  }

  function openTemplateMenu(){
    templateMenu.innerHTML="";
    const add=document.createElement("div"); add.className="template-item"; add.innerHTML="<strong>＋ New Template</strong>";
    add.addEventListener("click", ()=>{ templateMenu.classList.remove("open"); openEditor(null, {style:'bar', color:'#6c7bff', color2:'#6c7bff', units:'auto'}); });
    templateMenu.appendChild(add);
    templates.forEach(tpl=>{
      const row=document.createElement("div"); row.className="template-item";
      const meta=`<div class='note'>${tpl.style} • ${tpl.units} • ${(tpl.triggers?.length||0)} trig</div>`;
      row.innerHTML=`<div style='display:flex;justify-content:space-between;gap:8px;align-items:center'><div>${escapeHtml(tpl.name)}</div><div><button class='btn' data-act='use'>Use</button> <button class='btn' data-act='edit'>Edit</button> <button class='btn' data-act='del'>Delete</button></div></div>${meta}`;
      row.querySelector("[data-act='use']").addEventListener("click", (e)=>{ e.stopPropagation(); templateMenu.classList.remove("open"); openEditor(null, tpl); });
      row.querySelector("[data-act='edit']").addEventListener("click", (e)=>{ e.stopPropagation(); templateMenu.classList.remove("open"); openEditor(null, tpl); $("#dialogTitle").textContent = "Edit Template"; });
      row.querySelector("[data-act='del']").addEventListener("click", (e)=>{ e.stopPropagation(); if(confirm("Delete template '"+tpl.name+"'?")){ templates = templates.filter(x=>x.id!==tpl.id); saveTemplates(); openTemplateMenu(); } });
      templateMenu.appendChild(row);
    });
    templateMenu.classList.add("open");
  }

  function toLocalDatetime(d){
    const yyyy=d.getFullYear(); const MM=("0"+(d.getMonth()+1)).slice(-2);
    const dd=("0"+d.getDate()).slice(-2); const hh=("0"+d.getHours()).slice(-2); const mm=("0"+d.getMinutes()).slice(-2);
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
  }

  function trRow(entry){
    const row=document.createElement("div"); row.className="tr-row"; row.dataset.id = entry.id || uid("tr_");
    row.innerHTML=`
      <div class="field-row">
        <div class="field">
          <label>Type</label>
          <select class="tr-type">
            <option value="percent">Percent left</option>
            <option value="time">Time left</option>
            <option value="interval">Interval (elapsed multiples)</option>
          </select>
        </div>
        <div class="field">
          <label>Value</label>
          <input class="tr-value" type="text" placeholder="e.g., 25 or 05:00 or every 10s" />
          <div class="note tr-hint">Percent 0–100 • Time mm:ss / hh:mm:ss • Interval seconds</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Action</label>
          <select class="tr-action">
            <option value="sound">Play sound</option>
            <option value="tts">Speak (TTS)</option>
          </select>
        </div>
        <div class="field"><input class="tr-tts invisible" type="text" placeholder="Message (e.g., {left} left)"></div>
        <div class="field"><input class="tr-sound invisible" type="file" accept="audio/*"></div>
        <div class="field"><button type="button" class="btn tr-remove">Delete</button></div>
      </div>`;
    const selType=row.querySelector(".tr-type"); const inputVal=row.querySelector(".tr-value"); const selAction=row.querySelector(".tr-action");
    const inputTts=row.querySelector(".tr-tts"); const inputSound=row.querySelector(".tr-sound");
    selType.value = entry.type||"percent"; selAction.value = entry.action||"tts";
    if (entry.type==="time") inputVal.value = entry.valueTimeStr || (entry.valueTime!=null?String(entry.valueTime):"");
    else if (entry.type==="percent") inputVal.value = entry.valuePercent!=null? String(entry.valuePercent):"";
    else if (entry.type==="interval") inputVal.value = entry.intervalSec!=null? String(entry.intervalSec):"";
    inputTts.value = entry.ttsTemplate || "";
    function updateActionUI(){ const act=selAction.value; inputTts.classList.toggle("invisible", act!=="tts"); inputSound.classList.toggle("invisible", act!=="sound"); }
    function updateTypeUI(){ const t=selType.value; const hint=row.querySelector(".tr-hint"); if (t==="percent") hint.textContent="Fire once when percent left crosses below value"; if (t==="time") hint.textContent="Fire once when time left crosses below value"; if (t==="interval") hint.textContent="Fire every N seconds, aligned to elapsed multiples"; }
    updateActionUI(); updateTypeUI(); selAction.addEventListener("change", updateActionUI); selType.addEventListener("change", updateTypeUI);
    row.querySelector(".tr-remove").addEventListener("click", ()=> row.remove());
    return row;
  }
  function renderTrList(entries){ $("#trList").innerHTML=""; (entries||[]).forEach(e=> $("#trList").appendChild(trRow(e))); }
  function collectTrEntries(existingMap){
    const rows = $$(".tr-row", $("#trList"));
    const promises = rows.map(row => new Promise(async (resolve)=>{
      const id=row.dataset.id; const type=row.querySelector(".tr-type").value; const rawVal=row.querySelector(".tr-value").value.trim();
      const action=row.querySelector(".tr-action").value; const ttsTemplate=row.querySelector(".tr-tts").value; const fileInput=row.querySelector(".tr-sound");
      let soundDataUrl = existingMap.get(id)?.soundDataUrl || null;
      if (fileInput.files && fileInput.files[0]){
        const r=new FileReader(); r.onload=()=> resolve(pack(r.result)); r.readAsDataURL(fileInput.files[0]);
      } else resolve(pack(soundDataUrl));
      function pack(dataUrl){ return { id, type, valuePercent:type==="percent"?parseFloat(rawVal):null, valueTime:type==="time"?parseTimeStr(rawVal):null, valueTimeStr:type==="time"?rawVal:null, intervalSec:type==="interval"?Math.max(1,Math.floor(parseFloat(rawVal)||0)):null, action, ttsTemplate, soundDataUrl:dataUrl, align:"elapsed" }; }
    }));
    return Promise.all(promises);
  }
  function parseTimeStr(str){
    const seg=(str||"").split(":").map(s=>s.trim()).map(Number);
    if(seg.some(n=>Number.isNaN(n))) return null;
    if(seg.length===2) return seg[0]*60+seg[1];
    if(seg.length===3) return seg[0]*3600+seg[1]*60+seg[2];
    return null;
  }
  function crossedPct(prevE, nowE, total, targetPct){ const prevLeft=(1-(prevE/total))*100, nowLeft=(1-(nowE/total))*100; return prevLeft>=targetPct && nowLeft<targetPct; }
  function crossedTime(prevRem, rem, targetSec){ const prevS=Math.ceil(prevRem/1000), nowS=Math.ceil(rem/1000); return prevS>=targetSec && nowS<targetSec; }
  function fillTokens(tmpl, rem, total, t){ const left=fmt(rem, t.units, t.ms==='on', t.units==='custom'?t.format:null, t.name); const elapsed=fmt(Math.max(0,total-rem), t.units,false,t.units==='custom'?t.format:null,t.name); return (tmpl||"{left} remaining").replaceAll("{left}", left).replaceAll("{elapsed}", elapsed).replaceAll("{name}", t.name||""); }
  function fireAction(t,tr,rem,total){ if(tr.action==="sound"){ if(tr.soundDataUrl) playDataUrl(tr.soundDataUrl); else tone(660,.18); } else { speak(fillTokens(tr.ttsTemplate, rem, total, t)); } }
  
  function updateLettersPreview(){
    try{
      let dur;
      if (f.mode.value === "duration"){
        dur = msOfDuration(f.days.value, f.hours.value, f.minutes.value, f.seconds.value);
      } else {
        if (!f.when.value){ f.lettersPreview.textContent = `Frames: — • Frame length: —`; return; }
        const targetMs = parseLocalDateTime(f.when.value);
        if (targetMs === null){ f.lettersPreview.textContent = `Frames: — • Frame length: —`; return; }
        const nowTs = Date.now();
        let startMs = nowTs;
        if (f.startWhen.value){
          const parsedStart = parseLocalDateTime(f.startWhen.value);
          if (parsedStart !== null) startMs = parsedStart;
        } else if (f.startPct.value && f.startPct.value.trim() !== ""){
          const pRaw = parseFloat(f.startPct.value);
          const p = isNaN(pRaw) ? 0 : clamp(pRaw/100, 0, 0.9999);
          let candidate = (nowTs - p * targetMs) / (1 - p);
          if (Number.isFinite(candidate)) startMs = Math.min(nowTs, Math.floor(candidate));
        }
        dur = Math.max(1000, targetMs - startMs);
      }
      const n = f.letters_n.value ? Math.max(1, Math.min(7, +f.letters_n.value)) : null;
      const plan = planLetters(dur, n);
      const frames = Math.pow(26, plan.n) - 1;
      f.lettersPreview.textContent = `Frames: ${frames.toLocaleString()} • Frame length: ${(plan.frameMs/1000).toFixed(2)}s • Letters: ${plan.n}`;
    }catch(e){ /* silent */ }
  }
  
  function updateStyleUI(){
    const row = document.getElementById('lettersSettings');
    const color2Row = document.getElementById('color2Field');
    const styleVal = f.style ? f.style.value : 'bar';
    const isPro = styleVal === 'pro';
    const isLetters = styleVal === 'letters' || isPro;
    const isColor = styleVal === 'color' || isPro;
    if (row) row.classList.toggle('invisible', !isLetters);
    if (color2Row) color2Row.classList.toggle('invisible', !isColor);
    if (isColor && f.color2 && (!f.color2.value || f.color2.value.trim() === '')){
      f.color2.value = f.color?.value || '#6c7bff';
    }
    if (isLetters) updateLettersPreview();
  }

  function openEditor(id=null, template=null){
    $("#dialogTitle").textContent = id ? "Edit Timer" : (template ? "New from Template" : "New Timer");
    editId = id;
    const draft = id ? timers.find(x=>x.id===id) : {
      id: uid("t_"), name:"", mode:"duration", style: template?.style || "bar", color: template?.color || "#6c7bff",
      color2: template?.color2 || template?.color || "#6c7bff",
      units: template?.units || "auto", format: template?.format || "{HH}:{mm}:{ss}",
      ring_thickness: template?.ring_thickness ?? 10, ease: template?.ease || "linear", tick: template?.tick ?? 100, ms: template?.ms || "off",
      dotsCount: template?.dotsCount ?? 60, mb_bars: template?.mb_bars ?? null, mb_ticks: template?.mb_ticks ?? null, letters_n: template?.letters_n ?? null,
      triggers: template?.triggers || [], doneSoundDataUrl: template?.doneSoundDataUrl || null, doneTts: template?.doneTts || "", prestigeLevel:0,
      smartMethod: "manifold", smartUrl: ""
    };

    f.name.value = draft.name||""; f.mode.value=draft.mode||"duration"; f.style.value=draft.style||"bar"; f.color.value=draft.color||"#6c7bff";
    if (f.color2) f.color2.value = draft.color2 || draft.color || "#6c7bff";
    f.units.value=draft.units||"auto"; f.format.value=draft.format||"{HH}:{mm}:{ss}";
    f.ring_thickness.value=draft.ring_thickness??10; f.ease.value=draft.ease||"linear"; f.tick.value=draft.tick??100; f.ms.value=draft.ms||"off";
    f.mb_bars.value = draft.mb_bars ?? ""; f.mb_ticks.value = draft.mb_ticks ?? ""; if (f.letters_n) f.letters_n.value = draft.letters_n ?? "";
    if (f.smartMethod) f.smartMethod.value = draft.smartMethod || "manifold";
    if (f.smartUrl) f.smartUrl.value = draft.smartUrl || "";
    if (draft.startOverrideMs && typeof draft.startOverrideMs === "number"){
      try { f.startWhen.value = toLocalDatetime(new Date(draft.startOverrideMs)); }
      catch(e){ f.startWhen.value = ""; }
    } else {
      f.startWhen.value = "";
    }
    f.startPct.value = (draft.startOverridePct ?? "") === null ? "" : (draft.startOverridePct ?? "");

    renderTrList(draft.triggers||[]);
    f.addPctBtn.onclick = ()=> $("#trList").appendChild(trRow({type:"percent", valuePercent:25, action:"tts", ttsTemplate:"{left} left"}));
    f.addTimeBtn.onclick = ()=> $("#trList").appendChild(trRow({type:"time", valueTimeStr:"05:00", action:"sound"}));
    f.addIntBtn.onclick = ()=> $("#trList").appendChild(trRow({type:"interval", intervalSec:60, action:"tts", ttsTemplate:"{left} remaining"}));

    ;['change','input'].forEach(ev=>{
      [f.days,f.hours,f.minutes,f.seconds,f.when,f.letters_n,f.startWhen,f.startPct]
        .forEach(el=> el && el.addEventListener(ev, updateLettersPreview));
      if (f.style) f.style.addEventListener('change', updateStyleUI);
    });
    updateStyleUI();

    if (f.mode.value === "duration"){
      const ms = draft.duration ?? 60000;
      const ds=Math.floor(ms/86400000), hs=Math.floor(ms/3600000)%24, ms2=Math.floor(ms/60000)%60, ss=Math.floor(ms/1000)%60;
      f.days.value=ds; f.hours.value=hs; f.minutes.value=ms2; f.seconds.value=ss;
    }else{
      try{ const dt=(typeof draft.targetMs==="number" && draft.targetMs>0) ? new Date(draft.targetMs) : new Date(Date.now()+3600000); f.when.value = toLocalDatetime(dt);}catch(e){ f.when.value=""; }
    }

    customFormatRow.classList.toggle("invisible", f.units.value!=="custom");
    f.units.addEventListener("change", ()=> customFormatRow.classList.toggle("invisible", f.units.value!=="custom"));
    const durFields = $("#durationFields"), dtFields = $("#datetimeFields"), smartFields = $("#smartFields");
    const startOverrideRow = $("#startOverrideRow");
    const startPctRow = $("#startPctRow");
    function toggleMode(){
      const mode = f.mode.value;
      const isDur = mode === "duration";
      const isSmart = mode === "smart";
      durFields.classList.toggle("invisible", !isDur);
      dtFields.classList.toggle("invisible", isDur || isSmart);
      if (smartFields) smartFields.classList.toggle("invisible", !isSmart);
      if (startOverrideRow) startOverrideRow.classList.toggle("invisible", isDur);
      if (startPctRow) startPctRow.classList.toggle("invisible", isDur);
    }
    toggleMode();
    f.mode.addEventListener("change", toggleMode);

    try{ editor.showModal ? editor.showModal() : editor.setAttribute("open",""); } catch(e){ editor.setAttribute("open",""); }
  }

  // --- START: Authentication and Sync Functions ---
  
  function updateUIForLoginState() {
    const isLoggedIn = !!currentUser;
    accountControls.classList.toggle('invisible', isLoggedIn);
    userSession.classList.toggle('invisible', !isLoggedIn);
    if (isLoggedIn) {
      userEmailDisplay.textContent = currentUser.email;
    }
  }
  
  function openAuthDialog(isSignUpMode = false) {
    const dialog = $("#authDialog");
    const title = $("#authTitle");
    const submitBtn = $("#authSubmitBtn");
    const switchLink = $("#authModeSwitch");
    
    $("#auth_email").value = '';
    $("#auth_password").value = '';

    if (isSignUpMode) {
      title.textContent = "Sign Up";
      submitBtn.textContent = "Create Account";
      switchLink.textContent = "Already have an account? Log In";
    } else {
      title.textContent = "Log In";
      submitBtn.textContent = "Log In";
      switchLink.textContent = "Need an account? Sign Up";
    }
    // Gracefully handle browsers that do not support <dialog>.showModal()
    try {
      dialog.showModal ? dialog.showModal() : dialog.setAttribute("open", "");
    } catch (e) {
      dialog.setAttribute("open", "");
    }
  }
  
  async function handleAuthSubmit() {
    const email = $("#auth_email").value.trim();
    const password = $("#auth_password").value;
    const isSignUpMode = $("#authTitle").textContent === "Sign Up";
    const submitBtn = $("#authSubmitBtn");

    if (!email || !password) {
      alert("Email and password are required.");
      return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = "Working...";

    try {
      if (isSignUpMode) {
        await handleSignUp(email, password);
      } else {
        await handleLogin(email, password);
      }
    } catch (error) {
        console.error("Auth error:", error);
        alert("An error occurred. Please try again.");
    } finally {
        submitBtn.disabled = false;
        const currentModeIsSignUp = $("#authTitle").textContent === "Sign Up";
        submitBtn.textContent = currentModeIsSignUp ? "Create Account" : "Log In";
    }
  }

  async function handleSignUp(email, password) {
    const checkResponse = await fetch(`${RESTDB_URL}?q={"email":"${email}"}`, {
        headers: { 'x-apikey': API_KEY }
    });
    if (!checkResponse.ok) throw new Error("Network error checking user.");
    const existingUsers = await checkResponse.json();
    if (existingUsers.length > 0) {
        alert("An account with this email already exists. Please log in.");
        return;
    }

    const newUser = {
        email,
        password,
        timers: [], // Use JSON type, send empty array
        last_modified: new Date().toISOString() // Use DateTime type, send ISO string
    };
    
    const createResponse = await fetch(RESTDB_URL, {
        method: 'POST',
        headers: { 'x-apikey': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
    });

    if (createResponse.ok) {
        alert("Account created successfully! Please log in.");
        authDialog.close();
        openAuthDialog(false);
    } else {
        alert("Failed to create account. Server returned an error.");
    }
  }

  async function handleLogin(email, password) {
    const response = await fetch(`${RESTDB_URL}?q={"email":"${email}"}`, {
        headers: { 'x-apikey': API_KEY, }
    });
    if (!response.ok) throw new Error("Network error fetching user.");
    const users = await response.json();

    if (users.length === 0) {
        alert("Error: No account found with that email.");
        return;
    }

    const user = users[0];
    if (user.password !== password) {
        alert("Error: Incorrect password.");
        return;
    }

    currentUser = { id: user._id, email: user.email };
    localStorage.setItem(KEY_USER, JSON.stringify(currentUser));
    updateUIForLoginState();
    authDialog.close();
    
    await syncTimers();
  }

  function handleLogout() {
    if (confirm("Are you sure you want to log out? Your timers will remain on this device but will no longer sync.")) {
      currentUser = null;
      localStorage.removeItem(KEY_USER);
      updateUIForLoginState();
      render();
    }
  }
  
  async function syncTimers() {
      if (!currentUser || isSyncing) return;
      isSyncing = true;
      syncBtn.textContent = "Syncing...";
      syncBtn.disabled = true;

      try {
        const response = await fetch(`${RESTDB_URL}/${currentUser.id}`, {
            headers: { 'x-apikey': API_KEY, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error("Could not fetch remote data.");
        
        const remoteUser = await response.json();
        const remoteTimers = remoteUser.timers || [];
        // RestDB returns DateTime as an ISO string. Date.parse() handles it correctly.
        const remoteTimestamp = remoteUser.last_modified ? Date.parse(remoteUser.last_modified) : 0;
        const localTimestamp = parseInt(localStorage.getItem(KEY_LAST_MODIFIED) || '0');
        
        const localTimersExist = timers.length > 0;
        const remoteTimersAreEmpty = !remoteTimers || remoteTimers.length === 0;

        if (localTimersExist && remoteTimersAreEmpty) {
            console.log("Sync: Local timers exist and remote is empty. Pushing local state.");
            await pushTimersToCloud(timers, localTimestamp || Date.now());
        } else if (remoteTimestamp > localTimestamp) {
            console.log("Sync: Remote is newer. Pulling remote state.");
            timers = remoteTimers.map(migrateTimer);
            localStorage.setItem(KEY_TIMERS, JSON.stringify(timers));
            localStorage.setItem(KEY_LAST_MODIFIED, String(remoteTimestamp));
            render();
        } else if (localTimestamp > remoteTimestamp) {
            console.log("Sync: Local is newer. Pushing local state.");
            await pushTimersToCloud(timers, localTimestamp);
        } else {
            console.log("Sync: Local and remote are up to date.");
        }
        await refreshSmartTimers();
        alert('Sync complete!');
      } catch (error) {
          console.error("Sync failed:", error);
          alert("Sync failed. Please check your connection and try again.");
      } finally {
          isSyncing = false;
          syncBtn.textContent = "Sync";
          syncBtn.disabled = false;
      }
  }

  async function pushTimersToCloud(timersArray, timestampNumber) {
    if (!currentUser) return;
    
    const payload = {
      timers: timersArray,
      last_modified: new Date(timestampNumber).toISOString() // Convert timestamp number to ISO string for RestDB
    };
    
    try {
      const response = await fetch(`${RESTDB_URL}/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'x-apikey': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      console.log("Successfully pushed changes to the cloud.");
    } catch (error) {
      console.error("Failed to push changes to the cloud:", error);
    }
  }
  // --- END: Authentication and Sync Functions ---

  $("#saveTplBtn").addEventListener("click", async ()=>{
    const triggers = await collectTrEntries(new Map());
    const tpl = {
      id: uid("tpl_"), name: f.name.value.trim() || "Template", style: f.style.value, color: f.color.value,
      color2: f.color2.value || f.color.value,
      units: f.units.value, format: f.format.value || "{HH}:{mm}:{ss}", ring_thickness: +f.ring_thickness.value || 10,
      ease: f.ease.value, tick: +f.tick.value || 100, ms: f.ms.value,
      mb_bars: f.mb_bars.value? Math.max(2, Math.min(5, +f.mb_bars.value)) : null,
      letters_n: (f.letters_n && f.letters_n.value) ? Math.max(1, Math.min(7, +f.letters_n.value)) : null,
      mb_ticks: f.mb_ticks.value? Math.max(8, Math.min(40, +f.mb_ticks.value)) : null,
      triggers, doneSoundDataUrl:null, doneTts: f.doneTts.value||""
    };
    if (tpl.style === "pro"){
      tpl.splitStyles = [...PRO_SPLIT_STYLES];
      tpl.splitSettings = null;
    }
    tpl.name = pickTemplateName(tpl);
    templates.push(tpl); saveTemplates(); alert("Saved template: "+tpl.name);
  });

  $("#saveBtn").addEventListener("click", async (e)=>{
    e.preventDefault();
    const base = {
      id: editId || uid("t_"), name: f.name.value.trim() || "Untitled", style: f.style.value, color: f.color.value,
      color2: f.color2.value || f.color.value,
      units: f.units.value, format: f.format.value || "{HH}:{mm}:{ss}", ring_thickness: +f.ring_thickness.value || 10,
      ease: f.ease.value, tick: +f.tick.value || 100, ms: f.ms.value,
      mb_bars: f.mb_bars.value? Math.max(2, Math.min(5, +f.mb_bars.value)) : null,
      mb_ticks: f.mb_ticks.value? Math.max(8, Math.min(40, +f.mb_ticks.value)) : null,
      letters_n: f.letters_n.value? Math.max(1, Math.min(7, +f.letters_n.value)) : null
    };
    const existing = editId ? timers.find(x=>x.id===base.id) : null;
    const existingMap = new Map((existing?.triggers||[]).map(e=>[e.id,e]));
    const triggers = await collectTrEntries(existingMap);

    let doneSoundDataUrl = existing?.doneSoundDataUrl || null;
    if (f.doneSound.files && f.doneSound.files[0]){
      const dataUrl = await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f.doneSound.files[0]); });
      doneSoundDataUrl = dataUrl;
    }

    let record;
    if (f.mode.value === "duration"){
      const dur = msOfDuration(f.days.value, f.hours.value, f.minutes.value, f.seconds.value);
      const start = now();
      const plan = planMultiBar(dur, base.mb_bars||null, base.mb_ticks||null);
      record = { ...base, mode:"duration", duration:dur, start, total0: dur, mb_plan:plan, triggers, doneSoundDataUrl, doneTts:f.doneTts.value||"", prestigeLevel: existing?.prestigeLevel || 0 };
    } else if (f.mode.value === "smart") {
      const method = f.smartMethod.value;
      if (method !== "manifold") { alert("Unsupported smart method"); return; }
      const url = f.smartUrl.value.trim();
      if (!url) { alert("Enter a market URL"); return; }
      const ts = await getExpectedDate(url);
      if (!ts) { alert("Failed to fetch market date"); return; }
      const nowTs = now();
      let startOverrideMs = null;
      let startOverridePct = null;
      let startMs = nowTs;
      if (f.startWhen.value) {
        const parsedStart = parseLocalDateTime(f.startWhen.value);
        if (parsedStart === null) { alert("Invalid start date & time"); return; }
        startOverrideMs = parsedStart;
        startMs = parsedStart;
      } else if (f.startPct.value && f.startPct.value.trim() !== "") {
        const pRaw = parseFloat(f.startPct.value);
        const p = isNaN(pRaw) ? 0 : clamp(pRaw / 100, 0, 0.9999);
        startOverridePct = Math.round(pRaw * 1000) / 1000;
        let candidate = (nowTs - p * ts) / (1 - p);
        if (!Number.isFinite(candidate)) candidate = nowTs;
        startMs = Math.min(nowTs, Math.floor(candidate));
      }
      let tot = ts - startMs;
      if (!Number.isFinite(tot) || tot <= 0) tot = 1000;
      const plan = planMultiBar(tot, base.mb_bars||null, base.mb_ticks||null);
      record = { ...base, mode:"smart", targetMs: ts, start: startMs, startOverrideMs, startOverridePct,
        smartMethod: method, smartUrl: url, total0: tot, mb_plan: plan, triggers, doneSoundDataUrl,
        doneTts: f.doneTts.value || "", prestigeLevel: existing?.prestigeLevel || 0 };
    } else {
      const targetLocal = f.when.value;
      if (!targetLocal) { alert("Select an end date & time"); return; }
      const targetMs = parseLocalDateTime(targetLocal);
      if (targetMs === null) { alert("Invalid end date & time"); return; }
      const nowTs = now();
      let startOverrideMs = null;
      let startOverridePct = null;
      let startMs = nowTs;
      if (f.startWhen.value) {
        const parsedStart = parseLocalDateTime(f.startWhen.value);
        if (parsedStart === null) { alert("Invalid start date & time"); return; }
        startOverrideMs = parsedStart;
        startMs = parsedStart;
      } else if (f.startPct.value && f.startPct.value.trim() !== "") {
        const pRaw = parseFloat(f.startPct.value);
        const p = isNaN(pRaw) ? 0 : clamp(pRaw / 100, 0, 0.9999);
        startOverridePct = Math.round(pRaw * 1000) / 1000;
        let candidate = (nowTs - p * targetMs) / (1 - p);
        if (!Number.isFinite(candidate)) candidate = nowTs;
        startMs = Math.min(nowTs, Math.floor(candidate));
      }
      let tot = targetMs - startMs;
      if (!Number.isFinite(tot) || tot <= 0) {
        tot = 1000;
      }
      const plan = planMultiBar(tot, base.mb_bars||null, base.mb_ticks||null);
      record = { ...base, mode: "datetime", targetMs, start: startMs, startOverrideMs, startOverridePct,
        total0: tot, mb_plan: plan, triggers, doneSoundDataUrl, doneTts: f.doneTts.value || "",
        prestigeLevel: existing?.prestigeLevel || 0 };
    }
    if (record.style === "pro"){
      ensureProSplitState(record);
    }
    const i = timers.findIndex(x=>x.id===record.id);
    if (i>=0) timers[i] = { ...timers[i], ...record, _firedMap:{}, _kMap:{} };
    else timers.push(record);
    
    await updateAndSaveTimers();
    if (editor.open) editor.close();
  });

  exportBtn.addEventListener("click", ()=>{
    const blob=new Blob([JSON.stringify(timers,null,2)], {type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="hyper-timers.json"; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  });
  importInput.addEventListener("change", async (ev)=>{
    const file=ev.target.files?.[0]; if(!file) return; const text=await file.text();
    try{ 
      const data=JSON.parse(text); if(!Array.isArray(data)) throw new Error("Invalid file"); 
      await updateAndSaveTimers(data.map(migrateTimer));
      alert("Imported "+data.length+" timer(s)."); 
    }
    catch(e){ alert("Failed to import: "+e.message); } finally { importInput.value=""; }
  });

  addBtn.addEventListener("click", ()=>openEditor(null,null));
  fab.addEventListener("click", ()=>openEditor(null,null));

  function updateProMultiBarNote(card, t){
    const note = card.querySelector('.split-note');
    if (!note) return;
    const plan = t.splitSettings?.multibar?.plan || t.mb_plan;
    if (!plan){
      note.textContent = 'Multi Bar';
      return;
    }
    const ticks = Array.isArray(plan.ticks) ? plan.ticks.join(' × ') : '';
    const parts = [];
    if (plan.bars) parts.push(`${plan.bars} bars`);
    if (ticks) parts.push(`${ticks} ticks`);
    if (plan.dtMs) parts.push(`${Math.round(plan.dtMs/1000)}s step`);
    note.textContent = parts.join(' • ') || 'Multi Bar';
  }

  function updateProLettersNote(card, t){
    const note = card.querySelector('.split-note');
    if (!note) return;
    const total = Math.max(1000, t.total0 || baseTotal(t));
    const lettersPlan = t.splitSettings?.letters || planLetters(total, t.letters_n||null);
    if (!lettersPlan){
      note.textContent = 'Letters';
      return;
    }
    const parts = [`${lettersPlan.n} letter${lettersPlan.n===1?'':'s'}`];
    if (lettersPlan.frameMs) parts.push(`${(lettersPlan.frameMs/1000).toFixed(2)}s/frame`);
    note.textContent = parts.join(' • ');
  }

  function updateProColorPreview(card, t, progress, accent=null){
    const preview = card.querySelector('.split-color-preview');
    if (!preview) return;
    const colorInfo = t.splitSettings?.color || {};
    const startHex = (colorInfo.start || t.color || "#6c7bff").toUpperCase();
    const endHex = (colorInfo.end || t.color2 || t.color || "#6c7bff").toUpperCase();
    const chips = preview.querySelectorAll('.split-color-chip');
    if (chips[0]) chips[0].textContent = startHex;
    if (chips[1]) chips[1].textContent = endHex;
    const activeAccent = accent || currentAccentColor({ ...t, style: "color" }, progress);
    if (activeAccent){
      preview.style.background = gradientBackgroundForAccent(activeAccent);
      preview.style.borderColor = rgbaString(activeAccent.rgb, activeAccent.isLight ? 0.28 : 0.36);
      preview.classList.toggle('light', activeAccent.isLight);
      preview.classList.toggle('dark', !activeAccent.isLight);
      preview.style.color = activeAccent.isLight ? '#05070b' : '#f7f8ff';
      chips.forEach(chip => {
        chip.style.background = activeAccent.isLight ? 'rgba(255,255,255,0.68)' : 'rgba(0,0,0,0.35)';
        chip.style.color = activeAccent.isLight ? '#05070b' : '#f7f8ff';
      });
    }
    const note = card.querySelector('.split-note');
    if (note) note.textContent = `${startHex} → ${endHex}`;
  }

  function createColorPreviewElement(){
    const preview = document.createElement("div");
    preview.className = "split-color-preview";
    const chips = document.createElement("div");
    chips.className = "split-color-chips";
    const startChip = document.createElement("span");
    startChip.className = "split-color-chip";
    const endChip = document.createElement("span");
    endChip.className = "split-color-chip";
    chips.append(startChip, endChip);
    preview.appendChild(chips);
    return preview;
  }

  function createTimerCard(t, splitStyle=null){
    const fallbackStyle = t.style || "bar";
    const displayStyle = splitStyle ? (splitStyle === "color" ? "color" : splitStyle) : fallbackStyle;
    const timerForVisual = displayStyle === (t.style || "") ? t : { ...t, style: displayStyle };
    const progress = visualProgress(t);

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = t.id;
    card.dataset.displayStyle = displayStyle;
    if (splitStyle) card.dataset.proPart = splitStyle;

    const actions = document.createElement("div");
    actions.className = "actions";
    const pauseBtn = (t.mode==="datetime" || t.mode==="smart") ? "" : `<button class="action-btn" data-act="pause" title="${t.paused?'Resume':'Pause'}">⏯︎</button>`;
    actions.innerHTML = `${pauseBtn}<button class="action-btn" data-act="prestige" title="Prestige">★</button><button class="action-btn" data-act="tplsave" title="Save template">⇪</button><button class="action-btn" data-act="edit" title="Edit">✎</button><button class="action-btn" data-act="delete" title="Delete">🗑</button>`;
    card.appendChild(actions);

    const title = document.createElement("div");
    title.className="title";
    const dotEl = document.createElement("span");
    dotEl.className="dot";
    dotEl.dataset.role="accent-dot";
    title.appendChild(dotEl);
    const nameEl = document.createElement("span");
    nameEl.textContent = t.name || "Untitled";
    title.appendChild(nameEl);
    if (t.prestigeLevel){
      const badgeEl = document.createElement("span");
      badgeEl.className = "badge";
      badgeEl.textContent = `Prestige ${t.prestigeLevel}`;
      title.appendChild(badgeEl);
    }
    card.appendChild(title);

    const subt = document.createElement("div");
    const unitLabel = t.units==="custom" ? "Custom" : t.units.toUpperCase();
    let styleLabel;
    if (splitStyle){
      const baseLabel = PRO_SPLIT_LABELS[splitStyle] || splitStyle.toUpperCase();
      styleLabel = `Pro • ${baseLabel}`;
    } else {
      styleLabel = t.style === "pro" ? "PRO MODE" : (fallbackStyle||"bar").toUpperCase();
    }
    subt.className="subtitle";
    subt.textContent = (t.mode==="duration"?"Duration":(t.mode==="smart"?"Smart":"Target"))+" • "+styleLabel+" • "+unitLabel;
    card.appendChild(subt);

    const big = makeBig(t);

    if (splitStyle === "color"){
      const preview = createColorPreviewElement();
      card.appendChild(preview);
      card.appendChild(big);
      const note = document.createElement("div");
      note.className = "split-note";
      card.appendChild(note);
    } else if (["ring","pie","multibar","letters"].includes(displayStyle)){
      const wrap = document.createElement("div"); wrap.className="canvaswrap";
      const cvs = makeCanvas(280); wrap.appendChild(cvs); card.appendChild(wrap);
      drawVisual(cvs, timerForVisual);
      card.appendChild(big);
      if (splitStyle){
        const note = document.createElement("div");
        note.className = "split-note";
        card.appendChild(note);
      }
    } else if (displayStyle === "bar"){
      card.appendChild(big);
      const bar = document.createElement("div");
      bar.className="progressbar";
      const fill = document.createElement("div");
      fill.style.background = timerForVisual.color;
      bar.appendChild(fill);
      card.appendChild(bar);
      fill.style.width = (progress*100).toFixed(2)+"%";
    } else {
      card.appendChild(big);
    }

    if (splitStyle === "multibar") updateProMultiBarNote(card, t);
    else if (splitStyle === "letters") updateProLettersNote(card, t);

    if (splitStyle === "color"){
      const colorTimer = timerForVisual.style === "color" ? timerForVisual : { ...timerForVisual, style: "color" };
      const accent = currentAccentColor(colorTimer, progress);
      updateProColorPreview(card, t, progress, accent);
      updateCardVisuals(card, colorTimer, accent);
    } else {
      const accent = currentAccentColor(timerForVisual, progress);
      updateCardVisuals(card, timerForVisual, accent);
    }

    const foot = document.createElement("div");
    foot.className="footer-row";
    const pill = document.createElement("span"); pill.className="pill"; pill.dataset.role="accent-pill";
    pill.textContent="Copy remaining"; pill.addEventListener("click", ()=>{ navigator.clipboard?.writeText(fmt(remainingMs(t), t.units, t.ms==='on', t.units==='custom'?t.format:null, t.name)); pill.textContent="Copied ✓"; setTimeout(()=>pill.textContent="Copy remaining", 900);});
    foot.appendChild(pill);

    const eta = document.createElement("span"); eta.className="note";
    if (t.mode==="datetime" || t.mode==="smart"){ const d=new Date(t.targetMs); eta.textContent="Ends "+d.toLocaleString(); }
    else { const d = new Date(t.start + (t.duration||0)); eta.textContent = "ETA " + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
    foot.appendChild(eta);
    card.appendChild(foot);

    actions.addEventListener("click", async ev=>{
      const act = ev.target?.dataset?.act;
      if (!act) return;
      if (act==="pause"){
        const remNow = remainingMs(t);
        t.paused = !t.paused;
        if (t.paused){ t.pausedAt = Date.now(); t.leftWhenPaused = remNow; }
        else { const delta = Date.now() - (t.pausedAt||Date.now()); if (t.mode==="duration"){ t.start += delta; } else { t.targetMs += delta; } delete t.pausedAt; }
        render();
      } else if (act==="edit"){
        openEditor(t.id);
      } else if (act==="delete"){
        if (confirm("Delete timer?")){
          const newTimers = timers.filter(x=>x.id!==t.id);
          await updateAndSaveTimers(newTimers);
        }
      } else if (act==="prestige"){
        doPrestige(t);
        await updateAndSaveTimers();
      } else if (act==="tplsave"){
        saveTemplateFromTimer(t);
      }
    });

    return card;
  }

  function buildTimerCards(t){
    if (t.style === "pro"){
      ensureProSplitState(t);
      const splits = Array.isArray(t.splitStyles) && t.splitStyles.length ? t.splitStyles : PRO_SPLIT_STYLES;
      return splits.map(styleName => createTimerCard(t, styleName));
    }
    return [createTimerCard(t, null)];
  }

  function render(){
    grid.innerHTML = "";
    timers.sort((a,b)=> remainingMs(a) - remainingMs(b));

    timers.forEach(t => {
      const cards = buildTimerCards(t);
      cards.forEach(card => grid.appendChild(card));
    });
  }

  function makeCanvas(size){ const cvs=document.createElement("canvas"); cvs.width=size*2; cvs.height=size*2; cvs.style.width=size+"px"; cvs.style.height=size+"px"; return cvs; }
  function makeBig(t){
    const big=document.createElement("div"); big.className="big";
    const span=document.createElement("span"); span.className="flip";
    const template = t.units==="custom" ? t.format : null;
    span.textContent = fmt(remainingForDisplay(t), t.units, t.ms==="on", template, t.name);
    big.appendChild(span); return big;
  }

  function drawVisual(cvs,t){
    const style=t.style;
    if (style==="ring") return drawRing(cvs,t);
    if (style==="pie") return drawPie(cvs,t);
    if (style==="letters") return drawLetters(cvs,t);
    if (style==="multibar") return drawMultiBar(cvs,t);
  }
  function ringRadius(cvs, px){ const dpr=window.devicePixelRatio||1; return (px||10)*dpr; }
  function drawRing(cvs,t){
    const ctx=cvs.getContext("2d"); const w=cvs.width,h=cvs.height; const dpr=window.devicePixelRatio||1; const size=Math.min(w,h);
    const cx=w/2, cy=h/2; const lw=ringRadius(cvs, t.ring_thickness||10); const R=size/2-lw;
    const p=visualProgress(t); const start=-Math.PI/2;
    ctx.lineWidth=lw; ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.stroke();
    ctx.lineCap='round'; ctx.lineWidth=lw; ctx.strokeStyle=t.color; const end=start+p*Math.PI*2; ctx.beginPath(); ctx.arc(cx,cy,R,start,end); ctx.stroke();
  }
  
  function planLetters(totalMs, nOverride=null){
    const MINN=1, MAXN=7;
    const total = Math.max(1, Math.round(totalMs));
    let chosenN;
    if (nOverride && Number.isFinite(+nOverride)){
      chosenN = clamp(+nOverride, MINN, MAXN);
    } else {
      chosenN = 1;
      for (let n=1; n<=MAXN; n++){
        const frames = Math.pow(26, n) - 1;
        const frameMs = total / frames;
        if (frameMs >= 1000) chosenN = n; else break;
      }
    }
    const frames = Math.pow(26, chosenN) - 1;
    const frameMs = total / frames;
    return { n: chosenN, frames, frameMs };
  }

  function ensureProSplitState(t){
    if (!t || t.style !== "pro") return t;
    const baseList = Array.isArray(t.splitStyles) ? t.splitStyles : [];
    const ordered = [];
    baseList.forEach(style => {
      if (PRO_SPLIT_STYLES.includes(style) && !ordered.includes(style)) ordered.push(style);
    });
    PRO_SPLIT_STYLES.forEach(style => {
      if (!ordered.includes(style)) ordered.push(style);
    });
    t.splitStyles = ordered;

    const total = Math.max(1000, t.total0 || baseTotal(t) || 1000);
    if (!t.mb_plan){
      t.mb_plan = planMultiBar(total, t.mb_bars||null, t.mb_ticks||null);
    }
    const lettersPlan = planLetters(total, t.letters_n || null);
    const startHex = normalizeColorString(t.color);
    const endHex = normalizeColorString(t.color2, startHex);

    t.splitSettings = {
      multibar: {
        plan: t.mb_plan,
        barsOverride: t.mb_bars ?? null,
        ticksOverride: t.mb_ticks ?? null
      },
      letters: lettersPlan,
      color: {
        start: startHex,
        end: endHex
      }
    };
    return t;
  }

  function lettersFromIndex(idx, n){
    const base = 26;
    const max = Math.pow(base, n) - 1;
    let x = Math.max(0, Math.min(idx, max));
    const chars = Array(n).fill(0);
    for (let i=n-1; i>=0; i--){
      chars[i] = x % base;
      x = Math.floor(x / base);
    }
    return chars.map(d => String.fromCharCode(65 + d)).join("");
  }

  function currentLetters(t){
    const total = t.total0 || baseTotal(t);
    const rem = Math.max(0, remainingMs(t));
    const elapsed = Math.max(0, total - rem);
    const plan = planLetters(Math.max(1000, total), t.letters_n||null);
    const F = Math.pow(26, plan.n) - 1;
    const idx = Math.min(F, Math.floor(elapsed / plan.frameMs));
    const text = (rem<=0) ? "Z".repeat(plan.n) : lettersFromIndex(idx, plan.n);
    return { text, plan };
  }
  
  function drawLetters(cvs,t){
    const dpr = window.devicePixelRatio||1;
    const wrap = cvs.parentElement;
    const card = wrap?.closest('.card');
    const cardW = card ? card.clientWidth : (parseFloat(getComputedStyle(cvs).width)||280);
    const availW = Math.max(180, cardW - 28);
    const cssH = parseFloat(getComputedStyle(cvs).height) || 280;

    const total = t.total0 || baseTotal(t);
    const rem = Math.max(0, remainingMs(t));
    const elapsed = Math.max(0, total - rem);

    const plan = planLetters(Math.max(1000, total), t.letters_n||null);
    const n = plan.n;
    const frameMs = plan.frameMs;

    const ctx = cvs.getContext('2d');

    let fs = Math.floor(cssH * 0.36);
    const pad = Math.max(16, Math.floor(cssH * 0.12));

    ctx.save();
    ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    let worst = "W".repeat(Math.max(1,n));
    let wWorst = ctx.measureText(worst).width;
    if (wWorst + pad*2 > availW){
      const scale = (availW - pad*2) / wWorst;
      fs = Math.max(10, Math.floor(fs * scale));
      ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      wWorst = ctx.measureText(worst).width;
    }
    ctx.restore();

    const targetW = Math.max(cssH, Math.min(availW, wWorst + pad*2));
    if (Math.abs((parseFloat(getComputedStyle(cvs).width)||0) - targetW) > 1){
      cvs.style.width = targetW + "px";
      wrap.style.width = targetW + "px";
    }
    const bw = Math.round(targetW * dpr), bh = Math.round(cssH * dpr);
    if (cvs.width !== bw || cvs.height !== bh){ cvs.width = bw; cvs.height = bh; }

    const { text } = currentLetters(t);
    const w = cvs.width, h = cvs.height;
    ctx.clearRect(0,0,w,h);
    ctx.font = `${fs*dpr}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle = t.color || '#6c7bff';
    ctx.fillText(text, w/2, h/2);

    if (frameMs > 1000 && rem > 0){
      const phase = (elapsed % frameMs) / frameMs;
      const barH = Math.max(6*dpr, Math.round(bh * 0.04));
      const barPad = Math.max(10*dpr, Math.round(bw * 0.04));
      const x = barPad, y = h - barH - 10*dpr;
      const barW = w - barPad*2;
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(x, y, barW, barH);
      ctx.fillStyle = (t.color || '#6c7bff');
      ctx.fillRect(x, y, Math.max(0, Math.min(barW, barW*phase)), barH);
    }
  }
  
  function drawPie(cvs,t){
    const ctx=cvs.getContext("2d"); const w=cvs.width,h=cvs.height; const dpr=window.devicePixelRatio||1; const size=Math.min(w,h); const cx=w/2, cy=h/2; const R=size/2-4*dpr;
    const p=visualProgress(t); const start=-Math.PI/2; const end=start+p*Math.PI*2;
    ctx.fillStyle='rgba(255,255,255,.06)'; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=t.color; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,start,end); ctx.closePath(); ctx.fill();
  }

  function drawMultiBar(cvs,t){
    const ctx=cvs.getContext('2d'); const w=cvs.width,h=cvs.height; const dpr=window.devicePixelRatio||1; const pad=16*dpr;
    const plan = t.mb_plan || planMultiBar(Math.max(1000, t.total0 || baseTotal(t)), t.mb_bars||null, t.mb_ticks||null);
    const bars = plan.bars, ticks = plan.ticks, dt = plan.dtMs;
    const areaW = w - pad*2;
    const barH=(h-pad*2)/bars * .68, gap=(h-pad*2)/bars * .32;

    const total = t.total0 || baseTotal(t);
    const rem = Math.max(0, remainingMs(t));
    const elapsed = Math.max(0, total - rem);
    const units = elapsed / dt;

    let div = 1;
    for (let i=0;i<bars;i++){
      const y = pad + i*(barH+gap);
      const base = ticks[i];
      const u = units / div;
      const completed = Math.floor(u) % base;
      const partial = (i===0) ? (u - Math.floor(u)) : 0;
      const prog = (completed + partial) / base;
      ctx.fillStyle='rgba(255,255,255,.08)'; roundRect(ctx, pad, y, areaW, barH, 8*dpr, true, false);
      ctx.fillStyle = t.color; roundRect(ctx, pad, y, areaW*prog, barH, 8*dpr, true, false);
      ctx.fillStyle='rgba(255,255,255,.10)'; const segW = areaW/base;
      for (let k=1;k<base;k++){ const x=pad + segW*k; ctx.fillRect(x-1, y, 2, barH); }
      div *= base;
    }
  }
  function roundRect(ctx,x,y,w,h,r,fill,stroke){ if(w<0) return; if(r>w/2) r=w/2; if(r>h/2) r=h/2; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); if(fill) ctx.fill(); if(stroke) ctx.stroke(); }

  function doPrestige(t){
    const rem = Math.max(0, remainingMs(t));
    const nowTs = Date.now();
    if (t.mode === "duration"){
      t.start = nowTs; 
      t.duration = rem; 
      t.total0 = rem;
    } else {
      t.start = nowTs; 
      t.total0 = Math.max(0, (t.targetMs||0) - nowTs);
      delete t.startOverrideMs;
      delete t.startOverridePct;
    }
    t.mb_plan = planMultiBar(Math.max(1000, t.total0), t.mb_bars||null, t.mb_ticks||null);
    t.prestigeLevel = (t.prestigeLevel||0) + 1;
  }

  function escapeHtml(str){ return String(str).replace(/[&<>"']/g, s=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;"}[s])); }

  function tick(){
    timers.forEach(t=>{
      if (t.style === "pro") ensureProSplitState(t);
      const cards = grid.querySelectorAll('.card[data-id="'+t.id+'"]');
      if (!cards.length) return;
      const template = t.units==="custom" ? t.format : null;
      const newTxt = fmt(remainingForDisplay(t), t.units, t.ms==="on", template, t.name);
      const progress = visualProgress(t);

      cards.forEach(card => {
        const txt = card.querySelector(".big .flip");
        if (txt && txt.textContent !== newTxt){
          txt.textContent = newTxt;
          txt.style.transform = "perspective(400px) rotateX(16deg)";
          setTimeout(()=>txt.style.transform = "perspective(400px) rotateX(0deg)", 120);
        }

        const displayStyle = card.dataset.displayStyle || t.style || "bar";
        const timerForVisual = displayStyle === (t.style || "") ? t : { ...t, style: displayStyle };

        if (displayStyle === "bar"){
          const fill = card.querySelector(".progressbar > div");
          if (fill) fill.style.width = (progress*100).toFixed(2)+"%";
        } else if (["ring","pie","multibar","letters"].includes(displayStyle)){
          const cvs = card.querySelector("canvas");
          if (cvs) drawVisual(cvs, timerForVisual);
          if (card.dataset.proPart === "multibar") updateProMultiBarNote(card, t);
          if (card.dataset.proPart === "letters") updateProLettersNote(card, t);
        }

        let accentTimer = timerForVisual;
        let accent;
        if (card.dataset.proPart === "color"){
          accentTimer = timerForVisual.style === "color" ? timerForVisual : { ...timerForVisual, style: "color" };
          accent = currentAccentColor(accentTimer, progress);
          updateProColorPreview(card, t, progress, accent);
        } else {
          accent = currentAccentColor(accentTimer, progress);
        }
        updateCardVisuals(card, accentTimer, accent);
      });

      const prevRem = t._prevRem ?? remainingMs(t);
      const rem = remainingMs(t); const total = t.total0 || baseTotal(t);
      t._firedMap = t._firedMap || {}; t._kMap = t._kMap || {};
      const ePrev = Math.max(0, total - prevRem); const eNow = Math.max(0, total - rem);
      (t.triggers||[]).forEach(tr=>{
        if (tr.type==="percent"){ if (crossedPct(ePrev, eNow, total, tr.valuePercent) && !t._firedMap[tr.id]){ fireAction(t,tr,rem,total); t._firedMap[tr.id]=true; } }
        else if (tr.type==="time"){ if (crossedTime(prevRem, rem, tr.valueTime) && !t._firedMap[tr.id]){ fireAction(t,tr,rem,total); t._firedMap[tr.id]=true; } }
        else if (tr.type==="interval"){ const intMs=(tr.intervalSec*1000)||1000; const kPrev=Math.floor(ePrev/intMs), kNow=Math.floor(eNow/intMs); const last=t._kMap[tr.id]??0; if (kNow>last){ const quantRem = total - kNow*intMs; fireAction(t,tr,Math.max(0,quantRem),total); t._kMap[tr.id]=kNow; } }
      });

      if (!t.completed && rem <= 0){
        t.completed = true;
        if (t.doneSoundDataUrl) playDataUrl(t.doneSoundDataUrl); else tone(990,.25);
        if (t.doneTts) speak(fillTokens(t.doneTts, 0, total, t));
        updateAndSaveTimers();
      }
      t._prevRem = rem;
    });
    const minTick = timers.length ? Math.min(...timers.map(t=> +t.tick || 100), 100) : 100;
    setTimeout(()=> requestAnimationFrame(tick), clamp(minTick, 16, 250));
  }

  pauseAllBtn.addEventListener("click", ()=>{
    const anyPaused = timers.some(t=>t.mode==="duration" && t.paused);
    const targetState = !anyPaused;
    timers.forEach(t=>{
      if (t.mode!=="duration") return;
      if (targetState && !t.paused){ const remNow = remainingMs(t); t.paused = true; t.pausedAt = Date.now(); t.leftWhenPaused = remNow; }
      if (!targetState && t.paused){ const delta = Date.now() - (t.pausedAt||Date.now()); t.start += delta; delete t.pausedAt; t.paused=false; }
    });
    render(); // Pause is visual and doesn't need a full save/sync
  });

  loginBtn.addEventListener('click', () => openAuthDialog(false));
  signupBtn.addEventListener('click', () => openAuthDialog(true));
  logoutBtn.addEventListener('click', handleLogout);
  syncBtn.addEventListener('click', syncTimers);
  tplBtn.addEventListener("click", ()=> openTemplateMenu());
  document.addEventListener("click", (e)=>{ if(!templateMenu.contains(e.target) && e.target!==tplBtn){ templateMenu.classList.remove("open"); } });
  $("#authModeSwitch").addEventListener('click', (e) => {
    e.preventDefault();
    const isSignUp = $("#authTitle").textContent === "Log In";
    openAuthDialog(isSignUp);
  });
  $("#authSubmitBtn").addEventListener('click', handleAuthSubmit);
  authDialog.addEventListener('close', () => {
    const submitBtn = $("#authSubmitBtn");
    submitBtn.disabled = false;
    const currentModeIsSignUp = $("#authTitle").textContent === "Sign Up";
    submitBtn.textContent = currentModeIsSignUp ? "Create Account" : "Log In";
  });

  load(); 
  render(); 
  requestAnimationFrame(tick);
})();
