import { addDays, dailyNumber, dailySize, dayKey, epochDay, LAUNCH_DAY, msUntilNextDay } from '../../shared/day.ts';
import { audio } from '../audio/context';
import { sfx } from '../audio/sfx.ts';
import { DUCK, makeGeo } from '../engine/grid.ts';
import type { Hint } from '../engine/hints.ts';
import { LEVEL_COUNT, LEVEL_SIZES } from '../engine/ladder.ts';
import { parseRegions, parseSolution, solutionToString, type PackPuzzle } from '../engine/puzzle.ts';
import type { Progress, Settings } from '../game/progress.ts';
import { Session, type SessionKind, type SoundCue } from '../game/session.ts';
import { formatCountdown, formatTime } from '../game/timer.ts';
import { getLang, LANG_NAMES, LANGS, onLangChange, plural, setLang, t, type Lang, type StringKey } from '../i18n';
import { solveId } from '../net/leaderboard.ts';
import { dailyAvailable, getDaily, getLevel } from '../packs/packs.ts';
import { BoardView } from './boardView.ts';
import { button, el, make } from './dom.ts';
import { duckSvg } from './duckArt.ts';
import { describeHint, type HintView } from './hintText.ts';
import { icon, type IconName } from './icons.ts';
import { BoardInput } from './input.ts';
import type { DailySolve, LeaderboardPort, LeaderboardUi } from './leaderboardUi.ts';
import { assignColours } from './palette.ts';
import { Sheet } from './sheet.ts';
import { bubbles } from './winFx.ts';

type Route =
  | { view: 'home' }
  | { view: 'levels' }
  | { view: 'past' }
  | { view: 'level'; k: number }
  | { view: 'daily'; day: string | null };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'levels') return { view: 'levels' };
  if (h === 'past') return { view: 'past' };
  if (h === 'daily') return { view: 'daily', day: null };
  let m = /^level\/(\d{1,4})$/.exec(h);
  if (m) {
    const k = Number(m[1]);
    if (k >= 1 && k <= LEVEL_COUNT) return { view: 'level', k };
  }
  m = /^daily\/(\d{4}-\d{2}-\d{2})$/.exec(h);
  if (m && !Number.isNaN(epochDay(m[1]!))) return { view: 'daily', day: m[1]! };
  return { view: 'home' };
}

export interface AppOptions {
  progress: Progress;
  leaderboard: { port: LeaderboardPort; ui: LeaderboardUi } | null;
  /** Expose solution helpers for automated tests (?test). */
  testMode: boolean;
}

/** Ducks drawn per row of the hero; purely decorative. */
function heroDuck(): HTMLElement {
  const wrap = make('div', 'hero-duck');
  wrap.appendChild(duckSvg('normal', 'duck'));
  const water = make('div', 'hero-water');
  wrap.appendChild(water);
  return wrap;
}

function iconButton(name: IconName, label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = button(cls, '', onClick);
  b.appendChild(icon(name));
  b.appendChild(make('span', 'label', label));
  return b;
}

export class App {
  private readonly progress: Progress;
  private readonly lb: AppOptions['leaderboard'];
  private readonly testMode: boolean;
  private readonly viewEl: HTMLElement;
  private readonly sheet: Sheet;
  private readonly board = new BoardView();
  private readonly input: BoardInput;
  private route: Route = { view: 'home' };
  private session: Session | null = null;
  private colours: number[] = [];
  private hint: { h: Hint; view: HintView; sig: string } | null = null;
  private hintPanel: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private serverOffset = 0;
  private paused = false;
  private loadToken = 0;
  private toastTimer = 0;

  constructor(opts: AppOptions) {
    this.progress = opts.progress;
    this.lb = opts.leaderboard;
    this.testMode = opts.testMode;
    this.viewEl = el('view');
    this.sheet = new Sheet(el('sheet'));
    this.input = new BoardInput(this.board, {
      beforeAction: () => this.beforeAction(),
      hint: () => this.showHint(),
    });
    this.board.el.classList.toggle('pat', this.progress.settings.patterns);

    el('backBtn').addEventListener('click', () => this.back());
    el('settingsBtn').addEventListener('click', () => {
      sfx.click();
      this.openSettings();
    });
    const mute = el<HTMLButtonElement>('muteBtn');
    const syncMute = () => {
      mute.replaceChildren(icon(audio.muted ? 'mute' : 'sound'));
      const label = t(audio.muted ? 'aria.unmute' : 'aria.mute');
      mute.setAttribute('aria-label', label);
      mute.title = label;
      mute.setAttribute('aria-pressed', String(audio.muted));
    };
    mute.addEventListener('click', () => {
      audio.unlock();
      audio.setMuted(!audio.muted);
    });
    audio.onMuteChange(syncMute);
    onLangChange(() => {
      syncMute();
      this.render();
    });
    syncMute();
    el('backBtn').replaceChildren(icon('back'));
    el('settingsBtn').replaceChildren(icon('gear'));

    document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    document.addEventListener('keydown', () => audio.unlock(), { capture: true });
    window.addEventListener('hashchange', () => this.navigate());
    document.addEventListener('visibilitychange', () => this.visibility());
    window.addEventListener('pagehide', () => this.session?.save());
    window.setInterval(() => this.onTick(), 250);
  }

