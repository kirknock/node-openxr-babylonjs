/** Creates the app's engine for the chosen renderer (plain Babylon.js; also valid in a browser). */
import { Engine, WebGPUEngine, type AbstractEngine } from "@babylonjs/core";

export type Renderer = "webgl2" | "webgpu";

/** The canvas type Babylon's Engine accepts (a browser HTMLCanvasElement). */
export type Canvas = ConstructorParameters<typeof Engine>[0];

export async function createEngine(canvas: Canvas, renderer: Renderer): Promise<AbstractEngine> {
  if (renderer === "webgl2") return new Engine(canvas, false, { stencil: true });
  const engine = new WebGPUEngine(canvas as HTMLCanvasElement, { stencil: true, xrCompatible: true });
  await engine.initAsync();
  return engine;
}
