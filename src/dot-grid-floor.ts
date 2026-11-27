/**
 * See-through "dot grid" floor: a regular grid of bright dots on an
 * otherwise fully transparent surface, so the floor plane (and its height)
 * reads at a glance — in VR and over passthrough alike — while the real world
 * / the scene below stays visible through it. No tint between the dots: on
 * Pico 4 passthrough a large semi-transparent surface visibly changes look
 * during head motion (docs/target-testing.md). Also the teleportation floor
 * mesh (picking ignores alpha, so the transparent surface is still a hit).
 *
 * The dot tile is generated on the CPU into a RawTexture and repeated
 * across the plane (plain Babylon; works the same in a browser).
 */
import type * as Babylon from "@babylonjs/core";

/** Floor extent (m), dot spacing (m) and dot radius (m). */
const FLOOR_SIZE = 24;
const DOT_SPACING = 0.5;
const DOT_RADIUS = 0.03;
/** Tile resolution: one dot per tile. */
const TILE_PX = 64;
/** Alpha of the dots. */
const DOT_ALPHA = 0.95;

/**
 * Generates one RGBA8 tile: fully transparent with an anti-aliased dot at
 * its center. Straight (non-premultiplied) alpha —
 * the blend stage produces premultiplied output over the alpha-0 clear.
 */
export function makeDotTile(size = TILE_PX): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const radiusPx = (DOT_RADIUS / DOT_SPACING) * size;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // 1 inside the dot, 0 outside, ~1.5 px smooth edge.
      const dot = Math.min(1, Math.max(0, (radiusPx + 0.75 - d) / 1.5));
      const i = (y * size + x) * 4;
      data[i] = Math.round(255 * (0.35 + 0.6 * dot));
      data[i + 1] = Math.round(255 * (0.45 + 0.5 * dot));
      data[i + 2] = Math.round(255 * (0.6 + 0.4 * dot));
      data[i + 3] = Math.round(255 * DOT_ALPHA * dot);
    }
  }
  return data;
}

/** Creates the dot-grid floor mesh ("ground") at y = 0 of the scene. */
export function createDotGridFloor(BABYLON: typeof Babylon, scene: Babylon.Scene): Babylon.Mesh {
  const ground = BABYLON.MeshBuilder.CreateGround(
    "ground",
    { width: FLOOR_SIZE, height: FLOOR_SIZE },
    scene,
  );

  const tile = BABYLON.RawTexture.CreateRGBATexture(
    makeDotTile(),
    TILE_PX,
    TILE_PX,
    scene,
    true, // mipmaps: keeps distant dots from aliasing into moiré
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
  );
  tile.name = "dotGridTile";
  tile.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  tile.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  tile.uScale = FLOOR_SIZE / DOT_SPACING;
  tile.vScale = FLOOR_SIZE / DOT_SPACING;
  tile.hasAlpha = true;

  const mat = new BABYLON.StandardMaterial("groundMat", scene);
  mat.diffuseTexture = tile;
  mat.useAlphaFromDiffuseTexture = true;
  // Dots stay bright regardless of the light angle; still a lit material.
  mat.emissiveTexture = tile;
  mat.specularColor = BABYLON.Color3.Black();
  mat.backFaceCulling = false; // visible from below too (floor misplaced above the head)
  mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  ground.material = mat;
  return ground;
}
