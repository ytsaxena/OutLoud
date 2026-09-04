/* ============================================================
   OutLoud — AI speaking coach
   Browser STT  →  Gemini (via /api/interview)  →  Browser TTS
   ============================================================ */

/* ---------------- theme ---------------- */
const Theme = {
  key: 'outloud_theme',
  get() { try { return localStorage.getItem(this.key); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(this.key, v); } catch (e) {} },
  effective() {
    const v = this.get();
    if (v === 'light' || v === 'dark') return v;
    return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  },
  apply() {
    const eff = this.effective();
    document.documentElement.setAttribute('data-theme', eff);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = eff === 'dark' ? '#141912' : '#3B6D11';
    const fab = document.getElementById('themeFab');
    const moon = document.getElementById('themeIcoMoon'), sun = document.getElementById('themeIcoSun');
    if (fab) fab.setAttribute('aria-label', eff === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    if (moon && sun) { moon.classList.toggle('hidden', eff === 'dark'); sun.classList.toggle('hidden', eff !== 'dark'); }
  },
  toggle() { this.set(this.effective() === 'dark' ? 'light' : 'dark'); this.apply(); Track.ev('theme_toggle', this.effective()); },
  init() { this.apply(); }
};

/* ---------------- storage ---------------- */
const KEY = 'outloud_v1';
const Store = {
  d: null,
  load() {
    try { this.d = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { this.d = null; }
    if (!this.d) this.d = { profile: null, sessions: [], events: [], firstSeen: Date.now(), camPref: true };
    if (!this.d.events) this.d.events = [];
    return this.d;
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) {} },
  reset() { try { localStorage.removeItem(KEY); } catch (e) {} }
};

/* ---------------- metrics ---------------- */
const Track = {
  ev(name, meta) {
    Store.d.events.push({ n: name, t: Date.now(), m: meta || null });
    if (Store.d.events.length > 400) Store.d.events.splice(0, 100);
    Store.save();
    try {
      if (typeof gtag === 'function') {
        const params = (meta && typeof meta === 'object') ? meta : (meta === undefined || meta === null ? {} : { value: meta });
        gtag('event', name, params);
      }
    } catch (e) {}
  },
  count(name) { return Store.d.events.filter(e => e.n === name).length; }
};

/* ---------------- toast ---------------- */
const Toast = {
  t: null,
  show(msg, ms) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(this.t);
    this.t = setTimeout(() => el.classList.remove('on'), ms || 2600);
  }
};

/* ---------------- auth ---------------- */
const Auth = {
  user: null,
  init() {
    if (!window.FirebaseAuth) { setTimeout(() => this.init(), 50); return; }
    window.FirebaseAuth.onChange(u => { this.user = u; this.paintIdentity(); });
  },
  signInGoogle() {
    if (!window.FirebaseAuth) { Toast.show('Still loading — try again in a second.'); return; }
    Track.ev('signin_attempt', 'google');
    window.FirebaseAuth.signIn()
      .then(user => {
        Track.ev('signin_success', 'google');
        Toast.show('Signed in as ' + (user.displayName || user.email || 'you') + '.');
        Nav.go('s-goal');
      })
      .catch(err => {
        if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
        Track.ev('signin_error', (err && err.code) || 'unknown');
        Toast.show('Could not sign in with Google. Please try again.');
      });
  },
  continueGuest() {
    Track.ev('continue_guest');
    Nav.go('s-goal');
  },
  signOut() {
    if (!window.FirebaseAuth || !this.user) return;
    window.FirebaseAuth.signOut().then(() => {
      Track.ev('signout');
      Toast.show('Signed out.');
    });
  },
  paintIdentity() {
    const el = document.getElementById('identityChip');
    if (!el) return;
    if (this.user) {
      el.style.display = '';
      el.textContent = 'Signed in as ' + (this.user.displayName || this.user.email || 'you') + ' — tap to sign out';
    } else {
      el.style.display = 'none';
    }
  }
};

/* ---------------- navigation ---------------- */
const Nav = {
  names: {
    's-welcome': 'Welcome', 's-goal': 'Choose goal', 's-level': 'Choose level',
    's-perm': 'Permissions', 'room': 'Interview room', 's-wait': 'Scoring',
    's-score': 'Score and feedback', 's-home': 'Home'
  },
  go(id) {
    document.querySelectorAll('.screen, #room').forEach(s => s.classList.remove('on'));
    const el = document.getElementById(id);
    el.classList.add('on');
    window.scrollTo(0, 0);
    if (id === 's-home') App.paintHome();
    this.track(id);
  },
  // GA4 has no notion of screen changes in a single-page app — send a
  // virtual page_view per screen so "Pages and screens" / exit rate
  // shows which step users actually left from.
  track(id) {
    try {
      if (typeof gtag !== 'function') return;
      const name = this.names[id] || id;
      gtag('event', 'page_view', {
        page_title: 'OutLoud — ' + name,
        page_location: location.origin + location.pathname + '#' + id,
        page_path: location.pathname + '#' + id
      });
    } catch (e) {}
  }
};

