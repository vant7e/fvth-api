/**
 * Match.html: shared WebGL for unit map + assembly ring.
 * — Field: ONE renderer / scene / canvas on #beadField (no per-bead canvas).
 * — Assembly ring: ONE renderer / scene / canvas on #assemblyBraceletRing.
 * Beads: full photo map (createBeadMaterial … 'photo') on 128×128 smooth SphereGeometry — same as bead_3d_test “Full photo map” + sphere.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  loadTexture,
  createBeadMaterial,
  csvShaderModelFromModelField,
  SINGLE_SAFE_YAW_MIN,
  SINGLE_SAFE_YAW_MAX,
  SINGLE_ROT_SPEED,
  safeYawMirrored,
  SPHERE_SEGMENTS,
  BEAD_SPHERE_RADIUS,
} from './bead_3d_runtime.js';

/** Match match.html bead sizes: '', size-m, size-l → 36 / 40 / 44 px face width. */
const FIELD_DOM_BEAD_DIA_PX = [36, 40, 44];

/** Full photo on spherical UVs (bead_3d_test “Full photo map (UV debug)” + 128×128 sphere). */
const MATCH_BEAD_SHADING_MODE = 'photo';

/** ——— Field (#beadField) ——— */
let fieldRenderer = null;
let fieldScene = null;
let fieldCamera = null;
let fieldPmremGenerator = null;
let fieldMeshGroup = null;
let fieldResizeObserver = null;

/** ——— Assembly ring (#assemblyBraceletRing) ——— */
let assemblyRenderer = null;
let assemblyScene = null;
let assemblyCamera = null;
let assemblyPmremGenerator = null;
let assemblyMeshGroup = null;
let assemblyResizeObserver = null;

let animationId = null;
let t0 = performance.now();
let _rendererCheckLogged = false;

/** bead_3d_test.html: 128×128 UV sphere + photo map (correct spherical projection). */
function createPhotoSphereBeadRoot(mat) {
  const root = new THREE.Group();
  const geom = new THREE.SphereGeometry(
    BEAD_SPHERE_RADIUS,
    SPHERE_SEGMENTS,
    SPHERE_SEGMENTS
  );
  const mesh = new THREE.Mesh(geom, mat);
  mesh.material.flatShading = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return root;
}

function disposeObjectTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mat) => {
        if (!mat) return;
        if (mat.userData && mat.userData.softMap) {
          try {
            mat.userData.softMap.dispose();
          } catch (e) {
            /* ignore */
          }
          delete mat.userData.softMap;
        }
        Object.keys(mat).forEach((k) => {
          const v = mat[k];
          if (v && v.isTexture && typeof v.dispose === 'function') v.dispose();
        });
        mat.dispose();
      });
    }
  });
}

function clearFieldMeshes() {
  if (!fieldMeshGroup) return;
  while (fieldMeshGroup.children.length) {
    const c = fieldMeshGroup.children[0];
    fieldMeshGroup.remove(c);
    disposeObjectTree(c);
  }
}

function clearAssemblyMeshes() {
  if (!assemblyMeshGroup) return;
  while (assemblyMeshGroup.children.length) {
    const c = assemblyMeshGroup.children[0];
    assemblyMeshGroup.remove(c);
    disposeObjectTree(c);
  }
}

function tick() {
  animationId = requestAnimationFrame(tick);
  const t = (performance.now() - t0) * 0.001;

  if (fieldRenderer && fieldScene && fieldCamera && fieldMeshGroup) {
    fieldMeshGroup.children.forEach((g, i) => {
      g.rotation.y = safeYawMirrored(
        t + i * 0.07,
        SINGLE_ROT_SPEED,
        SINGLE_SAFE_YAW_MIN,
        SINGLE_SAFE_YAW_MAX
      );
    });
    fieldRenderer.render(fieldScene, fieldCamera);
  }

  if (assemblyRenderer && assemblyScene && assemblyCamera && assemblyMeshGroup) {
    assemblyMeshGroup.children.forEach((g, i) => {
      g.rotation.y = safeYawMirrored(
        t + i * 0.09 + 0.4,
        SINGLE_ROT_SPEED,
        SINGLE_SAFE_YAW_MIN,
        SINGLE_SAFE_YAW_MAX
      );
    });
    assemblyRenderer.render(assemblyScene, assemblyCamera);
  }
}

function ensureAnimateLoop() {
  if (animationId != null) return;
  t0 = performance.now();
  animationId = requestAnimationFrame(tick);
}