  start(): void {
    this.navigate();
  }

  // ---- Time ----

  now(): number {
    return Date.now() + this.serverOffset;
  }

  today(): string {
    return dayKey(this.now());
  }

  /** Learn the server clock from a leaderboard response (only matters near midnight). */
  noteServerTime(serverNow: number): void {
    if (Number.isFinite(serverNow)) this.serverOffset = serverNow - Date.now();
  }

  // ---- Routing ----

  private go(hash: string): void {
    if (location.hash === hash) this.navigate();
    else location.hash = hash;
  }

  private back(): void {
    sfx.click();
    const r = this.route;
    if (r.view === 'level') this.go('#/levels');
    else if (r.view === 'daily' && r.day && r.day !== this.today()) this.go('#/past');
    else this.go('#/');
  }

  private navigate(): void {
    this.leaveSession();
    this.sheet.close();
    this.route = parseRoute(location.hash);
    const r = this.route;
    if (r.view === 'daily' && r.day && epochDay(r.day) > epochDay(this.today())) {
      this.go('#/daily');
      return;
    }
    if (r.view === 'level' && !this.progress.isOpen(r.k)) {
      this.go('#/levels');
      return;
    }
    if (r.view === 'level') void this.openLevel(r.k);
    else if (r.view === 'daily') void this.openDaily(r.day ?? this.today());
    this.render();
  }

  private leaveSession(): void {
    const s = this.session;
    if (s) {
      s.timer.stop();
      s.save();
    }
    this.session = null;
    this.hint = null;
    this.paused = false;
    this.input.attach(null);
  }

  /** Rebuild the current view (also after a language change). */
  private render(): void {
    const r = this.route;
    document.body.dataset.view = r.view;
    el('backBtn').hidden = r.view === 'home';
    el('backBtn').setAttribute('aria-label', t('aria.back'));
    el('settingsBtn').setAttribute('aria-label', t('aria.settings'));
    if (r.view === 'home') this.renderHome();
    else if (r.view === 'levels') this.renderLevels();
    else if (r.view === 'past') this.renderPast();
    else this.renderGame();
    this.onTick();
  }

  private setTitle(text: string): void {
    el('title').textContent = text;
  }

  // ---- Home ----

  private renderHome(): void {
    this.setTitle('');
    const v = make('section', 'home');
    const hero = make('div', 'hero');
    hero.appendChild(heroDuck());
    hero.appendChild(make('h1', 'logo', t('app.name')));
    hero.appendChild(make('p', 'tagline', t('home.tagline')));
    v.appendChild(hero);

    v.appendChild(this.dailyCard());

    const actions = make('div', 'home-actions');
    const cont = this.progress.lastLevelInPlay();
    const next = cont ?? this.progress.nextLevel();
    if (next === null) {
      actions.appendChild(make('p', 'all-done', t('home.allDone', { count: LEVEL_COUNT })));
    } else {
      const play = iconButton('play', t(cont ? 'home.continue' : 'home.play', { k: next }), () => {
        sfx.click();
        this.go(`#/level/${next}`);
      }, 'btn btn-primary btn-big');
      play.id = 'playBtn';
      actions.appendChild(play);
    }
    const row = make('div', 'row');
    const levels = button('btn', t('home.levels'), () => {
      sfx.click();
      this.go('#/levels');
    }, 'levelsBtn');
    const howto = button('btn', t('home.howto'), () => {
      sfx.click();
      this.openHowto();
    }, 'howtoBtn');
    row.append(levels, howto);
    actions.appendChild(row);
    v.appendChild(actions);
    this.viewEl.replaceChildren(v);
  }

