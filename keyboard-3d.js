import * as THREE from './vendor/three/three.module.js';

const stage = document.querySelector('#keyboardStage');
const canvas = document.querySelector('#keyboardCanvas');
const message = document.querySelector('#webglMessage');
const status = document.querySelector('#modelStatus');
const selectionStatus = document.querySelector('#selectionStatus');
const directory = document.querySelector('#keyDirectory');
const gapControl = document.querySelector('#gapControl');
const tentControl = document.querySelector('#tentControl');
const explodeControl = document.querySelector('#explodeControl');
const zoomControl = document.querySelector('#zoomControl');
const gapValue = document.querySelector('#gapValue');
const tentValue = document.querySelector('#tentValue');
const explodeValue = document.querySelector('#explodeValue');
const zoomValue = document.querySelector('#zoomValue');
const moveModeButton = document.querySelector('#moveMode');
const dragModeHint = document.querySelector('#dragModeHint');
const layerInputs = [...document.querySelectorAll('[data-layer]')];

const rowNames = ['top row', 'home row', 'bottom row', 'thumb cluster'];
const keyPositions = [];
const keyMeshes = [];
const pickables = [];
const layerGroups = { keycaps: [], switches: [], plate: [], electronics: [], case: [], cable: [] };

let renderer;
let camera;
let scene;
let model;
let cableMesh;
let resizeObserver;
let selectedKey = null;
let hoveredKey = null;
let drag = null;
let moveMode = false;
let azimuth = 0.12;
let polar = 0.68;
let cameraDistance = 11.8;
let target = new THREE.Vector3(0, 0.42, 0);
let animationPending = false;
let lastFrame = 0;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const keyMaterials = new WeakMap();
const basePositions = new WeakMap();
const layerOffsets = { case: -0.46, electronics: 0.28, plate: 0.08, switches: 0.52, keycaps: 1.08, cable: 0 };
const groundY = -0.2;
const groundClearance = 0.28;
const lowestFootY = -0.185;
const inwardEdgeX = 1.96;
let modelLift = 0;

function boardShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-2.05, 1.42);
  shape.lineTo(1.55, 1.42);
  shape.quadraticCurveTo(1.91, 1.4, 1.96, 1.08);
  shape.lineTo(1.79, -0.78);
  shape.quadraticCurveTo(1.73, -1.12, 1.39, -1.32);
  shape.lineTo(0.65, -1.63);
  shape.quadraticCurveTo(0.2, -1.79, -0.27, -1.62);
  shape.lineTo(-1.63, -1.12);
  shape.quadraticCurveTo(-2.03, -0.94, -2.08, -0.56);
  shape.lineTo(-2.19, 1.08);
  shape.quadraticCurveTo(-2.2, 1.38, -2.05, 1.42);
  return shape;
}