function stopAnimateLoopIfBothDisposed() {
  if (!fieldRenderer && !assemblyRenderer && animationId != null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

/**
 * @param {HTMLElement} beadFieldEl #beadField
 */
export async function ensureMatchBeadFieldEngine(beadFieldEl) {
  if (!beadFieldEl) throw new Error('ensureMatchBeadFieldEngine: missing host');
  if (fieldRenderer && fieldRenderer.domElement && beadFieldEl.contains(fieldRenderer.domElement)) return;

  if (!_rendererCheckLogged) {
    console.log('Renderer count check OK');
    _rendererCheckLogged = true;
  }

  const w = Math.max(1, beadFieldEl.clientWidth);
  const h = Math.max(1, beadFieldEl.clientHeight);
  const aspect = w / h;

  fieldRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  fieldRenderer.domElement.classList.add('fvth-field-webgl-canvas');
  fieldRenderer.domElement.setAttribute('aria-hidden', 'true');
  // Must paint above .bead-field-nodes (z-index: 2); pointer-events:none so clicks hit .bead below.
  fieldRenderer.domElement.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;z-index:4;';

  const first = beadFieldEl.firstChild;
  if (first) beadFieldEl.insertBefore(fieldRenderer.domElement, first);
  else beadFieldEl.appendChild(fieldRenderer.domElement);

  fieldRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  fieldRenderer.setSize(w, h);
  fieldRenderer.setClearColor(0x000000, 0);
  fieldRenderer.outputColorSpace = THREE.SRGBColorSpace;
  fieldRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  fieldRenderer.toneMappingExposure = 1.3;
  fieldRenderer.physicallyCorrectLights = true;

  const frustumSize = 56;
  fieldCamera = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    200
  );
  fieldCamera.position.set(0, 0, 40);
  fieldCamera.lookAt(0, 0, 0);

  fieldScene = new THREE.Scene();
  fieldScene.background = null;

  fieldScene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const fk = new THREE.DirectionalLight(0xffffff, 1.1);
  fk.position.set(6, 8, 10);
  fieldScene.add(fk);
  const ff = new THREE.DirectionalLight(0xffffff, 0.45);
  ff.position.set(-5, -3, 4);
  fieldScene.add(ff);

  fieldPmremGenerator = new THREE.PMREMGenerator(fieldRenderer);
  const roomEnv = new RoomEnvironment();
  const envMapTex = fieldPmremGenerator.fromScene(roomEnv, 0.04).texture;
  roomEnv.dispose();
  fieldScene.environment = envMapTex;

  fieldMeshGroup = new THREE.Group();
  fieldScene.add(fieldMeshGroup);

  fieldResizeObserver = new ResizeObserver(() => {
    if (!beadFieldEl || !fieldRenderer || !fieldCamera) return;
    const cw = Math.max(1, beadFieldEl.clientWidth);
    const ch = Math.max(1, beadFieldEl.clientHeight);
    const asp = cw / ch;
    fieldCamera.left = (-frustumSize * asp) / 2;
    fieldCamera.right = (frustumSize * asp) / 2;
    fieldCamera.top = frustumSize / 2;
    fieldCamera.bottom = -frustumSize / 2;
    fieldCamera.updateProjectionMatrix();
    fieldRenderer.setSize(cw, ch);
  });
  fieldResizeObserver.observe(beadFieldEl);

  ensureAnimateLoop();
}

/**
 * @param {HTMLElement} ringEl #assemblyBraceletRing
 */
export async function ensureAssemblyRingEngine(ringEl) {
  if (!ringEl) throw new Error('ensureAssemblyRingEngine: missing host');
  if (assemblyRenderer && assemblyRenderer.domElement && ringEl.contains(assemblyRenderer.domElement)) return;

  const w = Math.max(1, ringEl.clientWidth);
  const h = Math.max(1, ringEl.clientHeight);
  const aspect = w / Math.max(h, 1);

  assemblyRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  assemblyRenderer.domElement.setAttribute('aria-hidden', 'true');
  assemblyRenderer.domElement.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0;';

  const firstR = ringEl.firstChild;
  if (firstR) ringEl.insertBefore(assemblyRenderer.domElement, firstR);
  else ringEl.appendChild(assemblyRenderer.domElement);

  assemblyRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  assemblyRenderer.setSize(w, h);
  assemblyRenderer.setClearColor(0x000000, 0);
  assemblyRenderer.outputColorSpace = THREE.SRGBColorSpace;
  assemblyRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  assemblyRenderer.toneMappingExposure = 1.3;
  assemblyRenderer.physicallyCorrectLights = true;

  const frustumAsm = 44;
  assemblyCamera = new THREE.OrthographicCamera(
    (-frustumAsm * aspect) / 2,
    (frustumAsm * aspect) / 2,
    frustumAsm / 2,
    -frustumAsm / 2,
    0.1,
    200
  );
  assemblyCamera.position.set(0, 0, 40);
  assemblyCamera.lookAt(0, 0, 0);

  assemblyScene = new THREE.Scene();
  assemblyScene.background = null;
  assemblyScene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const ak = new THREE.DirectionalLight(0xffffff, 1.1);
  ak.position.set(6, 8, 10);
  assemblyScene.add(ak);
  const af = new THREE.DirectionalLight(0xffffff, 0.45);
  af.position.set(-5, -3, 4);
  assemblyScene.add(af);

  assemblyPmremGenerator = new THREE.PMREMGenerator(assemblyRenderer);
  const roomEnvA = new RoomEnvironment();
  const envAsm = assemblyPmremGenerator.fromScene(roomEnvA, 0.04).texture;
  roomEnvA.dispose();
  assemblyScene.environment = envAsm;

  assemblyMeshGroup = new THREE.Group();
  assemblyScene.add(assemblyMeshGroup);

  assemblyResizeObserver = new ResizeObserver(() => {
    if (!ringEl || !assemblyRenderer || !assemblyCamera) return;
    const cw = Math.max(1, ringEl.clientWidth);
    const ch = Math.max(1, ringEl.clientHeight);
    const asp = cw / ch;
    assemblyCamera.left = (-frustumAsm * asp) / 2;
    assemblyCamera.right = (frustumAsm * asp) / 2;
    assemblyCamera.top = frustumAsm / 2;
    assemblyCamera.bottom = -frustumAsm / 2;
    assemblyCamera.updateProjectionMatrix();
    assemblyRenderer.setSize(cw, ch);
  });
  assemblyResizeObserver.observe(ringEl);

  ensureAnimateLoop();
}

export async function syncMatchBeadField(beads, positions, gen, ctx) {
  const host = document.getElementById('beadField');
  if (!host) return false;
  await ensureMatchBeadFieldEngine(host);
  if (gen !== ctx.getGen()) return false;

  clearFieldMeshes();

  const tasks = [];
  for (let i = 0; i < beads.length; i++) {
    const b = beads[i];
    const pos = positions[i];
    if (!b || !pos) continue;
    const url = ctx.textureUrlFor(b, i);
    if (!url) continue;
    tasks.push(loadTexture(url).then((tex) => ({ i, b, pos, tex })));
  }

  const loaded = await Promise.all(tasks);
  if (gen !== ctx.getGen()) {
    loaded.forEach(({ tex }) => tex.dispose());
    return false;
  }

  const pbrDefault = 'beads';

  for (let k = 0; k < loaded.length; k++) {
    const { i, b, pos, tex } = loaded[k];
    const glowHex = ctx.glowHexFor(b);
    const pbrType = csvShaderModelFromModelField(b.model) || pbrDefault;
    const mat = createBeadMaterial(
      tex,
      { model: pbrType, beadId: b.id != null ? String(b.id) : '' },
      glowHex,
      MATCH_BEAD_SHADING_MODE
    );
    mat.envMap = fieldScene.environment;

    const root = createPhotoSphereBeadRoot(mat);

    // Align with DOM: bead center at (pos.x%, pos.y%) of #beadField (same as left/top + translate -50%).
    const { left, right, top, bottom } = fieldCamera;
    const worldW = right - left;
    const worldH = top - bottom;
    const wx = left + (pos.x / 100) * worldW;
    const wy = top - (pos.y / 100) * worldH;
    root.position.set(wx, wy, 0);

    // Match apparent size to DOM disc: diameter in world = (d_px / field_px) * visible world height.
    const fh = Math.max(1, host.clientHeight);
    const diaPx = FIELD_DOM_BEAD_DIA_PX[i % FIELD_DOM_BEAD_DIA_PX.length];
    const beadWorldDiam = (diaPx / fh) * worldH;
    const unitDiam = BEAD_SPHERE_RADIUS * 2;
    const unitScale =
      typeof ctx.unitMapBeadScale === 'number' ? ctx.unitMapBeadScale : 1;
    root.scale.setScalar((beadWorldDiam / unitDiam) * unitScale);

    fieldMeshGroup.add(root);
  }

  ensureAnimateLoop();
  return loaded.length > 0;
}

/**
 * @param {Array<{ bead: object }>} entries state.selected
 */
export async function syncAssemblyRingBeads(entries, gen, ctx) {
  const ring = document.getElementById('assemblyBraceletRing');
  if (!ring || !entries || !entries.length) return;
  await ensureAssemblyRingEngine(ring);
  if (gen !== ctx.getGen()) return;

  clearAssemblyMeshes();

  const n = entries.length;
  const center = 100;
  const radPx = 80;
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const b = entries[i].bead;
    if (!b) continue;
    const url = ctx.textureUrlFor(b, 'asm-' + i);
    if (!url) continue;
    tasks.push(loadTexture(url).then((tex) => ({ i, b, tex })));
  }

  const loaded = await Promise.all(tasks);
  if (gen !== ctx.getGen()) {
    loaded.forEach(({ tex }) => tex.dispose());
    return;
  }

  const pbrDefault = 'beads';
  const angleStep = (Math.PI * 2) / Math.max(n, 1);

  for (let k = 0; k < loaded.length; k++) {
    const { i, b, tex } = loaded[k];
    const glowHex = ctx.glowHexFor(b);
    const pbrType = csvShaderModelFromModelField(b.model) || pbrDefault;
    const mat = createBeadMaterial(
      tex,
      { model: pbrType, beadId: b.id != null ? String(b.id) : '' },
      glowHex,
      MATCH_BEAD_SHADING_MODE
    );
    mat.envMap = assemblyScene.environment;

    const root = createPhotoSphereBeadRoot(mat);

    const angle = i * angleStep;
    const px = center + radPx * Math.cos(angle);
    const py = center + radPx * Math.sin(angle);

    const rh = Math.max(1, ring.clientHeight);
    const { left, right, top, bottom } = assemblyCamera;
    const worldW = right - left;
    const worldH = top - bottom;
    const wx = left + (px / 200) * worldW;
    const wy = top - (py / 200) * worldH;
    root.position.set(wx, wy, 0);

    const arcPx = (2 * Math.PI * radPx) / Math.max(n, 1);
    const diaFromRing = arcPx * 0.42;
    const diaFromDom = FIELD_DOM_BEAD_DIA_PX[i % FIELD_DOM_BEAD_DIA_PX.length];
    const diaPx = Math.min(44, Math.max(20, Math.min(diaFromDom, diaFromRing)));
    const beadWorldDiam = (diaPx / rh) * worldH;
    root.scale.setScalar(beadWorldDiam / (BEAD_SPHERE_RADIUS * 2));

    assemblyMeshGroup.add(root);
  }

  ensureAnimateLoop();
}

