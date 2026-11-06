// `finishAt` is null while Claude is working; once the turn is over it is the moment the
// breath in progress ends on an exhale, and the animation goes when the clock gets there.
// `isHiding` is for the Hide button: the picture fades out until `finishAt`, a moment away,
// and the rest of the breath is dropped.
export type BreatheRun = { startedAt: number; finishAt: number | null; isHiding: boolean };

declare module "claude-code" {
  interface PluginState {
    breathe: {
      // What is being shown, or null: nothing to draw.
      run: Shaped<BreatheRun | null>;
      isMuted: boolean;
    };
  }
}
