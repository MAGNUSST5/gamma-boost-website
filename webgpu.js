// GammaBoost+ — hero with multiple scenes (Three.js WebGPU + TSL)
// Three demo environments: forest / urban / bunker. Each cycles automatically
// until the user picks one, or picks a preset / drags the slider.

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, pass, pow, vec3, vec4, max, float, screenUV, vec2,
  mix, smoothstep, length
} from 'three/tsl';

const canvas = document.getElementById('hero-canvas');
const fallbackEl = document.getElementById('hero-fallback');
const loadingEl = document.getElementById('hero-loading');
const slider = document.getElementById('gamma-slider');
const gammaValEl = document.getElementById('gamma-val');
const sceneNameEl = document.getElementById('scene-name');
const contactValEl = document.getElementById('contact-val');
const presetButtons = document.querySelectorAll('.preset-btn');
const sceneTabs = document.querySelectorAll('.scene-tab');

let renderer = null;
let scene = null;
let camera = null;
let postProcessing = null;
const gammaU = uniform(1.0);

const scenes = {};
const SCENE_ORDER = ['forest', 'urban', 'bunker'];
const SCENE_LABEL = { forest: 'FOREST', urban: 'URBAN', bunker: 'BUNKER' };
let activeScene = 'forest';

let userInteracted = false;
let autoStart = 0;
let lastSceneSwitch = 0;

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */

async function init() {
  if (!canvas) return;

  try {
    renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
    await renderer.init();
  } catch (err) {
    console.warn('[GammaBoost+] WebGPU failed, trying WebGL2:', err);
    try {
      renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
      await renderer.init();
    } catch (err2) {
      console.error('[GammaBoost+] No renderer available:', err2);
      showFallback();
      return;
    }
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;
  sizeRenderer();

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02040a, 0.032);

  camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);

  // Build all scenes; only active is added to the world
  scenes.forest = buildForestScene();
  scenes.urban = buildUrbanScene();
  scenes.bunker = buildBunkerScene();

  for (const name of SCENE_ORDER) {
    scenes[name].group.visible = false;
    scene.add(scenes[name].group);
  }
  enterScene(activeScene, true);
  setupPostProcessing();
  setupControls();

  window.addEventListener('resize', sizeRenderer, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });

  autoStart = performance.now();
  lastSceneSwitch = autoStart;
  renderer.setAnimationLoop(render);

  setTimeout(() => {
    if (loadingEl) loadingEl.classList.add('fade-out');
  }, 450);
}

function sizeRenderer() {
  if (!renderer || !canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 1 || h < 1) return;
  renderer.setSize(w, h, false);
  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function onPointerMove(e) {
  pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
}

function enterScene(name, instant = false) {
  const prev = scenes[activeScene];
  if (prev && !instant) {
    prev.group.visible = false;
    prev.lights.forEach((l) => scene.remove(l));
  } else if (instant && prev && prev !== scenes[name]) {
    prev.group.visible = false;
  }

  const s = scenes[name];
  if (!s) return;
  s.group.visible = true;
  s.lights.forEach((l) => scene.add(l));

  scene.fog.color.setHex(s.fog.color);
  scene.fog.density = s.fog.density;

  camera.position.copy(s.camera.pos);
  camera.lookAt(s.camera.target);

  activeScene = name;
  lastSceneSwitch = performance.now();

  if (sceneNameEl) sceneNameEl.textContent = SCENE_LABEL[name];

  sceneTabs.forEach((btn) => {
    const match = btn.dataset.scene === name;
    btn.classList.toggle('active', match);
    btn.setAttribute('aria-selected', match ? 'true' : 'false');
  });
}

/* -----------------------------------------------------------
   POSTPROCESS  (shared across all scenes)
----------------------------------------------------------- */

function setupPostProcessing() {
  postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);

  const output = Fn(() => {
    const rgb = max(scenePass.getTextureNode().rgb, vec3(0.0));
    const lifted = pow(rgb, vec3(1.0).div(gammaU));
    const uv = screenUV;
    const d = length(uv.sub(vec2(0.5)));
    const vignette = smoothstep(0.95, 0.42, d);
    const withVignette = lifted.mul(mix(float(0.75), float(1.0), vignette));
    return vec4(withVignette, 1.0);
  });

  postProcessing.outputNode = output();
}

