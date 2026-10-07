import { addDays } from '../../shared/day.ts';
import { NAME_MAX, sanitizeName, type DayBoard, type Entry, type SubmitResponse } from '../../shared/scoreRules.ts';
import { formatTime } from '../game/timer.ts';
import { t } from '../i18n';
import type { FailureKind, Result } from '../net/leaderboard.ts';
import { button, make } from './dom.ts';
import { duckSvg } from './duckArt.ts';

/** A solve that may go on the board. */
export interface DailySolve {
  day: string;
  ms: number;
  cols: string;
  gid: string;
}

/** The leaderboard as the UI sees it. Absent when no scores API was configured. */
export interface LeaderboardPort {
  submit(name: string, solve: DailySolve): Promise<Result<SubmitResponse>>;
  day(day: string): Promise<Result<DayBoard>>;
  /** Name used last time on this device. */
  lastName(): string;
  /** Ids of rows submitted from this device. */
  mine(): Set<number>;
}

interface SubmitState {
  gid: string;
  phase: 'idle' | 'submitting' | 'done' | 'error' | 'final';
  name: string;
  error?: FailureKind;
  result?: SubmitResponse;
}

const BOARD_FRESH_MS = 30_000;
const COMPACT_ROWS = 5;

/**
 * Name entry on the daily win card and the day boards, ported from Flap Flock. Names are
 * always rendered with textContent. Each solve can be submitted once (the server also
 * deduplicates by solve id).
 */
export class LeaderboardUi {
  private readonly port: LeaderboardPort;
  private readonly click: () => void;
  private submitState: SubmitState = { gid: '', phase: 'idle', name: '' };
  private submitInto: HTMLElement | null = null;
  private solve: DailySolve | null = null;
  private tab: 0 | 1 = 0;
  private boardPhase: 'loading' | 'ready' | 'error' = 'loading';
  private cache = new Map<string, { data: DayBoard; at: number }>();
  private request = 0;
  private boardInto: HTMLElement | null = null;
  private today = '';

  constructor(port: LeaderboardPort, click: () => void) {
    this.port = port;
    this.click = click;
  }

  // ---- Win card: name entry ----

  renderSubmit(into: HTMLElement, solve: DailySolve): void {
    if (this.submitState.gid !== solve.gid) this.submitState = { gid: solve.gid, phase: 'idle', name: this.port.lastName() };
    this.submitInto = into;
    this.solve = solve;
    into.replaceChildren(this.submitBlock());
  }

  private message(): string {
    const s = this.submitState;
    if (s.phase === 'submitting') return t('submit.sending');
    if (s.phase !== 'error' && s.phase !== 'final') return '';
    switch (s.error) {
      case 'rate':
        return t('submit.errRate');
      case 'rejected':
        return t('submit.errRejected');
      case 'server':
        return t('submit.errServer');
      default:
        return t('submit.errNetwork');
    }
  }

  private submitBlock(): HTMLElement {
    const s = this.submitState;
    const box = make('div', 'submit-box');
    box.id = 'submitBox';
    box.dataset.phase = s.phase;

    if (s.phase === 'done' && s.result) {
      const status = make('p', 'submit-status ok', t('submit.done', { rank: s.result.rank }));
      status.setAttribute('role', 'status');
      box.appendChild(status);
      box.appendChild(this.compactList(s.result.board.top, s.result.entry, s.result.rank));
      return box;
    }

    const status = make('p', 'submit-status' + (s.phase === 'error' || s.phase === 'final' ? ' bad' : ''), this.message());
    status.id = 'submitStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (s.phase === 'final') {
      box.appendChild(status);
      return box;
    }

    const form = make('form', 'submit-form');
    form.noValidate = true;
    const label = make('label', 'submit-label', t('submit.label'));
    label.htmlFor = 'nameInput';
    const input = make('input', 'name-input');
    input.id = 'nameInput';
    input.name = 'name';
    input.type = 'text';
    input.value = s.name;
    input.placeholder = t('submit.placeholder');
    // Looser than NAME_MAX on purpose: input methods compose in Latin letters that can be
    // longer than the name they produce. The value is clipped to NAME_MAX once committed.
    input.maxLength = NAME_MAX * 3;
    input.setAttribute('autocomplete', 'nickname');
    input.autocapitalize = 'words';
    input.spellcheck = false;
    input.enterKeyHint = 'send';
    input.setAttribute('aria-describedby', 'nameHint');
    input.disabled = s.phase === 'submitting';
    const send = make('button', 'btn btn-primary submit-btn', t(s.phase === 'error' ? 'lb.retry' : 'submit.send'));
    send.type = 'submit';
    send.id = 'submitBtn';
    send.disabled = s.phase === 'submitting' || !sanitizeName(s.name);
    const hint = make('p', 'hint', t('submit.hint'));
    hint.id = 'nameHint';

    let composing = false;
    let composedAt = -1e9;
    const commit = () => {
      const points = Array.from(input.value);
      if (points.length > NAME_MAX) input.value = points.slice(0, NAME_MAX).join('');
      this.submitState.name = input.value;
      send.disabled = !sanitizeName(input.value);
    };
    input.addEventListener('compositionstart', () => {
      composing = true;
    });
    input.addEventListener('compositionend', () => {
      composing = false;
      composedAt = performance.now();
      commit();
    });
    input.addEventListener('input', () => {
      if (composing) this.submitState.name = input.value;
      else commit();
    });
    // The on-screen keyboard covers the lower half of a phone; bring the field back into view.
    input.addEventListener('focus', () => {
      window.setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      // Enter that confirms an input-method candidate is not a request to send.
      if (composing || performance.now() - composedAt < 80) return;
      commit();
      void this.send();
    });