function boardRingShape() {
  const shape = boardShape();
  const boundary = boardShape().getPoints(10).slice(0, -1).reverse();
  const hole = new THREE.Path();
  boundary.forEach((point, index) => {
    const x = point.x * 0.86;
    const y = point.y * 0.82;
    if (index === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  });
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

function roundedKeyShape(width, depth, radius) {
  const shape = new THREE.Shape();
  const x = width / 2;
  const z = depth / 2;
  shape.moveTo(-x + radius, -z);
  shape.lineTo(x - radius, -z);
  shape.quadraticCurveTo(x, -z, x, -z + radius);
  shape.lineTo(x, z - radius);
  shape.quadraticCurveTo(x, z, x - radius, z);
  shape.lineTo(-x + radius, z);
  shape.quadraticCurveTo(-x, z, -x, z - radius);
  shape.lineTo(-x, -z + radius);
  shape.quadraticCurveTo(-x, -z, -x + radius, -z);
  return shape;
}

function extruded(shape, depth, bevel = 0) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: bevel ? 2 : 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 5,
    steps: 1
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function makeMaterial(color, roughness = 0.56, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

const materials = {
  case: makeMaterial('#607b84', 0.48, 0.08),
  caseEdge: makeMaterial('#3e555d', 0.52, 0.12),
  pcb: makeMaterial('#315548', 0.62, 0.08),
  plate: makeMaterial('#555d59', 0.42, 0.58),
  switch: makeMaterial('#2d302e', 0.43, 0.1),
  stem: makeMaterial('#8f918a', 0.34, 0.18),
  cap: makeMaterial('#e2ded2', 0.39, 0.02),
  capAlt: makeMaterial('#cdc8bb', 0.43, 0.01),
  controller: makeMaterial('#202523', 0.5, 0.14),
  chip: makeMaterial('#181c1b', 0.37, 0.24),
  copper: makeMaterial('#ad8063', 0.38, 0.42),
  pin: makeMaterial('#b4a681', 0.28, 0.72),
  rubber: makeMaterial('#242725', 0.72, 0)
};

function box(parent, size, position, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  parent.add(mesh);
  return mesh;
}

function addBoardBody(group, material, thickness, y, bevel) {
  const mesh = new THREE.Mesh(extruded(boardShape(), thickness, bevel), material);
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildKeyLayout() {
  const keys = [];
  const rowStagger = [-0.12, 0.02, 0.13];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 5; column++) {
      keys.push({ row, column, x: -1.47 + column * 0.72 + rowStagger[row], z: -1.02 + row * 0.72 });
    }
  }
  keys.push({ row: 3, column: 1, x: -0.05, z: 1.03, thumb: 1 });
  keys.push({ row: 3, column: 2, x: 0.7, z: 1.24, thumb: 2 });
  keys.push({ row: 3, column: 3, x: 1.34, z: 1.02, thumb: 3 });
  return keys;
}

const keyLayout = buildKeyLayout();

function createSwitch(layer, key, side) {
  const housing = box(layer, [0.39, 0.2, 0.39], [key.x, 0.11, key.z], materials.switch);
  box(layer, [0.18, 0.08, 0.18], [key.x, 0.24, key.z], materials.stem, { castShadow: false });
  housing.userData.key = { key, side };
}

function createKeycap(layer, key, side, index) {
  const shape = roundedKeyShape(0.58, 0.58, 0.065);
  const mesh = new THREE.Mesh(extruded(shape, 0.2, 0.018), index % 5 === 1 ? materials.capAlt.clone() : materials.cap.clone());
  mesh.position.set(key.x, 0.01, key.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.key = {
    key,
    side,
    label: `${side === 'left' ? 'Left' : 'Right'} half · ${rowNames[key.row]} · ${key.row === 3 ? `key ${key.thumb}` : `column ${key.column + 1}`}`,
    baseY: mesh.position.y
  };
  layer.add(mesh);
  keyMeshes.push(mesh);
  pickables.push(mesh);
  keyMaterials.set(mesh, mesh.material);
  basePositions.set(mesh, mesh.position.y);
  keyPositions.push(mesh.userData.key);
  return mesh;
}

function addElectronics(layer) {
  // The local +X edge faces the interconnect gap on both mirrored halves.
  // The assembly sits on that inner shoulder; dimensions are illustrative.
  const boardX = 1.57;
  const boardZ = 0.08;
  box(layer, [0.42, 0.065, 0.88], [boardX, 0.425, boardZ], materials.pcb);
  // Controller daughterboard and socket headers make the MCU visibly seated above the PCB.
  box(layer, [0.32, 0.045, 0.68], [boardX, 0.482, boardZ], materials.controller);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      box(layer, [0.045, 0.055, 0.055], [boardX + side * 0.18, 0.514, boardZ - 0.25 + row * 0.083], materials.pin, { castShadow: false });
    }
  }
  // MCU package and a small crystal sit below the OLED on the controller board.
  box(layer, [0.22, 0.075, 0.24], [boardX, 0.542, boardZ + 0.18], materials.chip);
  box(layer, [0.13, 0.045, 0.1], [boardX - 0.08, 0.585, boardZ + 0.3], materials.caseEdge);
  // Raised OLED module: dark glass with a restrained lit status line, mounted on the MCU.
  box(layer, [0.25, 0.035, 0.3], [boardX, 0.548, boardZ - 0.13], materials.caseEdge);
  box(layer, [0.21, 0.018, 0.25], [boardX, 0.575, boardZ - 0.13], materials.chip);
  box(layer, [0.12, 0.006, 0.018], [boardX, 0.586, boardZ - 0.18], materials.pcb, { castShadow: false });
  box(layer, [0.16, 0.006, 0.012], [boardX, 0.586, boardZ - 0.08], materials.capAlt, { castShadow: false });
  // USB connector points directly into the split gap.
  box(layer, [0.13, 0.105, 0.17], [boardX + 0.26, 0.482, boardZ + 0.02], materials.pin);
  box(layer, [0.012, 0.055, 0.1], [boardX + 0.33, 0.49, boardZ + 0.02], materials.rubber, { castShadow: false });
}

function addFeet(group) {
  for (const x of [-1.64, 1.58]) {
    for (const z of [-1.05, 0.93]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.13, 18), materials.rubber);
      foot.position.set(x, -0.12, z);
      foot.castShadow = true;
      group.add(foot);
    }
  }
}

