// Token Weather: a live forecast of the context window, above the prompt.
//
// One module, two drawings. The terminal gets monospaced text: single-cell
// weather glyphs, a gauge of box-drawing cells and a block-glyph sparkline.
// Claude Desktop gets the same facts in proportional type, with emoji for the
// weather and two small vector graphics, since block glyphs in a proportional
// face never line up.

import type { On } from "claude-code";
import type { TokenWeatherReading as Reading } from "../types";

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const GAP = 2;

// `icon` is one cell wide, for a terminal's grid; `emoji` is for a surface that
// draws proportional text. `color` is a theme key, so the text follows the
// person's theme, light or dark, on either surface. `hex` is for the Svg, which
// a surface draws as an image and cannot theme: mid-tones that read on a light
// and a dark page.
const FORECAST = [
  { upTo: 25, icon: "☀", emoji: "☀️", word: "Clear", color: "success", hex: "#3fae6a" },
  { upTo: 50, icon: "☁", emoji: "☁️", word: "Cloudy", color: "suggestion", hex: "#5b8def" },
  { upTo: 75, icon: "☂", emoji: "🌧️", word: "Showers", color: "warning", hex: "#d9a21f" },
  { upTo: 90, icon: "☇", emoji: "⛈️", word: "Storm", color: "claude", hex: "#e07a4f" },
  { upTo: Infinity, icon: "↯", emoji: "🌪️", word: "Compact soon", color: "error", hex: "#d94a45" },
] as const;

// Held by the host, so the history survives a hot reload of this file.
const readings = { plugin: "token-weather", key: "readings" } as const;

// One piece of the band. `width` is its size in cells; `priority` says what
// stays when the room is short, lowest first (0 always stays).
type Part = { priority: number; width: number; node: JSX.Element };

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
    const columns = e.props.bodyColumns - 2; // the Box's paddingX

    // The two parts that differ by surface.
    let gauge: Part;
    let spark: Part | null = null;
    if (e.surface === "terminal") {
      const width = gaugeWidth(columns);
      const filled = filledCells(now.percent, width);
      gauge = {
        priority: 1,
        width,
        node: (
          <Text>
            <Text color={f.color}>{"━".repeat(filled)}</Text>
            <Text dimColor>{"─".repeat(width - filled)}</Text>
          </Text>
        ),
      };
      if (history.length > 1) {
        const bars = sparkline(history);
        spark = { priority: 5, width: len(bars), node: <Text color={f.color}>{bars}</Text> };
      }
    } else {
      const { Svg } = $.ui.resolve(e);
      gauge = {
        priority: 1,
        width: 14,
        node: <Svg source={gaugeSvg(now.percent, f.hex)} alt={`Context ${now.percent}% full`} />,
      };
      if (history.length > 1) {
        spark = {
          priority: 5,
          width: 12,
          node: <Svg source={sparkSvg(history, f.hex)} alt={`Context size over the last ${history.length} turns`} />,
        };
      }
    }

    const head = e.surface === "terminal" ? `${f.icon}  ${f.word}` : `${f.emoji} ${f.word}`;
    const share = columns >= 96 ? `${now.percent}% of context` : `${now.percent}%`;
    const tokens = `${short(now.tokens)} / ${short(now.window)}`;
    const hint = now.percent >= 90 ? "try /compact" : null;
    const change = trend(history);

    // In drawing order, left to right.
    const parts: (Part | null)[] = [
      { priority: 0, width: len(head), node: <Text color={f.color} weight="semibold">{head}</Text> },
      gauge,
      { priority: 0, width: len(share), node: <Text weight="semibold" tabular>{share}</Text> },
      hint && { priority: 2, width: len(hint), node: <Text color="warning">{hint}</Text> },
      { priority: 3, width: len(tokens), node: <Text dimColor tabular>{tokens}</Text> },
      spark,
      change && {
        priority: 4,
        width: len(change.text),
        node: change.isDrop ? <Text color="success" tabular>{change.text}</Text> : <Text dimColor tabular>{change.text}</Text>,
      },
    ];

    return (
      <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={GAP} paddingX={1}>
        {fit(parts.filter((p): p is Part => p !== null), columns).map((p) => p.node)}
      </Box>
    );
  });
}

// Keeps what fits in `columns`, most important first; returns it in drawing order.
function fit(parts: Part[], columns: number) {
  const kept = new Set<Part>();
  let used = 0;
  for (const part of [...parts].sort((a, b) => a.priority - b.priority)) {
    const needs = used + part.width + (kept.size > 0 ? GAP : 0);
    if (part.priority === 0 || needs <= columns) {
      kept.add(part);
      used = needs;
    }
  }
  return parts.filter((p) => kept.has(p));
}

// Code points: exact on the terminal, close enough on a surface that sizes its own type.
const len = (s: string) => [...s].length;

// About a sixth of the room, so the gauge grows with the terminal but never swamps the line.
function gaugeWidth(columns: number) {
  return Math.min(24, Math.max(8, Math.round(columns / 6)));
}

// Any use at all shows at least one cell, and a full window shows them all.
function filledCells(percent: number, cells: number) {
  if (percent <= 0) return 0;
  return Math.min(cells, Math.max(1, Math.round((percent / 100) * cells)));
}

function sparkline(history: Reading[]) {
  const top = Math.max(...history.map((r) => r.tokens), 1);
  return history.map((r) => BARS[Math.floor((r.tokens / top) * (BARS.length - 1))]).join("");
}

// A drop means the context was compacted or cleared, which is good news.
function trend(history: Reading[]) {
  const now = history.at(-1);
  const prev = history.at(-2);
  if (!now || !prev) return null;
  const delta = now.tokens - prev.tokens;
  if (delta === 0) return { text: "steady", isDrop: false };
  return delta > 0
    ? { text: `▲ +${short(delta)} last turn`, isDrop: false }
    : { text: `▼ ${short(-delta)} last turn`, isDrop: true };
}

function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// A rounded bar on a translucent track, which reads on a light and a dark page.
function gaugeSvg(percent: number, hex: string) {
  const w = 120;
  const fill = percent <= 0 ? 0 : Math.min(w, Math.max(8, (percent / 100) * w));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 8" width="${w}" height="8">`,
    `<rect width="${w}" height="8" rx="4" fill="rgba(128,128,128,0.28)"/>`,
    fill > 0 ? `<rect width="${+fill.toFixed(1)}" height="8" rx="4" fill="${hex}"/>` : "",
    `</svg>`,
  ].join("");
}

// One bar per turn, scaled to the largest; the newest is solid, the rest faded.
function sparkSvg(history: Reading[], hex: string) {
  const top = Math.max(...history.map((r) => r.tokens), 1);
  const barW = 5;
  const step = 8;
  const h = 20;
  const bars = history.map((r, i) => {
    const barH = Math.max(2, Math.round((r.tokens / top) * h));
    const isNewest = i === history.length - 1;
    return `<rect x="${i * step}" y="${h - barH}" width="${barW}" height="${barH}" rx="1.5" fill="${hex}" opacity="${isNewest ? 1 : 0.45}"/>`;
  });
  const w = (history.length - 1) * step + barW;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bars.join("")}</svg>`;
}