/* -----------------------------------------------------------
   SHARED HELPERS
----------------------------------------------------------- */

function addStandardFigures(group, figures, positions, materialOverride) {
  const mat = materialOverride || new THREE.MeshStandardMaterial({
    color: 0x2a1e15,
    roughness: 0.88,
    emissive: 0x0a0605,
    emissiveIntensity: 1.0,
  });
  positions.forEach(({ pos, scale }) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.05, 4, 8), mat);
    body.position.y = 0.92;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 12), mat);
    head.position.y = 1.78;
    g.add(head);
    g.position.set(pos[0], pos[1] != null ? pos[1] : 0, pos[2] != null ? pos[2] : pos[1]);
    g.scale.setScalar(scale);
    g.userData.baseZ = pos[2] != null ? pos[2] : pos[1];
    g.userData.phase = Math.random() * Math.PI * 2;
    group.add(g);
    figures.push(g);
  });
}

function makeParticles(count, sampler, size = 0.07) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = sampler(i);
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xff9d3e,
    size,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
}

/* -----------------------------------------------------------
   SCENE 1 — FOREST
----------------------------------------------------------- */

function buildForestScene() {
  const group = new THREE.Group();
  const lights = [];
  const figures = [];

  lights.push(new THREE.AmbientLight(0x1c2538, 0.32));
  const moon = new THREE.DirectionalLight(0x8aa3c6, 0.55);
  moon.position.set(-8, 12, 6);
  lights.push(moon);
  const rim = new THREE.DirectionalLight(0xff7a32, 0.28);
  rim.position.set(-10, 2, -8);
  lights.push(rim);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x02040a, side: THREE.BackSide, fog: false })
  );
  group.add(sky);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starCount = 240;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 60;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 4;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 10;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0x556880, size: 0.18, sizeAttenuation: true, fog: false })
  ));

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x202838, fog: false })
  );
  moonMesh.position.set(-20, 14, -38);
  group.add(moonMesh);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(160, 160, 60, 60);
  const gPos = groundGeo.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    gPos.setZ(i,
      Math.sin(gPos.getX(i) * 0.25) * 0.06 +
      Math.cos(gPos.getY(i) * 0.22) * 0.05 +
      (Math.random() - 0.5) * 0.04
    );
  }
  gPos.needsUpdate = true;
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ color: 0x060910, roughness: 0.96, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Trees
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x060a0d, roughness: 1.0 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x0b0906, roughness: 1.0 });
  const treePositions = [
    [-9, -4], [-5, -12], [-11, -17], [9, -5], [6, -14], [12, -10],
    [-15, -21], [15, -23], [0, -27], [-3, -32], [3, -31], [-8, -28], [8, -29],
    [-20, -16], [20, -17], [-24, -26], [24, -28], [-18, -8], [18, -7],
  ];
  treePositions.forEach(([x, z]) => {
    const h = 2.6 + Math.random() * 2.3;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, h * 0.38, 5), trunkMat);
    trunk.position.set(x, h * 0.19, z);
    group.add(trunk);
    const foliage = new THREE.Mesh(new THREE.ConeGeometry(0.85 + Math.random() * 0.35, h, 6), treeMat);
    foliage.position.set(x, h * 0.5 + 0.2, z);
    foliage.rotation.y = Math.random() * Math.PI;
    group.add(foliage);
  });

  // Cabin
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 3.2, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x06090c, roughness: 1 })
  );
  building.position.set(0, 1.6, -11);
  group.add(building);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.4, 1.4, 4),
    new THREE.MeshStandardMaterial({ color: 0x040608, roughness: 1 })
  );
  roof.position.set(0, 3.9, -11);
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x0b0905, emissive: 0x3c2108, emissiveIntensity: 0.38,
  });
  [[-1.1, 0.85], [1.1, 0.85], [-1.1, 2.15], [1.1, 2.15]].forEach(([x, y]) => {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), winMat);
    win.position.set(x, y, -9.39);
    group.add(win);
  });
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 1.55),
    new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 1 })
  );
  door.position.set(0, 0.77, -9.39);
  group.add(door);

  // Figures
  addStandardFigures(group, figures, [
    { pos: [2.0, 0, -5.5], scale: 1.05 },
    { pos: [-2.8, 0, -7.5], scale: 1.0 },
    { pos: [4.2, 0, -10.5], scale: 1.0 },
    { pos: [-5.5, 0, -13.5], scale: 0.95 },
    { pos: [1.4, 0, -17.0], scale: 0.9 },
    { pos: [-8.2, 0, -19.0], scale: 0.88 },
  ]);

  // Campfire
  const fireCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xff7a22, fog: false })
  );
  fireCore.position.set(-5.2, 0.25, -11);
  group.add(fireCore);
  const fireOuter = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff4e14, transparent: true, opacity: 0.35, fog: false })
  );
  fireOuter.position.copy(fireCore.position);
  group.add(fireOuter);
  const firelight = new THREE.PointLight(0xff6a20, 1.8, 9, 2);
  firelight.position.set(-5.2, 0.5, -11);
  group.add(firelight);

  const logMat = new THREE.MeshStandardMaterial({ color: 0x0e0906, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.55, 5), logMat);
    log.position.set(-5.2 + Math.cos(i * 2) * 0.16, 0.07, -11 + Math.sin(i * 2) * 0.16);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i * 0.6;
    group.add(log);
  }

  // Particles
  const particles = makeParticles(160, (i) => {
    if (i < 80) return [
      -5.2 + (Math.random() - 0.5) * 0.4,
      0.3 + Math.random() * 4,
      -11 + (Math.random() - 0.5) * 0.4,
    ];
    return [
      (Math.random() - 0.5) * 30,
      Math.random() * 6,
      -5 - Math.random() * 24,
    ];
  });
  group.add(particles);

  return {
    group, lights, figures,
    camera: { pos: new THREE.Vector3(0, 1.65, 8.2), target: new THREE.Vector3(0, 1.1, -5) },
    fog: { color: 0x02040a, density: 0.032 },
    animate(t) {
      // Figure sway
      for (const fig of figures) {
        const ph = fig.userData.phase;
        fig.position.y = Math.sin(t * 0.8 + ph) * 0.03;
        fig.rotation.y = Math.sin(t * 0.35 + ph) * 0.18;
        fig.position.z = fig.userData.baseZ + Math.sin(t * 0.22 + ph) * 0.25;
      }
      // Particles
      const arr = particles.geometry.attributes.position.array;
      const count = arr.length / 3;
      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        if (i < 80) {
          arr[ix + 1] += 0.022 + (i % 4) * 0.004;
          arr[ix] += Math.sin(t * 2 + i) * 0.008;
          arr[ix + 2] += Math.cos(t * 2 + i * 0.7) * 0.006;
          if (arr[ix + 1] > 4.5) {
            arr[ix] = -5.2 + (Math.random() - 0.5) * 0.3;
            arr[ix + 1] = 0.3;
            arr[ix + 2] = -11 + (Math.random() - 0.5) * 0.3;
          }
        } else {
          arr[ix + 1] += 0.003 + (i % 5) * 0.0004;
          arr[ix] += Math.sin(t * 0.5 + i) * 0.002;
          if (arr[ix + 1] > 6) arr[ix + 1] = 0;
        }
      }
      particles.geometry.attributes.position.needsUpdate = true;
      // Fire flicker
      firelight.intensity = 1.5 + Math.sin(t * 8) * 0.25 + Math.sin(t * 23) * 0.18 + (Math.random() - 0.5) * 0.12;
      fireOuter.scale.setScalar(1 + Math.sin(t * 6) * 0.08 + Math.sin(t * 14) * 0.05);
      fireCore.scale.setScalar(1 + Math.sin(t * 11) * 0.08);
      // Moon drift
      moonMesh.position.x = -20 + Math.sin(t * 0.05) * 0.7;
    },
  };
}