function createHalf(side, x, mirror) {
  const half = new THREE.Group();
  half.position.x = x;
  half.scale.x = mirror ? -1 : 1;
  model.add(half);

  const layers = {};
  for (const name of ['case', 'electronics', 'plate', 'switches', 'keycaps']) {
    layers[name] = new THREE.Group();
    layers[name].position.y = { case: 0, electronics: 0, plate: 0, switches: 0.53, keycaps: 0.72 }[name];
    half.add(layers[name]);
    layerGroups[name].push(layers[name]);
  }

  addBoardBody(layers.case, materials.case, 0.09, -0.04, 0.025);
  const trayWalls = new THREE.Mesh(extruded(boardRingShape(), 0.26, 0.035), materials.case);
  trayWalls.position.y = 0.04;
  trayWalls.castShadow = true;
  trayWalls.receiveShadow = true;
  layers.case.add(trayWalls);
  addBoardBody(layers.plate, materials.plate, 0.075, 0.44, 0.012);
  addBoardBody(layers.electronics, materials.pcb, 0.055, 0.335, 0.008);
  addFeet(layers.case);
  addElectronics(layers.electronics);

  // Fasteners remain with the plate, so the plate reads as a separately mounted part.
  for (const [sx, sz] of [[-1.77, -1.14], [1.57, -1.12], [-1.73, 0.8], [1.47, 0.92]]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), materials.pin);
    screw.position.set(sx, 0.53, sz);
    layers.plate.add(screw);
  }

  keyLayout.forEach((key, index) => {
    // Progressively shift each column outward, opening a mirrored controller lane at the center split.
    const shiftedKey = { ...key, x: key.x - 0.5 * (key.column / 4) };
    createSwitch(layers.switches, shiftedKey, side);
    createKeycap(layers.keycaps, shiftedKey, side, index);
  });

  return half;
}

function createCable() {
  if (cableMesh) {
    model.remove(cableMesh);
    cableMesh.traverse(child => child.geometry?.dispose());
  }
  layerGroups.cable.length = 0;
  cableMesh = new THREE.Group();
  const spread = Number(gapControl.value) * 0.012 + 2.45;
  const leftPort = new THREE.Vector3(-spread + 1.9, 0.46, 0.1);
  const rightPort = new THREE.Vector3(spread - 1.9, 0.46, 0.1);
  const mid = (leftPort.x + rightPort.x) / 2;
  const curve = new THREE.CatmullRomCurve3([
    leftPort,
    new THREE.Vector3(mid - 0.5, 0.72, 0.34),
    new THREE.Vector3(mid + 0.5, 0.72, 0.34),
    rightPort
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.04, 8, false), materials.copper);
  cable.castShadow = true;
  cableMesh.add(cable);
  for (const endpoint of [leftPort, rightPort]) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 16), materials.caseEdge);
    port.rotation.z = Math.PI / 2;
    port.position.copy(endpoint);
    cableMesh.add(port);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 16), materials.copper);
    collar.rotation.z = Math.PI / 2;
    collar.position.copy(endpoint).add(new THREE.Vector3(endpoint.x < 0 ? 0.12 : -0.12, 0, 0));
    cableMesh.add(collar);
  }
  model.add(cableMesh);
  layerGroups.cable.push(cableMesh);
}

function updateCamera() {
  const sinPolar = Math.sin(polar);
  camera.position.set(
    target.x + cameraDistance * sinPolar * Math.sin(azimuth),
    target.y + cameraDistance * Math.cos(polar),
    target.z + cameraDistance * sinPolar * Math.cos(azimuth)
  );
  camera.lookAt(target);
  draw();
}

