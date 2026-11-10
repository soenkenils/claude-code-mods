// `finishAt` is null while Claude is working; once the turn is over it is the moment the
// breath in progress ends on an exhale, and the animation goes when the clock gets there.
// `isHiding` is for the Hide button: the picture fades out until `finishAt`, a moment away,
// and the rest of the breath is dropped. `pattern` is the pattern this run breathes, fixed when
// the run begins, so a `/breathe calm` in between changes the next run and not this one.
export type BreatheRun = { startedAt: number; finishAt: number | null; isHiding: boolean; pattern: string };

declare module "claude-code" {
  interface PluginState {
    breathe: {
      // What is being shown, or null: nothing to draw.
      run: Shaped<BreatheRun | null>;
      isMuted: boolean;
      // True while Claude's question (the AskUserQuestion tool) waits for an answer: the band
      // steps aside for it.
      isAsked: boolean;
      // The pattern `/breathe box|even|calm` chose for this session, or null: the setting's.
      pattern: string | null;
    };
  }
}