/* ---------------- text to speech ---------------- */
const Voice = {
  voice: null, ready: false, audioEl: null, gen: 0,
  init() {
    this.audioEl = new Audio();
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      if (!vs.length) return;
      const score = v => {
        let s = 0;
        const n = (v.name || '').toLowerCase();
        if (/female|woman|priya|veena|heera|samantha|zira|aria|neerja|tessa|karen|moira/.test(n)) s += 40;
        if (/male|david|alex|daniel|rishi/.test(n) && !/female/.test(n)) s -= 40;
        if (v.lang === 'en-IN') s += 30;
        else if (v.lang === 'en-GB') s += 20;
        else if ((v.lang || '').startsWith('en')) s += 10;
        else s -= 100;
        if (/google/.test(n)) s += 8;
        return s;
      };
      this.voice = vs.slice().sort((a, b) => score(b) - score(a))[0] || null;
      this.ready = true;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  },
  // call once from inside a user-gesture handler (e.g. session start) so
  // the shared <audio> element is allowed to autoplay later on mobile.
  // Must actually play a real (if silent) clip — playing an empty/srcless
  // element does not register as activation on strict mobile browsers.
  unlock() {
    try {
      this.audioEl.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==';
      const p = this.audioEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  },
  async say(text) {
    const my = ++this.gen;
    if (await this.sayNatural(text, my)) return;
    if (my !== this.gen) return; // superseded (skip/repeat/quit) while the fetch was in flight
    return this.sayBrowser(text, my);
  },
  sayNatural(text, my) {
    return fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => new Promise(res => {
        if (my !== this.gen) { res(true); return; } // stale — a newer say()/stop() has already superseded this one
        const a = this.audioEl;
        let done = false;
        const fin = ok => { if (done) return; done = true; clearTimeout(guard); a.onended = a.onerror = null; res(ok); };
        const guard = setTimeout(() => fin(true), Math.max(4000, text.length * 90));
        a.onended = () => fin(true);
        a.onerror = () => fin(false);
        a.src = 'data:audio/' + (j.codec || 'wav') + ';base64,' + j.audio;
        a.play().catch(() => fin(false));
      }))
      .catch(() => false);
  },
  sayBrowser(text, my) {
    return new Promise(res => {
      if (my !== this.gen) { res(); return; }
      if (!('speechSynthesis' in window)) { setTimeout(res, Math.min(6000, text.length * 55)); return; }
      try { speechSynthesis.cancel(); } catch (e) {}
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else { u.lang = 'en-IN'; }
      u.rate = 0.94; u.pitch = 1.06;
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(guard); res(); };
      u.onend = fin; u.onerror = fin;
      // safety: some Android builds never fire onend
      const guard = setTimeout(fin, Math.max(4000, text.length * 90));
      try { speechSynthesis.speak(u); } catch (e) { fin(); }
    });
  },
  stop() {
    this.gen++; // invalidate any in-flight say() calls so they can't hijack playback later
    try { speechSynthesis.cancel(); } catch (e) {}
    try { this.audioEl.pause(); } catch (e) {}
  }
};

/* ---------------- speech to text ---------------- */
const Ears = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition,
  rec: null, active: false, finalTxt: '', interim: '',
  silence: null, onDone: null, started: 0,
  supported() { return !!this.SR; },
  start(onUpdate, onDone) {
    if (!this.supported()) { onDone && onDone('', 0, 'unsupported'); return; }
    this.finalTxt = ''; this.interim = ''; this.onDone = onDone; this.started = Date.now();
    const r = new this.SR();
    this.rec = r;
    r.lang = 'en-IN'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) this.finalTxt += t + ' ';
        else interim += t;
      }
      this.interim = interim;
      onUpdate((this.finalTxt + interim).trim());
      this.bumpSilence();
    };
    r.onerror = e => {
      if (e.error === 'no-speech') { this.bumpSilence(); return; }
      this.finish(e.error);
    };
    r.onend = () => { if (this.active) { try { r.start(); } catch (e) { this.finish('ended'); } } };
    try { r.start(); this.active = true; this.bumpSilence(); }
    catch (e) { onDone && onDone('', 0, 'failed'); }
  },
  bumpSilence() {
    clearTimeout(this.silence);
    // end the answer after 3.5s of quiet, but never before 4s of total time
    const minTotal = 4000 - (Date.now() - this.started);
    this.silence = setTimeout(() => this.finish('silence'), Math.max(3500, minTotal));
  },
  stop() { this.finish('manual'); },
  finish(reason) {
    if (!this.active && !this.rec) return;
    this.active = false;
    clearTimeout(this.silence);
    try { this.rec.onend = null; this.rec.stop(); } catch (e) {}
    const txt = (this.finalTxt + ' ' + this.interim).trim();
    const secs = Math.max(1, Math.round((Date.now() - this.started) / 1000));
    this.rec = null;
    const cb = this.onDone; this.onDone = null;
    cb && cb(txt, secs, reason);
  }
};

