/**
 * scene.js — Three.js scene, camera, renderer, lights, and OrbitControls.
 * Call init() once to set everything up; the returned object is shared across modules.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initScene() {
  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  document.body.appendChild(renderer.domElement);

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d1a);
  scene.fog = new THREE.Fog(0x0d0d1a, 80, 220);

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 45, 80);
  camera.lookAt(0, 0, 0);

  // ── Lights ────────────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0x202040, 0.8);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffeedd, 2.0);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  // Subtle fill light from below for depth
  const fill = new THREE.DirectionalLight(0x4060a0, 0.4);
  fill.position.set(-20, -10, -20);
  scene.add(fill);

  // ── Orbit Controls ────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 10;
  controls.maxDistance = 200;
  controls.target.set(0, 0, 0);

  // ── Resize handler ────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Stars background (simple point cloud)
  const starGeo = new THREE.BufferGeometry();
  const starCount = 1500;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount * 3; i++) {
    starPos[i] = (Math.random() - 0.5) * 400;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, sizeAttenuation: true });
  scene.add(new THREE.Points(starGeo, starMat));

  return { renderer, scene, camera, controls };
}