    const fields = make('div', 'submit-fields');
    fields.append(input, send);
    form.append(label, fields, hint, status);
    box.appendChild(form);
    return box;
  }

  private rerenderSubmit(): void {
    if (this.submitInto?.isConnected) this.submitInto.replaceChildren(this.submitBlock());
  }

  private async send(): Promise<void> {
    const name = sanitizeName(this.submitState.name);
    const solve = this.solve;
    if (!name || !solve) return;
    // Flipping the phase before the first await is what makes a double click send once.
    if (this.submitState.phase === 'submitting' || this.submitState.phase === 'done' || this.submitState.phase === 'final') return;
    this.submitState = { gid: solve.gid, phase: 'submitting', name };
    this.click();
    this.rerenderSubmit();
    const r = await this.port.submit(name, solve);
    if (this.submitState.gid !== solve.gid) return;
    if (r.ok) {
      this.submitState = { gid: solve.gid, phase: 'done', name: r.data.entry.name, result: r.data };
      this.cache.set(solve.day, { data: r.data.board, at: Date.now() });
    } else {
      this.submitState = { gid: solve.gid, phase: r.retryable ? 'error' : 'final', name, error: r.error };
    }
    this.rerenderSubmit();
  }

  // ---- Rows ----

  private row(rank: number | null, e: Entry, me: boolean): HTMLLIElement {
    const li = make('li', 'lb-row' + (me ? ' me' : ''));
    if (me) li.setAttribute('aria-current', 'true');
    li.dataset.id = String(e.id);
    li.appendChild(make('span', 'lb-rank', rank === null ? '' : String(rank)));
    const icon = make('span', 'lb-duck');
    if (rank !== null && rank <= 3) icon.appendChild(duckSvg('happy', `duck medal-${rank}`));
    li.appendChild(icon);
    const name = make('span', 'lb-name');
    name.appendChild(make('span', 'lb-name-text', e.name));
    if (me) name.appendChild(make('span', 'lb-you', t('lb.you')));
    li.appendChild(name);
    li.appendChild(make('span', 'lb-score', formatTime(e.ms)));
    return li;
  }

  /** Top few rows, plus the player's own row below a gap when it is further down. */
  private compactList(top: readonly Entry[], own: Entry, ownRank: number): HTMLElement {
    const mine = this.port.mine();
    const list = make('ol', 'lb-list compact');
    const shown = top.slice(0, COMPACT_ROWS);
    shown.forEach((e, i) => list.appendChild(this.row(i + 1, e, e.id === own.id || mine.has(e.id))));
    if (!shown.some((e) => e.id === own.id)) {
      const gap = make('li', 'lb-gap', '⋯');
      gap.setAttribute('aria-hidden', 'true');
      list.appendChild(gap);
      list.appendChild(this.row(ownRank, own, true));
    }
    return list;
  }

  // ---- Day boards ----

  renderBoard(into: HTMLElement, today: string): void {
    this.boardInto = into;
    this.today = today;
    void this.load(false);
  }

  private dayOfTab(): string {
    return this.tab === 0 ? this.today : addDays(this.today, -1);
  }

  private async load(force: boolean): Promise<void> {
    const day = this.dayOfTab();
    const cached = this.cache.get(day);
    if (!force && cached && Date.now() - cached.at < BOARD_FRESH_MS) {
      this.boardPhase = 'ready';
      this.drawBoard();
      return;
    }
    const request = ++this.request;
    this.boardPhase = 'loading';
    this.drawBoard();
    const r = await this.port.day(day);
    if (request !== this.request) return;
    if (r.ok) {
      this.cache.set(day, { data: r.data, at: Date.now() });
      this.boardPhase = 'ready';
    } else this.boardPhase = 'error';
    this.drawBoard();
  }

  private drawBoard(): void {
    const into = this.boardInto;
    if (!into?.isConnected) return;
    const p = make('div', 'lb-panel');
    p.id = 'boardPanel';
    const tabs = make('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [tab, key] of [
      [0, 'lb.tabToday'],
      [1, 'lb.tabYesterday'],
    ] as const) {
      const b = button('tab' + (this.tab === tab ? ' active' : ''), t(key), () => {
        if (this.tab === tab) return;
        this.click();
        this.tab = tab;
        void this.load(false);
      });
      b.id = tab === 0 ? 'tabToday' : 'tabYesterday';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.tab === tab));
      tabs.appendChild(b);
    }
    p.appendChild(tabs);
    const body = make('div', 'lb-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-live', 'polite');
    const data = this.cache.get(this.dayOfTab())?.data;
    if (this.boardPhase === 'loading') body.appendChild(make('p', 'small lb-note', t('lb.loading')));
    else if (this.boardPhase === 'error' || !data) {
      body.appendChild(make('p', 'lb-note bad', t('lb.error')));
      body.appendChild(button('btn', t('lb.retry'), () => void this.load(true), 'lbRetry'));
    } else if (data.top.length === 0) body.appendChild(make('p', 'small lb-note', t('lb.empty')));
    else {
      const mine = this.port.mine();
      const list = make('ol', 'lb-list');
      data.top.forEach((e, i) => list.appendChild(this.row(i + 1, e, mine.has(e.id))));
      body.appendChild(list);
    }
    p.appendChild(body);
    into.replaceChildren(p);
  }
}
