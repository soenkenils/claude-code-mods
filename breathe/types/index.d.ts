// `finishAt` is null while Claude is working; once the turn is over it is the moment the
// breath in progress ends on an exhale, and the animation goes when the clock gets there.
export type BreatheRun = { startedAt: number; finishAt: number | null };

declare module "claude-code" {
  interface PluginState {
    breathe: {
      // What is being shown, or null: nothing to draw.
      run: Shaped<BreatheRun | null>;
      // The last frame's time. Writing it is what redraws the band.
      now: number;
      isMuted: boolean;
    };
  }
}