  private dailyCard(): HTMLElement {
    const today = this.today();
    const card = make('section', 'card daily-card');
    card.id = 'dailyCard';
    const head = make('div', 'daily-head');
    head.appendChild(icon('calendar'));
    const titles = make('div', 'daily-titles');
    titles.appendChild(make('h2', '', t('daily.title')));
    const size = dailySize(today);
    titles.appendChild(make('p', 'small', t('daily.number', { num: dailyNumber(today), size })));
    head.appendChild(titles);
    const streak = this.progress.streak(today);
    const badge = make('div', 'streak' + (streak > 0 ? ' on' : ''));
    badge.appendChild(icon('flame'));
    badge.appendChild(make('span', '', String(streak)));
    badge.title = t('daily.streak', { n: streak });
    badge.setAttribute('aria-label', t('daily.streak', { n: streak }));
    head.appendChild(badge);
    card.appendChild(head);

    const result = this.progress.dailyResult(today);
    const body = make('div', 'daily-body');
    if (result) {
      body.appendChild(make('p', 'daily-done', result.hints ? t('daily.solvedHints', { time: formatTime(result.ms), n: result.hints }) : t('daily.solved', { time: formatTime(result.ms) })));
      const cd = make('p', 'small countdown', '');
      cd.dataset.countdown = 'daily.next';
      body.appendChild(cd);
    } else if (dailyAvailable(today)) {
      const play = iconButton('play', t(this.progress.hasPlay(`D${today}`) ? 'daily.resume' : 'daily.play'), () => {
        sfx.click();
        this.go('#/daily');
      }, 'btn btn-accent');
      play.id = 'dailyBtn';
      body.appendChild(play);
    }
    const best = this.progress.bestStreak();
    if (best > 0) body.appendChild(make('p', 'small', `${t('daily.streak', { n: streak })} · ${t('daily.best', { n: best })}`));
    const links = make('div', 'row small-row');
    if (this.lb) {
      const lbBtn = iconButton('trophy', t('lb.show'), () => {
        sfx.click();
        this.openLeaderboard();
      }, 'btn btn-small');
      lbBtn.id = 'lbBtn';
      links.appendChild(lbBtn);
    }
    if (epochDay(today) > epochDay(LAUNCH_DAY)) {
      const past = iconButton('calendar', t('daily.past'), () => {
        sfx.click();
        this.go('#/past');
      }, 'btn btn-small');
      past.id = 'pastBtn';
      links.appendChild(past);
    }
    if (links.childElementCount) body.appendChild(links);
    card.appendChild(body);
    return card;
  }

  // ---- Level picker ----

  private renderLevels(): void {
    this.setTitle(t('levels.title'));
    const v = make('section', 'levels');
    const open = this.progress.openLevels();
    const next = this.progress.nextLevel();
    let target: HTMLElement | null = null;
    for (const [n, from, to] of LEVEL_SIZES) {
      const group = make('section', 'level-group');
      group.appendChild(make('h2', '', t('levels.range', { size: n, from, to })));
      const grid = make('div', 'level-grid');
      for (let k = from; k <= to; k++) {
        const solved = this.progress.isSolved(k);
        const isOpen = open.has(k);
        const b = button('lvl' + (solved ? ' solved' : isOpen ? ' open' : ' locked'), '', () => {
          if (!isOpen) {
            this.toast(t('levels.locked'));
            return;
          }
          sfx.click();
          this.go(`#/level/${k}`);
        });
        b.dataset.level = String(k);
        b.appendChild(make('span', 'num', String(k)));
        if (solved) {
          const stars = make('span', 'stars');
          const s = this.progress.stars(k);
          for (let i = 0; i < 3; i++) stars.appendChild(make('span', i < s ? 'star on' : 'star', '★'));
          b.appendChild(stars);
        } else if (!isOpen) {
          b.appendChild(icon('lock', 'icon lock'));
          b.setAttribute('aria-disabled', 'true');
        }
        b.setAttribute('aria-label', t('levels.level', { k }) + (solved ? ' ✓' : ''));
        if (k === next) {
          b.classList.add('next');
          target = b;
        }
        grid.appendChild(b);
      }
      group.appendChild(grid);
      v.appendChild(group);
    }
    this.viewEl.replaceChildren(v);
    const t0 = target as HTMLElement | null;
    if (t0) requestAnimationFrame(() => t0.scrollIntoView({ block: 'center' }));
  }

  // ---- Past dailies ----

