/**
 * Bead 3D runtime (parity with bead_3d_test.html).
 * Use createBeadMaterial(texture, type, glowHex) for MeshPhysicalMaterial: full photo map,
 * envMap on mesh, transmission via model + quartz ids (see makeStoneMaterial).
 * Geometry: createSphereBeadRoot — 128×128 sphere.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const SPHERE_SEGMENTS = 128;
export const BEAD_SPHERE_RADIUS = 0.5;

/** Single bead safe yaw (rad) — same as bead_3d_test.html */
export const SINGLE_SAFE_YAW_MIN = Math.PI * (210 / 180);
export const SINGLE_SAFE_YAW_MAX = Math.PI * (250 / 180);

/** Bracelet group only (rad) */
export const BRACELET_SAFE_YAW_MIN = Math.PI * (56 / 180);
export const BRACELET_SAFE_YAW_MAX = Math.PI * (78 / 180);

/** Presentation: slower oscillation (same safeYawMirrored / min–max arc) */
export const SINGLE_ROT_SPEED = 0.18;
/** Main preview: slow bracelet yaw (was 0.12 — too fast for ~20 beads) */
export const BRACELET_GROUP_ROT_SPEED = 0.042;

export function safeYawMirrored(t, speed, minA, maxA) {
  const span = maxA - minA;
  if (span <= 0) return minA;
  const period = 2 * span;
  let x = (t * speed) % period;
  if (x < 0) x += period;
  const wave = x < span ? x : period - x;
  return minA + wave;
}

const BEADS_CSV_URL = new URL('beads_master.csv', import.meta.url).href;

/** RFC4180-style parse (handles quoted fields with commas) */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else {
        cur += c;
      }
    }
  }
  row.push(cur);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}

let _beadTablePromise = null;

/**
 * @returns {Promise<Record<string, { variants: string[], glowColor: string, model: string }>>}
 */
export function loadBeadTable() {
  if (!_beadTablePromise) {
    _beadTablePromise = fetch(BEADS_CSV_URL)
      .then((r) => {
        if (!r.ok) throw new Error('CSV fetch failed: ' + BEADS_CSV_URL);
        return r.text();
      })
      .then((text) => {
        const rows = parseCSV(text);
        if (!rows.length) throw new Error('Empty CSV');
        const header = rows[0].map((h) => h.trim());
        const idIdx = header.indexOf('id');
        const imageIdx = header.indexOf('image');
        const glowIdx = header.indexOf('glow_color');
        const modelIdx = header.indexOf('model');
        if (idIdx < 0 || imageIdx < 0) throw new Error('CSV missing id or image column');

        const table = {};
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row[idIdx]) continue;
          const id = row[idIdx].trim();
          const rawImages = row[imageIdx] || '';
          const variants = rawImages
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
          let glow = '#333333';
          if (glowIdx >= 0 && row[glowIdx]) {
            const g = row[glowIdx].trim();
            if (g) glow = g;
          }
          let model = 'beads';
          if (modelIdx >= 0 && row[modelIdx]) {
            const m = row[modelIdx].trim();
            if (m) model = m;
          }
          table[id] = { variants, glowColor: glow, model };
        }
        return table;
      })
      .catch((err) => {
        _beadTablePromise = null;
        throw err;
      });
  }
  return _beadTablePromise;
}

function averageColorFromTexture(texture) {
  const img = texture.image;
  if (!img || !img.width) return new THREE.Color(0xe6a500);
  const w = Math.min(96, img.width | 0);
  const h = Math.min(96, img.height | 0);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Color(0xe6a500);
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return new THREE.Color(0xe6a500);
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 12) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return new THREE.Color(0xe6a500);
  r /= n;
  g /= n;
  b /= n;
  const c = new THREE.Color(r / 255, g / 255, b / 255);
  c.multiplyScalar(1.1);
  return c;
}