export function disposeMatchBeadFieldEngine() {
  clearFieldMeshes();
  if (fieldResizeObserver) {
    try {
      fieldResizeObserver.disconnect();
    } catch (e) {
      /* ignore */
    }
    fieldResizeObserver = null;
  }
  if (fieldPmremGenerator) {
    try {
      fieldPmremGenerator.dispose();
    } catch (e) {
      /* ignore */
    }
    fieldPmremGenerator = null;
  }
  if (fieldScene && fieldScene.environment && fieldScene.environment.dispose) {
    try {
      fieldScene.environment.dispose();
    } catch (e) {
      /* ignore */
    }
  }
  fieldScene = null;
  fieldCamera = null;
  fieldMeshGroup = null;
  if (fieldRenderer) {
    const dom = fieldRenderer.domElement;
    try {
      fieldRenderer.dispose();
    } catch (e) {
      /* ignore */
    }
    if (dom && dom.parentNode) {
      try {
        dom.parentNode.removeChild(dom);
      } catch (e2) {
        /* ignore */
      }
    }
    fieldRenderer = null;
  }
  stopAnimateLoopIfBothDisposed();
}

export function disposeAssemblyRingEngine() {
  clearAssemblyMeshes();
  if (assemblyResizeObserver) {
    try {
      assemblyResizeObserver.disconnect();
    } catch (e) {
      /* ignore */
    }
    assemblyResizeObserver = null;
  }
  if (assemblyPmremGenerator) {
    try {
      assemblyPmremGenerator.dispose();
    } catch (e) {
      /* ignore */
    }
    assemblyPmremGenerator = null;
  }
  if (assemblyScene && assemblyScene.environment && assemblyScene.environment.dispose) {
    try {
      assemblyScene.environment.dispose();
    } catch (e) {
      /* ignore */
    }
  }
  assemblyScene = null;
  assemblyCamera = null;
  assemblyMeshGroup = null;
  if (assemblyRenderer) {
    const dom = assemblyRenderer.domElement;
    try {
      assemblyRenderer.dispose();
    } catch (e) {
      /* ignore */
    }
    if (dom && dom.parentNode) {
      try {
        dom.parentNode.removeChild(dom);
      } catch (e2) {
        /* ignore */
      }
    }
    assemblyRenderer = null;
  }
  stopAnimateLoopIfBothDisposed();
}