  private renderPast(): void {
    this.setTitle(t('daily.past'));
    const v = make('section', 'past');
    v.appendChild(make('p', 'small note', t('daily.pastNote')));
    const list = make('ul', 'past-list');
    const fmt = new Intl.DateTimeFormat(getLang(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    for (let day = addDays(this.today(), -1); epochDay(day) >= epochDay(LAUNCH_DAY); day = addDays(day, -1)) {
      if (!dailyAvailable(day)) continue;
      const res = this.progress.dailyResult(day);
      const li = make('li');
      const d = day;
      const b = button('past-item' + (res ? ' solved' : ''), '', () => {
        sfx.click();
        this.go(`#/daily/${d}`);
      });
      b.appendChild(make('span', 'past-num', `#${dailyNumber(day)}`));
      b.appendChild(make('span', 'past-date', `${fmt.format(new Date(epochDay(day) * 86_400_000))} · ${dailySize(day)}×${dailySize(day)}`));
      b.appendChild(make('span', 'past-res', res ? `✓ ${formatTime(res.ms)}` : ''));
      li.appendChild(b);
      list.appendChild(li);
    }
    v.appendChild(list);
    this.viewEl.replaceChildren(v);
  }

  // ---- Game ----

  private async openLevel(k: number): Promise<void> {
    const token = ++this.loadToken;
    try {
      const pack = await getLevel(k);
      if (token !== this.loadToken) return;
      this.startSession({ type: 'level', k }, pack, pack.id);
    } catch {
      if (token === this.loadToken) this.loadFailed();
    }
  }

  private async openDaily(day: string): Promise<void> {
    const token = ++this.loadToken;
    try {
      const pack = await getDaily(day);
      if (token !== this.loadToken) return;
      this.startSession({ type: 'daily', day, num: dailyNumber(day) }, pack, pack.pid);
    } catch {
      if (token === this.loadToken) this.loadFailed();
    }
  }

  private loadFailed(): void {
    if (!this.overlayEl) return;
    this.overlayEl.replaceChildren(make('p', '', t('game.loadError')), button('btn', t('game.retry'), () => this.navigate()));
    this.overlayEl.hidden = false;
  }

  private startSession(kind: SessionKind, pack: PackPuzzle, pid: string): void {
    const s = new Session(kind, pack, pid, this.progress, {
      changed: (cells) => this.onChanged(cells),
      solved: () => this.onSolved(),
      sound: (cue) => this.onSound(cue),
    });
    this.session = s;
    this.colours = assignColours(s.geo);
    this.board.setPuzzle(s.geo, this.colours);
    this.board.el.classList.remove('solved');
    this.input.attach(s);
    this.renderGame();
    if (s.started && !document.hidden) s.timer.start();
  }

  private renderGame(): void {
    const s = this.session;
    const r = this.route;
    if (r.view === 'level') this.setTitle(t('game.level', { k: r.k }));
    else if (r.view === 'daily') this.setTitle(t('game.daily', { num: dailyNumber(r.day ?? this.today()) }));
    const v = make('section', 'game');
    const wrap = make('div', 'board-wrap');
    wrap.appendChild(this.board.el);
    const overlay = make('div', 'board-overlay');
    overlay.id = 'boardOverlay';
    this.overlayEl = overlay;
    wrap.appendChild(overlay);
    v.appendChild(wrap);

    const dock = make('div', 'dock');
    const status = make('p', 'status');
    status.id = 'status';
    status.setAttribute('aria-live', 'polite');
    this.statusEl = status;
    dock.appendChild(status);

    const tools = make('div', 'toolbar');
    const undo = iconButton('undo', t('game.undo'), () => {
      this.beforeAction();
      this.session?.undo();
    });
    undo.id = 'undoBtn';
    const hintBtn = iconButton('bulb', t('game.hint'), () => this.showHint(), 'btn btn-hint');
    hintBtn.id = 'hintBtn';
    const reset = iconButton('reset', t('game.reset'), () => this.confirmReset());
    reset.id = 'resetBtn';
    tools.append(undo, hintBtn, reset);
    dock.appendChild(tools);

    // The hint panel covers the status line and toolbar, so the board never moves.
    const panel = make('div', 'hint-panel');
    panel.id = 'hintPanel';
    panel.hidden = true;
    panel.setAttribute('role', 'status');
    this.hintPanel = panel;
    dock.appendChild(panel);
    v.appendChild(dock);
    this.viewEl.replaceChildren(v);

    if (!s) {
      overlay.replaceChildren(make('p', 'loading', t('game.loading')));
      overlay.hidden = false;
      this.board.el.hidden = true;
      return;
    }
    this.board.el.hidden = false;
    this.board.relabel(s.board.marks);
    this.board.render(s.board.marks, s.derived(), null);
    this.updateOverlay();
    this.updateStatus();
    if (this.hint) this.drawHint();
  }

  private updateOverlay(): void {
    const s = this.session;
    const o = this.overlayEl;
    if (!s || !o) return;
    o.replaceChildren();
    o.hidden = true;
    this.board.el.classList.remove('covered');
    if (s.solved) return;
    if (!s.started) {
      o.appendChild(duckSvg('normal', 'duck overlay-duck'));
      o.appendChild(make('p', 'small', t('daily.startHint')));
      const go = iconButton('play', t('daily.start'), () => {
        sfx.click();
        s.start();
        this.updateOverlay();
        this.board.el.focus({ preventScroll: true });
      }, 'btn btn-accent btn-big');
      go.id = 'startBtn';
      o.appendChild(go);
    } else if (this.paused) {
      o.appendChild(make('p', 'paused', t('daily.paused')));
      const go = iconButton('play', t('daily.resumeBtn'), () => {
        sfx.click();
        this.paused = false;
        s.timer.start();
        this.updateOverlay();
      }, 'btn btn-accent btn-big');
      go.id = 'resumeBtn';
      o.appendChild(go);
    } else return;
    o.hidden = false;
    this.board.el.classList.add('covered');
  }

  private updateStatus(): void {
    const s = this.session;
    const el0 = this.statusEl;
    if (!s || !el0) return;
    el0.classList.remove('bad', 'coach');
    if (s.solved) {
      el0.textContent = t('aria.solved');
      return;
    }
    const clash = this.board.el.querySelector('.cell.clash') !== null;
    if (clash) {
      el0.textContent = t('game.clash');
      el0.classList.add('bad');
      return;
    }
    if (s.kind.type === 'level' && s.kind.k <= 3) {
      el0.textContent = t(`coach.${s.kind.k}` as StringKey);
      el0.classList.add('coach');
      return;
    }
    el0.textContent = plural('game.left', s.ducksLeft());
  }

  private beforeAction(): void {
    if (this.hint) this.closeHint();
  }

  private onChanged(cells: readonly number[] | null): void {
    const s = this.session;
    if (!s) return;
    this.board.render(s.board.marks, s.derived(), cells);
    this.updateStatus();
  }

  private onSound(cue: SoundCue): void {
    if (cue === 'none') return;
    if (cue === 'duck' || cue === 'clash') {
      if (this.progress.settings.haptics) navigator.vibrate?.(cue === 'clash' ? [20, 40, 20] : 12);
    }
    if (cue === 'clash') this.announce(t('game.clash'));
    sfx[cue]();
  }

  private confirmReset(): void {
    const s = this.session;
    if (!s?.canPlay()) return;
    sfx.click();
    this.beforeAction();
    this.sheet.open('confirm', (p) => {
      p.appendChild(make('h2', '', t('game.resetConfirm')));
      const row = make('div', 'row');
      const yes = button('btn btn-danger', t('game.resetYes'), () => {
        this.sheet.close();
        s.reset();
      }, 'resetYes');
      const no = button('btn', t('game.cancel'), () => this.sheet.close());
      no.dataset.autofocus = '';
      row.append(no, yes);
      p.appendChild(row);
    });
  }

  // ---- Hints ----

  private showHint(): void {
    const s = this.session;
    if (!s?.canPlay()) return;
    const sig = s.board.serialize();
    // Asking again without changing anything keeps the same step (and the same count).
    if (this.hint && this.hint.sig === sig && this.hint.h.kind === 'step') {
      this.hintPanel?.classList.remove('nudge');
      void this.hintPanel?.offsetWidth;
      this.hintPanel?.classList.add('nudge');
      return;
    }
    const h = s.hint();
    sfx.hint();
    this.input.forgetTap();
    this.hint = { h, view: describeHint(h, s.geo, this.colours), sig };
    this.drawHint();
  }

  private drawHint(): void {
    const panel = this.hintPanel;
    const hint = this.hint;
    const s = this.session;
    if (!panel || !hint || !s) return;
    hint.view = describeHint(hint.h, s.geo, this.colours);
    panel.replaceChildren();
    const head = make('div', 'hint-head');
    head.appendChild(icon('bulb'));
    head.appendChild(make('strong', '', t('hint.title')));
    panel.appendChild(head);
    const text = make('p', 'hint-text', hint.view.text);
    text.id = 'hintText';
    panel.appendChild(text);
    const row = make('div', 'row');
    if (hint.view.canApply) {
      const show = button('btn btn-primary btn-small', t('hint.show'), () => {
        const h = hint.h;
        this.closeHint();
        s.applyHint(h);
      }, 'hintShow');
      row.appendChild(show);
    } else if (hint.h.kind === 'mistakes') {
      // First step of a mistakes hint: the count only. "Show me" points them out.
      const show = button('btn btn-primary btn-small', t('hint.show'), () => {
        this.hint = null;
        this.showHint();
      }, 'hintShow');
      row.appendChild(show);
    }
    row.appendChild(button('btn btn-small', t('hint.close'), () => this.closeHint(), 'hintClose'));
    panel.appendChild(row);
    panel.hidden = false;
    this.board.setHighlight(hint.view.highlight);
  }

  private closeHint(): void {
    this.hint = null;
    if (this.hintPanel) this.hintPanel.hidden = true;
    this.board.setHighlight(null);
  }

  // ---- Winning ----

  private onSolved(): void {
    const s = this.session;
    if (!s) return;
    this.closeHint();
    this.updateStatus();
    this.announce(t('aria.solved'));
    const ms = s.timer.ms;
    let level: { k: number; first: boolean; newBest: boolean; prevMs: number | null } | null = null;
    let daily: { day: string; onDay: boolean } | null = null;
    if (s.kind.type === 'level') {
      level = { k: s.kind.k, ...this.progress.recordLevel(s.kind.k, ms, s.hints) };
    } else {
      const onDay = s.kind.day === this.today();
      daily = { day: s.kind.day, onDay };
      this.progress.recordDaily(s.kind.day, ms, s.hints, onDay);
    }
    sfx.win();
    if (this.progress.settings.haptics) navigator.vibrate?.([30, 60, 30, 60, 60]);
    const wait = this.board.celebrate();
    bubbles(this.board.el.parentElement ?? this.board.el, 18, () => sfx.bubble());
    window.setTimeout(() => {
      if (this.session !== s) return;
      this.openWin(s, ms, level, daily);
    }, Math.min(1600, wait));
  }

  private openWin(
    s: Session,
    ms: number,
    level: { k: number; first: boolean; newBest: boolean; prevMs: number | null } | null,
    daily: { day: string; onDay: boolean } | null,
  ): void {
    const titleKey = `win.title.${Math.floor(Math.random() * 4)}` as StringKey;
    this.sheet.open('win', (p) => {
      p.appendChild(duckSvg('happy', 'duck win-duck'));
      p.appendChild(make('h2', 'win-title', t(titleKey)));
      if (level) p.appendChild(make('p', 'win-sub', t('win.level', { k: level.k })));
      if (daily) p.appendChild(make('p', 'win-sub', t('win.daily', { num: dailyNumber(daily.day) })));
      const stats = make('dl', 'stats');
      const stat = (label: string, value: string, extra = '') => {
        const d = make('div', 'stat' + extra);
        d.append(make('dt', '', label), make('dd', '', value));
        stats.appendChild(d);
      };
      stat(t('win.time'), formatTime(ms));
      stat(t('win.hints'), String(s.hints));
      if (level) {
        const best = level.prevMs === null ? ms : Math.min(ms, level.prevMs);
        stat(t('win.best'), formatTime(best), level.newBest ? ' new' : '');
      } else if (daily) {
        stat(t('win.streakLabel'), String(this.progress.streak(this.today())), daily.onDay ? ' new' : '');
      }
      p.appendChild(stats);
      if (level?.newBest) p.appendChild(make('p', 'new-best', t('win.newBest')));
      if (level) {
        const stars = make('div', 'stars big');
        const n = s.hints === 0 ? 3 : s.hints <= 2 ? 2 : 1;
        for (let i = 0; i < 3; i++) stars.appendChild(make('span', i < n ? 'star on' : 'star', '★'));
        p.appendChild(stars);
      }

      if (daily) this.winDailyExtras(p, s, ms, daily);

      const row = make('div', 'row win-actions');
      if (level) {
        const next = this.progress.nextAfter(level.k);
        if (next !== null) {
          const b = iconButton('play', t('win.next'), () => this.go(`#/level/${next}`), 'btn btn-primary');
          b.id = 'nextBtn';
          b.dataset.autofocus = '';
          row.appendChild(b);
        }
        row.appendChild(button('btn', t('win.levels'), () => this.go('#/levels'), 'winLevels'));
      } else {
        row.appendChild(button('btn', t('win.home'), () => this.go('#/'), 'winHome'));
      }
      p.appendChild(row);
    });
  }

  private winDailyExtras(p: HTMLElement, s: Session, ms: number, daily: { day: string; onDay: boolean }): void {
    const share = iconButton('share', t('win.share'), () => void this.share(s, ms), 'btn btn-accent');
    share.id = 'shareBtn';
    p.appendChild(share);
    const lbBox = make('div', 'win-lb');
    if (this.lb) {
      if (!daily.onDay) lbBox.appendChild(make('p', 'small note', t('win.lateBoard')));
      else if (s.hints > 0) lbBox.appendChild(make('p', 'small note', t('win.noBoard')));
      else {
        const cols = solutionToString(this.ducksToCols(s));
        const solve: DailySolve = { day: daily.day, ms: Math.round(ms), cols, gid: solveId(daily.day) };
        this.lb.ui.renderSubmit(lbBox, solve);
      }
    }
    p.appendChild(lbBox);
    const cd = make('p', 'small countdown', '');
    cd.dataset.countdown = 'daily.next';
    p.appendChild(cd);
  }

  private ducksToCols(s: Session): number[] {
    const n = s.n;
    const cols = new Array<number>(n).fill(0);
    for (let c = 0; c < n * n; c++) if (s.board.marks[c] === DUCK) cols[Math.floor(c / n)] = c % n;
    return cols;
  }

  private async share(s: Session, ms: number): Promise<void> {
    if (s.kind.type !== 'daily') return;
    sfx.click();
    const text =
      `${t('win.shareText', { num: s.kind.num, size: s.n, time: formatTime(ms) })} 🦆 ` +
      (s.hints ? t('win.shareHints', { n: s.hints }) : t('win.shareNoHints'));
    const url = 'https://arcade.hz.ax/quack-doku/';
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
        return;
      }
    } catch {
      /* cancelled or blocked: fall back to copying */
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      this.toast(t('win.copied'));
    } catch {
      this.toast(`${text} ${url}`);
    }
  }

