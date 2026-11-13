import type { EngineInterface, On, RenderInput } from "claude-code";
import { expect, mock, type Engine } from "claude-code/testing";

export const SURFACES = ["terminal", "desktop"] as const;
export type Surface = (typeof SURFACES)[number];

// The band waits `startAfterSeconds` (3 by default) and then counts down before the breath. Most
// tests are about the breath itself, so they skip both; the wait and the countdown have tests of their own.
export const noWait = (options: Record<string, number | string | boolean> = {}) => ({ options: { startAfterSeconds: 0, ...options } });
export const noCountdown = (options: Record<string, number | string | boolean> = {}) => noWait({ countdownSeconds: 0, ...options });

export const DE = { in: "Einatmen", hold: "Halten", out: "Ausatmen" };
export const EN = { in: "Breathe in", hold: "Hold", out: "Breathe out" };
export const DONE = "Claude ist fertig · atme zu Ende aus";

// What sits beneath the plugin in a session: the engine's own answers. `below` is another
// mod's band, drawn beneath this one; by default nothing is.
export function core(on: On, below?: ($: EngineInterface, e: RenderInput) => unknown) {
  const clock = mock.clock(on);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => (below ? below($, e) : { type: "engine", ref: 0 }) as never);
  return clock;
}

export const start = ($: Engine) => $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
export const beginTurn = ($: Engine, agentId?: string) => $.turn.start({ text: "go", turnId: agentId ?? "main", ...(agentId ? { agentId } : {}) });
export const endTurn = ($: Engine, agentId?: string, reason: "answer" | "aborted" = "answer") =>
  $.turn.complete({ answer: "", durationMs: 1, isAborted: reason === "aborted", turnId: agentId ?? "main", reason, ...(agentId ? { agentId } : {}) });
export const slash = ($: Engine, args = "") =>
  $.command.run({ command: "breathe", args, origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 100 } });

export type Props = { bodyColumns?: number; maxRows?: number; hasSurvey?: boolean };
export function band($: Engine, surface: Surface, props: Props = {}) {
  return $.ui.mount({
    plugin: "breathe",
    surface,
    component: "AbovePrompt",
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isCollapsed: false,
      isWorking: true,
      maxRows: props.maxRows ?? 10,
      bodyColumns: props.bodyColumns ?? 100,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  });
}
export type Band = Awaited<ReturnType<typeof band>>;

// The host's own text. On the desktop the phase's word is in the picture, not here.
export async function words($: Engine, surface: Surface, props?: Props) {
  const ui = await band($, surface, props);
  const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");
  await ui.unmount();
  return texts;
}

export const ENGINE = { type: "engine", ref: 0 };
// The engine's own node: nothing of the mod's is drawn. Its `ref` is the engine's business and
// differs between versions (0 in 2.1.312, 2 in 2.1.323), so only the type is compared.
export const isEngine = async (ui: Band) => expect(await ui.drawn()).toMatchObject({ type: "engine" });
export const isShown = async (ui: Band) => expect(await ui.drawn()).not.toMatchObject({ type: "engine" });
export const hide = (ui: Band) => ui.find({ type: "Button", key: "hide" });

// The desktop's picture, as the surface gets it.
export const pictureOf = async (ui: Band) => (await ui.findAll({ type: "Svg" }))[0];
export const sourceOf = async (ui: Band) => String((await pictureOf(ui))?.props.source);
export const sourceNow = async ($: Engine) => {
  const ui = await band($, "desktop");
  const source = await sourceOf(ui);
  await ui.unmount();
  return source;
};
// When the picture's first breath begins, in seconds from when it was drawn.
export const breathBegin = (source: string) => /dur="[\d.]+s" begin="(-?[\d.]+)s" repeatCount="indefinite"/.exec(source)?.[1];
// The picture's fades: [from, to, dur, begin].
export const fadesOf = (source: string) =>
  [...source.matchAll(/<animate attributeName="opacity" from="(\d)" to="(\d)" dur="([\d.]+)s" begin="([\d.]+)s" fill="freeze"\/>/g)].map((m) => m.slice(1, 5));

export const READY = { de: "Mach dich bereit", en: "Get ready" };
export const numberIn = (texts: string[]) => texts.map((t) => /^\s*(\d+)$/.exec(t)?.[1]).find((n) => n !== undefined);
