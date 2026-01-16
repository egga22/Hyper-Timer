(() => {
  "use strict";
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];
  const now = () => Date.now();
  const pad2 = n => String(n).padStart(2, "0");
  const pad3 = n => String(n).padStart(3, "0");
  const DAY_MS = 86400000;
  const WEEK_MS = 7 * DAY_MS;
  const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
  const uid = (p="id_") => p + Math.random().toString(36).slice(2);
  function parseTimestamp(raw) {
    if (raw == null) return 0;
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : 0;
    }
    if (typeof raw === "string") {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
      try {
        const maybeObject = JSON.parse(raw);
        if (maybeObject && typeof maybeObject === "object") {
          return parseTimestamp(maybeObject);
        }
      } catch (err) {
        // Ignore JSON parse errors and continue with other strategies.
      }
      return 0;
    }
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const ts = parseTimestamp(entry);
        if (ts) return ts;
      }
      return 0;
    }
    if (typeof raw === "object") {
      if (Object.prototype.hasOwnProperty.call(raw, "$date")) {
        return parseTimestamp(raw.$date);
      }
      if (Object.prototype.hasOwnProperty.call(raw, "$numberLong")) {
        return parseTimestamp(raw.$numberLong);
      }
      if (typeof raw.valueOf === "function" && raw.valueOf !== Object.prototype.valueOf) {
        const value = raw.valueOf();
        if (value !== raw) {
          const ts = parseTimestamp(value);
          if (ts) return ts;
        }
      }
    }
    return 0;
  }
  function canonicalizeTimersForComparison(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(item => {
        if (!item || typeof item !== "object") return {};
        const { _prevRem, _firedMap, _kMap, ...rest } = item;
        return { ...rest };
      })
      .sort((a, b) => {
        const idA = typeof a.id === "string" ? a.id : "";
        const idB = typeof b.id === "string" ? b.id : "";
        return idA.localeCompare(idB);
      });
  }

  function parseFlexibleTimestamp(raw) {
    if (raw == null) return NaN;
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : NaN;
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return NaN;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    if (typeof raw === "object") {
      if (Object.prototype.hasOwnProperty.call(raw, "$date")) {
        return parseFlexibleTimestamp(raw.$date);
      }
      if (Object.prototype.hasOwnProperty.call(raw, "$numberLong")) {
        return parseFlexibleTimestamp(raw.$numberLong);
      }
      if (typeof raw.valueOf === "function" && raw.valueOf !== Object.prototype.valueOf) {
        const value = raw.valueOf();
        if (value !== raw) {
          return parseFlexibleTimestamp(value);
        }
      }
    }
    return NaN;
  }

  function normalizeWeekStartTimestamp(raw) {
    const ts = parseFlexibleTimestamp(raw);
    if (!Number.isFinite(ts)) return NaN;
    const dt = new Date(ts);
    if (!Number.isFinite(dt.getTime())) return NaN;
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() - dt.getDay());
    return dt.getTime();
  }
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

  let fallbackFullscreenCard = null;

  function activeNativeFullscreenElement(){
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }

  async function tryEnterNativeFullscreen(card){
    if (!card) return false;
    const request = card.requestFullscreen || card.webkitRequestFullscreen || card.msRequestFullscreen;
    if (!request) return false;
    try {
      const result = request.call(card);
      if (result && typeof result.then === "function") {
        await result;
      }
      return true;
    } catch (err) {
      console.warn("Failed to enter fullscreen", err);
      return false;
    }
  }

  async function exitNativeFullscreenIfActive(){
    const active = activeNativeFullscreenElement();
    if (!active) return false;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!exit) return false;
    try {
      const result = exit.call(document);
      if (result && typeof result.then === "function") {
        await result;
      }
      return true;
    } catch (err) {
      console.warn("Failed to exit fullscreen", err);
      return false;
    }
  }

  function deactivateFallbackFullscreen(card=null){
    const target = card || fallbackFullscreenCard;
    if (!target) return;
    target.classList.remove("fullscreen-fallback");
    if (target.dataset) delete target.dataset.fullscreenFallback;
    if (!document.querySelector(".card.fullscreen-fallback")){
      document.body.classList.remove("has-fullscreen-fallback");
      if (!card || card === fallbackFullscreenCard) fallbackFullscreenCard = null;
    }
  }

  function activateFallbackFullscreen(card){
    if (!card) return;
    if (fallbackFullscreenCard && fallbackFullscreenCard !== card){
      deactivateFallbackFullscreen(fallbackFullscreenCard);
    }
    fallbackFullscreenCard = card;
    card.classList.add("fullscreen-fallback");
    if (card.dataset) card.dataset.fullscreenFallback = "1";
    document.body.classList.add("has-fullscreen-fallback");
  }

  function handleEscapeForFallback(ev){
    if (ev.key === "Escape") deactivateFallbackFullscreen();
  }

  document.addEventListener("keydown", handleEscapeForFallback);

  const settingsBtn = $("#settingsBtn");
  const settingsDialog = $("#settingsDialog");
  const settingsSignedOut = $("#settingsSignedOut");
  const settingsSignedIn = $("#settingsSignedIn");
  const settingsLoginBtn = $("#settingsLoginBtn");
  const settingsSignupBtn = $("#settingsSignupBtn");
  const settingsLogoutBtn = $("#settingsLogoutBtn");
  const settingsSyncBtn = $("#settingsSyncBtn");
  const settingsUserEmail = $("#settingsUserEmail");
  const settingsRoleDisplay = $("#settingsRoleDisplay");
  const proAccessNotice = $("#proAccessNotice");
  const authDialog = $("#authDialog");
  const settingsDefaultsSection = $("#settingsDefaultsSection");
  const settingsDefaultStyle = $("#settingsDefaultStyle");
  const settingsDefaultUnits = $("#settingsDefaultUnits");
  const settingsAutoUnitsMode = $("#settingsAutoUnitsMode");
  const settingsCustomFormatRow = $("#settingsCustomFormatRow");
  const settingsCustomFormat = $("#settingsCustomFormat");
  const settingsDefaultsSaveBtn = $("#settingsDefaultsSaveBtn");
  const settingsDefaultsStatus = $("#settingsDefaultsStatus");
  const settingsLoopsSection = $("#settingsLoopsSection");
  const settingsLoopsToggle = $("#settingsLoopsToggle");
  const shortTermDialog = $("#shortTermLoopDialog");
  const shortTermEventsList = $("#shortTermEventsList");
  const shortTermEventsEmpty = $("#shortTermEventsEmpty");
  const addShortTermWeeklyBtn = $("#addShortTermWeeklyBtn");
  const addShortTermSingleBtn = $("#addShortTermSingleBtn");
  const saveShortTermEventsBtn = $("#saveShortTermEventsBtn");

  function resetAuthDialogState() {
    const submitBtn = $("#authSubmitBtn");
    if (!submitBtn) return;
    submitBtn.disabled = false;
    const title = $("#authTitle");
    const currentModeIsSignUp = title && title.textContent === "Sign Up";
    submitBtn.textContent = currentModeIsSignUp ? "Create Account" : "Log In";
  }

  function closeAuthDialog() {
    if (!authDialog) return;
    if (typeof authDialog.close === "function") {
      try {
        authDialog.close();
        return;
      } catch (err) {
        // Fall through to the attribute removal fallback below.
      }
    }
    authDialog.removeAttribute("open");
    authDialog.dispatchEvent(new Event("close"));
  }

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
    loopDetails: $("#loopingSection"),
    loopEnabled: $("#f_loopEnabled"),
    loopInterval: $("#f_loopInterval"),
    loopUnit: $("#f_loopUnit"),
    loopWeeklyControls: $("#loopingWeeklyControls"),
    loopWeeklyDays: $("#f_loopWeeklyDays"),
    loopWeekStartRow: $("#loopWeekStartRow"),
    loopWeekStartOffset: $("#f_loopWeekStartOffset"),
    loopMonthlyMode: $("#f_loopMonthlyMode"),
    loopMonthlyDay: $("#f_loopMonthlyDay"),
    loopMonthlyOrdinal: $("#f_loopMonthlyOrdinal"),
    loopMonthlyWeekday: $("#f_loopMonthlyWeekday"),
    loopDatetimeFields: $("#loopingDatetimeFields"),
    loopMonthlyControls: $("#loopingMonthlyControls"),
    loopDurationNote: $("#loopingDurationNote"),
    loopMonthlyDayRow: $("#loopMonthlyDayRow"),
    loopMonthlyOrdinalRow: $("#loopMonthlyOrdinalRow"),
    loopAlignRow: $("#loopingAlignRow"),
    loopAlignStart: $("#f_loopAlignStart"),
    loopShortTermSummary: $("#loopShortTermSummary"),
    loopShortTermSummaryText: $("#loopShortTermSummaryText"),
    loopShortTermEditBtn: $("#loopShortTermEditBtn"),
  };
  const customFormatRow = $("#customFormatRow");

  let proModeOptionTemplate = null;
  let proModeOptionIndex = -1;
  if (f.style) {
    const existingProOption = f.style.querySelector('option[value="pro"]');
    if (existingProOption) {
      proModeOptionTemplate = existingProOption.cloneNode(true);
      proModeOptionIndex = Array.from(f.style.options).indexOf(existingProOption);
    }
  }

  function ensureProModeOptionPresent() {
    if (!f.style || !proModeOptionTemplate) return null;
    let option = f.style.querySelector('option[value="pro"]');
    if (option) return option;
    const newOption = proModeOptionTemplate.cloneNode(true);
    const options = Array.from(f.style.options);
    const insertionIndex = Math.min(
      proModeOptionIndex < 0 ? options.length : proModeOptionIndex,
      options.length
    );
    if (insertionIndex >= options.length) {
      f.style.appendChild(newOption);
    } else {
      f.style.insertBefore(newOption, options[insertionIndex]);
    }
    return newOption;
  }

  let lastStyleSelection = f.style ? f.style.value : "bar";
  if (f.style) {
    f.style.addEventListener("focus", () => {
      lastStyleSelection = f.style.value;
    });
    f.style.addEventListener("change", () => {
      if (f.style.value === "pro" && !userCanUseProMode()) {
        enforceProModeEligibility(true);
        return;
      }
      lastStyleSelection = f.style.value;
      toggleProAccessNotice(false);
      updateStyleUI();
    });
  }
  toggleProAccessNotice(false);

  let shortTermOptionTemplate = null;
  let shortTermOptionIndex = -1;
  if (f.loopUnit) {
    const existingShortTermOption = f.loopUnit.querySelector('option[value="shortterm"]');
    if (existingShortTermOption) {
      shortTermOptionTemplate = existingShortTermOption.cloneNode(true);
      shortTermOptionIndex = Array.from(f.loopUnit.options).indexOf(existingShortTermOption);
    }
  }

  function ensureShortTermOptionPresent() {
    if (!f.loopUnit || !shortTermOptionTemplate) return null;
    let option = f.loopUnit.querySelector('option[value="shortterm"]');
    if (option) return option;
    const newOption = shortTermOptionTemplate.cloneNode(true);
    const options = Array.from(f.loopUnit.options);
    const insertionIndex = Math.min(
      shortTermOptionIndex < 0 ? options.length : shortTermOptionIndex,
      options.length
    );
    if (insertionIndex >= options.length) {
      f.loopUnit.appendChild(newOption);
    } else {
      f.loopUnit.insertBefore(newOption, options[insertionIndex]);
    }
    return newOption;
  }

  function enforceShortTermScheduleAvailability() {
    if (!f.loopUnit) return;
    const allowed = userCanAccessShortTermSchedule();
    if (allowed) {
      const option = ensureShortTermOptionPresent();
      if (option) {
        option.disabled = false;
        option.hidden = false;
        option.removeAttribute("aria-hidden");
      }
      return;
    }
    const option = f.loopUnit.querySelector('option[value="shortterm"]');
    const wasSelected = f.loopUnit.value === "shortterm";
    if (option) {
      option.remove();
    }
    if (wasSelected) {
      if (f.loopUnit.options.length) {
        f.loopUnit.selectedIndex = 0;
      }
    }
    if (f.loopShortTermSummary) {
      f.loopShortTermSummary.classList.add("invisible");
    }
    shortTermEventsDraft = [];
    shortTermDialogEvents = [];
    updateLoopingUnitFields();
  }

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
  const ROLE_STANDARD = "Standard";
  const ROLE_CANONICAL = {
    owner: "Owner",
    "beta tester": "Beta Tester",
    "special access": "Special Access",
    standard: ROLE_STANDARD
  };
  const PRO_MODE_ROLES = new Set(["beta tester", "special access", "owner"]);
  const ADVANCED_SETTINGS_ROLES = new Set(["standard", "special access", "beta tester", "owner"]);
  const LOOP_FEATURE_ROLES = new Set(["standard", "special access", "beta tester", "owner"]);
  const SHORT_TERM_SCHEDULE_ROLES = new Set(["beta tester", "owner"]);
  const LOOP_INTERVAL_UNITS = new Set(["day", "week", "month", "year", "shortterm"]);
  const SHORT_TERM_TYPES = new Set(["weekly", "single"]);
  const MONTHLY_MODES = new Set(["day", "weekday"]);
  const MONTHLY_ORDINALS = ["first", "second", "third", "fourth", "last"];
  const MONTHLY_ORDINAL_INDEX = { first: 0, second: 1, third: 2, fourth: 3, last: -1 };
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DEFAULT_LOOP_CONFIG = {
    enabled: false,
    interval: 1,
    unit: "day",
    weeklyDays: [],
    weekStartOffset: 0,
    weekAnchorMs: null,
    monthlyMode: "day",
    monthlyDay: 1,
    monthlyOrdinal: "first",
    monthlyWeekday: 0,
    alignStartToEnd: false,
    events: []
  };
  const DEFAULT_PREFERENCES = {
    defaultStyle: "bar",
    defaultUnits: "auto",
    autoDisplayMode: "Standard",
    defaultCustomFormat: "{HH}:{mm}:{ss}",
    loopsEnabled: true
  };
  const KEY_PREFERENCE_STORE = "hyperTimer_v7_prefStore";
  const KNOWN_ANIMATION_STYLES = ["none", "bar", "ring", "pie", "multibar", "letters", "color", "pro"];
  const KNOWN_UNIT_CHOICES = ["auto", "d", "dhm", "hms", "ms", "s", "custom"];
  const KNOWN_AUTO_MODES = ["Standard", "Verbose"];
  let userPreferences = { ...DEFAULT_PREFERENCES };
  let cloudAccountMissing = false;
  let lastPreferenceStatus = { message: "", tone: "neutral" };
  let persistedPreferenceStatus = { message: "", tone: "neutral" };
  let isUpdatingPreferenceUI = false;
  let shortTermEventsDraft = [];
  let shortTermDialogEvents = [];
  let suppressLoopUnitChange = false;

  function normalizeRole(role) {
    if (typeof role === "string") {
      const trimmed = role.trim();
      if (trimmed) {
        const canonical = ROLE_CANONICAL[trimmed.toLowerCase()];
        return canonical || trimmed;
      }
    }
    return ROLE_STANDARD;
  }

  function extractRoleFromRecord(record) {
    if (!record || typeof record !== "object") return ROLE_STANDARD;
    const rawRole = record.Role ?? record.role;
    return normalizeRole(rawRole);
  }

  function getCurrentRole() {
    return currentUser ? extractRoleFromRecord(currentUser) : ROLE_STANDARD;
  }

  function userCanUseProMode() {
    const role = getCurrentRole().toLowerCase();
    return PRO_MODE_ROLES.has(role);
  }

  function userCanAccessLoopsFeature() {
    const role = getCurrentRole().toLowerCase();
    return LOOP_FEATURE_ROLES.has(role);
  }

  function userCanAccessShortTermSchedule() {
    const role = getCurrentRole().toLowerCase();
    return SHORT_TERM_SCHEDULE_ROLES.has(role);
  }

  function isLoopsFeatureEnabled() {
    return userCanAccessLoopsFeature() && !!userPreferences.loopsEnabled;
  }

  function toggleProAccessNotice(show) {
    if (!proAccessNotice) return;
    proAccessNotice.classList.toggle("invisible", !show);
  }

  function userCanAccessDefaultSettings() {
    return ADVANCED_SETTINGS_ROLES.has(getCurrentRole().toLowerCase());
  }

  function sanitizeStylePreference(style) {
    if (typeof style === "string") {
      const normalized = style.trim().toLowerCase();
      const match = KNOWN_ANIMATION_STYLES.find(opt => opt.toLowerCase() === normalized);
      if (match) return match;
    }
    return DEFAULT_PREFERENCES.defaultStyle;
  }

  function sanitizeUnitsPreference(units) {
    if (typeof units === "string") {
      const normalized = units.trim().toLowerCase();
      const match = KNOWN_UNIT_CHOICES.find(opt => opt.toLowerCase() === normalized);
      if (match) return match;
    }
    return DEFAULT_PREFERENCES.defaultUnits;
  }

  function sanitizeAutoDisplayMode(mode) {
    if (typeof mode === "string") {
      const normalized = mode.trim().toLowerCase();
      const match = KNOWN_AUTO_MODES.find(opt => opt.toLowerCase() === normalized);
      if (match) return match;
    }
    return DEFAULT_PREFERENCES.autoDisplayMode;
  }

  function sanitizeCustomFormat(format) {
    if (typeof format === "string") {
      const trimmed = format.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return DEFAULT_PREFERENCES.defaultCustomFormat;
  }

  function sanitizeBoolean(value) {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
    }
    return value === true || value === 1;
  }

  function toLocalDateInputValue(date) {
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    return `${yyyy}-${mm}-${dd}`;
  }

  function parseTimeOfDay(raw) {
    if (raw && typeof raw === "object") {
      const hour = Number(raw.hour ?? raw.h ?? raw.hours);
      const minute = Number(raw.minute ?? raw.min ?? raw.minutes ?? raw.m);
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        return { hour: clamp(Math.round(hour), 0, 23), minute: clamp(Math.round(minute), 0, 59) };
      }
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const hour = clamp(Math.floor(raw), 0, 23);
      const minute = clamp(Math.round((raw - Math.floor(raw)) * 60), 0, 59);
      return { hour, minute };
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const colon = trimmed.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
      if (colon) {
        const hour = clamp(Number(colon[1]), 0, 23);
        const minute = clamp(Number(colon[2] ?? "0"), 0, 59);
        return { hour, minute };
      }
      const compact = trimmed.match(/^(\d{1,2})(\d{2})$/);
      if (compact) {
        const hour = clamp(Number(compact[1]), 0, 23);
        const minute = clamp(Number(compact[2]), 0, 59);
        return { hour, minute };
      }
    }
    return null;
  }

  function formatTimeOfDay(hour, minute) {
    const h = clamp(Number.isFinite(hour) ? Math.round(hour) : 0, 0, 23);
    const m = clamp(Number.isFinite(minute) ? Math.round(minute) : 0, 0, 59);
    return `${pad2(h)}:${pad2(m)}`;
  }

  function cloneShortTermEvents(list = []) {
    return Array.isArray(list)
      ? list.map(ev => {
          const clone = { ...ev };
          if (Array.isArray(ev.weekdays)) {
            clone.weekdays = [...ev.weekdays];
          }
          return clone;
        })
      : [];
  }

  function combineDateAndTime(dateStr, hour, minute) {
    if (typeof dateStr !== "string" || !dateStr) return null;
    const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [_, y, m, d] = match;
    const dt = new Date(Number(y), Number(m) - 1, Number(d), clamp(Math.round(hour ?? 0), 0, 23), clamp(Math.round(minute ?? 0), 0, 59), 0, 0);
    return dt.getTime();
  }

  function sanitizeShortTermEvent(raw, referenceMs = null) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid("ste_");
    let label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label && typeof raw.name === "string") label = raw.name.trim();
    if (!label) label = "Event";
    let typeRaw = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
    if (!SHORT_TERM_TYPES.has(typeRaw)) {
      const repeatRaw = typeof raw.repeat === "string" ? raw.repeat.trim().toLowerCase() : "";
      if (["once", "single", "one-time", "onetime"].includes(repeatRaw)) {
        typeRaw = "single";
      } else if (repeatRaw === "weekly") {
        typeRaw = "weekly";
      } else if (sanitizeBoolean(raw.repeatWeekly)) {
        typeRaw = "weekly";
      }
    }
    const inferredType = SHORT_TERM_TYPES.has(typeRaw)
      ? typeRaw
      : ((raw.date || raw.timestamp || raw.when || raw.datetime) ? "single" : "weekly");
    if (inferredType === "single") {
      let timestamp = parseTimestamp(raw.timestamp ?? raw.when ?? raw.datetime ?? raw.date ?? null);
      let dateValue = typeof raw.date === "string" ? raw.date.trim() : "";
      let timeValue = parseTimeOfDay(raw.time ?? raw.timeOfDay ?? { hour: raw.hour, minute: raw.minute });
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        if (dateValue) {
          const combined = combineDateAndTime(dateValue, timeValue?.hour ?? null, timeValue?.minute ?? null);
          if (Number.isFinite(combined)) {
            timestamp = combined;
          }
        }
      }
      if ((!Number.isFinite(timestamp) || timestamp <= 0) && timeValue) {
        const base = Number.isFinite(referenceMs) ? new Date(referenceMs) : new Date();
        base.setSeconds(0, 0);
        base.setHours(timeValue.hour, timeValue.minute, 0, 0);
        if (base.getTime() <= now()) {
          base.setDate(base.getDate() + 1);
        }
        timestamp = base.getTime();
        dateValue = toLocalDateInputValue(base);
      }
      if (!Number.isFinite(timestamp)) {
        return null;
      }
      const dt = new Date(timestamp);
      const fallbackTime = timeValue || { hour: dt.getHours(), minute: dt.getMinutes() };
      return {
        id,
        label,
        type: "single",
        date: dateValue || toLocalDateInputValue(dt),
        hour: clamp(Math.round(fallbackTime.hour ?? dt.getHours()), 0, 23),
        minute: clamp(Math.round(fallbackTime.minute ?? dt.getMinutes()), 0, 59),
        timestamp
      };
    }
    const candidateWeekdays = [];
    const addWeekdayCandidate = value => {
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach(addWeekdayCandidate);
        return;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (/^-?\d+$/.test(trimmed)) {
          addWeekdayCandidate(Number(trimmed));
          return;
        }
        trimmed.split(/[^0-9-]+/).forEach(part => addWeekdayCandidate(part));
        return;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      candidateWeekdays.push(numeric);
    };
    addWeekdayCandidate(raw.weekdays);
    addWeekdayCandidate(raw.days);
    addWeekdayCandidate(raw.weekday);
    addWeekdayCandidate(raw.day);
    addWeekdayCandidate(raw.dayOfWeek);
    addWeekdayCandidate(raw.dow);
    if (!candidateWeekdays.length) {
      let inferred = Number(raw.weekday ?? raw.day ?? raw.dayOfWeek ?? raw.dow);
      if (!Number.isFinite(inferred)) {
        const ts = parseTimestamp(raw.timestamp ?? raw.when ?? raw.datetime ?? null);
        if (Number.isFinite(ts)) {
          inferred = new Date(ts).getDay();
        }
      }
      if (!Number.isFinite(inferred)) {
        if (Number.isFinite(referenceMs)) {
          inferred = new Date(referenceMs).getDay();
        } else {
          inferred = new Date().getDay();
        }
      }
      candidateWeekdays.push(inferred);
    }
    const normalizedWeekdays = Array.from(new Set(candidateWeekdays.map(value => clamp(Math.round(value), 0, 6)))).sort((a, b) => a - b);
    const weekdays = normalizedWeekdays.length ? normalizedWeekdays : [new Date().getDay()];
    let timeValue = parseTimeOfDay(raw.time ?? raw.timeOfDay ?? { hour: raw.hour, minute: raw.minute });
    if (!timeValue) {
      const ts = parseTimestamp(raw.timestamp ?? raw.when ?? raw.datetime ?? null);
      if (Number.isFinite(ts)) {
        const dt = new Date(ts);
        timeValue = { hour: dt.getHours(), minute: dt.getMinutes() };
      }
    }
    if (!timeValue) {
      const ref = Number.isFinite(referenceMs) ? new Date(referenceMs) : new Date();
      timeValue = { hour: ref.getHours(), minute: ref.getMinutes() };
    }
    const hour = clamp(Math.round(timeValue.hour ?? 0), 0, 23);
    const minute = clamp(Math.round(timeValue.minute ?? 0), 0, 59);
    const parseIntervalCandidate = value => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return NaN;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) return parsed;
      }
      return NaN;
    };
    let intervalCandidate = parseIntervalCandidate(raw.intervalWeeks);
    if (!Number.isFinite(intervalCandidate)) intervalCandidate = parseIntervalCandidate(raw.intervalEveryWeeks);
    if (!Number.isFinite(intervalCandidate)) intervalCandidate = parseIntervalCandidate(raw.interval);
    if (!Number.isFinite(intervalCandidate)) intervalCandidate = parseIntervalCandidate(raw.everyWeeks);
    if (!Number.isFinite(intervalCandidate)) intervalCandidate = parseIntervalCandidate(raw.weeks);
    if (!Number.isFinite(intervalCandidate)) intervalCandidate = parseIntervalCandidate(raw.frequency);
    let intervalWeeks = Math.max(1, Number.isFinite(intervalCandidate) ? Math.floor(intervalCandidate) : 1);
    if (!Number.isFinite(intervalWeeks) || intervalWeeks < 1) intervalWeeks = 1;
    let anchorWeekStart = normalizeWeekStartTimestamp(
      raw.anchorWeekStart ?? raw.anchorWeek ?? raw.anchorTimestamp ?? raw.anchor ?? raw.startWeek ?? raw.firstWeek ?? raw.referenceWeek
    );
    if (!Number.isFinite(anchorWeekStart)) {
      const ts = parseFlexibleTimestamp(raw.timestamp ?? raw.when ?? raw.datetime ?? null);
      if (Number.isFinite(ts)) {
        anchorWeekStart = normalizeWeekStartTimestamp(ts);
      }
    }
    if (!Number.isFinite(anchorWeekStart)) {
      const ref = Number.isFinite(referenceMs) ? referenceMs : now();
      const base = new Date(ref);
      base.setSeconds(0, 0);
      base.setHours(hour, minute, 0, 0);
      if (base.getTime() < ref) {
        base.setDate(base.getDate() + 1);
      }
      const weekdaySet = new Set(weekdays);
      let nextCandidate = null;
      for (let i = 0; i < 14; i++) {
        const probe = new Date(base);
        probe.setDate(base.getDate() + i);
        if (weekdaySet.has(probe.getDay())) {
          nextCandidate = probe;
          break;
        }
      }
      if (!nextCandidate) nextCandidate = base;
      anchorWeekStart = normalizeWeekStartTimestamp(nextCandidate.getTime());
    }
    if (!Number.isFinite(anchorWeekStart)) {
      anchorWeekStart = normalizeWeekStartTimestamp(now());
    }
    return {
      id,
      label,
      type: "weekly",
      weekdays,
      weekday: weekdays[0],
      hour,
      minute,
      intervalWeeks,
      anchorWeekStart
    };
  }

  function sanitizeShortTermEvents(source, referenceMs = null) {
    const list = Array.isArray(source) ? source : (source && typeof source === "object" && Array.isArray(source.events) ? source.events : []);
    const sanitized = [];
    const seen = new Set();
    for (const entry of list) {
      const event = sanitizeShortTermEvent(entry, referenceMs);
      if (!event) continue;
      let id = event.id;
      while (seen.has(id)) {
        id = uid("ste_");
      }
      if (id !== event.id) event.id = id;
      seen.add(id);
      sanitized.push(event);
    }
    return sanitized;
  }

  function nextOccurrenceForEvent(event, afterMs = null) {
    if (!event || typeof event !== "object") return null;
    const reference = Number.isFinite(afterMs) ? afterMs : now();
    if (event.type === "single") {
      const ts = Number(event.timestamp ?? combineDateAndTime(event.date, event.hour, event.minute));
      if (!Number.isFinite(ts)) return null;
      return ts >= reference ? ts : null;
    }
    if (event.type === "weekly") {
      const base = new Date(reference);
      base.setSeconds(0, 0);
      const hour = clamp(Math.round(event.hour ?? 0), 0, 23);
      const minute = clamp(Math.round(event.minute ?? 0), 0, 59);
      const intervalWeeks = Math.max(1, Math.floor(Number(event.intervalWeeks ?? 1)) || 1);
      let anchorWeekStart = Number(event.anchorWeekStart);
      if (Number.isFinite(anchorWeekStart)) {
        anchorWeekStart = normalizeWeekStartTimestamp(anchorWeekStart);
      } else {
        anchorWeekStart = NaN;
      }
      let candidates = Array.isArray(event.weekdays) ? event.weekdays.map(day => Number(day)) : [];
      candidates = candidates.filter(Number.isFinite).map(day => clamp(Math.round(day), 0, 6));
      if (!candidates.length) {
        const fallback = Number(event.weekday);
        candidates = [Number.isFinite(fallback) ? clamp(Math.round(fallback), 0, 6) : base.getDay()];
      }
      const unique = Array.from(new Set(candidates));
      let best = null;
      for (const weekday of unique) {
        const candidate = new Date(base);
        candidate.setHours(hour, minute, 0, 0);
        const baseDay = candidate.getDay();
        let offset = (weekday - baseDay + 7) % 7;
        if (offset === 0 && candidate.getTime() <= reference) {
          offset = 7;
        }
        candidate.setDate(candidate.getDate() + offset);
        let guard = 0;
        while (guard < 128) {
          let candidateTime = candidate.getTime();
          if (!Number.isFinite(candidateTime)) break;
          if (candidateTime <= reference) {
            candidate.setDate(candidate.getDate() + 7);
            guard++;
            continue;
          }
          if (intervalWeeks > 1) {
            const weekStart = normalizeWeekStartTimestamp(candidateTime);
            if (!Number.isFinite(weekStart)) break;
            let anchor = anchorWeekStart;
            if (!Number.isFinite(anchor)) {
              anchor = weekStart;
            }
            if (weekStart < anchor) {
              const diff = Math.ceil((anchor - weekStart) / WEEK_MS);
              candidate.setDate(candidate.getDate() + diff * 7);
              guard++;
              continue;
            }
            const diffWeeks = Math.round((weekStart - anchor) / WEEK_MS);
            if (diffWeeks % intervalWeeks !== 0) {
              const weeksToAdd = intervalWeeks - (diffWeeks % intervalWeeks);
              candidate.setDate(candidate.getDate() + weeksToAdd * 7);
              guard++;
              continue;
            }
          }
          candidateTime = candidate.getTime();
          if (!best || candidateTime < best) {
            best = candidateTime;
          }
          break;
        }
      }
      return best;
    }
    return null;
  }

  function findNextShortTermOccurrence(events, afterMs = null) {
    const list = Array.isArray(events) ? events : [];
    const reference = Number.isFinite(afterMs) ? afterMs : now();
    let best = null;
    for (const event of list) {
      const ts = nextOccurrenceForEvent(event, reference);
      if (!Number.isFinite(ts)) continue;
      if (!best || ts < best.timestamp || (ts === best.timestamp && (event.label || "") < (best.event.label || ""))) {
        best = { event, timestamp: ts };
      }
    }
    return best;
  }

  function describeShortTermOccurrence(event, timestamp) {
    if (!Number.isFinite(timestamp)) return "";
    const dt = new Date(timestamp);
    const weekday = WEEKDAY_NAMES[dt.getDay()] || "";
    const timeLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(dt);
    if (event && event.type === "single") {
      const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(dt);
      return `${weekday}, ${dateLabel} • ${timeLabel}`;
    }
    return `${weekday} • ${timeLabel}`;
  }

  function sanitizeLoopConfig(rawConfig, mode, referenceMs = null) {
    const base = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const supported = mode === "duration" || mode === "datetime";
    const refDate = Number.isFinite(referenceMs) ? new Date(referenceMs) : null;
    const refDay = refDate ? refDate.getDate() : 1;
    const refWeekday = refDate ? refDate.getDay() : 0;
    const enabled = supported && sanitizeBoolean(base.enabled);
    const intervalRaw = Number(base.interval);
    const interval = Math.max(1, Number.isFinite(intervalRaw) ? Math.floor(intervalRaw) : 1);
    const unitRaw = typeof base.unit === "string" ? base.unit.trim().toLowerCase() : "";
    const normalizedUnit = LOOP_INTERVAL_UNITS.has(unitRaw) ? unitRaw : "day";
    const shortTermRequested = normalizedUnit === "shortterm";
    const allowShortTerm = userCanAccessShortTermSchedule();
    const unit = shortTermRequested && !allowShortTerm ? "day" : normalizedUnit;
    const weeklyCandidates = [];
    if (Array.isArray(base.weeklyDays)) {
      weeklyCandidates.push(...base.weeklyDays);
    } else if (typeof base.weeklyDays === "string") {
      weeklyCandidates.push(...base.weeklyDays.split(/[^0-9-]+/));
    } else if (base.weeklyDays != null) {
      weeklyCandidates.push(base.weeklyDays);
    }
    if (weeklyCandidates.length === 0 && base.weeklyDay != null) {
      weeklyCandidates.push(base.weeklyDay);
    }
    const weeklyDaysSet = new Set();
    for (const entry of weeklyCandidates) {
      if (typeof entry === "string" && entry.trim() === "") continue;
      const numeric = Number(entry);
      if (!Number.isFinite(numeric)) continue;
      const clamped = clamp(Math.round(numeric), 0, 6);
      weeklyDaysSet.add(clamped);
    }
    let weeklyDays = Array.from(weeklyDaysSet).sort((a, b) => a - b);
    if (!weeklyDays.length) {
      weeklyDays = [clamp(refWeekday, 0, 6)];
    }
    let weekAnchorMs = normalizeWeekStartTimestamp(
      base.weekAnchorMs ?? base.weekAnchor ?? base.weeklyAnchor
    );
    if (!Number.isFinite(weekAnchorMs) && Number.isFinite(referenceMs)) {
      weekAnchorMs = normalizeWeekStartTimestamp(referenceMs);
    }
    const offsetCandidates = [
      base.weekStartOffset,
      base.weekOffset,
      base.weeklyOffset
    ];
    let weekStartOffsetRaw = 0;
    for (const candidate of offsetCandidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        weekStartOffsetRaw = numeric;
        break;
      }
    }
    let weekStartOffset = Math.floor(weekStartOffsetRaw);
    const intervalModulo = Math.max(1, interval);
    weekStartOffset = ((weekStartOffset % intervalModulo) + intervalModulo) % intervalModulo;
    const monthlyModeRaw = typeof base.monthlyMode === "string" ? base.monthlyMode.trim().toLowerCase() : "";
    const monthlyMode = MONTHLY_MODES.has(monthlyModeRaw) ? monthlyModeRaw : "day";
    let monthlyDayRaw = Number(base.monthlyDay);
    if (!Number.isFinite(monthlyDayRaw)) monthlyDayRaw = refDay;
    const monthlyDay = clamp(Math.round(monthlyDayRaw), 1, 31);
    const monthlyOrdinalRaw = typeof base.monthlyOrdinal === "string" ? base.monthlyOrdinal.trim().toLowerCase() : "";
    const monthlyOrdinal = MONTHLY_ORDINALS.includes(monthlyOrdinalRaw) ? monthlyOrdinalRaw : "first";
    let weekdayRaw = Number(base.monthlyWeekday);
    if (!Number.isFinite(weekdayRaw)) weekdayRaw = refWeekday;
    const monthlyWeekday = clamp(Math.round(weekdayRaw), 0, 6);
    const alignStartToEnd = mode === "datetime" && unit !== "shortterm" && sanitizeBoolean(base.alignStartToEnd);
    const events = unit === "shortterm" && allowShortTerm
      ? sanitizeShortTermEvents(base.events ?? base.schedule ?? base.shortTermEvents ?? [], referenceMs)
      : [];
    const finalEnabled = unit === "shortterm"
      ? (enabled && events.length > 0)
      : (shortTermRequested && !allowShortTerm ? false : enabled);
    return {
      ...DEFAULT_LOOP_CONFIG,
      enabled: finalEnabled,
      interval,
      unit,
      weeklyDays,
      weekStartOffset,
      weekAnchorMs: Number.isFinite(weekAnchorMs) ? weekAnchorMs : null,
      monthlyMode,
      monthlyDay,
      monthlyOrdinal,
      monthlyWeekday,
      alignStartToEnd,
      events
    };
  }

  function sanitizePreferences(prefs) {
    const base = prefs && typeof prefs === "object" ? prefs : {};
    const loopsEnabledRaw = base.loopsEnabled;
    const loopsEnabled = typeof loopsEnabledRaw === "undefined"
      ? DEFAULT_PREFERENCES.loopsEnabled
      : sanitizeBoolean(loopsEnabledRaw);
    return {
      defaultStyle: sanitizeStylePreference(base.defaultStyle),
      defaultUnits: sanitizeUnitsPreference(base.defaultUnits),
      autoDisplayMode: sanitizeAutoDisplayMode(base.autoDisplayMode ?? base.autoMode ?? base.autoUnitsMode),
      defaultCustomFormat: sanitizeCustomFormat(base.defaultCustomFormat ?? base.customFormat),
      loopsEnabled
    };
  }

  function gatherLoopConfigFromForm(mode, existingConfig = null, referenceMs = null) {
    const existing = sanitizeLoopConfig(existingConfig, mode, referenceMs);
    const supported = mode === "duration" || mode === "datetime";
    if (!supported) {
      return { ...existing, enabled: false };
    }
    if (!isLoopsFeatureEnabled()) {
      return { ...existing, enabled: false };
    }
    const usingWeeklyUnit = (f.loopUnit ? f.loopUnit.value : existing.unit) === "week";
    let weeklyDays = existing.weeklyDays;
    if (f.loopWeeklyDays && usingWeeklyUnit) {
      const inputs = $$('input[type="checkbox"]', f.loopWeeklyDays);
      weeklyDays = inputs.filter(input => input.checked).map(input => Number(input.value));
    }
    let unitValue = f.loopUnit ? f.loopUnit.value : existing.unit;
    if (unitValue === "shortterm" && !userCanAccessShortTermSchedule()) {
      unitValue = existing.unit === "shortterm" ? "day" : existing.unit;
      if (unitValue === "shortterm") unitValue = "day";
    }
    const events = unitValue === "shortterm" ? cloneShortTermEvents(shortTermEventsDraft) : [];
    const reference = mode === "datetime"
      ? (f.when && f.when.value ? parseLocalDateTime(f.when.value) : referenceMs)
      : referenceMs;
    let weekStartOffsetValue = existing.weekStartOffset;
    let weekAnchorMs = existing.weekAnchorMs;
    if (unitValue === "week") {
      const selectedOffset = f.loopWeekStartOffset ? Number(f.loopWeekStartOffset.value) : NaN;
      if (Number.isFinite(selectedOffset)) {
        weekStartOffsetValue = selectedOffset;
      }
      const referenceWeekStart = Number.isFinite(reference) ? normalizeWeekStartTimestamp(reference) : NaN;
      if (Number.isFinite(referenceWeekStart)) {
        weekAnchorMs = referenceWeekStart;
      }
    }
    const raw = {
      enabled: f.loopEnabled ? f.loopEnabled.checked : false,
      interval: f.loopInterval ? f.loopInterval.value : existing.interval,
      unit: unitValue,
      weeklyDays,
      weekStartOffset: weekStartOffsetValue,
      weekAnchorMs,
      monthlyMode: f.loopMonthlyMode ? f.loopMonthlyMode.value : existing.monthlyMode,
      monthlyDay: f.loopMonthlyDay ? f.loopMonthlyDay.value : existing.monthlyDay,
      monthlyOrdinal: f.loopMonthlyOrdinal ? f.loopMonthlyOrdinal.value : existing.monthlyOrdinal,
      monthlyWeekday: f.loopMonthlyWeekday ? f.loopMonthlyWeekday.value : existing.monthlyWeekday,
      alignStartToEnd: f.loopAlignStart ? f.loopAlignStart.checked : existing.alignStartToEnd,
      events
    };
    return sanitizeLoopConfig(raw, mode, reference);
  }

  function getPreferenceKeyForUser(user = currentUser) {
    if (user && typeof user === "object") {
      if (user.id) return `id:${user.id}`;
      if (user.email) return `email:${String(user.email).toLowerCase()}`;
    }
    return "local";
  }

  function readPreferenceStore() {
    try {
      const raw = localStorage.getItem(KEY_PREFERENCE_STORE);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) {
      console.warn("Failed to parse preference store", err);
    }
    return {};
  }

  function writePreferenceStore(store) {
    try {
      localStorage.setItem(KEY_PREFERENCE_STORE, JSON.stringify(store));
    } catch (err) {
      console.warn("Failed to persist preference store", err);
    }
  }

  function loadPreferencesForKey(key) {
    const store = readPreferenceStore();
    const entry = store && typeof store === "object" ? store[key] : null;
    if (entry && typeof entry === "object") {
      return sanitizePreferences(entry);
    }
    return { ...DEFAULT_PREFERENCES };
  }

  function savePreferencesForKey(key, prefs) {
    const store = readPreferenceStore();
    store[key] = sanitizePreferences(prefs);
    writePreferenceStore(store);
  }

  function loadPreferencesForCurrentUser() {
    return loadPreferencesForKey(getPreferenceKeyForUser(currentUser));
  }

  function savePreferencesForCurrentUser(prefs = userPreferences) {
    savePreferencesForKey(getPreferenceKeyForUser(currentUser), prefs);
  }

  function renderPreferencesStatus() {
    if (!settingsDefaultsStatus) return;
    const { message, tone } = lastPreferenceStatus;
    settingsDefaultsStatus.textContent = message || "";
    settingsDefaultsStatus.classList.remove("success", "error", "warning");
    if (tone === "success" || tone === "error" || tone === "warning") {
      settingsDefaultsStatus.classList.add(tone);
    }
  }

  function setPreferencesStatus(message, tone = "neutral", { persist = false } = {}) {
    lastPreferenceStatus = { message, tone };
    if (persist) {
      persistedPreferenceStatus = { message, tone };
    }
    renderPreferencesStatus();
  }

  function restorePersistedPreferenceStatus() {
    lastPreferenceStatus = { ...persistedPreferenceStatus };
    renderPreferencesStatus();
  }

  function applyPreferencesToState(prefs, { save = true } = {}) {
    userPreferences = sanitizePreferences(prefs);
    if (!userCanAccessLoopsFeature()) {
      userPreferences.loopsEnabled = false;
    }
    if (save) {
      savePreferencesForCurrentUser(userPreferences);
    }
    updateDefaultSettingsSection();
    updateLoopFeatureToggle();
    updateLoopingSectionVisibility();
  }

  function gatherSelectOptions(selectEl) {
    if (!selectEl) return [];
    const seen = new Set();
    return Array.from(selectEl.options || []).reduce((acc, option) => {
      const value = option.value;
      if (!value || seen.has(value)) return acc;
      seen.add(value);
      acc.push({ value, label: option.textContent || value });
      return acc;
    }, []);
  }

  function populateDefaultSettingsOptions() {
    if (settingsDefaultStyle && f.style) {
      const styleOptions = gatherSelectOptions(f.style);
      const prev = settingsDefaultStyle.value;
      settingsDefaultStyle.innerHTML = "";
      styleOptions.forEach(opt => {
        const optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        settingsDefaultStyle.appendChild(optionEl);
      });
      if (prev && settingsDefaultStyle.querySelector(`option[value="${prev}"]`)) {
        settingsDefaultStyle.value = prev;
      }
    }
    if (settingsDefaultUnits && f.units) {
      const unitOptions = gatherSelectOptions(f.units);
      const prev = settingsDefaultUnits.value;
      settingsDefaultUnits.innerHTML = "";
      unitOptions.forEach(opt => {
        const optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        settingsDefaultUnits.appendChild(optionEl);
      });
      if (prev && settingsDefaultUnits.querySelector(`option[value="${prev}"]`)) {
        settingsDefaultUnits.value = prev;
      }
    }
  }

  function applyPreferenceSelections() {
    if (!settingsDefaultStyle || !settingsDefaultUnits) return;
    isUpdatingPreferenceUI = true;
    const sanitizedStyle = sanitizeStylePreference(userPreferences.defaultStyle);
    const sanitizedUnits = sanitizeUnitsPreference(userPreferences.defaultUnits);
    const sanitizedMode = sanitizeAutoDisplayMode(userPreferences.autoDisplayMode);
    const sanitizedFormat = sanitizeCustomFormat(userPreferences.defaultCustomFormat);
    const styleValue = sanitizedStyle === "pro" && !userCanUseProMode()
      ? DEFAULT_PREFERENCES.defaultStyle
      : sanitizedStyle;
    if (settingsDefaultStyle.querySelector(`option[value="${styleValue}"]`)) {
      settingsDefaultStyle.value = styleValue;
    } else if (settingsDefaultStyle.options.length) {
      settingsDefaultStyle.selectedIndex = 0;
    }
    if (settingsDefaultUnits.querySelector(`option[value="${sanitizedUnits}"]`)) {
      settingsDefaultUnits.value = sanitizedUnits;
    } else if (settingsDefaultUnits.options.length) {
      settingsDefaultUnits.selectedIndex = 0;
    }
    if (settingsAutoUnitsMode) {
      if (settingsAutoUnitsMode.querySelector(`option[value="${sanitizedMode}"]`)) {
        settingsAutoUnitsMode.value = sanitizedMode;
      } else if (settingsAutoUnitsMode.options.length) {
        settingsAutoUnitsMode.selectedIndex = 0;
      }
    }
    if (settingsCustomFormat) {
      settingsCustomFormat.value = sanitizedFormat;
    }
    isUpdatingPreferenceUI = false;
    updateSettingsCustomFormatVisibility();
  }

  function updateSettingsCustomFormatVisibility() {
    if (!settingsCustomFormatRow || !settingsDefaultUnits) return;
    const show = settingsDefaultUnits.value === "custom";
    settingsCustomFormatRow.classList.toggle("invisible", !show);
  }

  function updateLoopFeatureToggle() {
    if (!settingsLoopsSection || !settingsLoopsToggle) return;
    const allowed = userCanAccessLoopsFeature();
    settingsLoopsSection.classList.toggle("invisible", !allowed);
    if (!allowed) {
      settingsLoopsToggle.checked = false;
    } else {
      settingsLoopsToggle.checked = !!userPreferences.loopsEnabled;
    }
  }

  function updateLoopingMonthlyModeFields() {
    if (!f.loopMonthlyControls) return;
    const controlsVisible = !f.loopMonthlyControls.classList.contains("invisible");
    const mode = f.loopMonthlyMode ? f.loopMonthlyMode.value : "day";
    if (f.loopMonthlyDayRow) {
      f.loopMonthlyDayRow.classList.toggle("invisible", !(controlsVisible && mode === "day"));
    }
    if (f.loopMonthlyOrdinalRow) {
      f.loopMonthlyOrdinalRow.classList.toggle("invisible", !(controlsVisible && mode === "weekday"));
    }
  }

  function getLoopIntervalValue() {
    if (!f.loopInterval) return 1;
    const numeric = Number(f.loopInterval.value);
    if (!Number.isFinite(numeric)) return 1;
    const floored = Math.floor(numeric);
    return Math.max(1, floored);
  }

  function refreshWeeklyStartOptions(desiredValue = null) {
    if (!f.loopWeekStartOffset) return;
    const select = f.loopWeekStartOffset;
    const interval = getLoopIntervalValue();
    const desiredNumeric = desiredValue != null ? Number(desiredValue) : Number(select.value);
    let normalized = Number.isFinite(desiredNumeric) ? Math.floor(desiredNumeric) : 0;
    const modulo = Math.max(1, interval);
    normalized = ((normalized % modulo) + modulo) % modulo;
    select.innerHTML = "";
    for (let i = 0; i < Math.max(1, interval); i++) {
      const option = document.createElement("option");
      option.value = String(i);
      if (i === 0) {
        option.textContent = "Start this week";
      } else if (i === 1) {
        option.textContent = "Start next week";
      } else {
        option.textContent = `Start in ${i} weeks`;
      }
      select.appendChild(option);
    }
    select.value = String(Math.min(normalized, Math.max(interval - 1, 0)));
  }

  function updateWeeklyStartVisibility() {
    if (!f.loopWeekStartRow) return;
    if (!f.loopDatetimeFields) return;
    const datetimeVisible = !f.loopDatetimeFields.classList.contains("invisible");
    const unit = f.loopUnit ? f.loopUnit.value : "day";
    const interval = getLoopIntervalValue();
    const show = datetimeVisible && unit === "week" && interval > 1;
    f.loopWeekStartRow.classList.toggle("invisible", !show);
  }

  function updateWeeklyStartControls(desiredValue = null) {
    refreshWeeklyStartOptions(desiredValue);
    updateWeeklyStartVisibility();
  }

  function updateLoopingUnitFields() {
    if (!f.loopDatetimeFields) return;
    const datetimeVisible = !f.loopDatetimeFields.classList.contains("invisible");
    const unit = f.loopUnit ? f.loopUnit.value : "day";
    const allowShortTerm = userCanAccessShortTermSchedule();
    const showWeekly = datetimeVisible && unit === "week";
    if (f.loopWeeklyControls) {
      f.loopWeeklyControls.classList.toggle("invisible", !showWeekly);
    }
    const showMonthly = datetimeVisible && unit === "month";
    if (f.loopMonthlyControls) {
      f.loopMonthlyControls.classList.toggle("invisible", !showMonthly);
      if (!showMonthly) {
        if (f.loopMonthlyDayRow) f.loopMonthlyDayRow.classList.add("invisible");
        if (f.loopMonthlyOrdinalRow) f.loopMonthlyOrdinalRow.classList.add("invisible");
      } else {
        updateLoopingMonthlyModeFields();
      }
    }
    const intervalField = f.loopInterval ? f.loopInterval.closest('.field') : null;
    if (intervalField) {
      intervalField.classList.toggle('invisible', unit === "shortterm");
    }
    if (f.loopShortTermSummary) {
      const shouldShow = allowShortTerm && datetimeVisible && unit === "shortterm";
      f.loopShortTermSummary.classList.toggle("invisible", !shouldShow);
    }
    updateWeeklyStartControls();
    updateShortTermSummary();
  }

  function ensureShortTermTarget() {
    if (!userCanAccessShortTermSchedule()) return;
    if (!f.when || !f.loopUnit || f.loopUnit.value !== "shortterm") return;
    if (!f.loopEnabled || !f.loopEnabled.checked) return;
    if (!f.mode || f.mode.value !== "datetime") return;
    const events = Array.isArray(shortTermEventsDraft) ? shortTermEventsDraft : [];
    if (!events.length) return;
    const next = findNextShortTermOccurrence(events, now());
    if (next && Number.isFinite(next.timestamp)) {
      try {
        f.when.value = toLocalDatetime(new Date(next.timestamp));
      } catch (err) {
        // ignore assignment failures
      }
    }
  }

  function updateShortTermSummary() {
    if (!f.loopShortTermSummary || !f.loopShortTermSummaryText) return;
    if (!userCanAccessShortTermSchedule()) {
      f.loopShortTermSummary.classList.add("invisible");
      return;
    }
    if (!f.loopUnit || f.loopUnit.value !== "shortterm") return;
    const loopsAvailable = isLoopsFeatureEnabled();
    const mode = f.mode ? f.mode.value : "duration";
    const events = Array.isArray(shortTermEventsDraft) ? shortTermEventsDraft : [];
    const loopsChecked = !!(f.loopEnabled && f.loopEnabled.checked);
    if (!loopsAvailable) {
      f.loopShortTermSummaryText.textContent = "Loops are unavailable for this account.";
      return;
    }
    if (mode !== "datetime") {
      f.loopShortTermSummaryText.textContent = "Short term schedules work with target timers.";
      return;
    }
    if (!events.length) {
      f.loopShortTermSummaryText.textContent = "Add events to get started.";
      return;
    }
    const next = findNextShortTermOccurrence(events, now());
    if (!loopsChecked) {
      if (next) {
        f.loopShortTermSummaryText.textContent = `Next up: ${next.event.label} — ${describeShortTermOccurrence(next.event, next.timestamp)}. Enable looping to activate.`;
      } else {
        f.loopShortTermSummaryText.textContent = "Enable looping to activate this schedule.";
      }
      return;
    }
    if (next) {
      f.loopShortTermSummaryText.textContent = `Next: ${next.event.label} — ${describeShortTermOccurrence(next.event, next.timestamp)}`;
      ensureShortTermTarget();
    } else {
      f.loopShortTermSummaryText.textContent = "No upcoming events — we'll pause after the current countdown.";
    }
  }

  function createDefaultShortTermEvent(type = "weekly") {
    const base = new Date();
    base.setSeconds(0, 0);
    base.setMinutes(base.getMinutes() + 5);
    const roundedMinutes = Math.min(55, Math.ceil(base.getMinutes() / 5) * 5);
    if (roundedMinutes >= 60) {
      base.setHours(base.getHours() + 1);
      base.setMinutes(0);
    } else {
      base.setMinutes(roundedMinutes);
    }
    const hour = base.getHours();
    const minute = base.getMinutes();
    if (type === "single") {
      const dateStr = toLocalDateInputValue(base);
      return {
        id: uid("ste_"),
        label: "New event",
        type: "single",
        date: dateStr,
        hour,
        minute,
        timestamp: combineDateAndTime(dateStr, hour, minute)
      };
    }
    return {
      id: uid("ste_"),
      label: "New event",
      type: "weekly",
      weekdays: [base.getDay()],
      weekday: base.getDay(),
      hour,
      minute,
      intervalWeeks: 1,
      anchorWeekStart: normalizeWeekStartTimestamp(base.getTime())
    };
  }

  function buildShortTermEventRow(event) {
    const row = document.createElement("div");
    row.className = "shortterm-event";
    row.dataset.id = event.id;

    const header = document.createElement("div");
    header.className = "shortterm-event-header";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Event name";
    labelInput.value = event.label || "";
    labelInput.addEventListener("input", () => {
      event.label = labelInput.value;
    });
    header.appendChild(labelInput);

    const typeSelect = document.createElement("select");
    typeSelect.innerHTML = '<option value="weekly">Weekly</option><option value="single">One-time</option>';
    typeSelect.value = event.type === "single" ? "single" : "weekly";
    typeSelect.addEventListener("change", () => {
      const newType = typeSelect.value === "single" ? "single" : "weekly";
      event.type = newType;
      if (newType === "single") {
        const base = new Date();
        event.date = event.date || toLocalDateInputValue(base);
        event.timestamp = combineDateAndTime(event.date, event.hour, event.minute);
        delete event.intervalWeeks;
        delete event.anchorWeekStart;
      } else {
        let nextWeekdays = Array.isArray(event.weekdays) ? event.weekdays.map(day => Number(day)) : [];
        nextWeekdays = nextWeekdays.filter(Number.isFinite).map(day => clamp(Math.round(day), 0, 6));
        if (!nextWeekdays.length) {
          const fallback = Number(event.weekday);
          nextWeekdays = [Number.isFinite(fallback) ? clamp(Math.round(fallback), 0, 6) : new Date().getDay()];
        }
        nextWeekdays = Array.from(new Set(nextWeekdays)).sort((a, b) => a - b);
        event.weekdays = nextWeekdays;
        event.weekday = event.weekdays[0];
        const numericInterval = Math.max(1, Math.floor(Number(event.intervalWeeks ?? 1)) || 1);
        event.intervalWeeks = Number.isFinite(numericInterval) && numericInterval > 0 ? numericInterval : 1;
        delete event.date;
        delete event.timestamp;
        delete event.anchorWeekStart;
      }
      renderShortTermEventList();
    });
    header.appendChild(typeSelect);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn icon shortterm-remove";
    removeBtn.title = "Remove";
    removeBtn.setAttribute("aria-label", "Remove event");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      shortTermDialogEvents = shortTermDialogEvents.filter(ev => ev.id !== event.id);
      renderShortTermEventList();
    });
    header.appendChild(removeBtn);

    row.appendChild(header);

    const body = document.createElement("div");
    body.className = "shortterm-event-body";
    if (event.type === "single") {
      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.value = event.date || toLocalDateInputValue(new Date());
      dateInput.addEventListener("change", () => {
        event.date = dateInput.value;
        event.timestamp = combineDateAndTime(event.date, event.hour, event.minute);
      });
      body.appendChild(dateInput);

      const timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = formatTimeOfDay(event.hour, event.minute);
      timeInput.addEventListener("change", () => {
        const parsed = parseTimeOfDay(timeInput.value);
        if (parsed) {
          event.hour = parsed.hour;
          event.minute = parsed.minute;
          event.timestamp = combineDateAndTime(event.date || toLocalDateInputValue(new Date()), event.hour, event.minute);
        }
      });
      body.appendChild(timeInput);
    } else {
      let initialWeekdays = Array.isArray(event.weekdays) ? event.weekdays.map(day => Number(day)) : [];
      initialWeekdays = initialWeekdays.filter(Number.isFinite).map(day => clamp(Math.round(day), 0, 6));
      if (!initialWeekdays.length) {
        const fallback = Number(event.weekday);
        initialWeekdays = [Number.isFinite(fallback) ? clamp(Math.round(fallback), 0, 6) : new Date().getDay()];
      }
      initialWeekdays = Array.from(new Set(initialWeekdays)).sort((a, b) => a - b);
      event.weekdays = initialWeekdays;
      event.weekday = initialWeekdays[0];
      let intervalWeeks = Math.max(1, Math.floor(Number(event.intervalWeeks ?? 1)) || 1);
      if (!Number.isFinite(intervalWeeks) || intervalWeeks < 1) intervalWeeks = 1;
      event.intervalWeeks = intervalWeeks;

      const weekdaysContainer = document.createElement("div");
      weekdaysContainer.className = "shortterm-weekdays";
      const selectedSet = new Set(initialWeekdays);
      const syncWeekdaysFromInputs = () => {
        const selected = Array.from(weekdaysContainer.querySelectorAll('input[type="checkbox"]'))
          .filter(cb => cb.checked)
          .map(cb => clamp(Math.round(Number(cb.value)), 0, 6))
          .sort((a, b) => a - b);
        if (!selected.length) {
          return false;
        }
        event.weekdays = selected;
        event.weekday = selected[0];
        delete event.anchorWeekStart;
        return true;
      };
      WEEKDAY_NAMES.forEach((name, index) => {
        const labelEl = document.createElement("label");
        labelEl.className = "shortterm-weekday";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = String(index);
        checkbox.checked = selectedSet.has(index);
        checkbox.addEventListener("change", () => {
          if (!syncWeekdaysFromInputs()) {
            checkbox.checked = true;
            syncWeekdaysFromInputs();
          }
          refreshStartWeekSelection();
          commitStartWeek();
        });
        const span = document.createElement("span");
        span.textContent = name.slice(0, 3);
        labelEl.appendChild(checkbox);
        labelEl.appendChild(span);
        weekdaysContainer.appendChild(labelEl);
      });
      syncWeekdaysFromInputs();
      body.appendChild(weekdaysContainer);

      const timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = formatTimeOfDay(event.hour, event.minute);
      timeInput.addEventListener("change", () => {
        const parsed = parseTimeOfDay(timeInput.value);
        if (parsed) {
          event.hour = parsed.hour;
          event.minute = parsed.minute;
          delete event.anchorWeekStart;
          refreshStartWeekSelection();
          commitStartWeek();
        }
      });
      body.appendChild(timeInput);

      const intervalContainer = document.createElement("div");
      intervalContainer.className = "shortterm-interval";

      const intervalLabel = document.createElement("span");
      intervalLabel.textContent = "Repeat every";
      intervalContainer.appendChild(intervalLabel);

      const intervalInput = document.createElement("input");
      intervalInput.type = "number";
      intervalInput.min = "1";
      intervalInput.inputMode = "numeric";
      intervalInput.value = String(intervalWeeks);
      intervalInput.setAttribute("aria-label", "Repeat every X weeks");

      const intervalSuffix = document.createElement("span");
      const updateIntervalSuffix = value => {
        const display = Number.isFinite(value) ? value : 1;
        intervalSuffix.textContent = display === 1 ? "week" : "weeks";
      };

      const getIntervalWeeks = () => {
        let numeric = Math.floor(Number(intervalInput.value));
        if (!Number.isFinite(numeric) || numeric < 1) {
          numeric = Math.floor(Number(event.intervalWeeks ?? intervalWeeks));
        }
        if (!Number.isFinite(numeric) || numeric < 1) {
          numeric = 1;
        }
        return numeric;
      };

      const startWeekContainer = document.createElement("div");
      startWeekContainer.className = "shortterm-weekstart";

      const startWeekLabel = document.createElement("span");
      startWeekLabel.textContent = "Start on";
      startWeekContainer.appendChild(startWeekLabel);

      const startWeekSelect = document.createElement("select");
      startWeekSelect.setAttribute("aria-label", "Select which week the rotation starts");
      startWeekContainer.appendChild(startWeekSelect);

      const computeStartWeekOffset = interval => {
        if (!Number.isFinite(interval) || interval < 1) return 0;
        const baseWeek = normalizeWeekStartTimestamp(now());
        let anchor = Number(event.anchorWeekStart);
        if (Number.isFinite(anchor)) {
          anchor = normalizeWeekStartTimestamp(anchor);
        } else {
          anchor = NaN;
        }
        if (!Number.isFinite(anchor)) return 0;
        if (anchor >= baseWeek) {
          const diffWeeks = Math.round((anchor - baseWeek) / WEEK_MS);
          return ((diffWeeks % interval) + interval) % interval;
        }
        const diffWeeks = Math.round((baseWeek - anchor) / WEEK_MS);
        return (interval - (diffWeeks % interval)) % interval;
      };

      const refreshStartWeekSelection = () => {
        const interval = getIntervalWeeks();
        startWeekSelect.innerHTML = "";
        if (interval <= 1) {
          startWeekContainer.classList.add("invisible");
          return;
        }
        startWeekContainer.classList.remove("invisible");
        for (let i = 0; i < interval; i++) {
          const option = document.createElement("option");
          option.value = String(i);
          if (i === 0) {
            option.textContent = "Start this week";
          } else if (i === 1) {
            option.textContent = "Start next week";
          } else {
            option.textContent = `Start in ${i} weeks`;
          }
          startWeekSelect.appendChild(option);
        }
        const offset = computeStartWeekOffset(interval);
        if (startWeekSelect.querySelector(`option[value="${offset}"]`)) {
          startWeekSelect.value = String(offset);
        } else {
          startWeekSelect.value = "0";
        }
      };

      const commitStartWeek = () => {
        const interval = getIntervalWeeks();
        if (interval <= 1) {
          delete event.anchorWeekStart;
          return;
        }
        let offset = Math.floor(Number(startWeekSelect.value));
        if (!Number.isFinite(offset) || offset < 0) offset = 0;
        if (offset >= interval) offset = interval - 1;
        const baseWeek = normalizeWeekStartTimestamp(now());
        const anchor = baseWeek + offset * WEEK_MS;
        event.anchorWeekStart = anchor;
      };

      updateIntervalSuffix(intervalWeeks);
      refreshStartWeekSelection();
      if (!Number.isFinite(Number(event.anchorWeekStart))) {
        commitStartWeek();
      }

      const commitInterval = () => {
        let numeric = Math.floor(Number(intervalInput.value));
        if (!Number.isFinite(numeric) || numeric < 1) {
          numeric = 1;
        }
        intervalInput.value = String(numeric);
        event.intervalWeeks = numeric;
        delete event.anchorWeekStart;
        updateIntervalSuffix(numeric);
        refreshStartWeekSelection();
        commitStartWeek();
      };

      intervalInput.addEventListener("change", commitInterval);
      intervalInput.addEventListener("blur", commitInterval);
      intervalInput.addEventListener("input", () => {
        const numeric = Math.floor(Number(intervalInput.value));
        updateIntervalSuffix(Number.isFinite(numeric) && numeric >= 1 ? numeric : 1);
        refreshStartWeekSelection();
      });

      startWeekSelect.addEventListener("change", () => {
        commitStartWeek();
        refreshStartWeekSelection();
      });

      intervalContainer.appendChild(intervalInput);
      intervalContainer.appendChild(intervalSuffix);
      body.appendChild(intervalContainer);
      body.appendChild(startWeekContainer);
    }
    row.appendChild(body);
    return row;
  }

  function renderShortTermEventList() {
    if (!shortTermEventsList || !shortTermEventsEmpty) return;
    shortTermEventsList.innerHTML = "";
    if (!Array.isArray(shortTermDialogEvents) || shortTermDialogEvents.length === 0) {
      shortTermEventsEmpty.classList.remove("invisible");
      return;
    }
    shortTermEventsEmpty.classList.add("invisible");
    shortTermDialogEvents.forEach(event => {
      shortTermEventsList.appendChild(buildShortTermEventRow(event));
    });
  }

  function closeShortTermDialog() {
    if (!shortTermDialog) return;
    try {
      shortTermDialog.close();
    } catch (err) {
      shortTermDialog.removeAttribute("open");
    }
    shortTermDialogEvents = [];
  }

  function openShortTermDialog({ autoCreate = false } = {}) {
    if (!userCanAccessShortTermSchedule()) return;
    if (!shortTermDialog) return;
    shortTermDialogEvents = cloneShortTermEvents(shortTermEventsDraft);
    if (autoCreate && shortTermDialogEvents.length === 0) {
      shortTermDialogEvents.push(createDefaultShortTermEvent("weekly"));
    }
    if (shortTermEventsEmpty) shortTermEventsEmpty.classList.add("invisible");
    renderShortTermEventList();
    try {
      shortTermDialog.showModal();
    } catch (err) {
      shortTermDialog.setAttribute("open", "");
    }
  }

  function handleShortTermSave() {
    if (!userCanAccessShortTermSchedule()) {
      closeShortTermDialog();
      return;
    }
    const sanitized = sanitizeShortTermEvents(shortTermDialogEvents);
    shortTermEventsDraft = cloneShortTermEvents(sanitized);
    closeShortTermDialog();
    if (sanitized.length && f.when) {
      const next = findNextShortTermOccurrence(sanitized, now());
      if (next && Number.isFinite(next.timestamp)) {
        try {
          f.when.value = toLocalDatetime(new Date(next.timestamp));
        } catch (err) {
          // ignore assignment failure
        }
      }
    }
    updateShortTermSummary();
    ensureShortTermTarget();
  }

  function updateLoopingFieldsForMode() {
    if (!f.loopDetails) return;
    const loopsAvailable = isLoopsFeatureEnabled();
    const mode = f.mode ? f.mode.value : "duration";
    const supported = mode === "duration" || mode === "datetime";
    const toggleChecked = loopsAvailable && supported && !!(f.loopEnabled && f.loopEnabled.checked);
    if (f.loopDurationNote) {
      f.loopDurationNote.classList.toggle("invisible", !(toggleChecked && mode === "duration"));
    }
    if (f.loopDatetimeFields) {
      f.loopDatetimeFields.classList.toggle("invisible", !(toggleChecked && mode === "datetime"));
    }
    if (!toggleChecked && f.loopDatetimeFields) {
      f.loopDatetimeFields.classList.add("invisible");
    }
    if (f.loopAlignRow) {
      const hideAlign = f.loopUnit && f.loopUnit.value === "shortterm";
      f.loopAlignRow.classList.toggle("invisible", !(toggleChecked && mode === "datetime") || hideAlign);
    }
    updateLoopingUnitFields();
  }

  function updateLoopingSectionVisibility() {
    if (!f.loopDetails) return;
    enforceShortTermScheduleAvailability();
    const loopsAvailable = isLoopsFeatureEnabled();
    const mode = f.mode ? f.mode.value : "duration";
    const supported = mode === "duration" || mode === "datetime";
    const shouldShow = loopsAvailable && supported;
    f.loopDetails.classList.toggle("invisible", !shouldShow);
    if (!loopsAvailable && f.loopEnabled) {
      f.loopEnabled.checked = false;
    }
    updateLoopingFieldsForMode();
  }

  function updateDefaultSettingsSection() {
    if (!settingsDefaultsSection) return;
    const shouldShow = !!currentUser && userCanAccessDefaultSettings();
    settingsDefaultsSection.classList.toggle("invisible", !shouldShow);
    if (!shouldShow) {
      return;
    }
    populateDefaultSettingsOptions();
    applyPreferenceSelections();
    renderPreferencesStatus();
  }

  function handlePreferenceFieldChange() {
    if (isUpdatingPreferenceUI) return;
    if (!settingsDefaultStyle || !settingsDefaultUnits) return;
    updateSettingsCustomFormatVisibility();
    const pending = sanitizePreferences({
      defaultStyle: settingsDefaultStyle.value,
      defaultUnits: settingsDefaultUnits.value,
      autoDisplayMode: settingsAutoUnitsMode ? settingsAutoUnitsMode.value : undefined,
      defaultCustomFormat: settingsCustomFormat ? settingsCustomFormat.value : undefined
    });
    const current = sanitizePreferences(userPreferences);
    if (
      pending.defaultStyle === current.defaultStyle &&
      pending.defaultUnits === current.defaultUnits &&
      pending.autoDisplayMode === current.autoDisplayMode &&
      pending.defaultCustomFormat === current.defaultCustomFormat
    ) {
      restorePersistedPreferenceStatus();
    } else {
      setPreferencesStatus("Unsaved changes — click Save Defaults.", "warning");
    }
  }

  async function handlePreferencesSave() {
    if (!settingsDefaultStyle || !settingsDefaultUnits) return;
    if (!currentUser || !userCanAccessDefaultSettings()) {
      setPreferencesStatus("Only beta testers, special access, or the owner can change defaults.", "error");
      return;
    }

    const pending = sanitizePreferences({
      defaultStyle: settingsDefaultStyle.value,
      defaultUnits: settingsDefaultUnits.value,
      autoDisplayMode: settingsAutoUnitsMode ? settingsAutoUnitsMode.value : undefined,
      defaultCustomFormat: settingsCustomFormat ? settingsCustomFormat.value : undefined
    });
    const adjusted = { ...pending };
    if (adjusted.defaultStyle === "pro" && !userCanUseProMode()) {
      adjusted.defaultStyle = DEFAULT_PREFERENCES.defaultStyle;
    }

    const current = sanitizePreferences(userPreferences);
    const unchanged = adjusted.defaultStyle === current.defaultStyle &&
      adjusted.defaultUnits === current.defaultUnits &&
      adjusted.autoDisplayMode === current.autoDisplayMode &&
      adjusted.defaultCustomFormat === current.defaultCustomFormat;
    if (unchanged) {
      setPreferencesStatus("Defaults unchanged.", "neutral", { persist: true });
      return;
    }

    applyPreferencesToState(adjusted, { save: true });
    if (settingsDefaultsSaveBtn) settingsDefaultsSaveBtn.disabled = true;
    setPreferencesStatus("Saving defaults...", "warning");

    try {
      const pushed = await pushPreferencesToCloud();
      if (pushed) {
        setPreferencesStatus("Defaults saved to your account.", "success", { persist: true });
      } else {
        setPreferencesStatus("Defaults saved locally. We'll sync them when you're online.", "warning", { persist: true });
      }
    } catch (error) {
      if (error.message === "account-not-found") {
        setPreferencesStatus("Cloud account missing. Defaults saved locally only.", "error", { persist: true });
      } else {
        console.error("Failed to save preferences to the cloud:", error);
        setPreferencesStatus("Defaults saved locally. Cloud sync failed.", "error");
      }
    } finally {
      if (settingsDefaultsSaveBtn) settingsDefaultsSaveBtn.disabled = false;
    }
  }

  function getDefaultTimerStyle() {
    const sanitized = sanitizeStylePreference(userPreferences.defaultStyle);
    if (sanitized === "pro" && !userCanUseProMode()) {
      return DEFAULT_PREFERENCES.defaultStyle;
    }
    return sanitized;
  }

  function getDefaultTimerUnits() {
    return sanitizeUnitsPreference(userPreferences.defaultUnits);
  }

  function getDefaultCustomFormat() {
    return sanitizeCustomFormat(userPreferences.defaultCustomFormat);
  }

  function getAutoDisplayMode() {
    return sanitizeAutoDisplayMode(userPreferences.autoDisplayMode);
  }

  function resolveCustomFormatValue(rawFormat) {
    return sanitizeCustomFormat(rawFormat);
  }

  function resolveFormatForUnits(unitsValue, inputValue) {
    if (unitsValue === "custom") {
      return resolveCustomFormatValue(inputValue);
    }
    const trimmed = typeof inputValue === "string" ? inputValue.trim() : "";
    return trimmed || DEFAULT_PREFERENCES.defaultCustomFormat;
  }

  function enforceProModeEligibility(showNotice = false) {
    if (!f.style) return;
    const allowed = userCanUseProMode();
    if (allowed) {
      const proOption = ensureProModeOptionPresent();
      if (proOption) {
        proOption.disabled = false;
        proOption.hidden = false;
        proOption.removeAttribute("aria-hidden");
      }
      toggleProAccessNotice(false);
      return;
    }

    const proOption = f.style.querySelector('option[value="pro"]');
    const wasSelected = f.style.value === "pro";
    if (proOption) {
      proOption.remove();
    }
    if (wasSelected) {
      const fallback = lastStyleSelection === "pro" ? "bar" : (lastStyleSelection || "bar");
      f.style.value = fallback;
      lastStyleSelection = f.style.value;
      updateStyleUI();
    }
    if (showNotice) {
      toggleProAccessNotice(true);
    } else {
      toggleProAccessNotice(false);
    }
  }

  if (f.style) {
    enforceProModeEligibility(false);
  }

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
    cloudAccountMissing = false;
    try {
      const userRaw = localStorage.getItem(KEY_USER);
      if (userRaw) {
        currentUser = JSON.parse(userRaw);
        if (currentUser) {
          if (!currentUser.id && currentUser._id) {
            currentUser.id = currentUser._id;
          }
          delete currentUser._id;
          const storedRole = currentUser.role ?? currentUser.Role;
          currentUser.role = normalizeRole(storedRole);
          delete currentUser.Role;
          localStorage.setItem(KEY_USER, JSON.stringify(currentUser));
        }
      }
      const raw = localStorage.getItem(KEY_TIMERS);
      if (raw){ const data = JSON.parse(raw); if (Array.isArray(data)) timers = data.map(migrateTimer); }
      const rt = localStorage.getItem(TPL);
      if (rt){ const data = JSON.parse(rt); if (Array.isArray(data)) templates = data.map(migrateTemplate); }
    } catch(e){ console.warn("load failed", e); }
    applyPreferencesToState(loadPreferencesForCurrentUser(), { save: false });
    persistedPreferenceStatus = { message: "", tone: "neutral" };
    lastPreferenceStatus = { message: "", tone: "neutral" };
    renderPreferencesStatus();
    updateUIForLoginState();
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
    out.loopConfig = sanitizeLoopConfig(out.loopConfig, out.mode, out.mode === "datetime" ? out.targetMs : null);
    out.loopCount = Math.max(0, Math.floor(Number(out.loopCount) || 0));
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
    if (out.units === "custom") {
      out.format = resolveCustomFormatValue(out.format);
    } else if (typeof out.format === "string") {
      out.format = out.format.trim() || DEFAULT_PREFERENCES.defaultCustomFormat;
    } else {
      out.format = DEFAULT_PREFERENCES.defaultCustomFormat;
    }
    return out;
  }

  function migrateTemplate(tpl){
    const out = {...tpl};
    out.color = normalizeColorString(out.color);
    out.color2 = normalizeColorString(out.color2, out.color);
    out.loopConfig = sanitizeLoopConfig(out.loopConfig, out.mode || "duration", out.targetMs ?? null);
    if (out.style === "pro"){
      ensureProSplitState(out);
    }
    if (out.units === "custom") {
      out.format = resolveCustomFormatValue(out.format);
    } else if (typeof out.format === "string") {
      out.format = out.format.trim() || DEFAULT_PREFERENCES.defaultCustomFormat;
    } else {
      out.format = DEFAULT_PREFERENCES.defaultCustomFormat;
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
  function fmtCustom(tmpl, S, name, timerObj=null){
    let percentStr = "0";
    if (timerObj) {
      const progress = calculateProgress(timerObj);
      const percent = Math.round(progress * 100);
      percentStr = String(percent);
    }
    const map = {"{DD}":String(S.d), "{HH}":pad2(S.h), "{mm}":pad2(S.m), "{ss}":pad2(S.s), "{ms3}":pad3(S.ms),
      "{totalD}":String(S.totalD), "{totalH}":String(S.totalH), "{totalm}":String(S.totalm), "{totals}":String(S.totals),
      "{name}": name || "", "{percent}": percentStr};
    let out = tmpl;
    for (const k in map) out = out.split(k).join(map[k]);
    return out;
  }

  function formatAutoClassic(S, showMs){
    const totalSeconds = S.totals;
    if (totalSeconds >= 3600){
      const H=Math.floor(totalSeconds/3600), M=Math.floor((totalSeconds%3600)/60), SS=totalSeconds%60;
      return H+":"+pad2(M)+":"+pad2(SS);
    }
    if (totalSeconds >= 60){
      const M=Math.floor(totalSeconds/60), SS=totalSeconds%60;
      return M+":"+pad2(SS);
    }
    return S.s + (showMs? "."+pad3(S.ms):"") + "s";
  }

  function formatAutoVerbose(S, showMs){
    if (S.d > 0){
      const parts = [`${S.d}d`];
      if (S.h > 0) parts.push(`${S.h}h`);
      if (S.m > 0) parts.push(`${S.m}m`);
      if (S.h === 0 && S.m === 0 && (S.s > 0 || showMs)){
        parts.push(S.s + (showMs ? "." + pad3(S.ms) : "") + "s");
      }
      return parts.join(" ");
    }
    if (S.h > 0){
      const parts = [`${S.h}h`];
      if (S.m > 0) parts.push(`${S.m}m`);
      if ((S.m === 0 || showMs) && (S.s > 0 || showMs)){
        parts.push(S.s + (showMs ? "." + pad3(S.ms) : "") + "s");
      }
      return parts.join(" ");
    }
    if (S.m > 0){
      const parts = [`${S.m}m`];
      if (S.s > 0 || showMs){
        parts.push(S.s + (showMs ? "." + pad3(S.ms) : "") + "s");
      }
      return parts.join(" ");
    }
    return S.s + (showMs? "."+pad3(S.ms):"") + "s";
  }

  function formatAutoByMode(S, showMs, mode){
    if (mode === "Standard") return formatAutoVerbose(S, showMs);
    return formatAutoClassic(S, showMs);
  }
  function fmt(t, units="auto", showMs=false, tmpl=null, name="", timerObj=null){
    const S = splitTime(t);
    switch (units){
      case "d": return S.d + " day" + (S.d!==1?"s":"");
      case "dhm": { const parts=[]; if(S.d) parts.push(S.d+"d"); if(S.d||S.h) parts.push(S.h+"h"); parts.push(S.m+"m"); return parts.join(" "); }
      case "hms": return (S.d*24+S.h)+":"+pad2(S.m)+":"+pad2(S.s) + (showMs? "."+pad3(S.ms):"");
      case "ms":  return (S.d*24*60+S.h*60+S.m)+":"+pad2(S.s) + (showMs? "."+pad3(S.ms):"");
      case "s":   return (S.d*86400+S.h*3600+S.m*60+S.s) + (showMs? "."+pad3(S.ms):"") + "s";
      case "custom": return fmtCustom(tmpl || "{HH}:{mm}:{ss}", S, name, timerObj);
      case "auto":
      default:{
        const mode = getAutoDisplayMode();
        return formatAutoByMode(S, showMs, mode);
      }
    }
  }

  const easings = { linear: x => x, easeOut: x => 1 - Math.pow(1-x, 2), easeInOut: x => x<.5 ? 2*x*x : 1 - Math.pow(-2*x+2,2)/2 };

  function timerLoopsEnabled(t){
    return !!(t && t.loopConfig && t.loopConfig.enabled && (t.mode === "duration" || t.mode === "datetime"));
  }

  function daysInMonth(year, month){
    return new Date(year, month + 1, 0).getDate();
  }

  function nthWeekdayOfMonth(year, month, weekday, ordinalKey){
    const ordinal = MONTHLY_ORDINAL_INDEX[ordinalKey] ?? 0;
    if (ordinal === -1){
      const lastDay = new Date(year, month + 1, 0);
      const diff = (lastDay.getDay() - weekday + 7) % 7;
      return lastDay.getDate() - diff;
    }
    const firstDay = new Date(year, month, 1);
    const diff = (weekday - firstDay.getDay() + 7) % 7;
    const day = 1 + diff + ordinal * 7;
    const maxDay = daysInMonth(year, month);
    if (day > maxDay){
      return nthWeekdayOfMonth(year, month, weekday, "last");
    }
    return day;
  }

  function addLoopInterval(previousTargetMs, config){
    const baseDate = new Date(Number(previousTargetMs));
    if (!Number.isFinite(baseDate.getTime())){
      const fallback = Number(previousTargetMs) || now();
      return fallback + Math.max(1, config.interval) * 86400000;
    }
    const hours = baseDate.getHours();
    const minutes = baseDate.getMinutes();
    const seconds = baseDate.getSeconds();
    const milliseconds = baseDate.getMilliseconds();
    let result;
    switch (config.unit){
      case "week": {
        const days = Array.isArray(config.weeklyDays) ? config.weeklyDays : [];
        const normalizedDays = Array.from(new Set(days
          .map(day => Number(day))
          .filter(num => Number.isFinite(num))
          .map(num => clamp(Math.round(num), 0, 6))
        )).sort((a, b) => a - b);
        const activeDays = normalizedDays.length ? normalizedDays : [baseDate.getDay()];
        const intervalWeeks = Math.max(1, Math.floor(Number(config.interval) || 1));
        let offsetRaw = Number(config.weekStartOffset);
        if (!Number.isFinite(offsetRaw)) offsetRaw = 0;
        let offset = Math.floor(offsetRaw);
        offset = ((offset % intervalWeeks) + intervalWeeks) % intervalWeeks;
        let anchorBase = normalizeWeekStartTimestamp(config.weekAnchorMs);
        if (!Number.isFinite(anchorBase)) {
          anchorBase = normalizeWeekStartTimestamp(baseDate);
        }
        const effectiveAnchor = Number.isFinite(anchorBase)
          ? anchorBase + offset * WEEK_MS
          : NaN;
        const daySet = new Set(activeDays);
        const candidate = new Date(baseDate);
        candidate.setDate(candidate.getDate() + 1);
        let guard = 0;
        let nextDate = null;
        while (guard < 512) {
          if (daySet.has(candidate.getDay())) {
            if (!Number.isFinite(effectiveAnchor) || intervalWeeks <= 1) {
              nextDate = new Date(candidate);
              break;
            }
            const weekStart = normalizeWeekStartTimestamp(candidate.getTime());
            if (Number.isFinite(weekStart)) {
              if (weekStart < effectiveAnchor) {
                const diff = Math.ceil((effectiveAnchor - weekStart) / WEEK_MS);
                candidate.setDate(candidate.getDate() + diff * 7);
                guard += diff;
                continue;
              }
              const diffWeeks = Math.floor((weekStart - effectiveAnchor) / WEEK_MS);
              if (diffWeeks % intervalWeeks === 0) {
                nextDate = new Date(candidate);
                break;
              }
              const weeksToAdd = intervalWeeks - (diffWeeks % intervalWeeks);
              candidate.setDate(candidate.getDate() + weeksToAdd * 7);
              guard += weeksToAdd;
              continue;
            }
          }
          candidate.setDate(candidate.getDate() + 1);
          guard++;
        }
        if (nextDate) {
          result = nextDate;
        } else {
          result = new Date(baseDate);
          result.setDate(result.getDate() + intervalWeeks * 7);
        }
        break;
      }
      case "month": {
        result = new Date(baseDate);
        result.setDate(1);
        result.setMonth(result.getMonth() + config.interval);
        if (config.monthlyMode === "weekday"){
          const targetDay = nthWeekdayOfMonth(result.getFullYear(), result.getMonth(), config.monthlyWeekday, config.monthlyOrdinal);
          result.setDate(targetDay);
        } else {
          const maxDay = daysInMonth(result.getFullYear(), result.getMonth());
          const targetDay = clamp(config.monthlyDay, 1, maxDay);
          result.setDate(targetDay);
        }
        break;
      }
      case "year": {
        result = new Date(baseDate);
        result.setFullYear(result.getFullYear() + config.interval);
        break;
      }
      case "shortterm": {
        const events = Array.isArray(config.events) ? config.events : [];
        const after = Number.isFinite(previousTargetMs) ? previousTargetMs + 1 : now();
        const next = findNextShortTermOccurrence(events, after);
        if (next && Number.isFinite(next.timestamp)) {
          return next.timestamp;
        }
        const fallback = Number(previousTargetMs) || now();
        return fallback + Math.max(1, config.interval || 1) * 86400000;
      }
      case "day":
      default: {
        result = new Date(baseDate);
        result.setDate(result.getDate() + config.interval);
        break;
      }
    }
    result.setHours(hours, minutes, seconds, milliseconds);
    return result.getTime();
  }

  function computeNextLoopTarget(t, config){
    const baseTarget = Number(t.targetMs) || now();
    if (config.unit === "shortterm") {
      const events = Array.isArray(config.events) ? config.events : [];
      const after = Math.max(now(), Number.isFinite(baseTarget) ? baseTarget + 1 : now());
      const next = findNextShortTermOccurrence(events, after);
      if (next && Number.isFinite(next.timestamp)) {
        return next.timestamp;
      }
      return (Number.isFinite(baseTarget) ? baseTarget : now()) + Math.max(1, config.interval || 1) * 86400000;
    }
    let candidate = addLoopInterval(baseTarget, config);
    const nowTs = now();
    let guard = 0;
    while (candidate <= nowTs && guard < 512){
      candidate = addLoopInterval(candidate, config);
      guard++;
    }
    if (candidate <= nowTs){
      return addLoopInterval(nowTs, config);
    }
    return candidate;
  }

  function handleLoopRestart(t, total){
    if (!timerLoopsEnabled(t)) return false;
    const nowTs = now();
    const sanitized = sanitizeLoopConfig(t.loopConfig, t.mode, t.mode === "datetime" ? t.targetMs : null);
    t.loopConfig = sanitized;
    if (t.mode === "duration"){
      let duration = Number(t.duration || total);
      if (!Number.isFinite(duration) || duration <= 0){
        duration = Number(total) || 1000;
      }
      duration = Math.max(1, Math.round(duration));
      t.start = nowTs;
      t.duration = duration;
      t.total0 = duration;
    } else if (t.mode === "datetime"){
      const previousTarget = Number(t.targetMs);
      const nextTarget = computeNextLoopTarget(t, sanitized);
      if (!Number.isFinite(nextTarget)){
        return false;
      }
      let startMs = nowTs;
      if (sanitized.alignStartToEnd && Number.isFinite(previousTarget)){
        startMs = previousTarget;
      }
      let totalMs = nextTarget - startMs;
      if (!Number.isFinite(totalMs) || totalMs <= 0){
        startMs = nowTs;
        totalMs = nextTarget - startMs;
        if (!Number.isFinite(totalMs) || totalMs <= 0){
          totalMs = Math.max(1000, Number(total) || 1000);
        }
      }
      t.targetMs = nextTarget;
      t.start = startMs;
      t.total0 = totalMs;
      delete t.startOverrideMs;
      delete t.startOverridePct;
    } else {
      return false;
    }
    t.loopCount = Math.max(0, Math.floor(Number(t.loopCount) || 0)) + 1;
    t.completed = false;
    t._prevRem = t.total0;
    t._firedMap = {};
    t._kMap = {};
    t.mb_plan = planMultiBar(Math.max(1000, t.total0), t.mb_bars||null, t.mb_ticks||null);
    delete t.paused;
    delete t.pausedAt;
    delete t.leftWhenPaused;
    return true;
  }

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

  function calculateProgress(t){
    const total = t.total0 || baseTotal(t);
    if (total <= 0) return 1;
    const rem = Math.max(0, remainingMs(t));
    const elapsed = Math.max(0, total - rem);
    return total ? elapsed / total : 1;
  }

  function visualProgress(t){
    const raw = calculateProgress(t);
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
    if (t.style === "pro" && !userCanUseProMode()) {
      alert("Pro Mode templates require Beta Tester or higher accounts.");
      return;
    }
    if (t.style === "pro") ensureProSplitState(t);
    const tpl = { id:uid("tpl_"), style:t.style, color:t.color, color2:t.color2, units:t.units, format: resolveFormatForUnits(t.units, t.format),
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
  function fillTokens(tmpl, rem, total, t){
    const template = t.units === "custom" ? resolveCustomFormatValue(t.format) : null;
    const left = fmt(rem, t.units, t.ms==='on', template, t.name, t);
    const elapsed = fmt(Math.max(0,total-rem), t.units,false,template,t.name, t);
    return (tmpl||"{left} remaining").replaceAll("{left}", left).replaceAll("{elapsed}", elapsed).replaceAll("{name}", t.name||"");
  }
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
    const draftStyle = template?.style || getDefaultTimerStyle();
    const draftUnits = template?.units || getDefaultTimerUnits();
    const draft = id ? timers.find(x=>x.id===id) : {
      id: uid("t_"), name:"", mode:"duration", style: draftStyle, color: template?.color || "#6c7bff",
      color2: template?.color2 || template?.color || "#6c7bff",
      units: draftUnits,
      format: template?.format || (draftUnits === "custom" ? getDefaultCustomFormat() : "{HH}:{mm}:{ss}"),
      ring_thickness: template?.ring_thickness ?? 10, ease: template?.ease || "linear", tick: template?.tick ?? 100, ms: template?.ms || "off",
      dotsCount: template?.dotsCount ?? 60, mb_bars: template?.mb_bars ?? null, mb_ticks: template?.mb_ticks ?? null, letters_n: template?.letters_n ?? null,
      triggers: template?.triggers || [], doneSoundDataUrl: template?.doneSoundDataUrl || null, doneTts: template?.doneTts || "", prestigeLevel:0,
      smartMethod: "manifold", smartUrl: ""
    };

    f.name.value = draft.name||""; f.mode.value=draft.mode||"duration"; f.style.value=draft.style||"bar"; f.color.value=draft.color||"#6c7bff";
    if (f.color2) f.color2.value = draft.color2 || draft.color || "#6c7bff";
    f.units.value = draft.units || "auto";
    if (f.units.value === "custom") {
      f.format.value = resolveCustomFormatValue(draft.format || getDefaultCustomFormat());
    } else {
      const fallbackFormat = typeof draft.format === "string" && draft.format.trim()
        ? draft.format.trim()
        : DEFAULT_PREFERENCES.defaultCustomFormat;
      f.format.value = fallbackFormat;
    }
    f.ring_thickness.value=draft.ring_thickness??10; f.ease.value=draft.ease||"linear"; f.tick.value=draft.tick??100; f.ms.value=draft.ms||"off";
    f.mb_bars.value = draft.mb_bars ?? ""; f.mb_ticks.value = draft.mb_ticks ?? ""; if (f.letters_n) f.letters_n.value = draft.letters_n ?? "";
    if (f.style) {
      lastStyleSelection = f.style.value;
      if (!userCanUseProMode() && f.style.value === "pro") {
        enforceProModeEligibility(true);
      } else {
        enforceProModeEligibility(false);
      }
    }
    if (f.smartMethod) f.smartMethod.value = draft.smartMethod || "manifold";
    if (f.smartUrl) f.smartUrl.value = draft.smartUrl || "";
    if (draft.startOverrideMs && typeof draft.startOverrideMs === "number"){
      try { f.startWhen.value = toLocalDatetime(new Date(draft.startOverrideMs)); }
      catch(e){ f.startWhen.value = ""; }
    } else {
      f.startWhen.value = "";
    }
    f.startPct.value = (draft.startOverridePct ?? "") === null ? "" : (draft.startOverridePct ?? "");

    const loopSource = draft.loopConfig ?? template?.loopConfig ?? DEFAULT_LOOP_CONFIG;
    const loopReferenceMs = draft.mode === "datetime"
      ? (typeof draft.targetMs === "number" ? draft.targetMs : (f.when && f.when.value ? parseLocalDateTime(f.when.value) : null))
      : null;
    const sanitizedLoop = sanitizeLoopConfig(loopSource, draft.mode, loopReferenceMs);
    if (f.loopInterval) f.loopInterval.value = sanitizedLoop.interval;
    refreshWeeklyStartOptions(sanitizedLoop.weekStartOffset);
    if (f.loopUnit) {
      suppressLoopUnitChange = true;
      if (f.loopUnit.querySelector(`option[value="${sanitizedLoop.unit}"]`)) {
        f.loopUnit.value = sanitizedLoop.unit;
      } else if (f.loopUnit.options.length) {
        f.loopUnit.selectedIndex = 0;
      }
      suppressLoopUnitChange = false;
    }
    shortTermEventsDraft = cloneShortTermEvents(sanitizedLoop.events || []);
    if (f.loopWeeklyDays) {
      const selectedDays = new Set((sanitizedLoop.weeklyDays || []).map(day => String(clamp(Number(day), 0, 6))));
      const inputs = $$('input[type="checkbox"]', f.loopWeeklyDays);
      for (const input of inputs) {
        input.checked = selectedDays.has(input.value);
      }
    }
    if (f.loopMonthlyMode) {
      if (f.loopMonthlyMode.querySelector(`option[value="${sanitizedLoop.monthlyMode}"]`)) {
        f.loopMonthlyMode.value = sanitizedLoop.monthlyMode;
      } else if (f.loopMonthlyMode.options.length) {
        f.loopMonthlyMode.selectedIndex = 0;
      }
    }
    if (f.loopMonthlyDay) f.loopMonthlyDay.value = sanitizedLoop.monthlyDay;
    if (f.loopMonthlyOrdinal) {
      if (f.loopMonthlyOrdinal.querySelector(`option[value="${sanitizedLoop.monthlyOrdinal}"]`)) {
        f.loopMonthlyOrdinal.value = sanitizedLoop.monthlyOrdinal;
      } else if (f.loopMonthlyOrdinal.options.length) {
        f.loopMonthlyOrdinal.selectedIndex = 0;
      }
    }
    if (f.loopMonthlyWeekday) f.loopMonthlyWeekday.value = String(sanitizedLoop.monthlyWeekday);
    if (f.loopEnabled) {
      const loopsAllowed = isLoopsFeatureEnabled();
      const supportedMode = draft.mode === "duration" || draft.mode === "datetime";
      f.loopEnabled.checked = loopsAllowed && supportedMode && sanitizedLoop.enabled;
    }
    if (f.loopAlignStart) {
      f.loopAlignStart.checked = !!sanitizedLoop.alignStartToEnd;
    }
    updateShortTermSummary();

    renderTrList(draft.triggers||[]);
    f.addPctBtn.onclick = ()=> $("#trList").appendChild(trRow({type:"percent", valuePercent:25, action:"tts", ttsTemplate:"{left} left"}));
    f.addTimeBtn.onclick = ()=> $("#trList").appendChild(trRow({type:"time", valueTimeStr:"05:00", action:"sound"}));
    f.addIntBtn.onclick = ()=> $("#trList").appendChild(trRow({type:"interval", intervalSec:60, action:"tts", ttsTemplate:"{left} remaining"}));

    ;['change','input'].forEach(ev=>{
      [f.days,f.hours,f.minutes,f.seconds,f.when,f.letters_n,f.startWhen,f.startPct]
        .forEach(el=> el && el.addEventListener(ev, updateLettersPreview));
    });
    updateStyleUI();
    updateLoopingSectionVisibility();
    updateLoopingFieldsForMode();
    updateLoopingMonthlyModeFields();

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
      updateLoopingSectionVisibility();
      updateLoopingFieldsForMode();
    }
    toggleMode();
    f.mode.addEventListener("change", toggleMode);

    try{ editor.showModal ? editor.showModal() : editor.setAttribute("open",""); } catch(e){ editor.setAttribute("open",""); }
  }

  // --- START: Authentication and Sync Functions ---
  
  function updateUIForLoginState() {
    const isLoggedIn = !!currentUser;
    const role = getCurrentRole();
    if (settingsSignedIn) settingsSignedIn.classList.toggle('invisible', !isLoggedIn);
    if (settingsSignedOut) settingsSignedOut.classList.toggle('invisible', isLoggedIn);
    if (settingsUserEmail) settingsUserEmail.textContent = isLoggedIn ? currentUser.email : "";
    if (settingsRoleDisplay) {
      if (isLoggedIn) {
        settingsRoleDisplay.textContent = `Role: ${role}`;
        settingsRoleDisplay.classList.remove('invisible');
      } else {
        settingsRoleDisplay.textContent = "";
        settingsRoleDisplay.classList.add('invisible');
      }
    }
    if (settingsBtn) {
      settingsBtn.title = isLoggedIn ? `Settings (${role})` : "Settings";
      settingsBtn.dataset.role = role;
    }
    toggleProAccessNotice(false);
    enforceProModeEligibility(false);
    updateDefaultSettingsSection();
    updateLoopFeatureToggle();
    updateLoopingSectionVisibility();
  }

  function openSettingsDialog() {
    if (!settingsDialog) return;
    updateUIForLoginState();
    try {
      settingsDialog.showModal ? settingsDialog.showModal() : settingsDialog.setAttribute("open", "");
    } catch (e) {
      settingsDialog.setAttribute("open", "");
    }
    if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'true');
  }

  function closeSettingsDialog() {
    if (!settingsDialog) return;
    try {
      settingsDialog.close ? settingsDialog.close() : settingsDialog.removeAttribute("open");
    } catch (e) {
      settingsDialog.removeAttribute("open");
    }
    if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
  }

  function openAuthDialog(isSignUpMode = false) {
    if (!authDialog) return;
    const title = $("#authTitle");
    const submitBtn = $("#authSubmitBtn");
    const switchLink = $("#authModeSwitch");

    if (submitBtn) submitBtn.disabled = false;

    $("#auth_email").value = '';
    $("#auth_password").value = '';

    if (isSignUpMode) {
      if (title) title.textContent = "Sign Up";
      if (submitBtn) submitBtn.textContent = "Create Account";
      if (switchLink) switchLink.textContent = "Already have an account? Log In";
    } else {
      if (title) title.textContent = "Log In";
      if (submitBtn) submitBtn.textContent = "Log In";
      if (switchLink) switchLink.textContent = "Need an account? Sign Up";
    }
    // Gracefully handle browsers that do not support <dialog>.showModal()
    try {
      if (typeof authDialog.showModal === "function") {
        authDialog.showModal();
      } else {
        authDialog.setAttribute("open", "");
      }
    } catch (e) {
      authDialog.setAttribute("open", "");
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

    const initialSettings = sanitizePreferences(DEFAULT_PREFERENCES);
    const newUser = {
        email,
        password,
        Role: ROLE_STANDARD,
        timers: [], // Use JSON type, send empty array
        last_modified: new Date().toISOString(), // Use DateTime type, send ISO string
        Settings: initialSettings,
        preferences: initialSettings
    };
    
    const createResponse = await fetch(RESTDB_URL, {
        method: 'POST',
        headers: { 'x-apikey': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
    });

    if (createResponse.ok) {
        alert("Account created successfully! Please log in.");
        closeAuthDialog();
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

    currentUser = { id: user._id, email: user.email, role: extractRoleFromRecord(user) };
    cloudAccountMissing = false;
    localStorage.setItem(KEY_USER, JSON.stringify(currentUser));
    persistedPreferenceStatus = { message: "", tone: "neutral" };
    lastPreferenceStatus = { message: "", tone: "neutral" };
    applyPreferencesToState(loadPreferencesForCurrentUser(), { save: false });
    renderPreferencesStatus();
    updateUIForLoginState();
    closeAuthDialog();

    await syncTimers();
  }

  function handleLogout() {
    if (confirm("Are you sure you want to log out? Your timers will remain on this device but will no longer sync.")) {
      closeSettingsDialog();
      currentUser = null;
      cloudAccountMissing = false;
      localStorage.removeItem(KEY_USER);
      persistedPreferenceStatus = { message: "", tone: "neutral" };
      lastPreferenceStatus = { message: "", tone: "neutral" };
      applyPreferencesToState(loadPreferencesForCurrentUser(), { save: false });
      renderPreferencesStatus();
      updateUIForLoginState();
      render();
    }
  }
  
  async function syncTimers() {
      if (!currentUser || !currentUser.id || isSyncing) return;
      isSyncing = true;
      cloudAccountMissing = false;
      const localStoredPreferences = sanitizePreferences(loadPreferencesForCurrentUser());
      let shouldRestorePreferences = false;
      let preferencesPushedViaTimers = false;
      if (settingsSyncBtn) {
        settingsSyncBtn.textContent = "Syncing...";
        settingsSyncBtn.disabled = true;
      }

      try {
        const response = await fetch(`${RESTDB_URL}/${currentUser.id}`, {
            headers: { 'x-apikey': API_KEY }
        });
        if (response.status === 404) {
          cloudAccountMissing = true;
          applyPreferencesToState(localStoredPreferences, { save: false });
          if (userCanAccessDefaultSettings()) {
            setPreferencesStatus("Cloud account not found. Defaults will stay local.", "error", { persist: true });
          }
          alert('Cloud account not found. Your timers and defaults will stay local until it is restored.');
          return;
        }
        if (!response.ok) throw new Error("Could not fetch remote data.");

        const remoteUser = await response.json();
        const remoteTimersRaw = Array.isArray(remoteUser.timers) ? remoteUser.timers : [];
        const remoteTimers = remoteTimersRaw.map(migrateTimer);
        const remoteRole = extractRoleFromRecord(remoteUser);
        currentUser.role = remoteRole;
        localStorage.setItem(KEY_USER, JSON.stringify(currentUser));
        updateUIForLoginState();

        const remotePreferencesRaw = remoteUser && typeof remoteUser === "object"
          ? (remoteUser.Settings ?? remoteUser.settings ?? remoteUser.preferences)
          : null;
        const sanitizedRemotePreferences = remotePreferencesRaw && typeof remotePreferencesRaw === "object"
          ? sanitizePreferences(remotePreferencesRaw)
          : null;

        if (sanitizedRemotePreferences) {
          applyPreferencesToState(sanitizedRemotePreferences, { save: true });
          if (userCanAccessDefaultSettings()) {
            setPreferencesStatus("Defaults synced from cloud.", "success", { persist: true });
          } else {
            persistedPreferenceStatus = { message: "", tone: "neutral" };
            lastPreferenceStatus = { message: "", tone: "neutral" };
            renderPreferencesStatus();
          }
        } else {
          applyPreferencesToState(localStoredPreferences, { save: true });
          shouldRestorePreferences = true;
          if (userCanAccessDefaultSettings()) {
            setPreferencesStatus("Cloud defaults missing — using local backup.", "warning", { persist: true });
          }
        }

        const remoteTimestamp = parseTimestamp(remoteUser.last_modified);
        let localTimestamp = parseTimestamp(localStorage.getItem(KEY_LAST_MODIFIED));

        const localTimersExist = timers.length > 0;
        const remoteTimersExist = remoteTimers.length > 0;
        const remoteTimestampMissing = remoteTimestamp === 0;
        let localTimestampMissing = localTimestamp === 0;

        const canonicalLocal = canonicalizeTimersForComparison(timers);
        const canonicalRemote = canonicalizeTimersForComparison(remoteTimers);
        const timersDiffer = JSON.stringify(canonicalLocal) !== JSON.stringify(canonicalRemote);

        let shouldPushLocal = false;
        let shouldPullRemote = false;
        let pushTimestamp = null;
        let pullTimestamp = null;

        if (localTimersExist && !remoteTimersExist) {
            console.log("Sync: Local timers exist and remote is empty. Pushing local state.");
            shouldPushLocal = true;
            if (!localTimestamp) {
              localTimestamp = Date.now();
              localTimestampMissing = false;
              localStorage.setItem(KEY_LAST_MODIFIED, String(localTimestamp));
            }
            pushTimestamp = localTimestamp;
        } else if (!localTimersExist && remoteTimersExist) {
            console.log("Sync: Local is empty and remote has timers. Pulling remote state.");
            shouldPullRemote = true;
            pullTimestamp = remoteTimestamp || Date.now();
            if (remoteTimestampMissing) {
              shouldPushLocal = true;
              pushTimestamp = pullTimestamp;
            }
        } else if (remoteTimestamp > localTimestamp) {
            console.log("Sync: Remote is newer. Pulling remote state.");
            shouldPullRemote = true;
            pullTimestamp = remoteTimestamp;
        } else if (localTimestamp > remoteTimestamp) {
            console.log("Sync: Local is newer. Pushing local state.");
            shouldPushLocal = true;
            pushTimestamp = localTimestamp;
        } else if (remoteTimestampMissing || localTimestampMissing) {
            if (!timersDiffer) {
              console.log("Sync: Timers match but timestamps are missing. Refreshing timestamp.");
              shouldPushLocal = true;
              pushTimestamp = Date.now();
              localTimestamp = pushTimestamp;
              localTimestampMissing = false;
              localStorage.setItem(KEY_LAST_MODIFIED, String(localTimestamp));
            } else if (!remoteTimersExist) {
              console.log("Sync: Remote appears empty after comparison. Pushing local state.");
              shouldPushLocal = true;
              pushTimestamp = Date.now();
              localTimestamp = pushTimestamp;
              localTimestampMissing = false;
              localStorage.setItem(KEY_LAST_MODIFIED, String(localTimestamp));
            } else if (!localTimersExist) {
              console.log("Sync: Local appears empty after comparison. Pulling remote state.");
              shouldPullRemote = true;
              pullTimestamp = Date.now();
              shouldPushLocal = true;
              pushTimestamp = pullTimestamp;
            } else if (canonicalLocal.length >= canonicalRemote.length) {
              console.log("Sync: Missing timestamps; preferring local timers.");
              shouldPushLocal = true;
              pushTimestamp = Date.now();
              localTimestamp = pushTimestamp;
              localTimestampMissing = false;
              localStorage.setItem(KEY_LAST_MODIFIED, String(localTimestamp));
            } else {
              console.log("Sync: Missing timestamps; preferring remote timers.");
              shouldPullRemote = true;
              pullTimestamp = Date.now();
              shouldPushLocal = true;
              pushTimestamp = pullTimestamp;
            }
        } else {
            console.log("Sync: Local and remote are up to date.");
        }

        if (shouldPullRemote) {
            timers = remoteTimers;
            const timestampToStore = pullTimestamp || remoteTimestamp || Date.now();
            localStorage.setItem(KEY_TIMERS, JSON.stringify(timers));
            localStorage.setItem(KEY_LAST_MODIFIED, String(timestampToStore));
            localTimestamp = timestampToStore;
            localTimestampMissing = false;
            render();
        }

        if (shouldPushLocal) {
            const timestampToPush = pushTimestamp || localTimestamp || Date.now();
            localStorage.setItem(KEY_LAST_MODIFIED, String(timestampToPush));
            localTimestamp = timestampToPush;
            localTimestampMissing = false;
            const pushSucceeded = await pushTimersToCloud(timers, timestampToPush);
            if (pushSucceeded) {
              preferencesPushedViaTimers = true;
            }
        }
        await refreshSmartTimers();

        if (shouldRestorePreferences) {
          if (!preferencesPushedViaTimers) {
            try {
              const pushed = await pushPreferencesToCloud();
              if (pushed && userCanAccessDefaultSettings()) {
                setPreferencesStatus("Cloud defaults restored from local backup.", "success", { persist: true });
              }
            } catch (prefError) {
              if (prefError.message === "account-not-found") {
                if (userCanAccessDefaultSettings()) {
                  setPreferencesStatus("Cloud account missing. Defaults saved locally only.", "error", { persist: true });
                }
              } else {
                console.error("Failed to sync preferences to the cloud:", prefError);
                if (userCanAccessDefaultSettings()) {
                  setPreferencesStatus("Defaults saved locally. Cloud sync failed.", "error");
                }
              }
            }
          } else if (userCanAccessDefaultSettings()) {
            setPreferencesStatus("Cloud defaults restored from local backup.", "success", { persist: true });
          }
        }

        alert('Sync complete!');
      } catch (error) {
          console.error("Sync failed:", error);
          alert("Sync failed. Please check your connection and try again.");
      } finally {
          isSyncing = false;
          if (settingsSyncBtn) {
            settingsSyncBtn.textContent = "Sync Now";
            settingsSyncBtn.disabled = false;
          }
      }
  }

  async function patchAccount(partialPayload) {
    if (!currentUser || !currentUser.id) {
      throw new Error("no-current-user");
    }
    if (cloudAccountMissing) {
      throw new Error("account-not-found");
    }
    const response = await fetch(`${RESTDB_URL}/${currentUser.id}`, {
      method: 'PATCH',
      headers: { 'x-apikey': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(partialPayload)
    });
    if (response.status === 404) {
      cloudAccountMissing = true;
      throw new Error("account-not-found");
    }
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    return response;
  }

  async function pushTimersToCloud(timersArray, timestampNumber) {
    if (!currentUser || !currentUser.id) {
      console.warn("Skipping cloud push because the current user record is missing an id.");
      return;
    }

    const timestampValue = Number(timestampNumber);
    let safeTimestamp = Number.isFinite(timestampValue) ? timestampValue : null;
    if (safeTimestamp === null && timestampNumber) {
      const parsedTimestamp = Date.parse(timestampNumber);
      if (Number.isFinite(parsedTimestamp)) {
        safeTimestamp = parsedTimestamp;
      }
    }
    if (safeTimestamp === null) {
      safeTimestamp = Date.now();
    }

    const sanitizedPrefs = sanitizePreferences(userPreferences);
    const payload = {
      timers: timersArray,
      last_modified: new Date(safeTimestamp).toISOString(),
      Settings: sanitizedPrefs,
      preferences: sanitizedPrefs
    };

    try {
      await patchAccount(payload);
      console.log("Successfully pushed changes to the cloud.");
      return true;
    } catch (error) {
      if (error.message === "no-current-user") {
        console.warn("Skipping cloud push because no authenticated user is available.");
        return false;
      }
      if (error.message === "account-not-found") {
        console.warn("Skipping cloud push because the remote account record is missing.");
        if (userCanAccessDefaultSettings()) {
          setPreferencesStatus("Cloud account missing. Defaults saved locally only.", "error", { persist: true });
        }
        return false;
      }
      console.error("Failed to push changes to the cloud:", error);
    }
    return false;
  }

  async function pushPreferencesToCloud() {
    if (!currentUser || !currentUser.id) {
      return false;
    }
    try {
      const sanitizedPrefs = sanitizePreferences(userPreferences);
      await patchAccount({ Settings: sanitizedPrefs, preferences: sanitizedPrefs });
      return true;
    } catch (error) {
      if (error.message === "no-current-user") {
        return false;
      }
      throw error;
    }
  }
  // --- END: Authentication and Sync Functions ---

  $("#saveTplBtn").addEventListener("click", async ()=>{
    const triggers = await collectTrEntries(new Map());
    const tpl = {
      id: uid("tpl_"), name: f.name.value.trim() || "Template", style: f.style.value, color: f.color.value,
      color2: f.color2.value || f.color.value,
      units: f.units.value,
      format: resolveFormatForUnits(f.units.value, f.format.value),
      ring_thickness: +f.ring_thickness.value || 10,
      ease: f.ease.value, tick: +f.tick.value || 100, ms: f.ms.value,
      mb_bars: f.mb_bars.value? Math.max(2, Math.min(5, +f.mb_bars.value)) : null,
      letters_n: (f.letters_n && f.letters_n.value) ? Math.max(1, Math.min(7, +f.letters_n.value)) : null,
      mb_ticks: f.mb_ticks.value? Math.max(8, Math.min(40, +f.mb_ticks.value)) : null,
      triggers, doneSoundDataUrl:null, doneTts: f.doneTts.value||""
    };
    if (tpl.style === "pro" && !userCanUseProMode()) {
      toggleProAccessNotice(true);
      alert("Pro Mode is limited to Beta Tester or higher accounts.");
      return;
    }
    if (tpl.style === "pro"){
      tpl.splitStyles = [...PRO_SPLIT_STYLES];
      tpl.splitSettings = null;
    }
    tpl.name = pickTemplateName(tpl);
    templates.push(tpl); saveTemplates(); alert("Saved template: "+tpl.name);
  });

  $("#saveBtn").addEventListener("click", async (e)=>{
    e.preventDefault();
    const existing = editId ? timers.find(x=>x.id===editId) : null;
    const loopReferenceMs = f.mode.value === "datetime"
      ? (f.when && f.when.value ? parseLocalDateTime(f.when.value) : existing?.targetMs ?? null)
      : (existing?.mode === "datetime" ? existing.targetMs : null);
    const loopConfig = gatherLoopConfigFromForm(f.mode.value, existing?.loopConfig ?? null, loopReferenceMs);
    const base = {
      id: editId || uid("t_"), name: f.name.value.trim() || "Untitled", style: f.style.value, color: f.color.value,
      color2: f.color2.value || f.color.value,
      units: f.units.value,
      format: resolveFormatForUnits(f.units.value, f.format.value),
      ring_thickness: +f.ring_thickness.value || 10,
      ease: f.ease.value, tick: +f.tick.value || 100, ms: f.ms.value,
      mb_bars: f.mb_bars.value? Math.max(2, Math.min(5, +f.mb_bars.value)) : null,
      mb_ticks: f.mb_ticks.value? Math.max(8, Math.min(40, +f.mb_ticks.value)) : null,
      letters_n: f.letters_n.value? Math.max(1, Math.min(7, +f.letters_n.value)) : null,
      loopConfig,
      loopCount: existing?.loopCount ?? 0
    };
    if (base.style === "pro" && !userCanUseProMode()) {
      toggleProAccessNotice(true);
      alert("Pro Mode is limited to Beta Tester or higher accounts.");
      return;
    }
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
    const fullscreenBtn = `<button class="action-btn" data-act="fullscreen" title="Fullscreen">⛶</button>`;
    actions.innerHTML = `${pauseBtn}${fullscreenBtn}<button class="action-btn" data-act="prestige" title="Prestige">★</button><button class="action-btn" data-act="tplsave" title="Save template">⇪</button><button class="action-btn" data-act="edit" title="Edit">✎</button><button class="action-btn" data-act="delete" title="Delete">🗑</button>`;
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
    if (timerLoopsEnabled(t) && t.mode === "duration"){
      const badgeEl = document.createElement("span");
      badgeEl.className = "badge";
      const loops = Math.max(0, Math.floor(Number(t.loopCount) || 0));
      badgeEl.textContent = `Loops ×${loops}`;
      title.appendChild(badgeEl);
    } else if (t.prestigeLevel){
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
    pill.textContent="Copy remaining"; pill.addEventListener("click", ()=>{ const template = t.units==='custom'?resolveCustomFormatValue(t.format):null; navigator.clipboard?.writeText(fmt(remainingMs(t), t.units, t.ms==='on', template, t.name, t)); pill.textContent="Copied ✓"; setTimeout(()=>pill.textContent="Copy remaining", 900);});
    foot.appendChild(pill);

    const eta = document.createElement("span"); eta.className="note";
    if (t.mode==="datetime" || t.mode==="smart"){ const d=new Date(t.targetMs); eta.textContent="Ends "+d.toLocaleString(); }
    else { const d = new Date(t.start + (t.duration||0)); eta.textContent = "ETA " + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
    foot.appendChild(eta);
    if (timerLoopsEnabled(t) && t.mode === "datetime" && t.loopConfig && t.loopConfig.unit === "shortterm") {
      const nextShort = findNextShortTermOccurrence(t.loopConfig.events || [], now());
      const note = document.createElement("div");
      note.className = "loop-note";
      if (nextShort && Number.isFinite(nextShort.timestamp)) {
        note.innerHTML = `<strong>Next:</strong> ${escapeHtml(nextShort.event.label || "Event")} — ${escapeHtml(describeShortTermOccurrence(nextShort.event, nextShort.timestamp))}`;
      } else {
        note.textContent = "No upcoming short term events.";
      }
      foot.appendChild(note);
    }
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
      } else if (act==="fullscreen"){
        ev.preventDefault();
        const activeNative = activeNativeFullscreenElement();
        if (card.classList.contains("fullscreen-fallback")){
          deactivateFallbackFullscreen(card);
          return;
        }
        if (activeNative && activeNative !== card){
          await exitNativeFullscreenIfActive();
        } else if (activeNative === card){
          await exitNativeFullscreenIfActive();
          return;
        }
        const success = await tryEnterNativeFullscreen(card);
        if (!success){
          activateFallbackFullscreen(card);
        }
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
    if (fallbackFullscreenCard) deactivateFallbackFullscreen(fallbackFullscreenCard);
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
    const template = t.units==="custom" ? resolveCustomFormatValue(t.format) : null;
    span.textContent = fmt(remainingForDisplay(t), t.units, t.ms==="on", template, t.name, t);
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
    t.loopCount = 0;
  }

  function escapeHtml(str){ return String(str).replace(/[&<>"']/g, s=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;"}[s])); }

  function tick(){
    timers.forEach(t=>{
      if (t.style === "pro") ensureProSplitState(t);
      const cards = grid.querySelectorAll('.card[data-id="'+t.id+'"]');
      if (!cards.length) return;
      const template = t.units==="custom" ? resolveCustomFormatValue(t.format) : null;
      const newTxt = fmt(remainingForDisplay(t), t.units, t.ms==="on", template, t.name, t);
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

      if (rem <= 0 && !t.completed){
        t.completed = true;
        if (t.doneSoundDataUrl) playDataUrl(t.doneSoundDataUrl); else tone(990,.25);
        if (t.doneTts) speak(fillTokens(t.doneTts, 0, total, t));
        if (timerLoopsEnabled(t)) {
          handleLoopRestart(t, total);
        }
        updateAndSaveTimers();
      }
      t._prevRem = timerLoopsEnabled(t) ? remainingMs(t) : rem;
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

  if (settingsBtn) settingsBtn.addEventListener('click', () => openSettingsDialog());
  if (settingsDefaultStyle) settingsDefaultStyle.addEventListener('change', handlePreferenceFieldChange);
  if (settingsDefaultUnits) settingsDefaultUnits.addEventListener('change', handlePreferenceFieldChange);
  if (settingsAutoUnitsMode) settingsAutoUnitsMode.addEventListener('change', handlePreferenceFieldChange);
  if (settingsCustomFormat) settingsCustomFormat.addEventListener('input', handlePreferenceFieldChange);
  if (settingsLoopsToggle) settingsLoopsToggle.addEventListener('change', () => {
    if (!userCanAccessLoopsFeature()) {
      settingsLoopsToggle.checked = false;
      return;
    }
    const pending = sanitizePreferences({ ...userPreferences, loopsEnabled: settingsLoopsToggle.checked });
    applyPreferencesToState(pending);
  });
  if (f.loopEnabled) f.loopEnabled.addEventListener('change', () => {
    updateLoopingFieldsForMode();
    updateShortTermSummary();
  });
  if (f.loopUnit) f.loopUnit.addEventListener('change', () => {
    if (f.loopUnit.value === "shortterm" && !userCanAccessShortTermSchedule()) {
      enforceShortTermScheduleAvailability();
      return;
    }
    updateLoopingFieldsForMode();
    if (!suppressLoopUnitChange && f.loopUnit.value === "shortterm") {
      openShortTermDialog({ autoCreate: shortTermEventsDraft.length === 0 });
    }
  });
  if (f.loopInterval) {
    ["input", "change"].forEach(eventName => {
      f.loopInterval.addEventListener(eventName, () => updateWeeklyStartControls());
    });
  }
  if (f.loopMonthlyMode) f.loopMonthlyMode.addEventListener('change', updateLoopingMonthlyModeFields);
  if (f.loopShortTermEditBtn) f.loopShortTermEditBtn.addEventListener('click', () => {
    if (!userCanAccessShortTermSchedule()) return;
    openShortTermDialog({ autoCreate: shortTermEventsDraft.length === 0 });
  });
  if (addShortTermWeeklyBtn) addShortTermWeeklyBtn.addEventListener('click', () => {
    if (!userCanAccessShortTermSchedule()) return;
    shortTermDialogEvents.push(createDefaultShortTermEvent("weekly"));
    renderShortTermEventList();
  });
  if (addShortTermSingleBtn) addShortTermSingleBtn.addEventListener('click', () => {
    if (!userCanAccessShortTermSchedule()) return;
    shortTermDialogEvents.push(createDefaultShortTermEvent("single"));
    renderShortTermEventList();
  });
  if (saveShortTermEventsBtn) saveShortTermEventsBtn.addEventListener('click', handleShortTermSave);
  if (shortTermDialog) {
    shortTermDialog.addEventListener('close', () => {
      shortTermDialogEvents = [];
      if (shortTermEventsList) shortTermEventsList.innerHTML = "";
      if (shortTermEventsEmpty) shortTermEventsEmpty.classList.remove("invisible");
    });
  }
  if (settingsDefaultsSaveBtn) settingsDefaultsSaveBtn.addEventListener('click', async () => {
    await handlePreferencesSave();
  });
  if (settingsLoginBtn) settingsLoginBtn.addEventListener('click', () => {
    closeSettingsDialog();
    openAuthDialog(false);
  });
  if (settingsSignupBtn) settingsSignupBtn.addEventListener('click', () => {
    closeSettingsDialog();
    openAuthDialog(true);
  });
  if (settingsLogoutBtn) settingsLogoutBtn.addEventListener('click', handleLogout);
  if (settingsSyncBtn) settingsSyncBtn.addEventListener('click', syncTimers);
  if (settingsDialog) settingsDialog.addEventListener('close', () => {
    if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
  });
  tplBtn.addEventListener("click", ()=> openTemplateMenu());
  document.addEventListener("click", (e)=>{ if(!templateMenu.contains(e.target) && e.target!==tplBtn){ templateMenu.classList.remove("open"); } });
  $("#authModeSwitch").addEventListener('click', (e) => {
    e.preventDefault();
    const isSignUp = $("#authTitle").textContent === "Log In";
    openAuthDialog(isSignUp);
  });
  $("#authSubmitBtn").addEventListener('click', handleAuthSubmit);
  if (authDialog) authDialog.addEventListener('close', resetAuthDialogState);

  updateUIForLoginState();
  load();
  render(); 
  requestAnimationFrame(tick);
})();