  // ---- Sheets ----

  private openLeaderboard(): void {
    const lb = this.lb;
    if (!lb) return;
    this.sheet.open('lb', (p) => {
      p.appendChild(make('h2', '', t('lb.show')));
      const box = make('div', 'lb-box');
      p.appendChild(box);
      lb.ui.renderBoard(box, this.today());
      p.appendChild(button('btn', t('settings.close'), () => this.sheet.close()));
    });
  }

  private openSettings(): void {
    this.sheet.open('settings', (p) => {
      p.appendChild(make('h2', '', t('settings.title')));
      const list = make('div', 'settings');
      const toggle = (id: string, label: string, desc: string, value: boolean, set: (v: boolean) => void) => {
        const row = make('label', 'toggle');
        row.htmlFor = id;
        const text = make('span', 'toggle-text');
        text.appendChild(make('span', 'toggle-label', label));
        if (desc) text.appendChild(make('span', 'toggle-desc', desc));
        const input = make('input');
        input.type = 'checkbox';
        input.id = id;
        input.checked = value;
        input.setAttribute('role', 'switch');
        input.addEventListener('change', () => {
          set(input.checked);
          sfx.click();
        });
        row.append(text, input);
        list.appendChild(row);
      };
      const setting = (key: keyof Settings) => (v: boolean) => {
        this.progress.setSetting(key, v);
        if (key === 'patterns') this.board.el.classList.toggle('pat', v);
        if (key === 'autoX' && this.session) this.onChanged(null);
        if (key === 'timer') this.onTick();
      };
      const st = this.progress.settings;
      toggle('setAutoX', t('settings.autoX'), t('settings.autoX.desc'), st.autoX, setting('autoX'));
      toggle('setTimer', t('settings.timer'), t('settings.timer.desc'), st.timer, setting('timer'));
      toggle('setPatterns', t('settings.patterns'), t('settings.patterns.desc'), st.patterns, setting('patterns'));
      toggle('setSound', t('settings.sound'), '', !audio.muted, (v) => {
        audio.unlock();
        audio.setMuted(!v);
      });
      if ('vibrate' in navigator) toggle('setHaptics', t('settings.haptics'), '', st.haptics, setting('haptics'));
      const langRow = make('label', 'toggle lang-row');
      langRow.htmlFor = 'setLang';
      const langText = make('span', 'toggle-text');
      langText.appendChild(make('span', 'toggle-label', t('aria.lang')));
      const sel = make('select');
      sel.id = 'setLang';
      for (const l of LANGS) {
        const o = make('option', '', LANG_NAMES[l]);
        o.value = l;
        sel.appendChild(o);
      }
      sel.value = getLang();
      sel.addEventListener('change', () => setLang(sel.value as Lang));
      langRow.append(langText, sel);
      list.appendChild(langRow);
      p.appendChild(list);
      p.appendChild(button('btn btn-primary', t('settings.close'), () => this.sheet.close(), 'settingsDone'));
    });
  }