/* -----------------------------------------------------------
   SCENE 2 — URBAN (city alley at night)
----------------------------------------------------------- */

function buildUrbanScene() {
  const group = new THREE.Group();
  const lights = [];
  const figures = [];

  lights.push(new THREE.AmbientLight(0x1a1624, 0.3));
  const sky = new THREE.DirectionalLight(0x5868a6, 0.35);
  sky.position.set(0, 12, 3);
  lights.push(sky);
  const neonLight = new THREE.PointLight(0xff5a1e, 1.4, 14, 2);
  neonLight.position.set(-4.4, 3.8, -10);
  lights.push(neonLight);
  const lamp = new THREE.PointLight(0xffc46a, 1.6, 10, 2);
  lamp.position.set(4.5, 3.2, -6);
  lights.push(lamp);

  // Backdrop — dark sky with city haze
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x060814, side: THREE.BackSide, fog: false })
  );
  group.add(skyDome);

  // Wet pavement
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x080a10, roughness: 0.55, metalness: 0.15 })
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Road stripe (implying alley center line)
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 30),
    new THREE.MeshStandardMaterial({ color: 0x3a3a20, roughness: 0.6, emissive: 0x1a1608, emissiveIntensity: 0.2 })
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.01, -6);
  group.add(stripe);

  // Left building (tall) with grid of lit windows
  const leftBldg = new THREE.Mesh(
    new THREE.BoxGeometry(6, 14, 14),
    new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 1 })
  );
  leftBldg.position.set(-8, 7, -10);
  group.add(leftBldg);

  // Right building (shorter)
  const rightBldg = new THREE.Mesh(
    new THREE.BoxGeometry(6, 10, 14),
    new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1 })
  );
  rightBldg.position.set(8, 5, -10);
  group.add(rightBldg);

  // Back building
  const backBldg = new THREE.Mesh(
    new THREE.BoxGeometry(10, 12, 3),
    new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1 })
  );
  backBldg.position.set(0, 6, -19);
  group.add(backBldg);

  // Emissive windows grid (left building front face)
  const winOnMat = new THREE.MeshBasicMaterial({ color: 0xffd880, fog: false });
  const winDimMat = new THREE.MeshBasicMaterial({ color: 0x2a1c0a, fog: false });
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = Math.random() > 0.55;
      const w = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.8),
        lit ? winOnMat : winDimMat
      );
      w.position.set(-4.99, 2 + row * 1.9, -13 + col * 2);
      w.rotation.y = Math.PI / 2;
      group.add(w);
    }
  }
  // Windows on right building (front face)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = Math.random() > 0.45;
      const w = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.7),
        lit ? winOnMat : winDimMat
      );
      w.position.set(4.99, 1.8 + row * 1.8, -13 + col * 2);
      w.rotation.y = -Math.PI / 2;
      group.add(w);
    }
  }
  // Back building windows (facing camera)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const lit = Math.random() > 0.5;
      const w = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.7),
        lit ? winOnMat : winDimMat
      );
      w.position.set(-3.6 + col * 1.8, 1.8 + row * 1.8, -17.49);
      group.add(w);
    }
  }

  // Neon sign (vertical red/orange band on left building)
  const neonSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 3),
    new THREE.MeshBasicMaterial({ color: 0xff6320, fog: false })
  );
  neonSign.position.set(-4.98, 4.2, -7);
  neonSign.rotation.y = Math.PI / 2;
  group.add(neonSign);
  const neonGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 5),
    new THREE.MeshBasicMaterial({ color: 0xff4a14, transparent: true, opacity: 0.22, fog: false })
  );
  neonGlow.position.set(-4.9, 4.2, -7);
  neonGlow.rotation.y = Math.PI / 2;
  group.add(neonGlow);

  // Streetlamp on the right
  const lampPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 1 })
  );
  lampPole.position.set(4.6, 1.7, -6);
  group.add(lampPole);
  const lampHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd390, fog: false })
  );
  lampHead.position.set(4.6, 3.35, -6);
  group.add(lampHead);
  const lampGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.25, fog: false })
  );
  lampGlow.position.copy(lampHead.position);
  group.add(lampGlow);

  // Trash cans
  const canMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const canMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.8, 10), canMat);
    canMesh.position.set(-3.4 + i * 0.75, 0.4, -3.5);
    group.add(canMesh);
  }

  // Figures (down the alley)
  addStandardFigures(group, figures, [
    { pos: [-1.8, 0, -6.5], scale: 1.02 },
    { pos: [1.6, 0, -8.5], scale: 1.0 },
    { pos: [-2.5, 0, -12], scale: 0.95 },
    { pos: [2.2, 0, -15], scale: 0.9 },
  ], new THREE.MeshStandardMaterial({
    color: 0x221a18, roughness: 0.9, emissive: 0x080505, emissiveIntensity: 1.0,
  }));

  // Rain-mist particles drifting down/across
  const particles = makeParticles(140, () => [
    (Math.random() - 0.5) * 16,
    Math.random() * 8 + 1,
    -4 - Math.random() * 16,
  ], 0.06);
  particles.material.color = new THREE.Color(0xc8b090);
  particles.material.opacity = 0.35;
  group.add(particles);

  return {
    group, lights, figures,
    camera: { pos: new THREE.Vector3(0, 1.7, 8), target: new THREE.Vector3(0, 1.4, -8) },
    fog: { color: 0x050a15, density: 0.028 },
    animate(t) {
      for (const fig of figures) {
        const ph = fig.userData.phase;
        fig.position.y = Math.sin(t * 0.8 + ph) * 0.02;
        fig.rotation.y = Math.sin(t * 0.35 + ph) * 0.12;
      }
      // Rain falls slowly
      const arr = particles.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= 0.02;
        arr[i] += Math.sin(t + i) * 0.004;
        if (arr[i + 1] < 0) arr[i + 1] = 8 + Math.random() * 2;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      // Neon flicker (rare, short)
      const flick = Math.sin(t * 23) > 0.97 ? 0.3 : 1.0;
      neonLight.intensity = 1.3 * flick + Math.sin(t * 2) * 0.1;
      neonSign.material.opacity = flick > 0.5 ? 1 : 0.6;
      // Lamp gentle pulse
      lampGlow.material.opacity = 0.22 + Math.sin(t * 1.5) * 0.04;
    },
  };
}

