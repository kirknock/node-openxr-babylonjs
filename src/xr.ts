/**
 * The app's WebXR setup, plain Babylon.js: the default experience (input,
 * pointer selection, teleportation), procedural controller visuals and
 * interaction logging. Enters immersive-ar when the device offers it
 * (see-through headsets), otherwise immersive-vr — the usual browser
 * pattern.
 */
import * as BABYLON from "@babylonjs/core";
import type { Mesh, Scene, WebXRDefaultExperience } from "@babylonjs/core";
// Side-effect import: registers the WebXR Layers feature (Babylon 9 keeps the index pure).
import "@babylonjs/core/XR/features/WebXRLayers.js";
// What went wrong: "TypeError: Cannot read properties of undefined (reading 'r')"
// in InputBlock._transmit, which stopped Babylon's render loop, when the user
// walked through a pane.
//  1. Trigger: a movable pane's meshes are near-grabbable (SixDofDragBehavior).
//     When the point just ahead of a controller gets within 10 cm of one, Babylon
//     shows its near-interaction orb, a small sphere at the controller.
//  2. Bug: the orb's NodeMaterial loads its colours by looking up "BABYLON.Color3"
//     by name. In Babylon 9.33.2, importing @babylonjs/core does not register the
//     math classes, so the lookup fails silently and edgeColor and fillColor stay
//     undefined.
//  3. Crash: the first draw of the orb reads .r from the undefined colour. The orb
//     is hidden until something comes that close, so this only shows up then.
// The fix: these side-effect imports register the classes. The vector one covers
// the same gap for Vector2/3/4 and Matrix. smoke:near-interaction covers it.
import "@babylonjs/core/Maths/math.color.js";
import "@babylonjs/core/Maths/math.vector.js";

import { attachControllerVisuals } from "./controller-visuals.js";
import { installControllerLogging, installScenePointerLogging } from "./controller-log.js";

export interface AppXr {
  xr: WebXRDefaultExperience;
  sessionMode: XRSessionMode;
  /** Connected controllers (handedness:profile), for the run summary. */
  controllers(): string[];
}

export async function setupXr(scene: Scene, floor: Mesh): Promise<AppXr> {
  const xr = await BABYLON.WebXRDefaultExperience.CreateAsync(scene, {
    floorMeshes: [floor],
    disableDefaultUI: true,
    // No network for controller models: resolve profiles locally and draw
    // our own wands (controller-visuals.ts).
    inputOptions: { disableOnlineControllerRepository: true, doNotLoadControllerMeshes: true },
    // Keep the landing ring on the floor (the stock one bobs up to 0.4 m).
    teleportationOptions: { defaultTargetMeshOptions: { disableAnimation: true } },
    // A laser on each hand, so each can point at its own pane (pane-controller-input.ts).
    pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true },
  });
  const controllerLog = installControllerLogging(xr.input);
  attachControllerVisuals(BABYLON, xr.input);
  installScenePointerLogging(scene);
  xr.baseExperience.camera.onAfterCameraTeleport.add((p) => {
    console.log(`[teleport] camera -> (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  });

  const sessionMode: XRSessionMode = (await navigator.xr?.isSessionSupported("immersive-ar")) === true ? "immersive-ar" : "immersive-vr";
  // Babylon's WebGPU XR path is layers-only.
  if (scene.getEngine().isWebGPU) xr.baseExperience.featuresManager.enableFeature(BABYLON.WebXRFeatureName.LAYERS, "latest");
  await xr.baseExperience.enterXRAsync(sessionMode, "local-floor");
  console.log(`[main] entered ${sessionMode} (local-floor)`);
  return { xr, sessionMode, controllers: () => controllerLog.controllers };
}
