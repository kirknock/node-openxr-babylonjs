/**
 * A slideshow of a folder's *.glb assets (plain Babylon.js): each is shown
 * for a while, then the next takes its place in one frame. The next asset
 * loads while the current one is still on show, from halfway through its
 * time, so the stage is never empty, a slow load only keeps the current asset
 * up longer, and the load's work is not added to the frames around a swap, the
 * ones a user sees stutter most. Two assets are in memory during that time. The
 * previous asset is hidden in the swap's frame and freed over the next frames.
 * One asset alone just stays up.
 *
 * Each swap logs the longest gap between frames during each phase of bringing
 * that asset in, so a run on the target shows which one stutters.
 */
import { type Scene, type TransformNode } from "@babylonjs/core";
import { listFiles } from "./list-files.js";
import { loadAsset, type AssetPlacement, type LoadedAsset, type LoadPhase } from "./load-asset.js";

/** Frames the phase "show" covers: the new asset's first ones, before the old one is freed. */
const SHOW_FRAMES = 2;

export type SwapPhase = LoadPhase | "warm-up" | "wait" | "show" | "dispose" | "after";
/** Longest gap between frames, in ms, per phase; a phase no frame fell in is absent. */
export type FrameGaps = Partial<Record<SwapPhase, number>>;

export interface SlideshowOptions {
  placement: Omit<AssetPlacement, "hidden">;
  showSeconds: number;
  /** Called with each asset's root as it goes on show. */
  onShow(root: TransformNode): void;
  /** Called with the frame gaps of bringing each asset in, once its predecessor is freed. */
  onSwapMeasured?(url: string, gaps: FrameGaps): void;
}

/**
 * Lists the folder's *.glb files once, then shows them in turn, forever.
 * Assets that fail to load are skipped; stops when the scene is disposed or
 * when every file in a row failed.
 */
export async function showAssetsInLoop(scene: Scene, folder: string, options: SlideshowOptions): Promise<void> {
  const urls = await listFiles(folder, ".glb");
  console.log(`[assets] ${urls.length} .glb file(s) under ${folder}`);
  if (urls.length === 0) return;
  let current: LoadedAsset | null = null;
  let shownUrl: string | null = null;
  let loadFrom = 0;
  let showUntil = 0;
  let failures = 0;
  const gaps = new FrameGapWatch(scene);
  // A load in flight may never settle once its scene is gone.
  const disposed = new Promise<null>((resolve) => scene.onDisposeObservable.addOnce(() => resolve(null)));
  for (let i = 0; !scene.isDisposed; i = (i + 1) % urls.length) {
    gaps.phase = "after";
    await sceneDelay(scene, Math.max(0, loadFrom - performance.now()));
    if (scene.isDisposed) return;
    if (shownUrl !== null) {
      const report = gaps.takeReport(shownUrl); // logs it, with or without a listener
      options.onSwapMeasured?.(shownUrl, report);
    }
    shownUrl = null;
    const next = await Promise.race([disposed, loadHidden(scene, urls[i], options.placement, gaps)]);
    if (scene.isDisposed) return;
    if (next === null) {
      if (++failures < urls.length) continue;
      console.warn("[assets] no asset could be loaded — slideshow stopped");
      return;
    }
    failures = 0;
    gaps.phase = "warm-up";
    await Promise.race([disposed, next.warmUp()]);
    gaps.phase = "wait";
    await sceneDelay(scene, Math.max(0, showUntil - performance.now()));
    if (scene.isDisposed) return;
    gaps.phase = "show";
    next.root.setEnabled(true);
    current?.root.setEnabled(false);
    options.onShow(next.root);
    const previous = current;
    current = next;
    shownUrl = urls[i];
    const now = performance.now();
    loadFrom = now + (options.showSeconds * 1000) / 2;
    showUntil = now + options.showSeconds * 1000;
    if (urls.length === 1) return;
    await Promise.race([disposed, gaps.frames(SHOW_FRAMES)]);
    if (scene.isDisposed) return;
    gaps.phase = "dispose";
    await previous?.disposeGradually();
  }
}

/** The longest gap between frames while each phase was on; see the file's header. */
class FrameGapWatch {
  phase: SwapPhase = "load";
  private gaps: FrameGaps = {};
  private lastFrame = 0;

  constructor(private readonly scene: Scene) {
    scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      if (this.lastFrame !== 0) this.gaps[this.phase] = Math.max(this.gaps[this.phase] ?? 0, now - this.lastFrame);
      this.lastFrame = now;
    });
  }

  /** Resolves after `count` more frames. */
  async frames(count: number): Promise<void> {
    for (let i = 0; i < count; i++) await new Promise((resolve) => this.scene.onAfterRenderObservable.addOnce(resolve));
  }

  takeReport(url: string): FrameGaps {
    const report = this.gaps;
    this.gaps = {};
    const parts = Object.entries(report).map(([phase, ms]) => `${phase} ${ms.toFixed(1)}`);
    if (parts.length > 0) console.log(`[render] longest frame gap bringing in ${url}, ms: ${parts.join(", ")}`);
    return report;
  }
}

async function loadHidden(scene: Scene, url: string, placement: SlideshowOptions["placement"], gaps: FrameGapWatch): Promise<LoadedAsset | null> {
  try {
    return await loadAsset(scene, url, { ...placement, hidden: true }, (phase) => {
      gaps.phase = phase;
    });
  } catch (err) {
    console.warn(`[assets] skipping ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Resolves after `ms`, or as soon as the scene is disposed. */
function sceneDelay(scene: Scene, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      scene.onDisposeObservable.remove(observer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const observer = scene.onDisposeObservable.addOnce(done);
  });
}
