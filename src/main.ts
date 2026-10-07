import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-600.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { Progress } from './game/progress.ts';
import { detectLang, setLang, type Lang } from './i18n';
import { createClient, loadName, myEntries, rememberEntry, saveName, scoresUrl } from './net/leaderboard.ts';
import { App } from './ui/app.ts';
import { iconSvg, installDuckSymbols } from './ui/duckArt.ts';
import { bindTranslations } from './ui/i18nDom.ts';
import { bindLangSelect } from './ui/langSelect.ts';
import { LeaderboardUi, type LeaderboardPort } from './ui/leaderboardUi.ts';
import { audio } from './audio/context';
import { sfx } from './audio/sfx.ts';
import { API_VERSION } from '../shared/scoreRules.ts';

setLang(detectLang(), false);
bindTranslations();
bindLangSelect();
installDuckSymbols();

const params = new URLSearchParams(location.search);
const testMode = params.has('test');
const progress = new Progress();
const scores = createClient({ baseUrl: scoresUrl() });

let app: App | null = null;

/** Null when no scores API was configured at build time: the leaderboard UI then stays hidden. */
const port: LeaderboardPort | null = scores.enabled
  ? {
      async submit(name, solve) {
        saveName(name);
        const r = await scores.submit({ v: API_VERSION, gid: solve.gid, day: solve.day, name, ms: solve.ms, cols: solve.cols });
        if (r.ok) {
          rememberEntry(r.data.entry.id);
          app?.noteServerTime(r.data.board.now);
        }
        return r;
      },
      async day(day) {
        const r = await scores.fetchDay(day);
        if (r.ok) app?.noteServerTime(r.data.now);
        return r;
      },
      lastName: () => loadName(),
      mine: () => myEntries(),
    }
  : null;

app = new App({
  progress,
  leaderboard: port ? { port, ui: new LeaderboardUi(port, () => sfx.click()) } : null,
  testMode,
});
app.start();

if (import.meta.env.PROD) registerSW({ immediate: true });

declare global {
  interface Window {
    __game?: Record<string, unknown>;
  }
}

window.__game = {
  state: () => app?.debugState(),
  solution: () => app?.debugSolution(),
  cellCenter: (i: number) => app?.debugCellCenter(i),
  setLang: (l: Lang) => setLang(l),
  iconSvg: (size: number, padded: boolean) => iconSvg(size, padded),
  leaderboard: { enabled: scores.enabled, url: scoresUrl() },
  progress,
  audio,
};