/* -----------------------------------------------------------
   SCENE 3 — BUNKER (dim industrial corridor)
----------------------------------------------------------- */

function buildBunkerScene() {
  const group = new THREE.Group();
  const lights = [];
  const figures = [];

  lights.push(new THREE.AmbientLight(0x101418, 0.25));

  // Dim overhead fluorescents
  const overhead1 = new THREE.PointLight(0x8c98a4, 1.4, 9, 2);
  overhead1.position.set(0, 3.2, 0);
  lights.push(overhead1);
  const overhead2 = new THREE.PointLight(0x8c98a4, 1.0, 9, 2);
  overhead2.position.set(0, 3.2, -8);
  lights.push(overhead2);
  const doorGlow = new THREE.PointLight(0xff6018, 1.5, 10, 2);
  doorGlow.position.set(0, 1.5, -14);
  lights.push(doorGlow);

  // No sky — just background
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 40),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0d, fog: false })
  );
  backdrop.position.set(0, 10, -30);
  group.add(backdrop);

  // Floor (concrete with noise)
  const floorGeo = new THREE.PlaneGeometry(18, 40, 20, 20);
  const fPos = floorGeo.attributes.position;
  for (let i = 0; i < fPos.count; i++) {
    fPos.setZ(i, (Math.random() - 0.5) * 0.03);
  }
  fPos.needsUpdate = true;
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.88, flatShading: true })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -10;
  group.add(floor);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.95 });
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 30), wallMat);
  leftWall.position.set(-4.5, 2.5, -10);
  group.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 30), wallMat);
  rightWall.position.set(4.5, 2.5, -10);
  group.add(rightWall);

  // Ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(9, 30), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 5, -10);
  group.add(ceiling);

  // Wall panel detail (vertical ribs on walls)
  for (let i = 0; i < 7; i++) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x050709, roughness: 1 })
    );
    rib.position.set(-4.3, 2.5, -i * 4);
    group.add(rib);
    const rib2 = rib.clone();
    rib2.position.set(4.3, 2.5, -i * 4);
    group.add(rib2);
  }

  // Overhead light fixtures (flat rectangles, emissive dim)
  const lightFixMat = new THREE.MeshBasicMaterial({ color: 0xb0bcc6, fog: false });
  [-0.5, -8.5].forEach((z) => {
    const fix = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.35), lightFixMat);
    fix.rotation.x = Math.PI / 2;
    fix.position.set(0, 4.95, z);
    group.add(fix);
  });

  // Pipes along ceiling
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.7, metalness: 0.4 });
  for (let i = 0; i < 2; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 28, 8), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = 0;
    pipe.position.set(i === 0 ? -3.2 : 3.2, 4.6, -10);
    pipe.rotation.x = Math.PI / 2;
    group.add(pipe);
  }

  // Barrels (stacked)
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x18120c, roughness: 0.92 });
  const barrelPositions = [
    [-3.2, 0, -4], [-3.2, 0, -5.3], [-3.4, 1.1, -4.6],
    [3.2, 0, -6], [3.4, 1.1, -6],
  ];
  barrelPositions.forEach(([x, y, z]) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 14), barrelMat);
    b.position.set(x, y + 0.55, z);
    group.add(b);
  });

  // Crates
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x1b1308, roughness: 1 });
  [[-2.2, 0, -8], [2.2, 0, -9]].forEach(([x, y, z]) => {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat);
    crate.position.set(x, y + 0.6, z);
    group.add(crate);
  });

  // End door (emissive edge)
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 3.2, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0d, roughness: 1, emissive: 0x3a1e08, emissiveIntensity: 0.25 })
  );
  door.position.set(0, 1.6, -15.5);
  group.add(door);
  const doorFrame = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.6),
    new THREE.MeshBasicMaterial({ color: 0xff7620, transparent: true, opacity: 0.22, fog: false })
  );
  doorFrame.position.set(0, 1.6, -15.35);
  group.add(doorFrame);

  // Figures down the corridor
  addStandardFigures(group, figures, [
    { pos: [-1.2, 0, -7.5], scale: 1.02 },
    { pos: [1.6, 0, -10], scale: 1.0 },
    { pos: [-0.6, 0, -13], scale: 0.95 },
  ], new THREE.MeshStandardMaterial({
    color: 0x1c1a20, roughness: 0.9, emissive: 0x060506, emissiveIntensity: 1.0,
  }));

  // Dust particles (slow, ambient)
  const particles = makeParticles(100, () => [
    (Math.random() - 0.5) * 8,
    Math.random() * 4.5,
    -3 - Math.random() * 12,
  ], 0.04);
  particles.material.color = new THREE.Color(0xb0a090);
  particles.material.opacity = 0.5;
  group.add(particles);

  return {
    group, lights, figures,
    camera: { pos: new THREE.Vector3(0, 1.7, 6), target: new THREE.Vector3(0, 1.4, -4) },
    fog: { color: 0x080809, density: 0.05 },
    animate(t) {
      for (const fig of figures) {
        const ph = fig.userData.phase;
        fig.position.y = Math.sin(t * 0.8 + ph) * 0.02;
        fig.rotation.y = Math.sin(t * 0.3 + ph) * 0.08;
      }
      // Dust drift
      const arr = particles.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += Math.sin(t * 0.3 + i * 0.1) * 0.002;
        arr[i] += Math.sin(t * 0.4 + i) * 0.002;
        arr[i + 2] += 0.0015;
        if (arr[i + 2] > 4) arr[i + 2] = -15;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      // Flickering fluorescent
      const flickA = Math.sin(t * 12) > 0.92 ? 0.4 : 1;
      overhead1.intensity = 1.4 * flickA + Math.sin(t * 0.8) * 0.05;
      // Door pulse
      doorFrame.material.opacity = 0.2 + Math.sin(t * 2) * 0.05;
    },
  };
}