  openHowto(): void {
    this.sheet.open('howto', (p) => {
      p.appendChild(make('h2', '', t('howto.title')));
      p.appendChild(this.exampleBoard());
      const rules = make('ul', 'rules');
      for (const key of ['howto.goal', 'howto.touch', 'howto.unique'] as const) {
        const li = make('li');
        li.appendChild(duckSvg('normal', 'duck bullet'));
        li.appendChild(make('span', '', t(key)));
        rules.appendChild(li);
      }
      p.appendChild(rules);
      const controls = make('ul', 'controls');
      for (const key of ['howto.tap', 'howto.double', 'howto.swipe', 'howto.hint', 'howto.keys'] as const) controls.appendChild(make('li', '', t(key)));
      p.appendChild(controls);
      p.appendChild(button('btn btn-primary', t('howto.close'), () => this.sheet.close(), 'howtoClose'));
    });
  }

  /** A small solved 5×5 board illustrating the rules. */
  private exampleBoard(): HTMLElement {
    const regions = 'aaaeeacceeacceeadcceabbbb';
    const n = 5;
    const geo = makeGeo(n, parseRegions(n, regions));
    const sol = parseSolution(n, '02413');
    const view = new BoardView();
    view.setPuzzle(geo, assignColours(geo));
    const marks = new Uint8Array(n * n);
    sol.forEach((c, r) => (marks[r * n + c] = DUCK));
    view.render(marks, new Uint8Array(n * n), null);
    view.el.classList.add('example');
    view.el.tabIndex = -1;
    view.el.setAttribute('aria-hidden', 'true');
    return view.el;
  }

