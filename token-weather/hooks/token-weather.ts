// Token Weather: a live forecast of the context window, above the prompt.

import type { On } from "claude-code";
import type { TokenWeatherReading as Reading } from "../types";

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const FORECAST = [
  { upTo: 25, icon: "☀", word: "Clear", color: "yellow" },
  { upTo: 50, icon: "☁", word: "Cloudy", color: "cyan" },
  { upTo: 75, icon: "☂", word: "Showers", color: "blue" },
  { upTo: 90, icon: "☇", word: "Storm", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "Compact soon", color: "red" },
] as const;

// Held by the host, so the history survives a hot reload of this file.
const readings = { plugin: "token-weather", key: "readings" } as const;

export function register(on: On) {
  // Fires after each main-thread turn (never a subagent's) with the usage figures.
  on("session.measure", async ($, e, next) => {
    const { tokens, window, percent } = e.context;
    if (e.changed.includes("context") && tokens !== undefined) {
      const reading = { tokens, window, percent: percent ?? Math.round((tokens / window) * 100) };
      const { value: history = [] } = await $.state.get(readings);
      await $.state.set(readings, [...history, reading].slice(-HISTORY));
    }
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { value: history = [] } = await $.state.get(readings);
    const now = history.at(-1);
    if (e.props.hasSurvey || !now) {
      return next(e);
    }
    const { Text, Box } = $.ui.resolve(e);
    // The last tier's upTo is Infinity, so find() always matches.
    const f = FORECAST.find((b) => now.percent < b.upTo)!;
    const parts = [
      Text({ color: f.color, bold: true, children: `${f.icon}  ${f.word}` }),
      Text({ children: `  ${now.percent}% of context` }),
      Text({ dimColor: true, children: `  ${short(now.tokens)} / ${short(now.window)}` }),
    ];
    if (e.props.bodyColumns >= 60) {
      parts.push(Text({ dimColor: true, children: "   last turns " }));
      parts.push(Text({ color: f.color, children: sparkline(history) }));
      const prev = history.at(-2);
      if (prev) {
        parts.push(Text({ dimColor: true, children: trend(prev, now) }));
      }
    }
    return Box({ flexDirection: "row", paddingX: 1, children: parts });
  });
}

function sparkline(history: Reading[]) {
  const top = Math.max(...history.map((r) => r.tokens), 1);
  return history.map((r) => BARS[Math.floor((r.tokens / top) * (BARS.length - 1))]).join("");
}

function trend(prev: Reading, now: Reading) {
  const delta = now.tokens - prev.tokens;
  if (delta === 0) return "  steady";
  return delta > 0 ? `  ▲ +${short(delta)} last turn` : `  ▼ ${short(-delta)} last turn`;
}

function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