/* -----------------------------------------------------------
   RENDER
----------------------------------------------------------- */

function render() {
  const now = performance.now();
  const t = now * 0.001;

  // Auto-scene rotation (until user touches anything)
  if (!userInteracted && now - lastSceneSwitch > 13000) {
    const idx = SCENE_ORDER.indexOf(activeScene);
    enterScene(SCENE_ORDER[(idx + 1) % SCENE_ORDER.length]);
  }

  // Auto-gamma demo
  if (!userInteracted) {
    const elapsed = (now - autoStart) / 1000;
    const cycle = 10;
    const phase = (elapsed + 2) % cycle;
    let target;
    if (phase < 1.5) target = 1.0;
    else if (phase < 4.5) target = 1.0 + ((phase - 1.5) / 3) * 1.1;
    else if (phase < 6.0) target = 2.1;
    else target = 2.1 - ((phase - 6.0) / 4) * 1.1;
    gammaU.value = target;
    if (gammaValEl) gammaValEl.textContent = target.toFixed(2);
    if (slider) slider.value = target;
    updateContactEstimate(target);
    updatePresetStates(target);
  }

  // Pointer parallax
  pointer.x += (pointer.tx - pointer.x) * 0.05;
  pointer.y += (pointer.ty - pointer.y) * 0.05;

  const s = scenes[activeScene];
  if (camera && s) {
    const driftX = Math.sin(t * 0.12) * 0.3;
    const driftY = Math.sin(t * 0.19) * 0.08;
    const base = s.camera.pos;
    const tgt = s.camera.target;
    camera.position.set(base.x + driftX + pointer.x * 0.6, base.y + driftY + pointer.y * -0.25, base.z);
    camera.lookAt(tgt.x + pointer.x * 0.4, tgt.y, tgt.z);
  }

  if (s && s.animate) s.animate(t);

  postProcessing.render();
}