function zoomDistance(value) {
  return 16 - value * 0.042;
}

function zoomFactor() {
  return 1;
}

function draw() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function queueAnimation() {
  if (animationPending) return;
  animationPending = true;
  requestAnimationFrame(animateLayers);
}

function animateLayers(now) {
  animationPending = false;
  const dt = Math.min(0.05, Math.max(0.008, (now - (lastFrame || now)) / 1000));
  lastFrame = now;
  let unsettled = false;
  for (const [name, groups] of Object.entries(layerGroups)) {
    if (name === 'cable') continue;
    const explode = Number(explodeControl.value) / 100;
    const targetOffset = layerOffsets[name] * explode;
    for (const group of groups) {
      const wanted = group.userData.baseY + targetOffset;
      const diff = wanted - group.position.y;
      if (Math.abs(diff) > 0.001) {
        group.position.y = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? wanted : group.position.y + diff * Math.min(1, dt * 12);
        unsettled = true;
      } else group.position.y = wanted;
    }
  }
  for (const mesh of keyMeshes) {
    const wanted = mesh.userData.pressed ? mesh.userData.key.baseY - 0.1 : mesh.userData.key.baseY;
    const diff = wanted - mesh.position.y;
    if (Math.abs(diff) > 0.001) {
      mesh.position.y = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? wanted : mesh.position.y + diff * Math.min(1, dt * 18);
      unsettled = true;
    }
  }
  draw();
  if (unsettled) queueAnimation();
}

function setExplosion() {
  const amount = Number(explodeControl.value);
  explodeValue.value = `${amount}%`;
  explodeControl.setAttribute('aria-valuetext', `${amount} percent exploded`);
  for (const [name, groups] of Object.entries(layerGroups)) {
    if (name === 'cable') continue;
    for (const group of groups) {
      if (basePositions.has(group)) continue;
      group.userData.baseY ??= group.position.y;
    }
  }
  updateModelClearance();
  queueAnimation();
  status.textContent = amount === 0 ? 'Assembled · 36 keys · two mirrored halves' : `Exploded ${amount}% · keycaps, switches, plate, PCB and case separate vertically`;
}

function updateSplit() {
  const spread = 2.45 + Number(gapControl.value) * 0.012;
  const halves = model.children.filter(child => child.userData.halfSide);
  for (const half of halves) half.position.x = half.userData.halfSide === 'left' ? -spread : spread;
  gapValue.value = `${gapControl.value} / 80`;
  gapControl.setAttribute('aria-valuetext', `Illustrative split spacing ${gapControl.value} of 80`);
  createCable();
  applyVisibility();
  draw();
}

function updateModelClearance() {
  if (!model) return;
  const tentDrop = inwardEdgeX * Math.sin(THREE.MathUtils.degToRad(Number(tentControl.value)));
  const explodedCaseDrop = Math.abs(layerOffsets.case) * (Number(explodeControl.value) / 100);
  const lowestPartY = lowestFootY - tentDrop - explodedCaseDrop;
  const nextLift = Math.max(0, groundY + groundClearance - lowestPartY);
  const liftDelta = nextLift - modelLift;
  modelLift = nextLift;
  model.position.y = modelLift;
  target.y += liftDelta;
}

function updateTent() {
  const angle = Number(tentControl.value);
  for (const half of model.children) {
    if (!half.userData.halfSide) continue;
    half.rotation.z = (half.userData.halfSide === 'left' ? -1 : 1) * THREE.MathUtils.degToRad(angle);
  }
  tentValue.value = `${angle}°`;
  tentControl.setAttribute('aria-valuetext', `Illustrative tent angle ${angle} degrees`);
  updateModelClearance();
  updateCamera();
}

function updateZoom() {
  const value = Number(zoomControl.value);
  cameraDistance = zoomDistance(value);
  zoomValue.value = `${value}%`;
  zoomControl.setAttribute('aria-valuetext', `Model scale ${value} percent`);
  updateCamera();
}