/* ---------------- backend ---------------- */
const Api = {
  async call(payload) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: ctl.signal
      });
      clearTimeout(to);
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } catch (e) { clearTimeout(to); throw e; }
  }
};

/* ---------------- content ---------------- */
const ICO = {
  briefcase: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M8 9V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  chat: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3v3.5a.5.5 0 0 0 .8.4L12.5 17H20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4z"/></svg>',
  trendUp: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 6h6v6"/></svg>',
  bars1: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1" opacity=".3"/><rect x="17" y="4" width="4" height="17" rx="1" opacity=".3"/></svg>',
  bars2: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1" opacity=".3"/></svg>',
  bars3: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg>'
};
const GOALS = [
  { id: 'job', emo: ICO.briefcase, t: 'Job interview', s: 'HR and hiring manager questions' },
  { id: 'work', emo: ICO.chat, t: 'Talking at work', s: 'Customers, supervisors, daily updates' },
  { id: 'confidence', emo: ICO.trendUp, t: 'Everyday confidence', s: 'Just speak without freezing up' }
];
const LEVELS = [
  { id: 'freeze', emo: ICO.bars1, t: 'I freeze up', s: 'I know the words but they do not come out' },
  { id: 'stumble', emo: ICO.bars2, t: 'I manage, but I stumble', s: 'I speak, with long pauses and mistakes' },
  { id: 'polish', emo: ICO.bars3, t: 'I am okay, I want polish', s: 'I want to sound sharper and more confident' }
];
const BANK = {
  job: [
    ['Tell me a little about yourself.', 'Why do you want this job?', 'Tell me about a time you solved a problem at work or in college.'],
    ['What are you good at, and how do you know?', 'Describe a mistake you made and what you did next.', 'Where do you see yourself in two years?'],
    ['Why should we hire you over someone else?', 'Tell me about a time you disagreed with a senior. What happened?', 'What is one thing you want to learn this year, and why?']
  ],
  work: [
    ['Introduce yourself to a new customer.', 'A customer is angry about a delay. What do you say?', 'Explain what you did at work yesterday.'],
    ['Explain your work to someone who has never done it.', 'You cannot finish a task on time. How do you tell your supervisor?', 'Describe a day when everything went well at work.'],
    ['Convince a customer to try something new.', 'A team member is not doing their part. How do you handle it?', 'Suggest one improvement for your workplace and explain why.']
  ],
  confidence: [
    ['Tell me about yourself in one minute.', 'Describe your hometown to someone who has never been there.', 'What did you do last Sunday?'],
    ['What is something you are proud of?', 'Describe your best friend and why you like them.', 'If you got one free week, what would you do?'],
    ['What is one opinion you hold strongly? Explain why.', 'Tell me about a person who changed how you think.', 'Teach me something you know well, in one minute.']
  ]
};
const FILLERS = ['um', 'uh', 'umm', 'uhh', 'hmm', 'like', 'actually', 'basically', 'matlab', 'yaar', 'means', 'so', 'okay'];
const ACKS = [
  'Good, that gives me a clear picture.',
  'Thank you. Let us move on.',
  'Alright, noted. Next question.',
  'That helps, thank you.'
];
const TIPS = [
  'Checking how clearly you explained your ideas…',
  'Looking at the structure of your answers…',
  'Finding what you did well…',
  'Writing your feedback…'
];

