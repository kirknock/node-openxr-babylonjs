/**
 * Controller-logging smoke: iwer device -> Babylon WebXRInput (NullEngine,
 * no GL, no OpenXR runtime) -> installControllerLogging.
 *
 * Connects a controller on the emulated device, drives trigger travel,
 * squeeze, and thumbstick through iwer's gamepad API across pumped frames,
 * and asserts:
 *   - availability lines appear (input source added + profile resolved)
 *   - press/release edges and analog steps are logged
 *   - axes changes are logged with deadband behavior
 *   - NO pose/position/orientation data leaks into any controller line
 */
import { installIwerRuntime } from "@kirknock/node-openxr-core/webxr/iwer-runtime.js";
import { createFakeGlContext } from "@kirknock/node-openxr-core/platform/env-shims.js";
import { installControllerLogging } from "../src/controller-log.js";

function fail(msg: string): never {
  console.error(`CONTROLLER-LOG SMOKE: FAIL (${msg})`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Same environment order as the app: iwer shims before Babylon loads.
  const { device, pump } = installIwerRuntime();
  const BABYLON = await import("@babylonjs/core");

  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const sessionManager = new BABYLON.WebXRSessionManager(scene);
  await sessionManager.initializeAsync();

  // WebXRInput/WebXRCamera BEFORE session init (same rule as main.ts):
  // the inputsourceschange listener attaches in onXRSessionInit.
  const xrCamera = new BABYLON.WebXRCamera("xrCam", scene, sessionManager);
  const xrInput = new BABYLON.WebXRInput(sessionManager, xrCamera, {
    disableOnlineControllerRepository: true,
    doNotLoadControllerMeshes: true,
  });
  const log = installControllerLogging(xrInput);

  await sessionManager.initializeSessionAsync("immersive-vr", { optionalFeatures: ["local-floor"] });
  await sessionManager.setReferenceSpaceTypeAsync("local");

  const wxrSession = sessionManager.session;
  const XRWebGLLayerCtor = (globalThis as unknown as {
    XRWebGLLayer: new (s: unknown, c: unknown) => XRWebGLLayer;
  }).XRWebGLLayer;
  void wxrSession.updateRenderState({ baseLayer: new XRWebGLLayerCtor(wxrSession, createFakeGlContext()) });

  // Capture console.log lines produced by the logger.
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  // Interaction script: one device action per pumped frame (iwer commits
  // pending gamepad values when the frame is constructed).
  const left = device.controllers.left;
  if (left === undefined) fail("iwer device has no left controller");
  // The app's driver disconnects idle hands and the phantom 'none' source.
  for (const key of ["left", "right", "none"] as const) {
    const c = device.controllers[key];
    if (c !== undefined) c.connected = false;
  }
  left.connected = true;
  left.position.set(-0.2, 1.4, -0.5); // pose needed for Babylon's frame read

  const actions: Array<() => void> = [
    () => left.updateButtonValue("trigger", 0.55), // travel -> press region
    () => left.updateButtonValue("trigger", 1.0), // full pull (analog step)
    () => left.updateButtonValue("trigger", 0.0), // release
    () => left.updateButtonValue("squeeze", 1.0), // squeeze press
    () => left.updateButtonValue("squeeze", 0.0), // squeeze release
    () => left.updateAxis("thumbstick", "x-axis", 0.8), // flick right
    () => left.updateAxis("thumbstick", "x-axis", 0.0), // center
  ];

  // One action per pumped frame. Motion-controller init resolves on a
  // promise — let microtasks/macrotasks flush between pumps so the profile
  // lands before the next frame.
  const drive = async (script: Array<() => void>): Promise<void> => {
    let step = 0;
    const onFrame: XRFrameRequestCallback = (_time, frame) => {
      sessionManager.currentFrame = frame;
      sessionManager.currentTimestamp = performance.now();
      sessionManager.onXRFrameObservable.notifyObservers(frame);
      if (step < script.length) {
        script[step++]();
        wxrSession.requestAnimationFrame(onFrame);
      }
    };
    wxrSession.requestAnimationFrame(onFrame);
    for (let i = 0; i < script.length + 3; i++) {
      pump.pump();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await drive(actions);

  console.log = origLog;

  const controllerLines = lines.filter((l) => l.startsWith("[controller]"));
  for (const line of controllerLines) origLog(line);

  const has = (pred: (l: string) => boolean): boolean => controllerLines.some(pred);
  if (!has((l) => l.includes("input source added: left"))) fail("missing 'input source added' line");
  if (!has((l) => /^.controller. available: left \(profile generic-trigger/.test(l) || l.includes("available: left (profile"))) {
    fail("missing 'available' line with profile");
  }
  if (!has((l) => l.includes("trigger") && l.includes("PRESSED"))) fail("missing trigger PRESSED line");
  if (!has((l) => l.includes("trigger") && l.includes("released"))) fail("missing trigger released line");
  if (!has((l) => l.includes("squeeze") && l.includes("PRESSED"))) fail("missing squeeze PRESSED line");
  if (!has((l) => l.includes("thumbstick") && l.includes("axes"))) fail("missing thumbstick axes line");
  if (controllerLines.some((l) => /pos(e|ition)|orientation|quat|x=-?0\.\d+, ?y=1\./.test(l))) {
    fail("pose/position data leaked into controller log lines");
  }

  // dispose() detaches everything, each component's observers included, and
  // does not report the still-connected controller as removed.
  log.dispose();
  lines.length = 0;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  await drive([() => left.updateButtonValue("trigger", 1.0), () => left.updateButtonValue("trigger", 0.0)]);
  console.log = origLog;
  const afterDispose = lines.filter((l) => l.startsWith("[controller]"));
  if (afterDispose.length > 0) fail(`controller lines after dispose(): ${afterDispose.join(" | ")}`);

  sessionManager.dispose();
  console.log("CONTROLLER-LOG SMOKE: PASS");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("CONTROLLER-LOG SMOKE: ERROR", err);
  process.exit(1);
});