  // ---- Misc ----

  private onTick(): void {
    const s = this.session;
    const timer = el('timer');
    const showTimer = !!s && (s.kind.type === 'daily' || this.progress.settings.timer) && (this.route.view === 'level' || this.route.view === 'daily');
    timer.hidden = !showTimer;
    if (showTimer && s) timer.textContent = formatTime(s.timer.ms);
    const left = msUntilNextDay(this.now());
    document.querySelectorAll<HTMLElement>('[data-countdown]').forEach((e) => {
      e.textContent = t('daily.next', { time: formatCountdown(left) });
    });
    // The day rolled over while the home screen was open: show the new duck.
    if (this.route.view === 'home') {
      const card = document.getElementById('dailyCard');
      const shown = card?.querySelector('.daily-titles .small')?.textContent ?? '';
      const want = t('daily.number', { num: dailyNumber(this.today()), size: dailySize(this.today()) });
      if (card && shown !== want) this.renderHome();
    }
  }

  private visibility(): void {
    const s = this.session;
    if (!s || s.solved) return;
    if (document.hidden) {
      s.timer.stop();
      s.save();
      if (s.kind.type === 'daily' && s.started) {
        this.paused = true;
        this.updateOverlay();
      }
    } else if (s.kind.type === 'level' && s.started) {
      s.timer.start();
    }
  }