function applyVisibility() {
  const visible = Object.fromEntries(layerInputs.map(input => [input.dataset.layer, input.checked]));
  for (const [name, groups] of Object.entries(layerGroups)) {
    const shown = visible[name];
    for (const group of groups) group.visible = shown;
  }
  const activeSelection = selectedKey && keyMeshes.find(mesh => mesh.userData.key === selectedKey);
  if (activeSelection && !visible.keycaps) selectionStatus.textContent = 'Keycaps hidden · turn the layer back on to select a key.';
  draw();
}

function setSelectedKey(mesh) {
  if (selectedKey) {
    const previous = keyMeshes.find(item => item.userData.key === selectedKey);
    if (previous) keyMaterials.get(previous).emissive.setHex(0x000000);
  }
  selectedKey = mesh ? mesh.userData.key : null;
  if (mesh) {
    keyMaterials.get(mesh).emissive.set('#a8795d');
    mesh.userData.pressed = true;
    window.setTimeout(() => {
      mesh.userData.pressed = false;
      queueAnimation();
    }, 130);
    selectionStatus.textContent = `${mesh.userData.key.label} · physical position only; no keymap assigned.`;
    const directoryButtons = [...directory.querySelectorAll('button')];
    directoryButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.keyIndex === String(keyMeshes.indexOf(mesh)))));
  } else selectionStatus.textContent = 'Select a key or a layer to inspect it.';
  queueAnimation();
}

function raycastKey(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(pickables.filter(mesh => mesh.parent?.visible), false)[0]?.object ?? null;
}

function resetView() {
  azimuth = 0.12;
  polar = 0.68;
  target.set(0, 0.42 + modelLift, 0);
  zoomControl.value = '100';
  cameraDistance = zoomDistance(100);
  zoomValue.value = '100%';
  updateCamera();
}

function addKeyDirectory() {
  keyMeshes.forEach((mesh, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.keyIndex = String(index);
    button.textContent = mesh.userData.key.label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setSelectedKey(mesh));
    directory.append(button);
  });
}

function configureControls() {
  explodeControl.addEventListener('input', setExplosion);
  gapControl.addEventListener('input', updateSplit);
  tentControl.addEventListener('input', updateTent);
  zoomControl.addEventListener('input', updateZoom);
  layerInputs.forEach(input => input.addEventListener('change', applyVisibility));

  document.querySelector('#resetView').addEventListener('click', resetView);
  document.querySelector('#resetModel').addEventListener('click', () => {
    explodeControl.value = '0';
    gapControl.value = '36';
    tentControl.value = '12';
    layerInputs.forEach(input => { input.checked = true; });
    setExplosion();
    updateSplit();
    updateTent();
    applyVisibility();
    resetView();
    selectionStatus.textContent = 'Model reassembled · select a key or layer to inspect it.';
  });

  moveModeButton.addEventListener('click', () => {
    moveMode = !moveMode;
    moveModeButton.setAttribute('aria-pressed', String(moveMode));
    moveModeButton.textContent = moveMode ? 'Orbit view' : 'Move view';
    dragModeHint.textContent = moveMode ? 'DRAG TO MOVE · RIGHT-DRAG TO ORBIT' : 'DRAG TO ORBIT · SHIFT + DRAG TO MOVE';
    stage.classList.toggle('is-panning', moveMode);
  });

  stage.addEventListener('contextmenu', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    if (event.target.closest('button,input')) return;
    stage.focus({ preventScroll: true });
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      mode: event.button === 2 || event.shiftKey || moveMode ? 'pan' : 'orbit',
      azimuth,
      polar,
      target: target.clone()
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.toggle('is-panning', drag.mode === 'pan');
    stage.classList.toggle('is-dragging', drag.mode === 'orbit');
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) {
      const mesh = raycastKey(event);
      if (mesh !== hoveredKey) {
        if (hoveredKey) keyMaterials.get(hoveredKey).emissive.setHex(hoveredKey === keyMeshes.find(item => item.userData.key === selectedKey) ? 0x4b2d21 : 0x000000);
        hoveredKey = mesh;
        if (mesh) keyMaterials.get(mesh).emissive.setHex(0x3a2a20);
        canvas.style.cursor = mesh ? 'pointer' : 'grab';
        draw();
      }
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === 'orbit') {
      azimuth = drag.azimuth - dx * 0.008;
      polar = THREE.MathUtils.clamp(drag.polar + dy * 0.006, 0.18, 1.5);
      updateCamera();
    } else {
      const panScale = cameraDistance * 0.0015;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
      const up = camera.up.clone();
      target.copy(drag.target).addScaledVector(right, -dx * panScale).addScaledVector(up, dy * panScale);
      updateCamera();
    }
  });
  const endDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const shouldPick = !drag.moved && drag.mode === 'orbit';
    drag = null;
    stage.classList.remove('is-panning', 'is-dragging');
    if (shouldPick) {
      const mesh = raycastKey(event);
      if (mesh) setSelectedKey(mesh);
    }
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('wheel', event => {
    event.preventDefault();
    cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.006, zoomDistance(145), zoomDistance(55));
    const value = Math.round((16 - cameraDistance / zoomFactor()) / 0.042);
    zoomControl.value = String(THREE.MathUtils.clamp(value, 55, 145));
    zoomValue.value = `${zoomControl.value}%`;
    updateCamera();
  }, { passive: false });

  stage.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.14 : 0.07;
    if (event.key === 'ArrowLeft') azimuth -= step;
    else if (event.key === 'ArrowRight') azimuth += step;
    else if (event.key === 'ArrowUp') polar = Math.max(0.18, polar - step);
    else if (event.key === 'ArrowDown') polar = Math.min(1.5, polar + step);
    else if (event.key === '+' || event.key === '=') cameraDistance = Math.max(zoomDistance(145), cameraDistance - 0.5);
    else if (event.key === '-') cameraDistance = Math.min(zoomDistance(55), cameraDistance + 0.5);
    else return;
    event.preventDefault();
    zoomControl.value = String(THREE.MathUtils.clamp(Math.round((16 - cameraDistance / zoomFactor()) / 0.042), 55, 145));
    zoomValue.value = `${zoomControl.value}%`;
    updateCamera();
  });
}

