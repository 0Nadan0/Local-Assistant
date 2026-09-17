/* 우리동네 생활비서 — Gate 1 컨시어지 프로토타입
 *
 * 목적은 "제품"이 아니라 측정이다: 맞춤으로 골라 보여준 정보를 사람들이 실제로 누르고, 신청하러 가는가.
 * 그래서 화면은 최소로, 기록은 빠짐없이 남긴다. (CLAUDE.md "Gate 1 프로토타입 예외" 참고)
 *
 * 구조
 *   1. 저장소(store)   — 이 폰에만 남는 설정·저장·피드백
 *   2. 기록(track)     — 이용 기록을 모아 구글 시트로 보낸다
 *   3. 맞춤(match)     — 누구에게 보여줄지(자격·거리·시간) + 순서 점수(Spec 18.1)
 *   4. 화면(render)    — 소개 → 설정 6단계 → 홈 / 둘러보기 / 저장 / 내 정보 / 상세
 */
(function () {
  "use strict";

  const CFG = Object.assign({ ENDPOINT: "", STUDY_KEY: "", APP_VERSION: "0", TODAY_OVERRIDE: "" }, window.GATE1_CONFIG || {});
  const $app = document.getElementById("app");
  const $tabbar = document.getElementById("tabbar");
  const $sheet = document.getElementById("sheet");
  const $toast = document.getElementById("toast");

  let DATA = null; // data/items.json
  let ITEMS = new Map();

  // ------------------------------------------------------------------ 1. 저장소
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("g1." + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("g1." + key, JSON.stringify(value)); } catch (e) { /* 저장 불가 브라우저 — 이번 방문만 유지 */ }
    },
  };
  const mem = {}; // localStorage가 막힌 경우를 위한 이번 방문용 사본

  // 참여자별로 나눠 저장하는 것들 — 한 기기를 두 사람이 써도(부부, 검토용 A01~A05) 서로 섞이지 않는다.
  // 나머지(보낼 기록 대기열·마지막 코드·글자 크기)는 기기 하나에 하나만 둔다.
  const PER_PERSON = new Set(["consent", "profile", "draft", "saved", "feedback", "opened", "session"]);
  function storeKey(key) { return PER_PERSON.has(key) && PID ? PID + "." + key : key; }
  function getS(key, fallback) {
    const k = storeKey(key);
    return k in mem ? mem[k] : (mem[k] = store.get(k, fallback));
  }
  function setS(key, value) {
    const k = storeKey(key);
    mem[k] = value;
    store.set(k, value);
  }

  // 참여자 코드 — 링크의 ?p=A01. 이름·전화번호는 받지 않는다.
  // 대소문자는 구분하지 않는다 (a01로 보내도 A01로 기록).
  // PID가 정해지기 전에는 storeKey가 참여자별 구분을 하지 않는다 — 여기서 쓰는 "pid"는 공용 칸이라 문제없다.
  let PID = null;
  function participantId() {
    const raw = new URLSearchParams(location.search).get("p");
    let pid = null;
    if (raw && /^[A-Za-z0-9_-]{1,20}$/.test(raw.trim())) {
      pid = raw.trim().toUpperCase();
      setS("pid", pid);
    } else {
      pid = getS("pid", null);
    }
    if (!pid) {
      pid = "anon-" + Math.random().toString(36).slice(2, 8);
      setS("pid", pid);
    }
    // 주소창에 코드를 남겨 둔다 — "홈 화면에 추가"는 지금 주소로 아이콘을 만들고,
    // 아이폰 홈 화면 앱은 사파리와 저장소가 따로라 주소에 코드가 없으면 익명(anon)이 된다.
    if (!pid.startsWith("anon-")) {
      try {
        const url = new URL(location.href);
        if (url.searchParams.get("p") !== pid) {
          url.searchParams.set("p", pid);
          history.replaceState(null, "", url.pathname + url.search + url.hash);
        }
      } catch (e) { /* 주소를 못 바꾸는 환경 — 저장된 코드로 계속 기록한다 */ }
    }
    return pid;
  }
  PID = participantId();

  function sessionId() {
    const now = Date.now();
    let s = getS("session", null);
    if (!s || now - s.last > 30 * 60 * 1000) s = { id: now.toString(36), last: now, fresh: true };
    else s = { id: s.id, last: now, fresh: false };
    setS("session", { id: s.id, last: now });
    return s;
  }
  const SESSION = sessionId();

  // ------------------------------------------------------------------ 2. 기록
  const track = (function () {
    let timer = null;
    let sending = false;

    function queue() { return getS("queue", []); }

    function log(event, fields) {
      const q = queue();
      q.push(Object.assign({
        ts: new Date().toISOString(),
        pid: PID,
        session: SESSION.id,
        event: event,
        app_version: CFG.APP_VERSION,
        data_version: DATA ? DATA.data_version : "",
      }, fields || {}));
      setS("queue", q.slice(-3000));
      const s = getS("session", {}); s.last = Date.now(); setS("session", s);
      clearTimeout(timer);
      timer = setTimeout(flush, 4000);
    }

    async function flush() {
      if (!CFG.ENDPOINT || sending) return;
      const q = queue();
      if (!q.length) return;
      const batch = q.slice(0, 100);
      sending = true;
      try {
        // text/plain + no-cors: 구글 Apps Script가 사전요청(preflight) 없이 받는 방식
        await fetch(CFG.ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ key: CFG.STUDY_KEY, events: batch }),
          keepalive: true,
        });
        setS("queue", queue().slice(batch.length));
        setS("lastSent", new Date().toISOString());
        if (queue().length) setTimeout(flush, 500);
      } catch (e) {
        // 인터넷이 끊겼을 때 — 다음 기회에 다시 보낸다
      } finally {
        sending = false;
      }
    }

    function flushOnLeave() {
      if (!CFG.ENDPOINT || !navigator.sendBeacon) return;
      const q = queue();
      if (!q.length) return;
      const batch = q.slice(0, 100);
      const ok = navigator.sendBeacon(CFG.ENDPOINT, new Blob([JSON.stringify({ key: CFG.STUDY_KEY, events: batch })], { type: "text/plain;charset=utf-8" }));
      if (ok) setS("queue", q.slice(batch.length));
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { detailLeave(); flushOnLeave(); }
      else flush();
    });
    window.addEventListener("online", flush);

    return { log: log, flush: flush, pending: function () { return queue().length; } };
  })();

  // ------------------------------------------------------------------ 날짜
  function todayStr() {
    if (CFG.TODAY_OVERRIDE) return CFG.TODAY_OVERRIDE;
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  const TODAY = todayStr();
  function toDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function daysFrom(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); } // b - a
  function dday(s) { return daysFrom(TODAY, s); }
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  function fmtDate(s, withWeekday) {
    if (!s) return "";
    const d = toDate(s);
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일" + (withWeekday === false ? "" : "(" + WD[d.getDay()] + ")");
  }
  function fmtRange(a, b) {
    if (a && b && a !== b) return fmtDate(a) + " ~ " + fmtDate(b);
    return fmtDate(a || b);
  }
  function ddayLabel(n) { return n === 0 ? "오늘 마감" : n > 0 ? "D-" + n : "마감"; }

  // ------------------------------------------------------------------ 3. 맞춤
  const AGE_OPTIONS = [
    { v: "50-59", label: "50~59세" }, { v: "60-64", label: "60~64세" }, { v: "65-69", label: "65~69세" },
    { v: "70-74", label: "70~74세" }, { v: "75+", label: "75세 이상" },
  ];
  const INTERESTS = [
    { v: "행사·문화", emo: "🎭", sub: "공연·축제·전시" },
    { v: "배움·강좌", emo: "📚", sub: "도서관·문화센터 강좌" },
    { v: "혜택", emo: "💰", sub: "지원금·할인·바우처" },
    { v: "건강", emo: "🩺", sub: "검진·접종·건강교실" },
    { v: "생활·안전", emo: "🧭", sub: "안전·생활 공지" },
  ];
  const CAT_GROUP = { "안전": "생활·안전", "생활민원": "생활·안전", "시설·공지": "생활·안전", "폐기물": "생활·안전" };
  function catGroup(cat) { return CAT_GROUP[cat] || cat; }
  const CAT_EMO = { "행사·문화": "🎭", "배움·강좌": "📚", "혜택": "💰", "건강": "🩺", "생활·안전": "🧭" };

  const KIDS = [
    { v: "영유아", label: "미취학 아이" }, { v: "초등", label: "초등학생" }, { v: "청소년", label: "중·고등학생" },
  ];
  const BAND_LABEL = { "영유아": "영유아", "초등": "초등학생", "청소년": "청소년", "성인": "성인", "50+": "50세 이상", "65+": "65세 이상", "전연령": "누구나" };

  const KID_WITH = { "영유아": "어린 자녀·손주와 함께", "초등": "초등 자녀·손주와 함께", "청소년": "중고생 자녀·손주와 함께" };
  function userBand(age) { return age === "50-59" || age === "60-64" ? "50+" : "65+"; }
  const AGE_RANGE = { "50-59": [50, 59], "60-64": [60, 64], "65-69": [65, 69], "70-74": [70, 74], "75+": [75, 120] };

  // 누구에게 보여줄지. 이유를 같이 돌려준다 (화면의 "왜 보여드렸나요"와 기록에 쓴다)
  function eligibility(item, p) {
    const bands = (item.bands || []).filter(function (b) { return b !== "불명"; });
    const reasons = [];
    let ageMatch = false;

    // 특수 자격 — 사업자·임신부·청년 대상은 이 시범의 참여자(50세 이상)에게 해당하지 않는다
    if (item.special === "exclude") return { ok: false, why: "special" };
    if (item.special === "check") reasons.push({ code: "check", label: "확인: " + item.special_label, warn: true });

    // 자격(연령)
    let selfOk, kidOk = false;
    if (item.age_min != null || item.age_max != null) {
      const r = AGE_RANGE[p.age];
      const lo = item.age_min != null ? item.age_min : 0, hi = item.age_max != null ? item.age_max : 200;
      selfOk = r[0] <= hi && r[1] >= lo;
      if (selfOk && lo >= 40) {
        ageMatch = true;
        reasons.push({ code: "age", label: item.age_max != null ? lo + "~" + hi + "세 대상" : lo + "세 이상 대상" });
      }
    } else if (!bands.length || bands.includes("전연령")) {
      selfOk = true;
    } else {
      const mine = userBand(p.age);
      const explicit = mine === "65+" ? (bands.includes("65+") || bands.includes("50+")) : bands.includes("50+");
      const onlyOlder = explicit && !bands.includes("성인") && !bands.includes("청소년");
      selfOk = explicit || bands.includes("성인");
      if (onlyOlder) {
        ageMatch = true;
        reasons.push({ code: "age", label: bands.includes("65+") && !bands.includes("50+") ? "65세 이상 대상" : (mine === "65+" && bands.includes("65+") ? "어르신 대상" : "50세 이상 대상") });
      }
      const kids = p.kids || [];
      kidOk = kids.some(function (k) { return bands.includes(k); });
      if (!selfOk && kidOk) {
        ageMatch = true;
        const k = kids.find(function (k) { return bands.includes(k); });
        reasons.push({ code: "kid", label: KID_WITH[k] });
      }
    }
    if (!selfOk && !kidOk) return { ok: false, why: "age" };

    // 거리 — Gate 0에서 고정한 B안(거주 동 + 이웃 동). 사용자가 "강동구 전체"를 고르면 A안
    const wide = DATA.district_wide_scopes.includes(item.scope);
    if (!wide && item.dong && p.scope !== "district") {
      const near = (DATA.adjacency[p.dong] || []).includes(item.dong);
      if (item.dong !== p.dong && !near) return { ok: false, why: "distance" };
      reasons.push({ code: item.dong === p.dong ? "dong" : "near", label: item.dong === p.dong ? "우리 동네 (" + item.dong + ")" : "이웃 동네 (" + item.dong + ")" });
    } else if (!wide && item.dong) {
      reasons.push({ code: "district", label: "강동구 " + item.dong });
    }

    // 시간 — 평일 낮이 어렵다고 하신 분께는 평일 낮 일정을 뺀다 (요일·시간을 알 때만)
    if (p.weekday === "hard" && weekdayDaytime(item)) return { ok: false, why: "time" };

    return { ok: true, ageMatch: ageMatch, reasons: reasons };
  }

  function weekdayDaytime(item) {
    if (item.weekday_daytime) return true;
    const days = (item.days || "").replace(/매주|매월|격주/g, "");
    const m = /^(\d{1,2}):/.exec(item.time || "");
    if (!days || !m) return false;
    if (/[토일]/.test(days)) return false;
    if (!/[월화수목금]/.test(days)) return false;
    return Number(m[1]) < 17;
  }

  // 지금 볼 수 있는 정보인가 (STATE-02 마감된 정보)
  function status(item) {
    if (item.full) return "closed";
    if (item.until && item.until < TODAY) return "closed";
    if (item.apply_end) {
      if (item.apply_end < TODAY) return "closed";
    } else if (item.run_end) {
      if (item.run_end < TODAY) return "closed";
    } else if (item.run_start) {
      if (item.run_start < TODAY) return "closed";
    } else if (item.published && daysFrom(item.published, TODAY) > 60) {
      return "stale";
    }
    if (item.apply_start && item.apply_start > TODAY) return "upcoming";
    return "open";
  }

  // 나이에 따라 시작일이 다른 정보 (예: 독감 접종 75세 10/6, 70~74세 10/12, 65~69세 10/15)
  function myStart(item) {
    const p = profile();
    return item.age_start && p ? item.age_start[p.age] || null : null;
  }

  // Spec 18.1 점수: 지역 +40 · 연령 +20(명시된 조건만) · 관심사 +15 · 마감 임박 +0~25 · 신규 +10 · 반복 감쇠
  function score(item, p, elig) {
    const parts = [];
    let s = 40; // 지역 일치 — 모든 정보가 강동구이고, 거리 조건은 위에서 걸렀다
    if (elig.ageMatch) s += 20;
    if ((p.interests || []).includes(catGroup(item.cat))) {
      s += 15;
      parts.push({ code: "interest", label: "관심: " + catGroup(item.cat) });
    }
    const st = status(item);
    if (st === "open" && item.apply_end) {
      const d = dday(item.apply_end);
      const add = d <= 3 ? 25 : d <= 7 ? 25 - (d - 3) * 4 : 0;
      if (add) { s += add; parts.unshift({ code: "deadline", label: d === 0 ? "오늘 마감" : "마감 " + ddayLabel(d), urgent: true }); }
    }
    const recent = (item.published && daysFrom(item.published, TODAY) <= 7) ||
      (item.apply_start && item.apply_start <= TODAY && daysFrom(item.apply_start, TODAY) <= 3);
    if (recent) { s += 10; parts.push({ code: "new", label: "새 소식" }); }
    if (st === "upcoming" && !item.no_apply) parts.push({ code: "upcoming", label: fmtDate(item.apply_start, false) + " 접수 시작" });
    const ms = myStart(item);
    if (ms) parts.unshift({ code: "my_start", label: ms > TODAY ? "내 차례: " + fmtDate(ms, false) + "부터" : "지금 가능" });
    if (item.seats && st === "open") {
      const left = item.seats.total - item.seats.taken;
      if (left > 0 && left <= 3) parts.push({ code: "seats", label: "남은 자리 " + left, urgent: true });
    }

    const opened = getS("opened", {});
    if (opened[item.id]) s -= Math.min(30, 10 * opened[item.id]);
    return { score: s, reasons: parts.concat(elig.reasons) };
  }

  function candidates(p) {
    const fb = getS("feedback", {});
    const out = [];
    DATA.items.forEach(function (item) {
      if (item.grade === "C") return;
      const st = status(item);
      if (st === "closed" || st === "stale") return;
      if (fb[item.id] && fb[item.id].helpful === "no") return;
      const elig = eligibility(item, p);
      if (!elig.ok) return;
      const sc = score(item, p, elig);
      out.push({ item: item, score: sc.score, reasons: sc.reasons, status: st });
    });
    out.sort(function (a, b) {
      return b.score - a.score || (a.item.apply_end || "9999").localeCompare(b.item.apply_end || "9999") || a.item.id.localeCompare(b.item.id);
    });
    return out;
  }

  // 오늘의 3가지 — 같은 분야가 셋 다 차지하지 않게 (Spec 18.2)
  function todayTop(list) {
    const fb = getS("feedback", {});
    // 신청했다고 답한 것, 특정 자격(장애인 등)이 필요한 것은 "오늘의 3가지"에 올리지 않는다 — 목록에는 남긴다
    const pool = list.filter(function (c) {
      return !(fb[c.item.id] && fb[c.item.id].applied === "yes") && c.item.special !== "check";
    });
    const picked = [], perCat = {};
    for (const c of pool) {
      const g = catGroup(c.item.cat);
      if ((perCat[g] || 0) >= 2) continue;
      picked.push(c);
      perCat[g] = (perCat[g] || 0) + 1;
      if (picked.length === 3) break;
    }
    return picked;
  }

  // ------------------------------------------------------------------ 4. 화면 도우미
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function profile() { return getS("profile", null); }

  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { $toast.hidden = true; }, 2200);
  }

  function setChrome(tab) {
    $tabbar.hidden = !tab;
    $app.classList.toggle("no-tabbar", !tab);
    $tabbar.querySelectorAll("a").forEach(function (a) {
      a.classList.toggle("on", a.dataset.tab === tab);
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }

  function chipsHtml(reasons, max) {
    return '<div class="chips">' + reasons.slice(0, max || 3).map(function (r) {
      const cls = r.urgent ? "chip urgent" : (r.code === "upcoming" || r.warn) ? "chip warn" : "chip";
      return '<span class="' + cls + '">' + esc(r.label) + "</span>";
    }).join("") + "</div>";
  }

  function whenLine(item, st) {
    if (st === "closed") return "📅 신청 마감";
    const ms = myStart(item);
    if (ms) return "📅 " + fmtDate(ms) + "부터 " + (item.run_end ? fmtDate(item.run_end) + "까지" : "");
    if (item.no_apply && item.run_start) return "📅 " + fmtRange(item.run_start, item.run_end) + " · 신청 없이 참여";
    if (st === "upcoming") return "📅 " + fmtDate(item.apply_start) + "부터 신청" + (item.apply_end ? " (" + fmtDate(item.apply_end, false) + "까지)" : "");
    if (item.apply_end) {
      const d = dday(item.apply_end);
      return "📅 신청 " + fmtDate(item.apply_end) + "까지 · " + ddayLabel(d);
    }
    if (item.standing) return item.no_apply ? "📅 언제든 볼 수 있어요" : "📅 언제든 신청";
    if (item.run_start) return "📅 " + fmtRange(item.run_start, item.run_end);
    return "📅 기간은 안내문에서 확인";
  }

  function cardHtml(c, surface, rank) {
    const it = c.item;
    const where = it.place || it.org;
    return '<button class="card' + (surface === "today" ? " top" : "") + '" data-open="' + esc(it.id) + '" data-surface="' + surface + '" data-rank="' + rank + '">' +
      '<div class="cat">' + (surface === "today" ? '<span class="rank">' + rank + "</span>" : "") + (CAT_EMO[catGroup(it.cat)] || "📌") + " " + esc(catGroup(it.cat)) + "</div>" +
      '<div class="ttl">' + esc(it.title) + "</div>" +
      '<div class="meta"><div>' + esc(whenLine(it, c.status)) + "</div>" + (where ? "<div>📍 " + esc(where) + "</div>" : "") + "</div>" +
      (c.reasons.length ? chipsHtml(c.reasons, 3) : "") +
      "</button>";
  }

  // 화면에 실제로 보인 카드만 "노출"로 센다
  let observer = null;
  function observeImpressions(list) {
    if (observer) observer.disconnect();
    const seen = new Set();
    const byId = new Map(list.map(function (c) { return [c.item.id, c]; }));
    if (!("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        const el = e.target;
        const key = el.dataset.surface + ":" + el.dataset.open;
        if (seen.has(key)) return;
        seen.add(key);
        const c = byId.get(el.dataset.open);
        if (!c) return;
        track.log("impression", logFields(c, el.dataset.surface, Number(el.dataset.rank)));
        observer.unobserve(el);
      });
    }, { threshold: 0.6 });
    $app.querySelectorAll("[data-open]").forEach(function (el) { observer.observe(el); });
  }

  function logFields(c, surface, rank) {
    return {
      item_id: c.item.id, surface: surface, rank: rank, score: c.score,
      reasons: c.reasons.map(function (r) { return r.code; }).join(";"),
      grade: c.item.grade, category: c.item.cat,
    };
  }

  // 카드 누름 → 상세
  let lastList = new Map();
  $app.addEventListener("click", function (e) {
    const el = e.target.closest("[data-open]");
    if (!el) return;
    const c = lastList.get(el.dataset.open);
    if (c) track.log("tap", logFields(c, el.dataset.surface, Number(el.dataset.rank)));
    sessionStorageSet("from", { surface: el.dataset.surface, rank: Number(el.dataset.rank) });
    location.hash = "#/item/" + encodeURIComponent(el.dataset.open);
  });
  function sessionStorageSet(k, v) { mem["ss." + k] = v; }
  function sessionStorageGet(k) { return mem["ss." + k]; }

  // ------------------------------------------------------------------ 화면: 소개·설정
  function renderIntro() {
    setChrome(null);
    const agreed = getS("consent", false);
    $app.innerHTML =
      '<section class="intro-hero">' +
      '<img class="logo" src="icon.svg" alt="">' +
      "<h1>강동구 소식,<br>나한테 맞는 것만 골라 드려요</h1>" +
      '<p class="muted">도서관 강좌, 구청 혜택, 보건소 소식까지 흩어진 정보를 모아 매일 3가지로 정리해 드립니다.</p>' +
      "</section>" +
      '<ul class="intro-points">' +
      '<li><span class="emo">📍</span><span>사는 동네와 나이에 맞는 정보만</span></li>' +
      '<li><span class="emo">⏰</span><span>마감이 가까운 것부터 먼저</span></li>' +
      '<li><span class="emo">👆</span><span>신청하는 곳까지 한 번에</span></li>' +
      "</ul>" +
      '<div class="notice"><b>시범 서비스 안내</b><br>' +
      "더 나은 서비스를 만들기 위한 2주 시범 운영이에요. 어떤 정보를 보고 눌렀는지 <b>이용 기록만</b> 익명으로 모아요. " +
      "이름·전화번호·위치는 모으지 않고, 설정한 동네·연령대는 이 휴대폰에만 저장돼요.</div>" +
      '<label class="check"><input type="checkbox" id="consent"' + (agreed ? " checked" : "") + "><span>안내를 읽었고, 이용 기록을 익명으로 보내는 데 동의해요</span></label>" +
      '<div class="onb-footer"><button class="btn" id="start"' + (agreed ? "" : " disabled") + ">시작하기</button></div>";

    const $c = document.getElementById("consent");
    const $s = document.getElementById("start");
    $c.addEventListener("change", function () { $s.disabled = !$c.checked; });
    $s.addEventListener("click", function () {
      if (!getS("consent", false)) track.log("consent", { value: "yes" });
      setS("consent", true);
      location.hash = "#/onb/1";
    });
  }

  const ONB_STEPS = 6;
  function draft() { return getS("draft", null) || Object.assign({ interests: [], kids: [] }, profile() || {}); }

  function onbShell(step, q, help, body, canNext, nextLabel) {
    let bar = "";
    for (let i = 1; i <= ONB_STEPS; i++) bar += '<i class="' + (i <= step ? "on" : "") + '"></i>';
    return '<div class="topbar"><button class="back" data-back aria-label="이전">←</button><span class="title small muted">' + step + " / " + ONB_STEPS + "</span></div>" +
      '<div class="progress" aria-hidden="true">' + bar + "</div>" +
      '<div class="onb-q">' + q + "</div>" + (help ? '<p class="onb-help">' + help + "</p>" : "") +
      body +
      '<div class="onb-footer"><button class="btn" data-next' + (canNext ? "" : " disabled") + ">" + (nextLabel || "다음") + "</button></div>";
  }

  function renderOnb(step) {
    if (!getS("consent", false)) { location.hash = "#/intro"; return; }
    setChrome(null);
    const d = draft();
    let html = "";
    let valid = false;

    if (step === 1) {
      html = onbShell(1, "어느 동에 사세요?", "주민센터(행정복지센터) 이름으로 골라 주세요.",
        '<div class="choices three">' + DATA.dongs.map(function (x) {
          return '<button class="choice" data-pick="dongAdmin" data-v="' + esc(x.name) + '" aria-pressed="' + (d.dongAdmin === x.name) + '">' + esc(x.name) + "</button>";
        }).join("") + "</div>", !!d.dongAdmin);
    } else if (step === 2) {
      html = onbShell(2, "연령대를 알려 주세요", "나이에 맞는 강좌와 혜택을 고르는 데만 써요.",
        '<div class="choices">' + AGE_OPTIONS.map(function (x) {
          return '<button class="choice" data-pick="age" data-v="' + x.v + '" aria-pressed="' + (d.age === x.v) + '">' + x.label + "</button>";
        }).join("") + "</div>", !!d.age);
    } else if (step === 3) {
      html = onbShell(3, "어떤 소식을 받고 싶으세요?", "여러 개 고를 수 있어요. 나중에 바꿀 수 있어요.",
        '<div class="choices">' + INTERESTS.map(function (x) {
          return '<button class="choice" data-multi="interests" data-v="' + esc(x.v) + '" aria-pressed="' + d.interests.includes(x.v) + '"><span class="emo">' + x.emo + "</span><span>" + esc(x.v) + '<span class="sub">' + esc(x.sub) + "</span></span></button>";
        }).join("") + "</div>", d.interests.length > 0, d.interests.length ? "다음" : "하나 이상 골라 주세요");
    } else if (step === 4) {
      const opts = [
        { v: "ok", label: "네, 평일 낮에도 괜찮아요" },
        { v: "hard", label: "평일 낮은 어려워요", sub: "저녁·주말 일정 위주로 보여 드려요" },
        { v: "unknown", label: "그때그때 달라요" },
      ];
      html = onbShell(4, "평일 낮에 시간을 내실 수 있나요?", "강좌·행사가 평일 오전에 많아서 여쭤봐요.",
        '<div class="choices">' + opts.map(function (x) {
          return '<button class="choice" data-pick="weekday" data-v="' + x.v + '" aria-pressed="' + (d.weekday === x.v) + '"><span>' + x.label + (x.sub ? '<span class="sub">' + x.sub + "</span>" : "") + "</span></button>";
        }).join("") + "</div>", !!d.weekday);
    } else if (step === 5) {
      const none = d.kidsAnswered && !d.kids.length;
      html = onbShell(5, "함께 챙기는 자녀나 손주가 있나요?", "아이와 함께 가는 프로그램도 같이 찾아 드려요. 여러 개 고를 수 있어요.",
        '<div class="choices">' +
        '<button class="choice" data-kids-none aria-pressed="' + none + '">없어요</button>' +
        KIDS.map(function (x) {
          return '<button class="choice" data-multi="kids" data-v="' + x.v + '" aria-pressed="' + d.kids.includes(x.v) + '">' + x.label + "</button>";
        }).join("") + "</div>", !!d.kidsAnswered);
    } else if (step === 6) {
      const legal = legalOf(d.dongAdmin);
      const near = (DATA.adjacency[legal] || []).join(", ");
      const opts = [
        { v: "adjacent", label: "우리 동네와 이웃 동네", sub: legal + (near ? " + " + near : "") },
        { v: "district", label: "강동구 전체", sub: "조금 멀어도 괜찮아요" },
      ];
      html = onbShell(6, "어디까지 알려 드릴까요?", "구청 혜택처럼 강동구 전체가 대상인 소식은 어느 쪽이든 보여 드려요.",
        '<div class="choices">' + opts.map(function (x) {
          return '<button class="choice" data-pick="scope" data-v="' + x.v + '" aria-pressed="' + (d.scope === x.v) + '"><span>' + esc(x.label) + '<span class="sub">' + esc(x.sub) + "</span></span></button>";
        }).join("") + "</div>", !!d.scope, "내 생활 홈 만들기");
    }
    $app.innerHTML = html;

    $app.querySelector("[data-back]").addEventListener("click", function () {
      location.hash = step === 1 ? (profile() ? "#/me" : "#/intro") : "#/onb/" + (step - 1);
    });
    $app.querySelectorAll("[data-pick]").forEach(function (el) {
      el.addEventListener("click", function () {
        const dd = draft();
        dd[el.dataset.pick] = el.dataset.v;
        setS("draft", dd);
        renderOnb(step);
      });
    });
    $app.querySelectorAll("[data-multi]").forEach(function (el) {
      el.addEventListener("click", function () {
        const dd = draft();
        const key = el.dataset.multi;
        const set = new Set(dd[key] || []);
        set.has(el.dataset.v) ? set.delete(el.dataset.v) : set.add(el.dataset.v);
        dd[key] = Array.from(set);
        if (key === "kids") dd.kidsAnswered = dd.kids.length > 0 || dd.kidsAnswered;
        if (key === "kids" && !dd.kids.length) dd.kidsAnswered = false;
        setS("draft", dd);
        renderOnb(step);
      });
    });
    const none = $app.querySelector("[data-kids-none]");
    if (none) none.addEventListener("click", function () {
      const dd = draft(); dd.kids = []; dd.kidsAnswered = true; setS("draft", dd); renderOnb(step);
    });
    $app.querySelector("[data-next]").addEventListener("click", function () {
      const dd = draft();
      const value = { 1: dd.dongAdmin, 2: dd.age, 3: dd.interests.join(";"), 4: dd.weekday, 5: dd.kids.join(";") || "없음", 6: dd.scope }[step];
      track.log("onboarding_step", { value: String(step), detail: value });
      if (step < ONB_STEPS) { location.hash = "#/onb/" + (step + 1); return; }
      finishOnboarding(dd);
    });
  }

  function legalOf(admin) {
    const x = DATA.dongs.find(function (d) { return d.name === admin; });
    return x ? x.legal : "";
  }

  function finishOnboarding(dd) {
    const before = profile();
    const p = {
      dongAdmin: dd.dongAdmin, dong: legalOf(dd.dongAdmin), age: dd.age, interests: dd.interests,
      weekday: dd.weekday, kids: dd.kids, kidsAnswered: true, scope: dd.scope,
    };
    setS("profile", p);
    setS("draft", null);
    const n = candidates(p).length;
    track.log(before ? "profile_change" : "onboarding_complete", { value: String(n), detail: p });
    setChrome(null);
    $app.innerHTML =
      '<section class="intro-hero center">' +
      '<div style="font-size:3em">🏡</div>' +
      "<h1>" + esc(p.dongAdmin) + " 생활 홈을<br>만들었어요</h1>" +
      '<p class="muted">지금 신청할 수 있는 맞춤 소식이 <b>' + n + "건</b> 있어요.</p>" +
      "</section>" +
      '<div class="onb-footer"><button class="btn" id="go">내 생활 홈 보기</button></div>';
    document.getElementById("go").addEventListener("click", function () { location.hash = "#/home"; });
  }

  // ------------------------------------------------------------------ 화면: 홈
  function renderHome() {
    const p = profile();
    setChrome("home");
    const list = candidates(p);
    const top = todayTop(list);
    const topIds = new Set(top.map(function (c) { return c.item.id; }));
    const rest = list.filter(function (c) { return !topIds.has(c.item.id); });
    lastList = new Map(list.map(function (c) { return [c.item.id, c]; }));

    const t = toDate(TODAY);
    let html =
      '<header class="home-head">' +
      '<div class="home-date">' + (t.getMonth() + 1) + "월 " + t.getDate() + "일 " + WD[t.getDay()] + "요일</div>" +
      '<p class="home-hello">' + esc(p.dongAdmin) + " 이웃님,<br>오늘 챙겨 볼 소식이에요</p>" +
      "</header>";

    html += '<div class="section-head"><h2>오늘의 3가지</h2></div>';
    if (!top.length) {
      html += '<div class="empty"><div class="emo">🌤️</div><p>지금 조건에 맞는 새 소식이 없어요.</p>' +
        (p.scope !== "district" ? '<button class="btn secondary" id="widen" style="margin-top:12px">강동구 전체로 넓혀 보기</button>' : "") + "</div>";
    } else {
      html += top.map(function (c, i) { return cardHtml(c, "today", i + 1); }).join("");
    }

    if (rest.length) {
      html += '<div class="section-head"><h2>나를 위한 소식 ' + rest.length + '건</h2><a href="#/browse">모두 보기</a></div>';
      html += rest.slice(0, 5).map(function (c, i) { return cardHtml(c, "home_list", i + 1); }).join("");
      if (rest.length > 5) html += '<a class="btn secondary" href="#/browse" style="margin-top:12px">' + (rest.length - 5) + "건 더 보기</a>";
    }
    html += '<p class="small muted center" style="margin-top:24px">정보 기준일 ' + esc(fmtDate(DATA.data_version)) + " · 신청 전 공식 안내를 꼭 확인해 주세요</p>";
    $app.innerHTML = html;

    track.log("home_view", { value: String(list.length), detail: top.map(function (c) { return c.item.id; }).join(";") });
    if (!top.length) track.log("empty_state", { surface: "today" });
    const w = document.getElementById("widen");
    if (w) w.addEventListener("click", function () {
      const pp = profile(); pp.scope = "district"; setS("profile", pp);
      track.log("profile_change", { value: "widen_from_empty", detail: pp });
      renderHome();
    });
    observeImpressions(list);
  }

  // ------------------------------------------------------------------ 화면: 둘러보기
  function renderBrowse() {
    const p = profile();
    setChrome("browse");
    const filter = sessionStorageGet("filter") || "전체";
    const sort = sessionStorageGet("sort") || "추천순";
    let list = candidates(p);
    lastList = new Map(list.map(function (c) { return [c.item.id, c]; }));
    const groups = ["전체"].concat(INTERESTS.map(function (x) { return x.v; }).filter(function (g) {
      return list.some(function (c) { return catGroup(c.item.cat) === g; });
    }));
    if (filter !== "전체") list = list.filter(function (c) { return catGroup(c.item.cat) === filter; });
    if (sort === "마감순") list = list.slice().sort(function (a, b) {
      return (a.item.apply_end || "9999").localeCompare(b.item.apply_end || "9999") || b.score - a.score;
    });

    let html = '<header class="home-head"><h1>둘러보기</h1></header>' +
      '<div class="filters" role="group" aria-label="분야">' + groups.map(function (g) {
        return '<button class="filter" data-filter="' + esc(g) + '" aria-pressed="' + (g === filter) + '">' + (CAT_EMO[g] ? CAT_EMO[g] + " " : "") + esc(g) + "</button>";
      }).join("") + "</div>" +
      '<div class="filters" role="group" aria-label="정렬">' + ["추천순", "마감순"].map(function (s) {
        return '<button class="filter" data-sort="' + s + '" aria-pressed="' + (s === sort) + '">' + (s === "마감순" ? "마감 빠른 순" : "나에게 맞는 순") + "</button>";
      }).join("") + "</div>" +
      '<p class="small muted">' + list.length + "건</p>";
    html += list.length ? list.map(function (c, i) { return cardHtml(c, "browse", i + 1); }).join("")
      : '<div class="empty"><div class="emo">🔍</div><p>이 분야에는 지금 맞는 소식이 없어요.</p></div>';
    $app.innerHTML = html;

    $app.querySelectorAll("[data-filter]").forEach(function (el) {
      el.addEventListener("click", function () {
        sessionStorageSet("filter", el.dataset.filter);
        track.log("filter", { surface: "browse", value: el.dataset.filter });
        renderBrowse();
      });
    });
    $app.querySelectorAll("[data-sort]").forEach(function (el) {
      el.addEventListener("click", function () {
        sessionStorageSet("sort", el.dataset.sort);
        track.log("sort", { surface: "browse", value: el.dataset.sort });
        renderBrowse();
      });
    });
    track.log("browse_view", { value: filter + "/" + sort, detail: String(list.length) });
    observeImpressions(list);
  }

  // ------------------------------------------------------------------ 화면: 저장
  function renderSaved() {
    const p = profile();
    setChrome("saved");
    const saved = getS("saved", []);
    const all = new Map(candidates(p).map(function (c) { return [c.item.id, c]; }));
    const list = saved.map(function (id) {
      const item = ITEMS.get(id);
      if (!item) return null;
      return all.get(id) || { item: item, score: 0, reasons: [], status: status(item) };
    }).filter(Boolean);
    lastList = new Map(list.map(function (c) { return [c.item.id, c]; }));
    $app.innerHTML = '<header class="home-head"><h1>저장한 소식</h1></header>' +
      (list.length ? list.map(function (c, i) { return cardHtml(c, "saved", i + 1); }).join("")
        : '<div class="empty"><div class="emo">🔖</div><p>나중에 볼 소식은 상세 화면에서<br><b>저장</b>을 눌러 모아 두세요.</p></div>');
    track.log("saved_view", { value: String(list.length) });
  }

  // ------------------------------------------------------------------ 화면: 내 정보
  function renderMe() {
    const p = profile();
    setChrome("me");
    const size = getS("size", "l");
    const age = (AGE_OPTIONS.find(function (a) { return a.v === p.age; }) || {}).label;
    const weekday = { ok: "괜찮아요", hard: "어려워요", unknown: "그때그때 달라요" }[p.weekday];
    const kids = p.kids.length ? p.kids.map(function (k) { return (KIDS.find(function (x) { return x.v === k; }) || {}).label; }).join(", ") : "없어요";
    const pending = track.pending();
    const row = function (k, v) { return '<div class="list-row"><span class="k">' + k + '</span><span class="v">' + esc(v) + "</span></div>"; };

    $app.innerHTML =
      '<header class="home-head"><h1>내 정보</h1></header>' +
      "<h2>맞춤 설정</h2>" +
      '<div class="list">' +
      row("사는 동", p.dongAdmin) + row("연령대", age) + row("받는 소식", p.interests.join(", ")) +
      row("평일 낮", weekday) + row("자녀·손주", kids) + row("알림 범위", p.scope === "district" ? "강동구 전체" : "우리 동네와 이웃 동네") +
      "</div>" +
      '<button class="btn secondary" id="redo" style="margin-top:12px">설정 다시 하기</button>' +
      "<h2>글자 크기</h2>" +
      '<div class="choices two">' +
      '<button class="choice compact" data-size="l" aria-pressed="' + (size === "l") + '">크게</button>' +
      '<button class="choice compact" data-size="xl" aria-pressed="' + (size === "xl") + '" style="font-size:1.15em">아주 크게</button>' +
      "</div>" +
      "<h2>시범 운영 정보</h2>" +
      '<div class="list">' +
      row("참여 코드", PID) +
      row("정보 기준일", fmtDate(DATA.data_version)) +
      row("보낼 이용 기록", pending ? pending + "건 대기" : "모두 보냄") +
      "</div>" +
      (CFG.ENDPOINT ? "" : '<p class="small muted">⚠️ 기록 받을 주소가 아직 설정되지 않아 이 휴대폰에만 쌓이고 있어요.</p>') +
      '<div class="notice" style="margin-top:16px">이 앱은 2주 시범 서비스예요. 모인 기록은 "맞춤 소식이 실제로 도움이 되는지" 확인하는 데만 쓰고, 시범 운영이 끝나면 지웁니다.</div>';

    document.getElementById("redo").addEventListener("click", function () {
      setS("draft", Object.assign({}, p));
      track.log("profile_edit_start");
      location.hash = "#/onb/1";
    });
    $app.querySelectorAll("[data-size]").forEach(function (el) {
      el.addEventListener("click", function () {
        setS("size", el.dataset.size);
        applySize();
        track.log("font_size", { value: el.dataset.size });
        renderMe();
      });
    });
    track.flush();
  }

  function applySize() {
    document.documentElement.dataset.size = getS("size", "l");
  }

  // ------------------------------------------------------------------ 화면: 상세 (INFO-03)
  let detailOpen = null;
  function detailLeave() {
    if (!detailOpen) return;
    const secs = Math.round((Date.now() - detailOpen.t) / 1000);
    track.log("detail_leave", { item_id: detailOpen.id, value: String(secs) });
    detailOpen = null;
  }

  function renderItem(id) {
    const item = ITEMS.get(id);
    const p = profile();
    if (!item) { location.hash = "#/home"; return; }
    setChrome(null);

    const st = status(item);
    const elig = eligibility(item, p);
    const sc = elig.ok ? score(item, p, elig) : { score: null, reasons: [] };
    const from = sessionStorageGet("from") || {};
    sessionStorageSet("from", null);

    const opened = getS("opened", {});
    opened[id] = (opened[id] || 0) + 1;
    setS("opened", opened);
    detailOpen = { id: id, t: Date.now() };
    track.log("detail_view", {
      item_id: id, surface: from.surface || "direct", rank: from.rank || "", score: sc.score,
      reasons: sc.reasons.map(function (r) { return r.code; }).join(";"), grade: item.grade, category: item.cat, value: st,
    });

    const saved = getS("saved", []).includes(id);
    const fb = getS("feedback", {})[id] || {};

    // 왜 보여드렸나요
    const why = [];
    sc.reasons.forEach(function (r) {
      if (r.code === "deadline") why.push("신청 마감이 가까워요 (" + r.label.replace("마감 ", "") + ")");
      else if (r.code === "age") why.push(r.label + "인 프로그램이에요");
      else if (r.code === "kid") why.push(r.label + " 참여할 수 있어요");
      else if (r.code === "dong") why.push("사시는 " + item.dong + "에서 열려요");
      else if (r.code === "near") why.push("가까운 이웃 동네(" + item.dong + ")에서 열려요");
      else if (r.code === "interest") why.push("관심 있다고 하신 '" + catGroup(item.cat) + "' 소식이에요");
      else if (r.code === "new") why.push("최근에 새로 올라온 소식이에요");
      else if (r.code === "my_start") why.push("연령대에 맞춰 " + (myStart(item) > TODAY ? fmtDate(myStart(item)) + "부터 받으실 수 있어요" : "지금 받으실 수 있어요"));
      else if (r.code === "check") why.push("신청 조건이 있어요 (" + item.special_label + "). 해당되는지 확인해 주세요");
    });
    if (DATA.district_wide_scopes.includes(item.scope)) why.push(item.scope === "강동구전체" ? "강동구 주민 누구에게나 해당돼요" : "강동구 주민도 이용할 수 있어요");

    const facts = [];
    const target = targetText(item);
    facts.push(["누가", target || "안내문에서 확인해 주세요", item.companion === "보호자동반" ? "보호자와 함께 참여해요" : ""]);
    if (item.no_apply) {
      facts.push(["신청", "따로 신청하지 않아도 돼요", ""]);
    } else if (item.apply_start || item.apply_end) {
      const d = item.apply_end ? dday(item.apply_end) : null;
      facts.push(["신청", fmtRange(item.apply_start, item.apply_end), st === "upcoming" ? fmtDate(item.apply_start) + "부터 신청할 수 있어요" : d !== null && d >= 0 ? ddayLabel(d) : ""]);
    } else if (item.standing) {
      facts.push(["신청", "언제든 신청할 수 있어요", ""]);
    }
    if (myStart(item)) {
      facts.push(["언제", fmtDate(myStart(item)) + "부터", "내 연령대 시작일 · " + (item.run_end ? fmtDate(item.run_end) + "까지" : "")]);
    } else if (item.run_start || item.days || item.time) {
      facts.push(["언제", fmtRange(item.run_start, item.run_end) || "안내문에서 확인", [item.days, item.time].filter(Boolean).join(" ")]);
    }
    if (item.place) facts.push(["어디서", item.place, item.org]);
    if (item.fee) facts.push(["비용", item.fee, ""]);
    if (item.seats) facts.push(["인원", "정원 " + item.seats.total + "명 중 " + item.seats.taken + "명 신청", item.seats.taken >= item.seats.total ? "정원이 찼어요" : "자리가 차면 일찍 마감돼요"]);
    else if (item.capacity) facts.push(["인원", "정원이 있어요", "자리가 차면 일찍 마감될 수 있어요"]);
    if (item.phone) facts.push(["문의", item.phone, ""]);

    const domain = hostOf(item.action_url || item.url);
    let html =
      '<div class="topbar"><button class="back" data-back aria-label="뒤로">←</button><span class="title"></span></div>' +
      '<div class="detail-cat">' + (CAT_EMO[catGroup(item.cat)] || "📌") + " " + esc(catGroup(item.cat)) + " · " + esc(item.org) + "</div>" +
      '<div class="detail-title">' + esc(item.title) + "</div>" +
      (item.title_orig && item.title_orig !== item.title ? '<div class="detail-orig">원래 제목: ' + esc(item.title_orig) + "</div>" : "") +
      (sc.reasons.length ? chipsHtml(sc.reasons, 4) : "") +
      (st === "closed" ? '<div class="closed-banner">신청이 마감된 소식이에요</div>' : "") +
      (item.summary ? '<p style="margin-top:14px">' + esc(item.summary) + "</p>" : "") +
      (why.length ? '<div class="why"><b>왜 보여드렸나요?</b><ul>' + why.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<dl class="facts">' + facts.map(function (f) {
        return '<div class="fact"><dt>' + f[0] + "</dt><dd>" + esc(f[1]) + (f[2] ? '<span class="sub">' + esc(f[2]) + "</span>" : "") + "</dd></div>";
      }).join("") + "</dl>" +
      '<div class="cta stack">' +
      '<button class="btn" data-cta="apply"' + (st === "closed" ? " disabled" : "") + ">" + applyLabel(item) + "</button>" +
      (item.phone ? '<a class="btn secondary" data-cta="phone" href="tel:' + esc(item.phone.replace(/[^0-9]/g, "")) + '">📞 전화로 물어보기</a>' : "") +
      '<div class="btn-row">' +
      (item.map_query ? '<button class="btn secondary" data-cta="map">🗺️ 길찾기</button>' : "") +
      '<button class="btn secondary" data-cta="save" aria-pressed="' + saved + '">' + (saved ? "🔖 저장됨" : "🔖 저장") + "</button>" +
      (item.map_query ? "" : '<button class="btn secondary" data-cta="share">💬 가족에게</button>') +
      "</div>" +
      (item.map_query ? '<button class="btn secondary" data-cta="share">💬 가족에게 보내기</button>' : "") +
      "</div>" +
      '<p class="source">출처: ' + esc(item.org) + " · " + esc(domain) + ' · <a href="' + esc(item.url) + '" target="_blank" rel="noopener" data-cta-link="source">원문 보기</a><br>' +
      "정보는 공식 안내를 바탕으로 정리했어요. 신청 전에 원문을 꼭 확인해 주세요.</p>" +
      feedbackHtml(fb, item);
    $app.innerHTML = html;

    $app.querySelector("[data-back]").addEventListener("click", function () {
      if (history.length > 1) history.back(); else location.hash = "#/home";
    });
    $app.querySelectorAll("[data-cta]").forEach(function (el) {
      el.addEventListener("click", function () { onCta(item, el.dataset.cta, st); });
    });
    const src = $app.querySelector("[data-cta-link]");
    if (src) src.addEventListener("click", function () { track.log("cta", { item_id: id, value: "source", grade: item.grade, category: item.cat }); });
    bindFeedback(item);
  }

  function applyLabel(item) {
    if (item.no_apply) return "공식 안내 보러 가기";
    if (item.source_id === "SRC-014") return "도서관 누리집에서 신청하기";
    return "신청 방법 보러 가기";
  }

  function targetText(item) {
    const parts = [];
    const bands = (item.bands || []).filter(function (b) { return b !== "불명"; });
    if (item.cond) parts.push(item.cond);
    else if (bands.length) {
      if (bands.includes("청소년") && bands.includes("65+") && !bands.includes("초등")) parts.push("청소년 이상 누구나");
      else parts.push(bands.map(function (b) { return BAND_LABEL[b] || b; }).join(", "));
    }
    return parts.join(" · ");
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function onCta(item, kind, st) {
    const base = { item_id: item.id, grade: item.grade, category: item.cat };
    if (kind === "apply") {
      track.log("cta", Object.assign({ value: "apply_sheet" }, base));
      openApplySheet(item);
    } else if (kind === "map") {
      track.log("cta", Object.assign({ value: "map" }, base));
      window.open("https://map.naver.com/p/search/" + encodeURIComponent(item.map_query), "_blank", "noopener");
    } else if (kind === "save") {
      const saved = new Set(getS("saved", []));
      const on = !saved.has(item.id);
      on ? saved.add(item.id) : saved.delete(item.id);
      setS("saved", Array.from(saved));
      track.log("cta", Object.assign({ value: on ? "save" : "unsave" }, base));
      toast(on ? "저장했어요. 아래 '저장' 탭에서 볼 수 있어요" : "저장을 취소했어요");
      const btn = $app.querySelector('[data-cta="save"]');
      btn.textContent = on ? "🔖 저장됨" : "🔖 저장";
      btn.setAttribute("aria-pressed", String(on));
    } else if (kind === "share") {
      share(item, base);
    } else if (kind === "phone") {
      track.log("cta", Object.assign({ value: "phone" }, base));
    }
  }

  function openApplySheet(item) {
    const url = item.action_url || item.url;
    $sheet.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">' +
      '<h3 id="sheet-t">공식 사이트로 이동해요</h3>' +
      '<p class="muted">신청은 아래 공식 사이트에서 진행돼요. 로그인이 필요할 수 있어요.</p>' +
      '<div class="domain">🔒 ' + esc(hostOf(url)) + "</div>" +
      '<div class="stack"><a class="btn" id="sheet-go" href="' + esc(url) + '" target="_blank" rel="noopener">공식 사이트 열기</a>' +
      '<button class="btn ghost" id="sheet-cancel">닫기</button></div></div>';
    $sheet.hidden = false;
    const close = function () { $sheet.hidden = true; $sheet.innerHTML = ""; };
    document.getElementById("sheet-go").addEventListener("click", function () {
      track.log("cta", { item_id: item.id, value: "apply_go", grade: item.grade, category: item.cat });
      track.flush();
      setTimeout(close, 300);
      askAppliedLater(item.id);
    });
    document.getElementById("sheet-cancel").addEventListener("click", function () {
      track.log("cta", { item_id: item.id, value: "apply_cancel", grade: item.grade, category: item.cat });
      close();
    });
    $sheet.onclick = function (e) { if (e.target === $sheet) close(); };
  }

  // 공식 사이트에 다녀오면 "신청하셨나요?"를 눈에 띄게
  function askAppliedLater(id) { mem.askApplied = id; }

  async function share(item, base) {
    const d = item.apply_end ? "\n신청 마감: " + fmtDate(item.apply_end) : "";
    const text = "[우리동네 소식] " + item.title + d + "\n" + (item.place ? "장소: " + item.place + "\n" : "") + "자세히: " + (item.action_url || item.url);
    if (navigator.share) {
      try {
        await navigator.share({ title: item.title, text: text });
        track.log("cta", Object.assign({ value: "share_done" }, base));
      } catch (e) {
        track.log("cta", Object.assign({ value: "share_cancel" }, base));
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("내용을 복사했어요. 카카오톡에 붙여 넣어 보내 주세요");
      track.log("cta", Object.assign({ value: "share_copy" }, base));
    } catch (e) {
      location.href = "sms:?&body=" + encodeURIComponent(text);
      track.log("cta", Object.assign({ value: "share_sms" }, base));
    }
  }

  // ------------------------------------------------------------------ 피드백
  const NOT_HELPFUL = ["나와 상관없어요", "이미 알던 소식", "너무 멀어요", "시간이 안 맞아요", "내용이 어려워요"];

  function feedbackHtml(fb, item) {
    const btn = function (group, v, label) {
      return '<button class="choice compact" data-fb="' + group + '" data-v="' + v + '" aria-pressed="' + (fb[group] === v) + '">' + label + "</button>";
    };
    let h = '<section class="feedback"><h3>이 소식이 도움이 됐나요?</h3><div class="choices two">' +
      btn("helpful", "yes", "👍 도움 됐어요") + btn("helpful", "no", "👎 아니요") + "</div>";
    if (fb.helpful === "no") {
      h += '<div class="chips" style="margin-top:12px">' + NOT_HELPFUL.map(function (r) {
        return '<button class="filter" data-fb="why" data-v="' + esc(r) + '" aria-pressed="' + (fb.why === r) + '">' + esc(r) + "</button>";
      }).join("") + "</div>";
    }
    if (fb.helpful === "yes") h += '<p class="thanks" style="margin-top:10px">알려 주셔서 고마워요!</p>';
    h += "</section>";
    h += '<section class="feedback" id="applied"><h3>' + (item && item.no_apply ? "다녀오셨나요? (이용하셨나요?)" : "신청하셨나요?") + '</h3><div class="choices three">' +
      btn("applied", "yes", "했어요") + btn("applied", "later", "할 거예요") + btn("applied", "no", "안 할래요") + "</div>" +
      (fb.applied === "yes" ? '<p class="thanks" style="margin-top:10px">잘하셨어요! 오늘의 3가지에서는 빼 둘게요.</p>' : "") +
      "</section>";
    return h;
  }

  function bindFeedback(item) {
    $app.querySelectorAll("[data-fb]").forEach(function (el) {
      el.addEventListener("click", function () {
        const all = getS("feedback", {});
        const fb = all[item.id] || {};
        const group = el.dataset.fb;
        fb[group] = el.dataset.v;
        if (group === "helpful" && fb.helpful === "yes") delete fb.why;
        all[item.id] = fb;
        setS("feedback", all);
        const event = group === "why" ? "feedback_reason" : group === "helpful" ? "feedback_helpful" : "feedback_applied";
        track.log(event, { item_id: item.id, value: el.dataset.v, grade: item.grade, category: item.cat });
        if (group === "helpful" && fb.helpful === "no") toast("다음부터 이 소식은 빼고 보여 드릴게요");
        const y = window.scrollY;
        const sections = $app.querySelectorAll(".feedback");
        sections.forEach(function (s) { s.remove(); });
        $app.insertAdjacentHTML("beforeend", feedbackHtml(fb, item));
        bindFeedback(item);
        window.scrollTo(0, y);
      });
    });
    if (mem.askApplied === item.id) {
      // 공식 사이트에서 돌아왔을 때 신청 여부 질문으로 스크롤
      const onBack = function () {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onBack);
        mem.askApplied = null;
        const el = document.getElementById("applied");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      document.addEventListener("visibilitychange", onBack);
    }
  }

  // ------------------------------------------------------------------ 라우터
  function route() {
    const hash = location.hash || "";
    if (!hash.startsWith("#/item/")) detailLeave();
    const p = profile();
    const m = hash.match(/^#\/([a-z]+)(?:\/(.+))?$/);
    const page = m ? m[1] : "";
    const arg = m && m[2] ? decodeURIComponent(m[2]) : "";

    if (page === "intro") return renderIntro();
    if (page === "onb") return renderOnb(Math.min(Math.max(Number(arg) || 1, 1), ONB_STEPS));
    if (!p) return (location.hash = getS("consent", false) ? "#/onb/1" : "#/intro");
    if (page === "item") return renderItem(arg);
    if (page === "browse") return renderBrowse();
    if (page === "saved") return renderSaved();
    if (page === "me") return renderMe();
    if (page !== "home") return (location.hash = "#/home");
    renderHome();
  }

  async function boot() {
    applySize();
    try {
      const res = await fetch("data/items.json", { cache: "no-cache" });
      DATA = await res.json();
    } catch (e) {
      $app.innerHTML = '<div class="empty" style="margin-top:30vh"><div class="emo">📡</div><p>소식을 불러오지 못했어요.<br>인터넷 연결을 확인하고 다시 열어 주세요.</p></div>';
      return;
    }
    DATA.items.forEach(function (it) { ITEMS.set(it.id, it); });
    if (SESSION.fresh) {
      track.log("app_open", {
        value: new URLSearchParams(location.search).get("p") ? "link" : "return",
        detail: {
          w: window.innerWidth, h: window.innerHeight,
          standalone: window.matchMedia("(display-mode: standalone)").matches,
          ua: /iPhone|iPad/.test(navigator.userAgent) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "other",
          has_profile: !!profile(),
        },
      });
    }
    window.addEventListener("hashchange", route);
    route();
    track.flush();
  }

  boot();
})();