/* -----------------------------------------------------------
   CONTROLS
----------------------------------------------------------- */

function updateContactEstimate(gamma) {
  if (!contactValEl) return;
  let n;
  if (gamma < 1.05) n = '?';
  else if (gamma < 1.35) n = '2?';
  else if (gamma < 1.75) n = '3';
  else if (gamma < 2.15) n = '5';
  else n = '6';
  contactValEl.textContent = n;
}

function updatePresetStates(value) {
  presetButtons.forEach((btn) => {
    const pv = parseFloat(btn.dataset.gamma);
    btn.classList.toggle('active', Math.abs(pv - value) < 0.03);
    btn.setAttribute('aria-checked', Math.abs(pv - value) < 0.03 ? 'true' : 'false');
  });
}

function setupControls() {
  function applyGamma(value) {
    const v = Math.max(0.5, Math.min(2.6, parseFloat(value)));
    gammaU.value = v;
    if (gammaValEl) gammaValEl.textContent = v.toFixed(2);
    updateContactEstimate(v);
    updatePresetStates(v);
  }
  function takeOver() {
    userInteracted = true;
  }

  slider.addEventListener('input', (e) => { takeOver(); applyGamma(e.target.value); });
  slider.addEventListener('pointerdown', takeOver);

  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      takeOver();
      const target = parseFloat(btn.dataset.gamma);
      const from = parseFloat(slider.value);
      tween(from, target, 550, (v) => { slider.value = v; applyGamma(v); });
    });
  });

  // Scene picker
  sceneTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      takeOver();
      enterScene(btn.dataset.scene);
    });
  });

  // Feature-card swatches drive hero gamma + scroll up
  document.querySelectorAll('.swatch[data-gamma]').forEach((sw) => {
    sw.addEventListener('click', () => {
      takeOver();
      const target = parseFloat(sw.dataset.gamma);
      const from = parseFloat(slider.value);
      tween(from, target, 600, (v) => { slider.value = v; applyGamma(v); });
      document.querySelector('#top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  applyGamma(slider.value);
}

function tween(from, to, duration, onUpdate) {
  const start = performance.now();
  const step = (now) => {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    onUpdate(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function showFallback() {
  if (fallbackEl) fallbackEl.style.display = 'flex';
  if (loadingEl) loadingEl.style.display = 'none';
  if (slider) slider.disabled = true;
  presetButtons.forEach((b) => (b.disabled = true));
  sceneTabs.forEach((b) => (b.disabled = true));
}

init().catch((err) => {
  console.error('[GammaBoost+] Initialization error:', err);
  showFallback();
});
