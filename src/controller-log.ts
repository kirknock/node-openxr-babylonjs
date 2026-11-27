/**
 * Controller availability + interaction logging for Babylon's WebXRInput.
 *
 * Two availability lines per controller — input source added (WebXR-level
 * connect) and motion-controller profile resolved (usable: component list,
 * button/axis counts) — plus one on removal. Interaction events use edge
 * detection so the log stays readable at frame rate:
 *
 *   press/release transitions for every component (with the current value)
 *   analog value steps (trigger/squeeze travel, deadband ANALOG_STEP)
 *   thumbstick/trackpad axis changes (deadband AXES_STEP, plus the
 *   return-to-center line)
 *
 * Deliberately NO pose/position/orientation data — that belongs to the
 * pose-debug channels, not to interaction logs.
 */
import type * as Babylon from "@babylonjs/core";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import { forEachController } from "./each-controller.js";

const controllerLog = { info: (message: string): void => console.log(`[controller] ${message}`) };

/** Minimum |Δvalue| between two analog log lines (0..1 scale). */
const ANALOG_STEP = 0.25;
/** Minimum |Δx|+|Δy| between two axes log lines. */
const AXES_STEP = 0.25;
/** Below this axes magnitude the stick counts as centered. */
const AXES_CENTER_EPS = 0.1;

export interface ControllerLog {
  /** "<hand>:<profileId>" per profile-resolved controller, live-updated. */
  readonly controllers: string[];
  /** Detaches every observer installed here. */
  dispose(): void;
}

/**
 * Installs availability + interaction logging on a WebXRInput. Call BEFORE
 * the XR session starts so the first inputsourceschange is caught (same
 * construction-order rule as WebXRInput itself).
 */
export function installControllerLogging(xrInput: Babylon.WebXRInput): ControllerLog {
  const controllers: string[] = [];

  const stop = forEachController(xrInput, (controller) => {
    // Everything observed on this controller, removed with it.
    const removers: Array<() => void> = [];
    const addObs = <T>(obs: Babylon.Observable<T>, cb: (value: T) => void): void => {
      const observer = obs.add(cb);
      removers.push(() => obs.remove(observer));
    };
    const hand = String(controller.inputSource.handedness);
    controllerLog.info(`input source added: ${hand} (resolving motion-controller profile...)`);

    addObs(controller.onMotionControllerInitObservable, (motionController) => {
      const ids = Object.keys(motionController.components);
      const axesCount = controller.inputSource.gamepad?.axes.length ?? 0;
      controllers.push(`${hand}:${motionController.profileId}`);
      controllerLog.info(
        `available: ${hand} (profile ${motionController.profileId}, ` +
          `buttons ${ids.length} [${ids.join(", ")}], axes ${axesCount})`,
      );

      for (const component of Object.values(motionController.components)) {
        // Button: log press/release edges always; analog travel in steps.
        let lastValue = component.value ?? 0;
        let lastPressed = component.pressed ?? false;
        addObs(component.onButtonStateChangedObservable, (changed) => {
          const value = changed.value ?? 0;
          const pressed = changed.pressed ?? false;
          if (pressed !== lastPressed) {
            controllerLog.info(
              `${hand} ${changed.id}: ${pressed ? "PRESSED" : "released"} (value=${value.toFixed(2)})`,
            );
            lastPressed = pressed;
            lastValue = value;
          } else if (Math.abs(value - lastValue) >= ANALOG_STEP) {
            controllerLog.info(`${hand} ${changed.id}: value=${value.toFixed(2)}`);
            lastValue = value;
          }
        });

        // Axes (thumbstick/trackpad components only; never fires otherwise).
        let lastX = 0;
        let lastY = 0;
        let centered = true;
        addObs(component.onAxisValueChangedObservable, (axes) => {
          const { x, y } = axes;
          const offCenter = Math.abs(x) + Math.abs(y) >= AXES_CENTER_EPS;
          if (Math.abs(x - lastX) + Math.abs(y - lastY) >= AXES_STEP || (centered === false && !offCenter)) {
            controllerLog.info(`${hand} ${component.id}: axes x=${x.toFixed(2)} y=${y.toFixed(2)}`);
            lastX = x;
            lastY = y;
          }
          centered = !offCenter;
        });
      }
    });
    return (removed) => {
      for (const remove of removers) remove();
      if (!removed) return;
      const i = controllers.findIndex((entry) => entry.startsWith(`${hand}:`));
      if (i !== -1) controllers.splice(i, 1);
      controllerLog.info(`removed: ${hand}`);
    };
  });

  return { controllers, dispose: stop };
}


/**
 * Logs pointer-selection interaction (the xr-controller-pointer-selection
 * feature maps controller select to scene pointerdown/pointerup on the
 * picked mesh). Mesh names only — no pose data. Returns a stop function.
 */
export function installScenePointerLogging(scene: Babylon.Scene): () => void {
  const observer = scene.onPointerObservable.add((info) => {
    const target = info.pickInfo?.pickedMesh?.name ?? "(nothing)";
    if (info.type === PointerEventTypes.POINTERDOWN) {
      controllerLog.info(`select: ${target}`);
    } else if (info.type === PointerEventTypes.POINTERUP) {
      controllerLog.info(`release: ${target}`);
    }
  });
  return () => scene.onPointerObservable.remove(observer);
}
