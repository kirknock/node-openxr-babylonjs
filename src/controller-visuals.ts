/**
 * Procedural controller visuals — a small lit handle per hand.
 *
 * Babylon's real vendor controller models come from the online controller
 * repository (network), which the headless app deliberately avoids; without
 * it loadModel() simply rejects and controllers are invisible. This gives
 * immediate in-headset presence with zero network and zero exotic-shader
 * risk: a wand along the grip axis, blue for the left hand, orange for the
 * right. The pointer-selection laser remains the interaction indicator.
 *
 * The meshes are parented to the controller's grip node (pointer node as
 * fallback), so they follow the tracked pose and are disposed with the
 * controller. They render like any other scene mesh.
 */
import type * as Babylon from "@babylonjs/core";
import { forEachController } from "./each-controller.js";

const controllerLog = { info: (message: string): void => console.log(`[controller] ${message}`) };

export interface ControllerVisuals {
  /** Removes the visuals and every observer installed here. */
  dispose(): void;
}

/** Diffuse/emissive tint per handedness — instant left/right identification. */
const HAND_TINT: Record<string, [number, number, number]> = {
  left: [0.1, 0.3, 0.9],
  right: [0.95, 0.35, 0.1],
};

/**
 * Attaches visuals to every controller that connects. Call any time after
 * WebXRInput construction.
 */
export function attachControllerVisuals(
  BABYLON: typeof import("@babylonjs/core"),
  xrInput: Babylon.WebXRInput,
): ControllerVisuals {
  const stop = forEachController(xrInput, (controller) => {
    // Meshes die with the controller's grip node; the material does not.
    let visual: { root: Babylon.TransformNode; material: Babylon.Material } | null = null;
    const onInit = controller.onMotionControllerInitObservable.add(() => {
      const anchor = controller.grip ?? controller.pointer;
      if (anchor === undefined || anchor === null) return;
      const scene = anchor.getScene();
      const hand = String(controller.inputSource.handedness);
      const [r, g, b] = HAND_TINT[hand] ?? [0.45, 0.45, 0.45];

      const mat = new BABYLON.StandardMaterial(`${hand}ControllerVisualMat`, scene);
      mat.diffuseColor = new BABYLON.Color3(r, g, b);
      mat.emissiveColor = new BABYLON.Color3(r * 0.35, g * 0.35, b * 0.35);

      const root = new BABYLON.TransformNode(`${hand}ControllerVisual`, scene);
      root.parent = anchor;
      visual = { root, material: mat };

      // Cylinders are Y-up; lay the wand along the grip's local +Z (Babylon
      // LH forward). Sizes in metres. NOTE: all parts must stay
      // non-pickable — they sit directly in the pointer ray's path and
      // would otherwise swallow every selection (the laser does the same).
      const layAlongZ = BABYLON.Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
      const handle = BABYLON.MeshBuilder.CreateCylinder(
        `${hand}ControllerHandle`,
        { height: 0.1, diameter: 0.028, tessellation: 12 },
        scene,
      );
      handle.rotationQuaternion = layAlongZ;
      handle.position.z = -0.03; // wand reaches back into the palm
      handle.material = mat;
      handle.isPickable = false;
      handle.parent = root;

      const tip = BABYLON.MeshBuilder.CreateCylinder(
        `${hand}ControllerTip`,
        { height: 0.022, diameterTop: 0.036, diameterBottom: 0.028, tessellation: 12 },
        scene,
      );
      tip.rotationQuaternion = layAlongZ;
      tip.position.z = 0.028;
      tip.material = mat;
      tip.isPickable = false;
      tip.parent = root;

      const ring = BABYLON.MeshBuilder.CreateTorus(
        `${hand}ControllerRing`,
        { diameter: 0.034, thickness: 0.006, tessellation: 16 },
        scene,
      );
      ring.position.z = 0.038;
      ring.material = mat;
      ring.isPickable = false;
      ring.parent = root;

      controllerLog.info(`visuals attached: ${hand}`);
    });
    return () => {
      controller.onMotionControllerInitObservable.remove(onInit);
      if (visual !== null && !visual.root.isDisposed()) visual.root.dispose();
      visual?.material.dispose();
    };
  });

  return { dispose: stop };
}
