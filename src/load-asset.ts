/**
 * Loads a GLB/glTF asset by URL (plain Babylon.js; relative URLs resolve
 * against the page location), scales it to a target height and places its
 * bounds centre at a given point — under a pivot, so rotating the returned
 * root turns the asset in place. Its shaders are compiled before it resolves,
 * and a hidden asset can draw each of its meshes once before it shows (warmUp),
 * so the asset's first visible frame costs no more than any other.
 * dispose() removes it from the scene and frees everything it loaded (meshes,
 * materials, textures, animations); disposeGradually() does so over many frames.
 */
import { LoadAssetContainerAsync, Mesh, TransformNode, Vector3, type AbstractMesh, type Scene } from "@babylonjs/core";
// Side-effect import: registers the glTF 2.0 SceneLoader plugin.
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
// Side-effect import: registers every glTF 2.0 extension Babylon ships
// (KHR_materials_unlit, _pbrSpecularGlossiness, …). Extensions are opt-in
// modules in @babylonjs/loaders 8 and an unregistered REQUIRED extension
// makes the whole load throw "not available"; importing them statically also
// avoids the lazy per-extension import() path.
import "@babylonjs/loaders/glTF/2.0/Extensions/index.js";
import type { GLTFLoader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import type { IGLTFLoaderExtension } from "@babylonjs/loaders/glTF/2.0/glTFLoaderExtension.js";
import { registerGLTFExtension, unregisterGLTFExtension } from "@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry.js";

// Except KHR_interactivity: it runs the asset's behaviour graph, which this
// viewer has no use for and which can throw outside the load promise on
// graphs Babylon does not fully support. Assets list it as optional.
unregisterGLTFExtension("KHR_interactivity");

/** Longest stretch of shader compilation or disposal between yields to the render loop. */
const SLICE_MS = 4;
/** What the meshes are scaled by during warmUp: far below a pixel, but still drawn. */
const WARM_UP_SCALE = 1e-6;

type LoadMeshPrimitive = NonNullable<IGLTFLoaderExtension["_loadMeshPrimitiveAsync"]>;

/**
 * Finishes a load's meshes one per event-loop turn. The loader completes each
 * mesh when its last texture has arrived, usually the same texture for all of
 * them, and completing one computes its bounds: on the CPU through the skeleton
 * for a skinned mesh. Together those stopped the frame loop for tens of ms.
 */
class OneMeshPerTurn implements IGLTFLoaderExtension {
  readonly name = "one_mesh_per_turn";
  enabled = true;
  private lastMesh: Promise<unknown> = Promise.resolve();

  constructor(private readonly loader: GLTFLoader) {}

  dispose(): void {
    /* holds nothing */
  }

  _loadMeshPrimitiveAsync(...args: Parameters<LoadMeshPrimitive>): ReturnType<LoadMeshPrimitive> {
    const load = (this.loader as unknown as { _loadMeshPrimitiveAsync: LoadMeshPrimitive })._loadMeshPrimitiveAsync;
    return load.apply(this.loader, args)!.then(async (mesh) => {
      const turn = this.lastMesh.then(nextTurn);
      this.lastMesh = turn;
      await turn;
      return mesh;
    });
  }
}
registerGLTFExtension("one_mesh_per_turn", false, (loader) => new OneMeshPerTurn(loader));

export interface AssetPlacement {
  /** World position of the asset's bounds centre (default 2.2 m ahead, 1.3 m up). */
  center?: Vector3;
  /** Target height in metres (default 0.6). */
  height?: number;
  /** Upper bound for the largest dimension in metres (default: none) — keeps flat, wide assets in reach. */
  maxSize?: number;
  /** Stay disabled once loaded, for the caller to show with root.setEnabled(true) (default false). */
  hidden?: boolean;
}

export interface LoadedAsset {
  /** Pivot at the asset's bounds centre; move/rotate this. */
  root: TransformNode;
  /**
   * Draws each mesh once, one per frame, too small to see, while the root stays
   * disabled: what a driver leaves for a pipeline state's first draw (WebGPU
   * builds its render pipelines there) then does not land in the frame the asset
   * shows, all at once. Needs the render loop running; a hidden asset only.
   */
  warmUp(): Promise<void>;
  /** Removes the asset from the scene and frees all its resources. */
  dispose(): void;
  /** As dispose(), yielding to the render loop between stretches of work. */
  disposeGradually(): Promise<void>;
}

/** What loadAsset is busy with, for a caller that measures it. */
export type LoadPhase = "load" | "compile";

export async function loadAsset(scene: Scene, url: string, placement: AssetPlacement = {}, onPhase?: (phase: LoadPhase) => void): Promise<LoadedAsset> {
  const center = placement.center ?? new Vector3(0, 1.3, 2.2);
  const height = placement.height ?? 0.6;
  onPhase?.("load");
  const container = await LoadAssetContainerAsync(url, scene);
  container.addAllToScene();
  // Pivot at the bounds centre, so rotating the root turns it in place.
  const content = new TransformNode("assetContent", scene);
  for (const node of container.rootNodes) node.parent = content;
  const { min, max } = content.getHierarchyBoundingVectors();
  content.position = min.add(max).scaleInPlace(-0.5);
  const root = new TransformNode("assetRoot", scene);
  content.parent = root;
  const size = max.subtract(min);
  const largest = Math.max(size.x, size.y, size.z, 0.001);
  root.scaling.setAll(Math.min(height / Math.max(size.y, 0.001), (placement.maxSize ?? Infinity) / largest));
  root.position.copyFrom(center);
  root.setEnabled(false);
  onPhase?.("compile");
  await nextTurn(); // the loader's last continuation just ran in this one
  await compileMaterials(container.meshes);
  root.setEnabled(placement.hidden !== true);
  const dispose = (): void => {
    container.dispose(); // meshes, materials, textures, animation groups, skeletons
    root.dispose(); // the two pivots (not part of the container)
  };
  console.log(`[render] asset ${url}: ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} m, scale ${root.scaling.x.toFixed(2)}`);
  return {
    root,
    warmUp: () => warmUp(scene, container.meshes, content, root),
    dispose,
    disposeGradually: async () => {
      // Each is removed from the container first: its dispose() would repeat them.
      let sliceStart = performance.now();
      const remaining = [container.animationGroups, container.meshes, container.materials, container.textures] as Array<Array<{ dispose(): void }>>;
      for (const list of remaining) {
        for (let item = list.pop(); item !== undefined && !scene.isDisposed; item = list.pop()) {
          item.dispose();
          if (performance.now() - sliceStart > SLICE_MS) {
            await nextTurn();
            sliceStart = performance.now();
          }
        }
      }
      if (!scene.isDisposed) dispose();
    },
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

async function warmUp(scene: Scene, meshes: AbstractMesh[], content: TransformNode, root: TransformNode): Promise<void> {
  const pivot = new TransformNode("assetWarmUp", scene);
  pivot.scaling.setAll(WARM_UP_SCALE);
  content.parent = pivot;
  const wasVisible = meshes.map((mesh) => mesh.isVisible);
  const wasAlwaysActive = meshes.map((mesh) => mesh.alwaysSelectAsActiveMesh);
  for (const mesh of meshes) mesh.isVisible = false;
  for (const [i, mesh] of meshes.entries()) {
    if (!wasVisible[i] || mesh.getTotalVertices() === 0 || scene.isDisposed) continue;
    mesh.isVisible = true;
    mesh.alwaysSelectAsActiveMesh = true; // whichever way the user is looking
    await new Promise((resolve) => scene.onAfterRenderObservable.addOnce(resolve));
    mesh.isVisible = false;
    mesh.alwaysSelectAsActiveMesh = wasAlwaysActive[i];
  }
  meshes.forEach((mesh, i) => {
    mesh.isVisible = wasVisible[i];
  });
  content.parent = root;
  pivot.dispose();
}

/**
 * Compiles what the meshes need to render, yielding to the render loop when
 * a stretch took long (a driver without parallel shader compilation blocks
 * for each new shader). Not the loader's compileMaterials option: that also
 * compiles an instanced variant of every material. A material that does not
 * compile is reported and left to behave as it would at first render.
 */
async function compileMaterials(meshes: AbstractMesh[]): Promise<void> {
  let sliceStart = performance.now();
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || mesh.material === null) continue;
    try {
      await mesh.material.forceCompilationAsync(mesh);
    } catch (err) {
      console.warn(`[render] material ${mesh.material.name} does not compile: ${String(err)}`);
    }
    if (performance.now() - sliceStart > SLICE_MS) {
      await nextTurn();
      sliceStart = performance.now();
    }
  }
}