function resize() {
  if (!renderer || !camera) return;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  camera.aspect = width / height;
  camera.zoom = Math.min(1, camera.aspect / 1.16);
  camera.updateProjectionMatrix();
  cameraDistance = zoomDistance(Number(zoomControl.value));
  camera.updateProjectionMatrix();
  draw();
}

function init() {
  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0e13');
    scene.fog = new THREE.Fog('#0b0e13', 19, 38);

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 70);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#0b0e13', 1);

    scene.add(new THREE.HemisphereLight('#f1eadb', '#27302c', 2.1));
    const keyLight = new THREE.DirectionalLight('#fff1d9', 3.2);
    keyLight.position.set(-5, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -11;
    keyLight.shadow.camera.right = 11;
    keyLight.shadow.camera.top = 9;
    keyLight.shadow.camera.bottom = -9;
    keyLight.shadow.bias = -0.00025;
    scene.add(keyLight);
    const fill = new THREE.DirectionalLight('#a9bfbe', 1.25);
    fill.position.set(6, 5, -6);
    scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), makeMaterial('#10141a', 0.84));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = groundY;
    floor.receiveShadow = true;
    scene.add(floor);

    model = new THREE.Group();
    scene.add(model);
    const left = createHalf('left', -2.882, false);
    const right = createHalf('right', 2.882, true);
    left.userData.halfSide = 'left';
    right.userData.halfSide = 'right';
    for (const groups of Object.values(layerGroups)) {
      for (const group of groups) {
        if (group !== cableMesh) group.userData.baseY = group.position.y;
      }
    }
    createCable();
    addKeyDirectory();
    configureControls();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();
    updateCamera();
    updateSplit();
    updateTent();
    setExplosion();
    applyVisibility();
    status.textContent = 'Assembled · 36 keys · two mirrored halves';
  } catch (error) {
    console.error('The interactive keyboard model could not start.', error);
    canvas.hidden = true;
    message.hidden = false;
    message.textContent = 'This browser could not start the 3D model. Enable WebGL or try a current browser; the parts guide below is still available.';
    status.textContent = '3D model unavailable in this browser.';
    layerInputs.forEach(input => { input.disabled = true; });
    [explodeControl, gapControl, tentControl, zoomControl].forEach(input => { input.disabled = true; });
  }
}

init();
