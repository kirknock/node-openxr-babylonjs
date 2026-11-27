/**
 * Per-controller setup with matching teardown, for helpers that attach
 * something to every controller of a WebXRInput.
 */
import type * as Babylon from "@babylonjs/core";

/**
 * Calls `attach` for every controller, present now or added later. What it
 * returns runs when that controller is removed (`removed` true), or when the
 * returned function is called (false; this also stops watching for new
 * controllers).
 */
export function forEachController(
  xrInput: Babylon.WebXRInput,
  attach: (controller: Babylon.WebXRInputSource) => ((removed: boolean) => void) | void,
): () => void {
  const detachers = new Map<Babylon.WebXRInputSource, (removed: boolean) => void>();
  const add = (controller: Babylon.WebXRInputSource): void => {
    const detacher = attach(controller);
    if (detacher !== undefined) detachers.set(controller, detacher);
  };
  const detach = (controller: Babylon.WebXRInputSource, removed: boolean): void => {
    detachers.get(controller)?.(removed);
    detachers.delete(controller);
  };
  const added = xrInput.onControllerAddedObservable.add(add);
  const removed = xrInput.onControllerRemovedObservable.add((controller) => detach(controller, true));
  for (const controller of xrInput.controllers) add(controller);
  return () => {
    xrInput.onControllerAddedObservable.remove(added);
    xrInput.onControllerRemovedObservable.remove(removed);
    for (const controller of [...detachers.keys()]) detach(controller, false);
  };
}