function createSoftMapTexture(sourceTexture, size) {
  const img = sourceTexture.image;
  if (!img || !img.width) return null;
  const w = size;
  const h = size;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * @param {'tint'|'soft'|'photo'} mode
 * @returns {{ material: THREE.MeshPhysicalMaterial, softMap: THREE.Texture|null }}
 */
export function makeStoneMaterial(texture, glowHex, mode, modelType, beadId) {
  const colGlow = new THREE.Color(glowHex);
  let softMap = null;
  const id = beadId != null ? String(beadId) : '';

  if (id === 'titanium_quartz' || id === 'green_phantom_quartz') {
    const attenuationColor =
      id === 'green_phantom_quartz'
        ? new THREE.Color(0xeafff3)
        : new THREE.Color(0xffffff);
    const mat = new THREE.MeshPhysicalMaterial({
      map: texture,
      transmission: 1.0,
      opacity: 1.0,
      transparent: false,
      ior: 1.45,
      thickness: 1.5,
      attenuationDistance: 2.5,
      attenuationColor,
      roughness: 0.05,
      metalness: 0.0,
      envMapIntensity: 1.2,
      clearcoat: 0.3,
      clearcoatRoughness: 0.1,
    });
    return { material: mat, softMap: null };
  }

  let roughness = 0.25;
  let metalness = 0.05;
  let transmission = 0;
  let ior = 1.5;

  if (modelType === 'clear') {
    roughness = 0.05;
    metalness = 0.0;
    transmission = 0.9;
    ior = 1.45;
  }

  if (modelType === 'rough') {
    roughness = 0.85;
    metalness = 0.0;
  }

  if (modelType === 'roughstone') {
    roughness = 1.0;
    metalness = 0.0;
  }

  const base = {
    metalness,
    roughness,
    transmission,
    ior,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.0,
    reflectivity: 0.5,
    flatShading: false,
  };

  if (mode === 'photo') {
    const mat = new THREE.MeshPhysicalMaterial({
      map: texture,
      metalness: base.metalness,
      roughness: base.roughness,
      transmission: base.transmission,
      ior: base.ior,
      clearcoat: base.clearcoat,
      clearcoatRoughness: base.clearcoatRoughness,
      envMapIntensity: base.envMapIntensity,
      reflectivity: base.reflectivity,
      flatShading: base.flatShading,
      emissive: colGlow,
      emissiveIntensity: 0.04,
      sheen: 0.1,
      sheenRoughness: 0.9,
      sheenColor: colGlow,
    });
    return { material: mat, softMap: null };
  }

  const avg = averageColorFromTexture(texture);

  if (mode === 'tint') {
    const mat = new THREE.MeshPhysicalMaterial({
      color: avg,
      map: null,
      metalness: base.metalness,
      roughness: base.roughness,
      transmission: base.transmission,
      ior: base.ior,
      clearcoat: base.clearcoat,
      clearcoatRoughness: base.clearcoatRoughness,
      envMapIntensity: base.envMapIntensity,
      reflectivity: base.reflectivity,
      flatShading: base.flatShading,
      emissive: colGlow,
      emissiveIntensity: 0.05,
      sheen: 0.08,
      sheenRoughness: 0.92,
      sheenColor: colGlow,
    });
    return { material: mat, softMap: null };
  }

  softMap = createSoftMapTexture(texture, 48);
  const mat = new THREE.MeshPhysicalMaterial({
    color: avg,
    map: softMap || null,
    metalness: base.metalness,
    roughness: base.roughness,
    transmission: base.transmission,
    ior: base.ior,
    clearcoat: base.clearcoat,
    clearcoatRoughness: base.clearcoatRoughness,
    envMapIntensity: base.envMapIntensity,
    reflectivity: base.reflectivity,
    flatShading: base.flatShading,
    emissive: colGlow,
    emissiveIntensity: 0.04,
    transparent: false,
  });
  if (softMap) {
    mat.userData.softMap = softMap;
  }
  return { material: mat, softMap };
}

/**
 * Unified bead material (bead_3d_test.html makeStoneMaterial).
 * @param {'tint'|'soft'|'photo'} [shadingMode='photo'] — match field uses `tint` per product spec; bracelet preview often `photo`.
 */
export function createBeadMaterial(
  texture,
  type,
  glowHex = '#e6b800',
  shadingMode = 'photo'
) {
  let modelType = 'beads';
  let beadId = '';
  if (type != null && typeof type === 'object' && !Array.isArray(type)) {
    if (type.model != null && String(type.model).trim()) {
      modelType = String(type.model).trim();
    }
    if (type.beadId != null && String(type.beadId).trim()) {
      beadId = String(type.beadId);
    }
  } else if (type != null && typeof type === 'string' && type.trim()) {
    modelType = type.trim();
  }
  const gh =
    glowHex && String(glowHex).trim() ? String(glowHex).trim() : '#e6b800';
  const mode =
    shadingMode === 'tint' || shadingMode === 'soft' || shadingMode === 'photo'
      ? shadingMode
      : 'photo';
  return makeStoneMaterial(texture, gh, mode, modelType, beadId).material;
}

/** @deprecated Prefer createBeadMaterial(texture, 'beads', glowHex, 'photo') */
export function makePhotoMaterial(texture, glowHex) {
  return createBeadMaterial(texture, 'beads', glowHex, 'photo');
}

export function loadTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      reject
    );
  });
}