/* ---------------- app ---------------- */
const App = {
  sel: { goal: null, level: null },
  qs: [], answers: [], idx: 0, stream: null, camOn: true, sessionStart: 0, aborted: false,
  lastBetter: '',

  boot() {
    Store.load();
    Theme.init();
    Auth.init();
    Voice.init();
    this.camOn = Store.d.camPref !== false;
    this.paintChoices();
    this.buildAura();
    if (Store.d.sessions.length) {
      document.getElementById('btn-returning').style.display = '';
      Nav.go('s-home');
    } else {
      Nav.track('s-welcome');
    }
    Track.ev('app_open');
    document.addEventListener('visibilitychange', () => { if (document.hidden) Voice.stop(); });
  },

  buildAura() {
    const a = document.getElementById('aura');
    let h = '';
    for (let i = 0; i < 24; i++) {
      const d = (Math.abs(i - 11.5) / 11.5);
      h += `<b style="animation-delay:${(i * 0.07).toFixed(2)}s; animation-duration:${(0.7 + d * 0.5).toFixed(2)}s; opacity:${(1 - d * 0.6).toFixed(2)}"></b>`;
    }
    a.innerHTML = h;
  },

  paintChoices() {
    const g = document.getElementById('goals'), l = document.getElementById('levels');
    g.innerHTML = GOALS.map(o => this.choiceHTML(o, 'goal')).join('');
    l.innerHTML = LEVELS.map(o => this.choiceHTML(o, 'level')).join('');
  },
  choiceHTML(o, kind) {
    return `<button class="choice" aria-pressed="false" data-kind="${kind}" data-id="${o.id}" onclick="App.pick('${kind}','${o.id}')">
      <span class="emo">${o.emo}</span><span class="txt"><b>${o.t}</b><span>${o.s}</span></span><span class="tick"></span></button>`;
  },
  pick(kind, id) {
    this.sel[kind] = id;
    document.querySelectorAll(`[data-kind="${kind}"]`).forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
    document.getElementById(kind === 'goal' ? 'go-goal' : 'go-level').disabled = false;
    Track.ev('pick_' + kind, id);
  },

  toggleCamPref() {
    const b = document.getElementById('camtoggle');
    this.camOn = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', this.camOn);
    b.style.background = this.camOn ? 'var(--primary)' : 'var(--outline-variant)';
    b.firstElementChild.style.left = this.camOn ? '28px' : '4px';
    Store.d.camPref = this.camOn; Store.save();
  },

  /* ---------- session ---------- */
  async beginSession() {
    if (!Store.d.profile) {
      Store.d.profile = { goal: this.sel.goal || 'job', level: this.sel.level || 'stumble' };
      Store.save();
    }
    this.aborted = false; this.answers = []; this.idx = 0; this.sessionStart = Date.now();
    Track.ev('session_start');

    // unlock speech synthesis / audio playback on mobile (needs a user gesture)
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
    Voice.unlock();

    if (!Ears.supported()) {
      this.fatal('This browser cannot listen', 'OutLoud needs speech recognition, which works in Chrome on Android and Safari on iPhone. Please open this link in Chrome.');
      return;
    }

    // permissions
    try {
      const want = { audio: true, video: this.camOn ? { facingMode: 'user', width: { ideal: 640 } } : false };
      this.stream = await navigator.mediaDevices.getUserMedia(want);
      Track.ev('perm_granted', this.camOn ? 'mic+cam' : 'mic');
    } catch (e) {
      if (this.camOn) {
        try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); this.camOn = false; Track.ev('perm_granted', 'mic'); }
        catch (e2) { Track.ev('perm_denied'); this.fatal('Microphone blocked', 'OutLoud cannot hear you without the microphone. Tap the lock icon in your address bar, allow the microphone, then reload.'); return; }
      } else {
        Track.ev('perm_denied');
        this.fatal('Microphone blocked', 'OutLoud cannot hear you without the microphone. Tap the lock icon in your address bar, allow the microphone, then reload.');
        return;
      }
    }

    Nav.go('room');
    this.mountCam();
    this.setCaption('Getting ready', 'Priya is preparing your questions…');
    this.qs = await this.getQuestions();
    Track.ev('questions_ready');
    await this.sleep(400);
    await Voice.say(`Hello. I am Priya. This is a short practice interview, only three questions. Take your time, and answer out loud.`);
    this.ask(0);
  },

  async getQuestions() {
    const p = Store.d.profile;
    const n = Store.d.sessions.length;
    const fb = () => (BANK[p.goal] || BANK.job)[Math.min(n, 2)];
    try {
      const r = await Api.call({ type: 'questions', goal: p.goal, level: p.level, session: n + 1 });
      if (Array.isArray(r.questions) && r.questions.length >= 3) return r.questions.slice(0, 3);
      throw new Error('bad shape');
    } catch (e) {
      Track.ev('questions_fallback');
      return fb();
    }
  },

  async ask(i) {
    if (this.aborted) return;
    this.idx = i;
    const dots = document.getElementById('qcount').children;
    for (let k = 0; k < 3; k++) { dots[k].className = k < i ? 'done' : (k === i ? 'on' : ''); }
    const q = this.qs[i];
    this.setCaption('Question ' + (i + 1) + ' of 3', q);
    this.setLive('');
    this.micState('idle-locked', 'Priya is speaking');
    document.getElementById('roomtop').classList.add('speaking');
    await Voice.say(q);
    document.getElementById('roomtop').classList.remove('speaking');
    if (this.aborted || this.idx !== i) return; // a newer ask()/skip/repeat superseded this one while awaiting
    this.listen();
  },

  listen() {
    this.micState('listening', 'Tap when done');
    this.setLive('');
    Track.ev('answer_started', this.idx + 1);
    Ears.start(
      txt => this.setLive(txt),
      (txt, secs, reason) => this.answered(txt, secs, reason)
    );
  },

  async answered(txt, secs, reason) {
    if (this.aborted) return;
    if (reason === 'unsupported' || reason === 'failed') {
      this.micState('ready', 'Tap to try again');
      this.setLive('');
      return;
    }
    if (!txt || txt.split(/\s+/).filter(Boolean).length < 3) {
      // too short — nudge once, then move on
      this.micState('idle-locked', 'Priya is speaking');
      await Voice.say('I could not hear you clearly. Take a breath, and try answering once more.');
      if (this.aborted) return;
      if (!this._retried) { this._retried = true; this.listen(); return; }
    }
    this._retried = false;
    this.answers.push({ q: this.qs[this.idx], a: txt, secs });
    Track.ev('answer_done', { q: this.idx + 1, words: txt.split(/\s+/).filter(Boolean).length, secs });
    this.micState('thinking', 'Got it');
    document.getElementById('qcount').children[this.idx].className = 'done';
    const answeredIdx = this.idx;

    if (answeredIdx < 2) {
      document.getElementById('roomtop').classList.add('speaking');
      await Voice.say(ACKS[answeredIdx % ACKS.length]);
      document.getElementById('roomtop').classList.remove('speaking');
      if (this.aborted || this.idx !== answeredIdx) return; // superseded by a skip/repeat while the ack was speaking
      this.ask(answeredIdx + 1);
    } else {
      document.getElementById('roomtop').classList.add('speaking');
      await Voice.say('That is the end of the interview. Well done for finishing. Let me give you your feedback.');
      document.getElementById('roomtop').classList.remove('speaking');
      this.endSession();
    }
  },

  micTap() {
    const st = document.getElementById('mic').dataset.state;
    if (st === 'listening') { Ears.stop(); Track.ev('answer_manual_stop'); }
    else if (st === 'ready') { this.listen(); }
    else if (st === 'idle-locked') { Voice.stop(); }
  },

  micState(state, label) {
    const m = document.getElementById('mic');
    m.dataset.state = state;
    document.getElementById('micLabel').textContent = label;
    const ic = document.getElementById('micicon');
    if (state === 'listening') ic.innerHTML = '<rect x="7" y="6" width="10" height="12" rx="2"/>';
    else ic.innerHTML = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>';
  },

  setCaption(tag, text) {
    document.querySelector('#caption .qn').textContent = tag;
    document.getElementById('captxt').textContent = text;
  },
  setLive(t) {
    const el = document.getElementById('live');
    if (!t) { el.classList.add('empty'); el.textContent = 'Your words will appear here as you speak…'; }
    else { el.classList.remove('empty'); el.textContent = t; el.scrollTop = el.scrollHeight; }
  },

  mountCam() {
    const v = document.getElementById('selfcam');
    const off = document.getElementById('camoff');
    document.getElementById('ini').textContent = 'You';
    if (this.camOn && this.stream && this.stream.getVideoTracks().length) {
      v.srcObject = this.stream; v.classList.remove('hidden'); off.classList.add('hidden');
    } else {
      v.classList.add('hidden'); off.classList.remove('hidden');
    }
    document.getElementById('btn-cam').classList.toggle('off', !this.camOn);
  },
  toggleCam() {
    if (!this.stream) return;
    const tracks = this.stream.getVideoTracks();
    if (!tracks.length) { this.toast('Camera was not allowed for this session.'); return; }
    this.camOn = !this.camOn;
    tracks.forEach(t => t.enabled = this.camOn);
    Store.d.camPref = this.camOn; Store.save();
    this.mountCam();
    Track.ev('camera_toggle', this.camOn ? 'on' : 'off');
  },

  /* ---------- evaluation ---------- */
  async endSession() {
    Nav.go('s-wait');
    this.stopMedia();
    let i = 0;
    const rot = setInterval(() => { document.getElementById('waittip').textContent = TIPS[++i % TIPS.length]; }, 2600);
    let fb;
    try {
      const r = await Api.call({ type: 'evaluate', goal: Store.d.profile.goal, level: Store.d.profile.level, answers: this.answers });
      fb = this.sanitise(r);
      Track.ev('feedback_ai');
    } catch (e) {
      fb = this.localFeedback();
      Track.ev('feedback_fallback');
    }
    clearInterval(rot);
    fb.stats = this.computeStats();
    const rec = {
      at: Date.now(), score: fb.total, scores: fb.scores,
      words: fb.stats.words, secs: Math.round((Date.now() - this.sessionStart) / 1000),
      goal: Store.d.profile.goal
    };
    Store.d.sessions.push(rec); Store.save();
    Track.ev('session_complete', rec.score);
    this.paintScore(fb);
    Nav.go('s-score');
  },

  sanitise(r) {
    const c = (n, d) => Math.max(40, Math.min(100, Math.round(Number(n) || d)));
    const s = r.scores || {};
    const scores = { fluency: c(s.fluency, 62), clarity: c(s.clarity, 62), structure: c(s.structure, 60), vocabulary: c(s.vocabulary, 64) };
    const total = Math.round((scores.fluency + scores.clarity + scores.structure + scores.vocabulary) / 4);
    return {
      total,
      scores,
      headline: r.headline || 'You finished the whole interview. That is the hardest part.',
      wins: (Array.isArray(r.wins) ? r.wins : []).slice(0, 3).filter(Boolean),
      fix: r.fix || 'Try to give one clear example in each answer, so the interviewer can picture it.',
      saidIt: r.saidIt || (this.answers[0] ? this.answers[0].a.split(/[.?!]/)[0] : ''),
      betterIt: r.betterIt || 'Say it slowly, and add one detail: what you did, and what happened after.'
    };
  },

  computeStats() {
    const all = this.answers.map(a => a.a).join(' ').toLowerCase();
    const words = all.split(/\s+/).filter(Boolean);
    const secs = this.answers.reduce((s, a) => s + a.secs, 0) || 1;
    const fillers = words.filter(w => FILLERS.includes(w.replace(/[^a-z]/g, ''))).length;
    const longest = Math.max(0, ...this.answers.map(a => a.a.split(/\s+/).filter(Boolean).length));
    return { words: words.length, wpm: Math.round(words.length / (secs / 60)) || 0, fillers, longest, secs };
  },

  localFeedback() {
    const st = this.computeStats();
    const base = 55 + Math.min(20, Math.round(st.words / 12));
    const pace = st.wpm >= 90 && st.wpm <= 150 ? 8 : 0;
    const clean = st.fillers <= 3 ? 8 : (st.fillers <= 7 ? 3 : 0);
    const sc = {
      fluency: Math.min(96, base + pace),
      clarity: Math.min(96, base + clean),
      structure: Math.min(96, base + (st.longest > 40 ? 6 : 0)),
      vocabulary: Math.min(96, base + 4)
    };
    Object.keys(sc).forEach(k => sc[k] = Math.max(45, sc[k]));
    return {
      total: Math.round((sc.fluency + sc.clarity + sc.structure + sc.vocabulary) / 4),
      scores: sc,
      headline: 'You answered all three questions out loud. That is a real win.',
      wins: [
        `You spoke ${st.words} words in this session — that is ${st.words} more than staying silent.`,
        st.longest > 30 ? 'Your longest answer had good length. You did not give up after one line.' : 'You kept going even when it felt uncomfortable.',
        st.fillers <= 5 ? 'You used very few filler words.' : 'You kept the conversation moving instead of stopping.'
      ],
      fix: st.wpm > 160 ? 'You are speaking quite fast. Slow down and pause at the end of each sentence — it makes you sound more confident, not less.'
        : (st.words < 60 ? 'Your answers are short. Aim for four or five sentences: what happened, what you did, what the result was.'
          : 'Add one specific example to each answer. Numbers, names and places make an answer memorable.'),
      saidIt: this.answers[0] ? this.answers[0].a.split(/\s+/).slice(0, 18).join(' ') : '',
      betterIt: 'Try this shape: “I am <name>. I have <experience>. Recently I <one thing you did>, and it <result>.”'
    };
  },

  paintScore(fb) {
    this.lastBetter = fb.betterIt;
    const el = document.getElementById('totalScore');
    let n = 0;
    const t = setInterval(() => { n += Math.max(1, Math.round(fb.total / 22)); if (n >= fb.total) { n = fb.total; clearInterval(t); } el.textContent = n; }, 28);
    const ring = document.getElementById('scoreRing');
    const circ = 377;
    setTimeout(() => { ring.style.strokeDashoffset = circ - (circ * Math.min(100, Math.max(0, fb.total)) / 100); }, 120);
    document.getElementById('scoreLine').textContent = fb.headline;
    document.getElementById('wins').innerHTML = fb.wins.map(w => `<li>${this.esc(w)}</li>`).join('');
    const labels = { fluency: 'Fluency', clarity: 'Clarity', structure: 'Structure', vocabulary: 'Vocabulary' };
    document.getElementById('bars').innerHTML = Object.keys(labels).map(k =>
      `<div class="bar"><div class="top"><b>${labels[k]}</b><span>${fb.scores[k]}</span></div><div class="track"><div class="fill" data-w="${fb.scores[k]}"></div></div></div>`
    ).join('');
    setTimeout(() => document.querySelectorAll('.fill').forEach(f => f.style.width = f.dataset.w + '%'), 120);
    document.getElementById('fixText').textContent = fb.fix;
    document.getElementById('saidIt').textContent = fb.saidIt ? '“' + fb.saidIt + '”' : 'Your answer';
    document.getElementById('betterIt').textContent = fb.betterIt;
    const s = fb.stats;
    document.getElementById('stats').innerHTML = `
      <div class="stat big"><span>words spoken</span><b>${s.words}</b></div>
      <div class="stat"><b>${s.wpm}</b><span>words / min</span></div>
      <div class="stat"><b>${s.fillers}</b><span>filler words</span></div>
      <div class="stat"><b>${s.longest}</b><span>longest answer</span></div>`;
  },

  hearBetter() { Voice.say(this.lastBetter || ''); Track.ev('hear_better'); },

  finishToHome() { Nav.go('s-home'); },

  /* ---------- home ---------- */
  paintHome() {
    const d = Store.d, ss = d.sessions;
    const goalName = (GOALS.find(g => g.id === (d.profile && d.profile.goal)) || GOALS[0]).t;
    document.getElementById('homeGoal').textContent = goalName;

    // streak
    const days = [...new Set(ss.map(s => new Date(s.at).toDateString()))];
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      const d2 = new Date(); d2.setDate(d2.getDate() - i);
      if (days.includes(d2.toDateString())) streak++;
      else if (i > 0) break;
    }
    document.getElementById('streakN').textContent = Math.max(streak, ss.length ? 1 : 0);
    const doneToday = days.includes(new Date().toDateString());
    document.getElementById('streakSub').textContent = doneToday ? 'Done for today. Come back tomorrow.' : 'You have not practised today yet.';

    const n = ss.length;
    document.getElementById('nextTag').textContent = doneToday ? 'Extra practice' : "Today's session";
    document.getElementById('nextTitle').textContent = n === 0 ? 'Your first interview' : 'Interview round ' + (n + 1);
    document.getElementById('nextDesc').textContent = n === 0 ? '3 questions, about 4 minutes.'
      : (n < 3 ? '3 new questions, slightly harder than last time.' : '3 questions at your level. Keep the streak alive.');

    // trend
    const tr = document.getElementById('trend');
    if (n >= 2) {
      const pts = ss.slice(-8).map(s => s.score);
      const w = 100, h = 40;
      const lo = Math.min(...pts), hi = Math.max(...pts);
      const pad = Math.max(4, (hi - lo) * 0.35);
      const min = lo - pad, max = hi + pad;
      const X = i => (i / (pts.length - 1)) * w;
      const Y = p => h - ((p - min) / (max - min)) * h;
      const path = pts.map((p, i) => `${X(i)},${Y(p)}`).join(' ');
      const delta = pts[pts.length - 1] - pts[0];
      tr.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:76px;overflow:visible">
        <polygon points="0,${h} ${path} ${w},${h}" fill="var(--primary)" opacity=".10"/>
        <polyline points="${path}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p)}" r="2.5" fill="var(--primary)" vector-effect="non-scaling-stroke"/>`).join('')}
      </svg><p class="label" style="margin-top:10px">Last ${pts.length} sessions · ${delta >= 0 ? '+' : ''}${delta} points${delta > 0 ? ' since you started' : ''}</p>`;
    } else tr.innerHTML = '';

    document.getElementById('history').innerHTML = n
      ? ss.slice().reverse().slice(0, 6).map(s => `<div class="hist"><div class="sc">${s.score}</div>
          <div style="flex:1"><b style="font-size:14.5px">${new Date(s.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</b>
          <div class="label" style="margin:0">${s.words} words · ${Math.round(s.secs / 60)} min</div></div></div>`).join('')
      : '<p class="body" style="font-size:14px">No sessions yet.</p>';
  },

  /* ---------- metrics dashboard ---------- */
  openMetrics() {
    const d = Store.d, ss = d.sessions;
    const day = Math.floor((Date.now() - d.firstSeen) / 86400000) + 1;
    const opens = Track.count('app_open');
    const started = Track.count('session_start');
    const q1 = Track.count('answer_done');
    const done = Track.count('session_complete');
    const permOK = Track.count('perm_granted'), permNO = Track.count('perm_denied');
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
    const avg = ss.length ? Math.round(ss.reduce((s, x) => s + x.score, 0) / ss.length) : 0;
    const totalWords = ss.reduce((s, x) => s + x.words, 0);
    document.getElementById('sheetBody').innerHTML = `
      <p class="overline">Metrics — this device</p>
      <h3 class="headline" style="margin:6px 0 16px">Day ${day} since first open</h3>
      <table class="mtable">
        <tr><td>App opens</td><td>${opens}</td></tr>
        <tr><td>Mic permission grant rate</td><td>${pct(permOK, permOK + permNO)}</td></tr>
        <tr><td>Sessions started</td><td>${started}</td></tr>
        <tr><td>Activation (spoke ≥1 answer)</td><td>${pct(q1 ? 1 : 0, started ? 1 : 0)}</td></tr>
        <tr><td>Session completion rate</td><td>${pct(done, started)}</td></tr>
        <tr><td>Sessions completed</td><td>${done}</td></tr>
        <tr><td>Average speaking score</td><td>${avg || '—'}</td></tr>
        <tr><td>Total words spoken</td><td>${totalWords}</td></tr>
        <tr><td>AI feedback / fallback</td><td>${Track.count('feedback_ai')} / ${Track.count('feedback_fallback')}</td></tr>
      </table>
      <p class="note"><span>ℹ️</span><span>North Star is Week&nbsp;4 practice completion — the share of signups who complete at least one session in their fourth week. It needs 28 days of data, so it is not shown here yet.</span></p>
      <button class="btn tonal" style="margin-top:16px" onclick="App.closeSheet()">Close</button>`;
    document.getElementById('sheet').classList.add('on');
  },

  openSheet() {
    document.getElementById('sheetBody').innerHTML = `
      <p class="overline">Interview options</p>
      <div style="height:12px"></div>
      <button class="btn tonal" style="margin-bottom:10px" onclick="App.repeatQ()"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4a8 8 0 0 0-6.32 3.09L4.7 6.12A.5.5 0 0 0 4 6.55V10a.5.5 0 0 0 .5.5h3.45a.5.5 0 0 0 .35-.85L6.9 8.24A6 6 0 1 1 6 12H4a8 8 0 1 0 8-8z"/></svg> Repeat the question</button>
      <button class="btn tonal" style="margin-bottom:10px" onclick="App.skipQ()"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5a1 1 0 0 1 1.53-.85l9 6a1 1 0 0 1 0 1.7l-9 6A1 1 0 0 1 6 17V5z"/><rect x="16" y="4" width="2.5" height="14" rx="1"/></svg> Skip this question</button>
      <button class="btn outline" style="margin-bottom:10px" onclick="App.quit()">Leave the interview</button>
      <button class="btn text" onclick="App.closeSheet()">Cancel</button>`;
    document.getElementById('sheet').classList.add('on');
  },
  closeSheet() { document.getElementById('sheet').classList.remove('on'); },

  async repeatQ() {
    this.closeSheet();
    Voice.stop();
    if (Ears.active) Ears.stop();
    Track.ev('repeat_question');
    await this.sleep(200);
    this.ask(this.idx);
  },
  skipQ() {
    this.closeSheet();
    Voice.stop();
    Track.ev('skip_question');
    if (Ears.active) { Ears.stop(); return; }
    this.answers.push({ q: this.qs[this.idx], a: '', secs: 1 });
    if (this.idx < 2) this.ask(this.idx + 1); else this.endSession();
  },
  quit() {
    this.closeSheet(); this.aborted = true;
    Voice.stop(); if (Ears.active) Ears.stop();
    this.stopMedia();
    Track.ev('session_abandon', this.idx + 1);
    Nav.go(Store.d.sessions.length ? 's-home' : 's-welcome');
  },

  stopMedia() { if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } },

  fatal(title, msg) {
    document.getElementById('sheetBody').innerHTML =
      `<p class="overline" style="color:var(--error)">Cannot continue</p>
       <h3 class="headline" style="margin:6px 0 10px">${this.esc(title)}</h3>
       <p class="body">${this.esc(msg)}</p>
       <button class="btn" style="margin-top:18px" onclick="App.closeSheet()">Okay</button>`;
    document.getElementById('sheet').classList.add('on');
  },
  toast(m) { this.fatal('Heads up', m); },

  resetAll() {
    if (!confirm('Delete all your practice history on this phone?')) return;
    Store.reset(); location.reload();
  },

  esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
};

App.boot();