  private announce(text: string): void {
    const live = document.getElementById('live');
    if (!live) return;
    live.textContent = '';
    window.setTimeout(() => (live.textContent = text), 30);
  }

  toast(text: string): void {
    const tEl = el('toast');
    tEl.textContent = text;
    tEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => tEl.classList.remove('show'), 2200);
  }

  // ---- Test hooks ----

  debugState(): Record<string, unknown> {
    const s = this.session;
    return {
      view: this.route.view,
      sheet: this.sheet.name,
      kind: s?.kind ?? null,
      n: s?.n ?? 0,
      solved: s?.solved ?? false,
      started: s?.started ?? false,
      paused: this.paused,
      ducks: s ? s.board.ducks() : [],
      marks: s ? s.board.serialize() : '',
      hints: s?.hints ?? 0,
      ms: s ? Math.round(s.timer.ms) : 0,
      today: this.today(),
    };
  }

  /** Solution cells of the current puzzle (only with ?test). */
  debugSolution(): number[] {
    const s = this.session;
    if (!this.testMode || !s) return [];
    return s.solution.map((c, r) => r * s.n + c);
  }

  /** Cell element centre in client coordinates, for driving pointer events from tests. */
  debugCellCenter(i: number): { x: number; y: number } | null {
    const c = this.board.cellEl(i);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}