export function setupRenderer(container, opts = {}) {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  const cap = opts.maxPixelRatio != null ? opts.maxPixelRatio : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.physicallyCorrectLights = true;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);
  return renderer;
}

/**
 * @param {number|null|undefined} bg - hex background, or null/undefined for transparent (UI blend)
 */
export function buildScene(bg) {
  const scene = new THREE.Scene();
  if (bg != null) {
    scene.background = new THREE.Color(bg);
  } else {
    scene.background = null;
  }
  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-5, -3, 2);
  scene.add(fill);
  return scene;
}

export function loadEnv(pmremGenerator) {
  const hdrUrl =
    'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr';
  const loader = new RGBELoader();
  return new Promise((resolve, reject) => {
    loader.load(
      hdrUrl,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const rt = pmremGenerator.fromEquirectangular(tex);
        tex.dispose();
        resolve(rt.texture);
      },
      undefined,
      (err) => {
        try {
          const roomEnv = new RoomEnvironment();
          const rt = pmremGenerator.fromScene(roomEnv, 0.04);
          resolve(rt.texture);
        } catch (e) {
          reject(e || err);
        }
      }
    );
  });
}

function createSphereBeadRoot(material, radius = BEAD_SPHERE_RADIUS) {
  const geom = new THREE.SphereGeometry(radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
  const mesh = new THREE.Mesh(geom, material);
  mesh.material.flatShading = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, geometry: geom };
}

/** CSV `model` column values that select PBR shader (not a GLB file). */
const CSV_SHADER_MODEL_TYPES = new Set(['beads', 'clear', 'rough', 'roughstone']);

export function csvShaderModelFromModelField(value) {
  if (value == null || !String(value).trim()) return null;
  const k = String(value).trim().toLowerCase();
  return CSV_SHADER_MODEL_TYPES.has(k) ? k : null;
}

function smoothNormalsOnObject(obj) {
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.geometry.computeVertexNormals();
    }
  });
}

function prepareGlbRoot(gltfScene) {
  const root = new THREE.Group();
  const model = gltfScene.clone(true);
  smoothNormalsOnObject(model);
  const bb0 = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  bb0.getCenter(center);
  model.position.sub(center);
  const bb1 = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bb1.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 1e-6 ? (BEAD_SPHERE_RADIUS * 2) / maxDim : 1;
  model.scale.setScalar(scale);
  root.add(model);
  root.rotation.y = SINGLE_SAFE_YAW_MIN;
  return root;
}

function disposeLoadedGlb(root) {
  root.traverse((o) => {
    if (o.geometry) {
      o.geometry.dispose();
    }
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mat) => {
        if (!mat) return;
        for (const k of Object.keys(mat)) {
          const v = mat[k];
          if (v && v.isTexture && typeof v.dispose === 'function') {
            v.dispose();
          }
        }
        mat.dispose();
      });
    }
  });
}

function loadGltfScene(url) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

function disposeStoneMaterial(material) {
  if (!material) return;
  if (material.userData?.softMap) {
    material.userData.softMap.dispose();
    delete material.userData.softMap;
  }
  material.dispose();
}

/* ——— Shared RAF for many mini viewports (match.html .bead-3d-mount per bead) ——— */
const _miniBeadEntries = new Set();
let _miniBeadRafId = 0;

function miniBeadsSharedTick() {
  const now = performance.now();
  _miniBeadRafId = requestAnimationFrame(miniBeadsSharedTick);
  for (const e of _miniBeadEntries) {
    if (e._disposed) continue;
    const t = (now - e._t0) * 0.001;
    if (e._spinning) {
      e.root.rotation.y = safeYawMirrored(
        t + e._phase,
        SINGLE_ROT_SPEED,
        SINGLE_SAFE_YAW_MIN,
        SINGLE_SAFE_YAW_MAX
      );
    } else {
      e.root.rotation.y = SINGLE_SAFE_YAW_MIN;
    }
    e.renderer.render(e.scene, e.camera);
  }
}

function registerMiniBeadViewport(entry) {
  _miniBeadEntries.add(entry);
  if (!_miniBeadRafId) {
    _miniBeadRafId = requestAnimationFrame(miniBeadsSharedTick);
  }
}

function unregisterMiniBeadViewport(entry) {
  if (!_miniBeadEntries.delete(entry)) return;
  if (_miniBeadEntries.size === 0 && _miniBeadRafId) {
    cancelAnimationFrame(_miniBeadRafId);
    _miniBeadRafId = 0;
  }
}

/**
 * @param {object} opt
 * @param {string} opt.textureFile
 * @param {string} [opt.glowHex='#e6b800']
 * @param {number} [opt.width=256]
 * @param {number} [opt.height=256]
 * @returns {Promise<string>} data URL (PNG)
 */
export async function renderBeadPreviewDataURL({
  textureFile,
  glowHex = '#e6b800',
  width = 256,
  height = 256,
}) {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-9999px;top:0;width:' +
    width +
    'px;height:' +
    height +
    'px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(host);

  const scene = buildScene(null);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 100);
  camera.position.set(0, 0.35, 2.15);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.physicallyCorrectLights = true;
  host.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  let envMap;
  try {
    envMap = await loadEnv(pmrem);
  } finally {
    pmrem.dispose();
  }
  scene.environment = envMap;

  const texture = await loadTexture(textureFile);
  const material = createBeadMaterial(
    texture,
    { model: 'beads', beadId: '' },
    glowHex,
    'photo'
  );
  material.envMap = envMap;

  const { root, geometry } = createSphereBeadRoot(material);
  root.rotation.y = SINGLE_SAFE_YAW_MIN;
  scene.add(root);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  scene.remove(root);
  geometry.dispose();
  disposeStoneMaterial(material);
  texture.dispose();
  if (envMap && envMap.dispose) envMap.dispose();
  renderer.dispose();
  host.removeChild(renderer.domElement);
  document.body.removeChild(host);

  return dataUrl;
}

/**
 * Single-bead viewer — GLB (when `glbUrl` set) or sphere 128×128 + makeStoneMaterial.
 * @param {object} opt
 * @param {string} [opt.glbUrl] If set, load GLB first; on failure uses texture sphere.
 * @param {'tint'|'soft'|'photo'} [opt.shadingMode='photo']
 * @param {boolean} [opt.sharedAnimationLoop=false] One global RAF for all registered mini viewports (match field).
 * @param {boolean} [opt.lowPower=false] If true and not sharedLoop, no RAF until hover start().
 * @param {boolean} [opt.fastLocalEnv=false] RoomEnvironment PMREM only — use for many tiny viewers.
 */
export async function createBead3D({
  container,
  textureFile,
  glowHex = '#e6b800',
  autoRotate = false,
  beadId = null,
  modelType = null,
  glbUrl = null,
  shadingMode = 'photo',
  sharedAnimationLoop = false,
  lowPower = false,
  fastLocalEnv = false,
  maxPixelRatio = 2,
} = {}) {
  if (!container || !(container instanceof HTMLElement)) {
    throw new Error('createBead3D: container must be a DOM element');
  }
  const glbUrlTrimmed =
    glbUrl != null && String(glbUrl).trim() ? String(glbUrl).trim() : '';
  if (!textureFile || typeof textureFile !== 'string' || !String(textureFile).trim()) {
    throw new Error('createBead3D: textureFile must be a non-empty string URL (sphere fallback)');
  }

  let resolvedPbr = csvShaderModelFromModelField(modelType);
  if (!resolvedPbr && beadId != null && String(beadId)) {
    try {
      const table = await loadBeadTable();
      const row = table[String(beadId)];
      if (row && row.model) resolvedPbr = csvShaderModelFromModelField(row.model);
    } catch {
      /* optional */
    }
  }
  if (!resolvedPbr) resolvedPbr = 'beads';

  const scene = buildScene(null);
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 100);
  camera.position.set(0, 0.35, 2.15);
  camera.lookAt(0, 0, 0);

  const renderer = setupRenderer(container, { maxPixelRatio });

  let envMap;
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  try {
    if (fastLocalEnv) {
      const roomEnv = new RoomEnvironment();
      envMap = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    } else {
      envMap = await loadEnv(pmremGenerator);
    }
  } finally {
    pmremGenerator.dispose();
  }
  scene.environment = envMap;

  let root;
  /** @type {THREE.BufferGeometry | null} */
  let geometry = null;
  /** @type {THREE.MeshPhysicalMaterial | null} */
  let material = null;
  /** @type {THREE.Texture | null} */
  let texture = null;
  let isGlb = false;

  if (glbUrlTrimmed) {
    try {
      const gltfScene = await loadGltfScene(glbUrlTrimmed);
      root = prepareGlbRoot(gltfScene);
      isGlb = true;
    } catch (e) {
      console.warn('createBead3D: GLB load failed, using texture sphere', glbUrlTrimmed, e);
      isGlb = false;
    }
  }

  if (!isGlb) {
    texture = await loadTexture(textureFile);
    material = createBeadMaterial(
      texture,
      {
        model: resolvedPbr,
        beadId: beadId != null ? String(beadId) : '',
      },
      glowHex,
      shadingMode
    );
    material.envMap = envMap;
    const sphere = createSphereBeadRoot(material);
    root = sphere.root;
    geometry = sphere.geometry;
    root.rotation.y = SINGLE_SAFE_YAW_MIN;
  }

  scene.add(root);

  let disposed = false;
  let rafId = 0;
  let rotating = false;
  const t0 = performance.now();

  function renderFrame() {
    if (disposed) return;
    const t = (performance.now() - t0) * 0.001;
    if (rotating && autoRotate) {
      root.rotation.y = safeYawMirrored(
        t,
        SINGLE_ROT_SPEED,
        SINGLE_SAFE_YAW_MIN,
        SINGLE_SAFE_YAW_MAX
      );
    } else {
      root.rotation.y = SINGLE_SAFE_YAW_MIN;
    }
    renderer.render(scene, camera);
  }

  function onResize() {
    if (disposed) return;
    const cw = Math.max(1, container.clientWidth);
    const ch = Math.max(1, container.clientHeight);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setSize(cw, ch);
    if (!sharedAnimationLoop) {
      renderFrame();
    }
  }

  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  /** @type {{ _disposed?: boolean, _spinning?: boolean, root?: THREE.Group, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.PerspectiveCamera, _t0?: number, _phase?: number } | null} */
  let sharedEntry = null;

  function tick() {
    if (disposed || sharedAnimationLoop) return;
    renderFrame();
    if (!lowPower || rotating) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  }

  if (sharedAnimationLoop) {
    sharedEntry = {
      _disposed: false,
      root,
      renderer,
      scene,
      camera,
      _t0: performance.now(),
      _phase: Math.random() * Math.PI * 2,
      _spinning: Boolean(autoRotate),
    };
    registerMiniBeadViewport(sharedEntry);
  } else if (lowPower) {
    renderFrame();
    rafId = 0;
  } else {
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (!autoRotate || disposed) return;
    rotating = true;
    if (sharedEntry) {
      sharedEntry._spinning = true;
      return;
    }
    if (lowPower && !rafId) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function stop() {
    rotating = false;
    root.rotation.y = SINGLE_SAFE_YAW_MIN;
    if (sharedEntry) {
      sharedEntry._spinning = false;
      return;
    }
    renderFrame();
    if (lowPower && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    ro.disconnect();
    if (sharedEntry) {
      sharedEntry._disposed = true;
      unregisterMiniBeadViewport(sharedEntry);
      sharedEntry = null;
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    scene.remove(root);
    if (isGlb) {
      disposeLoadedGlb(root);
    } else {
      if (geometry) geometry.dispose();
      if (material) disposeStoneMaterial(material);
      if (texture) texture.dispose();
    }
    if (envMap && envMap.dispose) envMap.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  return {
    start,
    stop,
    dispose,
    lowPower,
    sharedAnimationLoop,
    /** @type {THREE.Group} */
    root,
    scene,
    camera,
    renderer,
    /** alias for older callers */
    get mesh() {
      return root;
    },
  };
}

/**
 * Full circular bracelet in Three.js (main preview only — not for sidebar).
 * @param {HTMLElement} container
 * @param {Array<{ textureFile: string, glowHex?: string }>} beads
 * @param {{ autoRotate?: boolean, exportMode?: boolean, pixelRatio?: number, orbitControls?: boolean }} [options]
 */
export async function createBracelet3D(container, beads, options = {}) {
  const {
    autoRotate = true,
    exportMode = false,
    pixelRatio: pixelRatioOpt,
    orbitControls = false,
  } = options;
  if (!container || !(container instanceof HTMLElement)) {
    throw new Error('createBracelet3D: container must be a DOM element');
  }
  if (!Array.isArray(beads) || beads.length === 0) {
    throw new Error('createBracelet3D: beads must be a non-empty array');
  }

  container.innerHTML = '';

  function readContainerSize() {
    return {
      w: Math.max(1, container.clientWidth),
      h: Math.max(1, container.clientHeight),
    };
  }

  let { w, h } = readContainerSize();
  const scene = buildScene(null);
  // Farther camera + moderate FOV — comfortable framing for ~20 beads on the ring.
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.05, 100);
  camera.position.set(1.25, 0.82, 4.15);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(
    pixelRatioOpt != null ? pixelRatioOpt : window.devicePixelRatio
  );
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.physicallyCorrectLights = true;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  let envMap;
  try {
    envMap = await loadEnv(pmremGenerator);
  } finally {
    pmremGenerator.dispose();
  }
  scene.environment = envMap;

  const braceletGroup = new THREE.Group();
  scene.add(braceletGroup);

  const disposables = [];

  let beadTable = {};
  try {
    beadTable = await loadBeadTable();
  } catch {
    beadTable = {};
  }

  // Ring sized for ~20 beads: larger R + slightly smaller spheres to reduce overlap.
  const n = beads.length;
  const R = 1.15 + 0.012 * Math.min(Math.max(n, 1), 28);
  const beadScale = Math.min(0.34, 6.8 / Math.max(n, 8));
  const baseY = -0.05;

  for (let i = 0; i < n; i++) {
    const {
      textureFile,
      glowHex = '#e6b800',
      beadId = null,
      modelType = null,
    } = beads[i];
    const tex = await loadTexture(textureFile);
    let resolvedModel = modelType;
    if ((resolvedModel == null || resolvedModel === '') && beadId != null) {
      const row = beadTable[String(beadId)];
      if (row) resolvedModel = row.model;
    }
    if (resolvedModel == null || resolvedModel === '') resolvedModel = 'beads';
    const mat = createBeadMaterial(
      tex,
      {
        model: resolvedModel,
        beadId: beadId != null ? String(beadId) : '',
      },
      glowHex,
      'photo'
    );
    mat.envMap = envMap;
    const { root, geometry } = createSphereBeadRoot(mat);

    const ang = (i / n) * Math.PI * 2;
    const x = Math.cos(ang) * R;
    const z = Math.sin(ang) * R;
    root.position.set(x, baseY, z);
    root.scale.setScalar(beadScale);
    root.rotation.set(0, Math.PI, 0);

    braceletGroup.add(root);
    disposables.push({ geometry, material: mat, texture: tex });
  }

  braceletGroup.updateMatrixWorld(true);
  const fitBox = new THREE.Box3().setFromObject(braceletGroup);
  const fitSize = new THREE.Vector3();
  fitBox.getSize(fitSize);
  const maxDim = Math.max(fitSize.x, fitSize.y, fitSize.z);
  const targetSize = 1.95;
  if (maxDim > 1e-6) {
    braceletGroup.scale.setScalar(targetSize / maxDim);
  }

  let disposed = false;
  let rafId = 0;
  let rotating = false;
  const t0 = performance.now();

  /** Pause bracelet yaw while customer orbits camera (preview only). */
  let userOrbiting = false;
  let controls = null;
  if (orbitControls && !exportMode) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0, 0);
    controls.minDistance = 2.4;
    controls.maxDistance = 9;
    controls.minPolarAngle = Math.PI * 0.28;
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.addEventListener('start', () => {
      userOrbiting = true;
    });
    controls.addEventListener('end', () => {
      userOrbiting = false;
    });
  }

  function onResize() {
    if (disposed) return;
    const { w: cw, h: ch } = readContainerSize();
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setSize(cw, ch);
  }

  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  function tick() {
    if (disposed) return;
    const t = (performance.now() - t0) * 0.001;
    if (rotating && autoRotate && !userOrbiting) {
      braceletGroup.rotation.y = safeYawMirrored(
        t,
        BRACELET_GROUP_ROT_SPEED,
        BRACELET_SAFE_YAW_MIN,
        BRACELET_SAFE_YAW_MAX
      );
    } else if (!userOrbiting) {
      braceletGroup.rotation.y = BRACELET_SAFE_YAW_MIN;
    }
    if (controls) controls.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  if (!exportMode) {
    rafId = requestAnimationFrame(tick);
  }

  /** Video export: slow spin (full turn ≈ 14s — 4s clip only sweeps part of the arc). */
  function renderFrameAt(tSec) {
    if (disposed) return;
    const exportTurnPeriodSec = 14;
    braceletGroup.rotation.y =
      BRACELET_SAFE_YAW_MIN +
      tSec * ((Math.PI * 2) / exportTurnPeriodSec);
    renderer.render(scene, camera);
  }

  function start() {
    if (!autoRotate || disposed) return;
    rotating = true;
  }

  function stop() {
    rotating = false;
    braceletGroup.rotation.y = BRACELET_SAFE_YAW_MIN;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    ro.disconnect();
    if (controls) {
      controls.dispose();
      controls = null;
    }
    if (rafId) cancelAnimationFrame(rafId);
    scene.remove(braceletGroup);
    disposables.forEach((d) => {
      d.geometry.dispose();
      disposeStoneMaterial(d.material);
      d.texture.dispose();
    });
    if (envMap && envMap.dispose) envMap.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  const out = {
    start,
    stop,
    dispose,
    braceletGroup,
    scene,
    camera,
    renderer,
  };
  if (exportMode) {
    out.renderFrameAt = renderFrameAt;
  }
  return out;
}
