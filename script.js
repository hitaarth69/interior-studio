// ======================================================================
//  THREE.JS SETUP
// ======================================================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(8, 6, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

// ======================================================================
//  CONTROLS
// ======================================================================
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 3;
controls.maxDistance = 25;
controls.target.set(0, 1.5, 0);

// ======================================================================
//  LIGHTING
// ======================================================================
const ambientLight = new THREE.AmbientLight(0x404060, 0.4);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a3a5a, 0.6);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
sunLight.position.set(10, 20, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 50;
sunLight.shadow.camera.left = -15;
sunLight.shadow.camera.right = 15;
sunLight.shadow.camera.top = 15;
sunLight.shadow.camera.bottom = -15;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
fillLight.position.set(-5, 3, -5);
scene.add(fillLight);

// ======================================================================
//  STATE
// ======================================================================
const state = {
    room: { width: 6, depth: 5, height: 3, wallColor: '#e8e0d5', floorColor: '#d4b896' },
    furniture: [],
    selectedId: null,
    selectedType: null,
    history: [],
    historyIndex: -1,
    maxHistory: 30,
    idCounter: 0,
    snapEnabled: true,
    gridVisible: true,
    isDragging: false,
    dragObject: null,
    dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    dragOffset: new THREE.Vector3(),
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
};

// ======================================================================
//  ROOM GROUP
// ======================================================================
const roomGroup = new THREE.Group();
scene.add(roomGroup);

let floorMesh = null;
let wallMeshes = [];
let ceilingMesh = null;
let gridHelper = null;

function buildRoom() {
    // Clear old room
    while (roomGroup.children.length > 0) {
        const child = roomGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        roomGroup.remove(child);
    }
    wallMeshes = [];
    gridHelper = null;

    const { width, depth, height, wallColor, floorColor } = state.room;
    const w2 = width / 2;
    const d2 = depth / 2;

    // Floor
    const floorGeo = new THREE.PlaneGeometry(width, depth);
    const floorMat = new THREE.MeshStandardMaterial({
        color: floorColor,
        roughness: 0.7,
        metalness: 0.0,
        side: THREE.DoubleSide,
    });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    roomGroup.add(floorMesh);

    // Grid Helper
    const grid = new THREE.GridHelper(Math.max(width, depth) * 2, 20, 0x60a5fa, 0x3b82f6);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = state.gridVisible ? 0.3 : 0;
    gridHelper = grid;
    roomGroup.add(grid);

    // Walls (4 walls)
    const wallMat = new THREE.MeshStandardMaterial({
        color: wallColor,
        roughness: 0.8,
        metalness: 0.0,
        side: THREE.DoubleSide,
    });

    const wallPositions = [
        { x: 0, z: -d2, rx: 0, rz: 0, sx: width, sz: height },
        { x: 0, z: d2, rx: 0, rz: 0, sx: width, sz: height },
        { x: -w2, z: 0, rx: 0, rz: Math.PI / 2, sx: depth, sz: height },
        { x: w2, z: 0, rx: 0, rz: Math.PI / 2, sx: depth, sz: height },
    ];

    wallPositions.forEach((wp) => {
        const geo = new THREE.PlaneGeometry(wp.sx, wp.sz);
        const mesh = new THREE.Mesh(geo, wallMat.clone());
        mesh.position.set(wp.x, height / 2, wp.z);
        mesh.rotation.x = wp.rx;
        mesh.rotation.z = wp.rz;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isWall = true;
        roomGroup.add(mesh);
        wallMeshes.push(mesh);
    });

    // Ceiling (optional, with slight transparency)
    const ceilMat = new THREE.MeshStandardMaterial({
        color: wallColor,
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        opacity: 0.4,
        side: THREE.BackSide,
    });
    const ceilGeo = new THREE.PlaneGeometry(width, depth);
    ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
    ceilingMesh.rotation.x = Math.PI / 2;
    ceilingMesh.position.y = height;
    ceilingMesh.receiveShadow = false;
    roomGroup.add(ceilingMesh);

    // Rebuild furniture (if any)
    state.furniture.forEach(f => {
        const mesh = createFurnitureMesh(f);
        if (mesh) {
            mesh.position.set(f.x, f.y || 0, f.z);
            mesh.rotation.y = f.rotation || 0;
            mesh.userData.furnitureId = f.id;
            roomGroup.add(mesh);
        }
    });

    updateFurnitureCount();
}

// ======================================================================
//  FURNITURE FACTORY
// ======================================================================
function createFurnitureMesh(data) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
        color: data.color || '#c4a882',
        roughness: 0.6,
        metalness: 0.05,
    });

    // Common materials
    const darkMat = new THREE.MeshStandardMaterial({
        color: data.color ? darkenColor(data.color, 20) : '#8a7a64',
        roughness: 0.7,
        metalness: 0.02,
    });
    const cushionMat = new THREE.MeshStandardMaterial({
        color: data.color ? lightenColor(data.color, 30) : '#e8dcc8',
        roughness: 0.8,
        metalness: 0.0,
    });

    switch (data.type) {
        case 'sofa': {
            // Seat
            const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.0), cushionMat);
            seat.position.y = 0.25;
            seat.castShadow = true;
            seat.receiveShadow = true;
            group.add(seat);
            // Back
            const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.15), mat);
            back.position.set(0, 0.55, -0.45);
            back.castShadow = true;
            back.receiveShadow = true;
            group.add(back);
            // Armrests
            const armMat = new THREE.MeshStandardMaterial({ color: darkenColor(data.color || '#c4a882', 15), roughness: 0.6 });
            const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.9), armMat);
            arm1.position.set(-1.2, 0.2, 0);
            arm1.castShadow = true;
            arm1.receiveShadow = true;
            group.add(arm1);
            const arm2 = arm1.clone();
            arm2.position.x = 1.2;
            group.add(arm2);
            // Legs
            const legMat = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.8 });
            for (let lx of [-0.9, 0.9]) {
                for (let lz of [-0.4, 0.4]) {
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6), legMat);
                    leg.position.set(lx, -0.04, lz);
                    group.add(leg);
                }
            }
            break;
        }
        case 'chair': {
            // Seat
            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), cushionMat);
            seat.position.y = 0.3;
            seat.castShadow = true;
            seat.receiveShadow = true;
            group.add(seat);
            // Back
            const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), mat);
            back.position.set(0, 0.55, -0.25);
            back.castShadow = true;
            back.receiveShadow = true;
            group.add(back);
            // Legs
            const legMat = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.8 });
            for (let lx of [-0.2, 0.2]) {
                for (let lz of [-0.2, 0.2]) {
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), legMat);
                    leg.position.set(lx, 0.15, lz);
                    group.add(leg);
                }
            }
            break;
        }
        case 'table': {
            // Top
            const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.8), mat);
            top.position.y = 0.7;
            top.castShadow = true;
            top.receiveShadow = true;
            group.add(top);
            // Legs
            const legMat = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.7 });
            for (let lx of [-0.5, 0.5]) {
                for (let lz of [-0.3, 0.3]) {
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), legMat);
                    leg.position.set(lx, 0.35, lz);
                    group.add(leg);
                }
            }
            break;
        }
        case 'bed': {
            // Mattress
            const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 1.6), cushionMat);
            mattress.position.y = 0.15;
            mattress.castShadow = true;
            mattress.receiveShadow = true;
            group.add(mattress);
            // Frame
            const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 1.7), darkMat);
            frame.position.y = 0.05;
            frame.receiveShadow = true;
            group.add(frame);
            // Pillow
            const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.4), new THREE.MeshStandardMaterial({
                color: lightenColor(data.color || '#c4a882', 50),
                roughness: 0.9
            }));
            pillow.position.set(0.5, 0.35, 0);
            pillow.castShadow = true;
            group.add(pillow);
            // Legs
            const legMat = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.8 });
            for (let lx of [-0.9, 0.9]) {
                for (let lz of [-0.7, 0.7]) {
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6), legMat);
                    leg.position.set(lx, -0.03, lz);
                    group.add(leg);
                }
            }
            break;
        }
        case 'shelf': {
            const shelfMat = new THREE.MeshStandardMaterial({ color: darkenColor(data.color || '#c4a882', 30), roughness: 0.5 });
            // Uprights
            for (let sx of [-0.4, 0.4]) {
                const upright = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), shelfMat);
                upright.position.set(sx, 0.45, 0);
                group.add(upright);
            }
            // Shelves
            for (let i = 0; i < 4; i++) {
                const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.3), mat);
                shelf.position.set(0, i * 0.22 + 0.1, 0);
                shelf.castShadow = true;
                shelf.receiveShadow = true;
                group.add(shelf);
            }
            break;
        }
        case 'lamp': {
            // Base
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.06, 16), darkMat);
            base.position.y = 0.03;
            base.receiveShadow = true;
            group.add(base);
            // Stem
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), new THREE
        .MeshStandardMaterial({ color: '#888', metalness: 0.6, roughness: 0.3 }));
            stem.position.y = 0.3;
            group.add(stem);
            // Shade
            const shadeMat = new THREE.MeshStandardMaterial({
                color: lightenColor(data.color || '#c4a882', 40),
                roughness: 0.8,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.6,
            });
            const shade = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.25, 16), shadeMat);
            shade.position.y = 0.6;
            shade.castShadow = true;
            group.add(shade);
            // Light glow (point light)
            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xffdd88 })
            );
            glow.position.y = 0.45;
            group.add(glow);
            break;
        }
        case 'plant': {
            // Pot
            const potMat = new THREE.MeshStandardMaterial({ color: darkenColor(data.color || '#c4a882', 40), roughness: 0.8 });
            const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 12), potMat);
            pot.position.y = 0.1;
            pot.castShadow = true;
            pot.receiveShadow = true;
            group.add(pot);
            // Leaves (simple spheres)
            const leafMat = new THREE.MeshStandardMaterial({ color: '#3a7a3a', roughness: 0.9 });
            for (let i = 0; i < 8; i++) {
                const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.08, 6, 6), leafMat);
                const theta = Math.random() * Math.PI * 2;
                const r = 0.1 + Math.random() * 0.15;
                leaf.position.set(Math.cos(theta) * r, 0.25 + Math.random() * 0.15, Math.sin(theta) * r);
                leaf.castShadow = true;
                group.add(leaf);
            }
            break;
        }
        case 'rug': {
            const rugMat = new THREE.MeshStandardMaterial({
                color: data.color || '#8a6e4b',
                roughness: 0.95,
                metalness: 0.0,
                side: THREE.DoubleSide,
            });
            const rug = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), rugMat);
            rug.rotation.x = -Math.PI / 2;
            rug.position.y = 0.01;
            rug.receiveShadow = true;
            group.add(rug);
            break;
        }
        default: {
            // Fallback: a simple box
            const fallback = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat);
            fallback.castShadow = true;
            fallback.receiveShadow = true;
            group.add(fallback);
        }
    }

    // Store type and color for reference
    group.userData.type = data.type;
    group.userData.color = data.color || '#c4a882';
    group.userData.furnitureId = data.id;

    return group;
}

// ======================================================================
//  COLOR HELPERS
// ======================================================================
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 196, g: 168, b: 130 };
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

function darkenColor(hex, amount) {
    const c = hexToRgb(hex);
    return rgbToHex(c.r - amount, c.g - amount, c.b - amount);
}

function lightenColor(hex, amount) {
    const c = hexToRgb(hex);
    return rgbToHex(c.r + amount, c.g + amount, c.b + amount);
}

// ======================================================================
//  FURNITURE MANAGEMENT
// ======================================================================
function addFurniture(type, x, z, rotation = 0) {
    const colorOptions = {
        sofa: '#c4a882',
        chair: '#b89a78',
        table: '#a88c6e',
        bed: '#d4c4a8',
        shelf: '#c4b89a',
        lamp: '#e8dcc8',
        plant: '#8a9a6a',
        rug: '#8a6e4b',
    };
    const color = colorOptions[type] || '#c4a882';

    const id = ++state.idCounter;
    const furniture = {
        id,
        type,
        x,
        z,
        y: 0,
        rotation: rotation || 0,
        color: color,
    };
    state.furniture.push(furniture);
    const mesh = createFurnitureMesh(furniture);
    if (mesh) {
        mesh.position.set(x, 0, z);
        mesh.rotation.y = rotation || 0;
        mesh.userData.furnitureId = id;
        roomGroup.add(mesh);
    }
    updateFurnitureCount();
    pushHistory();
    return id;
}

function removeFurniture(id) {
    const index = state.furniture.findIndex(f => f.id === id);
    if (index === -1) return;
    state.furniture.splice(index, 1);
    // Remove mesh
    const toRemove = roomGroup.children.find(c => c.userData.furnitureId === id);
    if (toRemove) {
        roomGroup.remove(toRemove);
        // Dispose
        toRemove.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material?.dispose();
                }
            }
        });
    }
    if (state.selectedId === id) state.selectedId = null;
    updateFurnitureCount();
    pushHistory();
}

function clearRoom() {
    if (state.furniture.length === 0) return;
    if (!confirm('Delete all furniture?')) return;
    state.furniture.forEach(f => {
        const mesh = roomGroup.children.find(c => c.userData.furnitureId === f.id);
        if (mesh) {
            roomGroup.remove(mesh);
            mesh.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material?.dispose();
                    }
                }
            });
        }
    });
    state.furniture = [];
    state.selectedId = null;
    updateFurnitureCount();
    pushHistory();
}

function updateFurnitureCount() {
    document.getElementById('furniture-count').textContent = `${state.furniture.length} items`;
}

// ======================================================================
//  HISTORY (UNDO/REDO)
// ======================================================================
function pushHistory() {
    // Trim future states
    state.history = state.history.slice(0, state.historyIndex + 1);
    const snapshot = {
        furniture: JSON.parse(JSON.stringify(state.furniture)),
        room: JSON.parse(JSON.stringify(state.room)),
        idCounter: state.idCounter,
    };
    state.history.push(snapshot);
    if (state.history.length > state.maxHistory) {
        state.history.shift();
    }
    state.historyIndex = state.history.length - 1;
    updateUndoRedoButtons();
}

function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    restoreSnapshot(state.history[state.historyIndex]);
    updateUndoRedoButtons();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    restoreSnapshot(state.history[state.historyIndex]);
    updateUndoRedoButtons();
}

function restoreSnapshot(snapshot) {
    // Remove all furniture meshes
    const toRemove = roomGroup.children.filter(c => c.userData.furnitureId !== undefined);
    toRemove.forEach(mesh => {
        roomGroup.remove(mesh);
        mesh.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material?.dispose();
                }
            }
        });
    });

    state.furniture = JSON.parse(JSON.stringify(snapshot.furniture));
    state.room = JSON.parse(JSON.stringify(snapshot.room));
    state.idCounter = snapshot.idCounter;

    // Rebuild room
    buildRoom();

    // Rebuild furniture
    state.furniture.forEach(f => {
        const mesh = createFurnitureMesh(f);
        if (mesh) {
            mesh.position.set(f.x, f.y || 0, f.z);
            mesh.rotation.y = f.rotation || 0;
            mesh.userData.furnitureId = f.id;
            roomGroup.add(mesh);
        }
    });

    updateFurnitureCount();
    updateUndoRedoButtons();
    updateUIFromState();
}

function updateUndoRedoButtons() {
    document.getElementById('undo-btn').disabled = state.historyIndex <= 0;
    document.getElementById('redo-btn').disabled = state.historyIndex >= state.history.length - 1;
}

function updateUIFromState() {
    document.getElementById('room-width').value = state.room.width;
    document.getElementById('room-depth').value = state.room.depth;
    document.getElementById('room-height').value = state.room.height;
    document.getElementById('width-val').textContent = state.room.width;
    document.getElementById('depth-val').textContent = state.room.depth;
    document.getElementById('height-val').textContent = state.room.height;

    // Update color pickers
    document.querySelectorAll('#wall-color-picker button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === state.room.wallColor);
    });
    document.querySelectorAll('#floor-color-picker button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === state.room.floorColor);
    });
}

// ======================================================================
//  DRAG & DROP (3D)
// ======================================================================
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragOffset = new THREE.Vector3();
let isDragging = false;
let dragObject = null;

function getIntersection(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    state.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.mouse, camera);
    const intersects = state.raycaster.intersectObjects(roomGroup.children, true);
    return intersects;
}

function getFloorIntersection(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    state.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.mouse, camera);
    const planeIntersect = new THREE.Vector3();
    const ray = state.raycaster.ray;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersects = ray.intersectPlane(plane, planeIntersect);
    if (intersects) {
        // Check if within room bounds
        const { width, depth } = state.room;
        const halfW = width / 2;
        const halfD = depth / 2;
        if (planeIntersect.x >= -halfW && planeIntersect.x <= halfW &&
            planeIntersect.z >= -halfD && planeIntersect.z <= halfD) {
            return planeIntersect;
        }
    }
    return null;
}

// Mouse events
renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return; // Left click only

    // Check if clicking on furniture
    const intersects = getIntersection(event);
    let hitFurniture = null;
    for (const hit of intersects) {
        let obj = hit.object;
        while (obj) {
            if (obj.userData && obj.userData.furnitureId !== undefined) {
                hitFurniture = obj;
                break;
            }
            obj = obj.parent;
        }
        if (hitFurniture) break;
    }

    if (hitFurniture) {
        const id = hitFurniture.userData.furnitureId;
        state.selectedId = id;
        isDragging = true;
        dragObject = hitFurniture;

        // Calculate offset
        const planeIntersect = getFloorIntersection(event);
        if (planeIntersect) {
            const pos = new THREE.Vector3();
            dragObject.getWorldPosition(pos);
            dragOffset.copy(planeIntersect).sub(pos);
            dragOffset.y = 0;
        }
        setStatus(`🔍 Selected ${state.furniture.find(f => f.id === id)?.type || 'item'}`);
        return;
    }

    // Check if clicking on floor (place furniture)
    const floorHit = getFloorIntersection(event);
    if (floorHit && state.selectedType) {
        // Snap to grid
        let x = floorHit.x;
        let z = floorHit.z;
        if (state.snapEnabled) {
            const snapSize = 0.5;
            x = Math.round(x / snapSize) * snapSize;
            z = Math.round(z / snapSize) * snapSize;
        }
        const id = addFurniture(state.selectedType, x, z, 0);
        state.selectedId = id;
        setStatus(`✅ Placed ${state.selectedType}`);
        return;
    }

    // Deselect
    state.selectedId = null;
    setStatus('✅ Deselected');
});

renderer.domElement.addEventListener('mousemove', (event) => {
    if (!isDragging || !dragObject) return;
    const planeIntersect = getFloorIntersection(event);
    if (planeIntersect) {
        let x = planeIntersect.x - dragOffset.x;
        let z = planeIntersect.z - dragOffset.z;
        if (state.snapEnabled) {
            const snapSize = 0.5;
            x = Math.round(x / snapSize) * snapSize;
            z = Math.round(z / snapSize) * snapSize;
        }
        // Clamp to room bounds
        const { width, depth } = state.room;
        const halfW = width / 2 - 0.2;
        const halfD = depth / 2 - 0.2;
        x = Math.max(-halfW, Math.min(halfW, x));
        z = Math.max(-halfD, Math.min(halfD, z));
        dragObject.position.x = x;
        dragObject.position.z = z;
        // Update state
        const id = dragObject.userData.furnitureId;
        const f = state.furniture.find(f => f.id === id);
        if (f) {
            f.x = x;
            f.z = z;
        }
    }
});

renderer.domElement.addEventListener('mouseup', () => {
    if (isDragging && dragObject) {
        const id = dragObject.userData.furnitureId;
        const f = state.furniture.find(f => f.id === id);
        if (f) {
            f.x = dragObject.position.x;
            f.z = dragObject.position.z;
            pushHistory();
            setStatus(`📦 Moved ${f.type}`);
        }
    }
    isDragging = false;
    dragObject = null;
});

// Right-click to delete
renderer.domElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const intersects = getIntersection(event);
    for (const hit of intersects) {
        let obj = hit.object;
        while (obj) {
            if (obj.userData && obj.userData.furnitureId !== undefined) {
                const id = obj.userData.furnitureId;
                const f = state.furniture.find(f => f.id === id);
                if (f && confirm(`Delete ${f.type}?`)) {
                    removeFurniture(id);
                    setStatus(`🗑️ Deleted ${f.type}`);
                }
                return;
            }
            obj = obj.parent;
        }
    }
});

// ======================================================================
//  UI EVENT BINDINGS
// ======================================================================
// Room controls
document.getElementById('room-width').addEventListener('input', (e) => {
    state.room.width = parseFloat(e.target.value);
    document.getElementById('width-val').textContent = state.room.width;
    rebuildRoom();
});
document.getElementById('room-depth').addEventListener('input', (e) => {
    state.room.depth = parseFloat(e.target.value);
    document.getElementById('depth-val').textContent = state.room.depth;
    rebuildRoom();
});
document.getElementById('room-height').addEventListener('input', (e) => {
    state.room.height = parseFloat(e.target.value);
    document.getElementById('height-val').textContent = state.room.height;
    rebuildRoom();
});

function rebuildRoom() {
    // Save furniture positions relative to room
    const oldWidth = state.room.width;
    const oldDepth = state.room.depth;
    // Rebuild
    buildRoom();
    // Rescale furniture positions if room size changed
    const scaleX = state.room.width / oldWidth;
    const scaleZ = state.room.depth / oldDepth;
    state.furniture.forEach(f => {
        f.x *= scaleX;
        f.z *= scaleZ;
        const mesh = roomGroup.children.find(c => c.userData.furnitureId === f.id);
        if (mesh) {
            mesh.position.x = f.x;
            mesh.position.z = f.z;
        }
    });
    pushHistory();
    updateUIFromState();
}

// Wall color
document.querySelectorAll('#wall-color-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
        state.room.wallColor = btn.dataset.color;
        document.querySelectorAll('#wall-color-picker button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Update wall materials
        wallMeshes.forEach(mesh => {
            mesh.material.color.set(state.room.wallColor);
        });
        if (ceilingMesh) {
            ceilingMesh.material.color.set(state.room.wallColor);
        }
        pushHistory();
        setStatus(`🎨 Wall color updated`);
    });
});

// Floor color
document.querySelectorAll('#floor-color-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
        state.room.floorColor = btn.dataset.color;
        document.querySelectorAll('#floor-color-picker button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (floorMesh) {
            floorMesh.material.color.set(state.room.floorColor);
        }
        pushHistory();
        setStatus(`🎨 Floor color updated`);
    });
});

// Furniture buttons
document.querySelectorAll('.furniture-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.furniture-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedType = btn.dataset.type;
        setStatus(`✋ Selected ${btn.dataset.type} — Click the floor to place it.`);
    });
});

// Delete selected
document.getElementById('delete-selected-btn').addEventListener('click', () => {
    if (state.selectedId === null) {
        setStatus('⚠️ No item selected');
        return;
    }
    const f = state.furniture.find(f => f.id === state.selectedId);
    if (f) {
        removeFurniture(state.selectedId);
        setStatus(`🗑️ Deleted ${f.type}`);
    }
});

// Rotate selected
document.getElementById('rotate-selected-btn').addEventListener('click', () => {
    if (state.selectedId === null) {
        setStatus('⚠️ No item selected');
        return;
    }
    const f = state.furniture.find(f => f.id === state.selectedId);
    if (f) {
        f.rotation = (f.rotation || 0) + Math.PI / 4;
        const mesh = roomGroup.children.find(c => c.userData.furnitureId === f.id);
        if (mesh) mesh.rotation.y = f.rotation;
        pushHistory();
        setStatus(`🔄 Rotated ${f.type}`);
    }
});

// Snap toggle
document.getElementById('snap-toggle-btn').addEventListener('click', () => {
    state.snapEnabled = !state.snapEnabled;
    document.getElementById('snap-toggle-btn').textContent = state.snapEnabled ? '🔲 Snap: On' : '🔲 Snap: Off';
    setStatus(state.snapEnabled ? '✅ Snap enabled' : '✅ Snap disabled');
});

// Grid toggle
document.getElementById('grid-toggle-btn').addEventListener('click', () => {
    state.gridVisible = !state.gridVisible;
    if (gridHelper) {
        gridHelper.material.opacity = state.gridVisible ? 0.3 : 0;
    }
    document.getElementById('grid-toggle-btn').style.opacity = state.gridVisible ? 1 : 0.4;
    setStatus(state.gridVisible ? '📐 Grid visible' : '📐 Grid hidden');
});

// Undo/Redo
document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        document.getElementById('delete-selected-btn').click();
    }
    if (e.key === 'r' || e.key === 'R') {
        document.getElementById('rotate-selected-btn').click();
    }
});

// ======================================================================
//  EXPORT & SAVE
// ======================================================================
document.getElementById('export-png-btn').addEventListener('click', () => {
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.download = 'interior-design.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
    setStatus('📸 PNG exported!');
});

document.getElementById('save-room-btn').addEventListener('click', () => {
    const data = {
        room: state.room,
        furniture: state.furniture,
        idCounter: state.idCounter,
        version: '1.0',
        savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `interior-room-${new Date().toISOString().slice(0,10)}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setStatus('💾 Room saved!');
});

document.getElementById('load-room-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!data.room || !data.furniture) throw new Error('Invalid file');
                // Clear current
                clearRoom();
                state.room = data.room;
                state.furniture = data.furniture || [];
                state.idCounter = data.idCounter || 0;
                // Rebuild
                buildRoom();
                state.furniture.forEach(f => {
                    const mesh = createFurnitureMesh(f);
                    if (mesh) {
                        mesh.position.set(f.x, f.y || 0, f.z);
                        mesh.rotation.y = f.rotation || 0;
                        mesh.userData.furnitureId = f.id;
                        roomGroup.add(mesh);
                    }
                });
                updateFurnitureCount();
                updateUIFromState();
                pushHistory();
                setStatus(`📂 Loaded room with ${state.furniture.length} items`);
            } catch (err) {
                setStatus(`❌ Failed to load: ${err.message}`);
            }
        };
        reader.readAsText(file);
    };
    input.click();
});

document.getElementById('reset-room-btn').addEventListener('click', () => {
    if (!confirm('Reset everything? This will delete all furniture and reset room settings.')) return;
    clearRoom();
    state.room = { width: 6, depth: 5, height: 3, wallColor: '#e8e0d5', floorColor: '#d4b896' };
    state.idCounter = 0;
    state.selectedId = null;
    state.furniture = [];
    buildRoom();
    updateUIFromState();
    pushHistory();
    setStatus('🔄 Room reset');
});

// ======================================================================
//  THEME TOGGLE
// ======================================================================
document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('theme-toggle').innerHTML = isDark ? '<i class="fas fa-sun"></i>' :
        '<i class="fas fa-moon"></i>';
    localStorage.setItem('interior-theme', isDark ? 'light' : 'dark');
});

// Load saved theme
const savedTheme = localStorage.getItem('interior-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
document.getElementById('theme-toggle').innerHTML = savedTheme === 'dark' ? '<i class="fas fa-moon"></i>' :
    '<i class="fas fa-sun"></i>';

// ======================================================================
//  SET STATUS
// ======================================================================
function setStatus(msg) {
    document.getElementById('status-text').textContent = msg;
}

// ======================================================================
//  RESIZE
// ======================================================================
window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

// ======================================================================
//  ANIMATION LOOP
// ======================================================================
let frameCount = 0;
let lastFpsUpdate = performance.now();

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Animate lamp glow
    roomGroup.children.forEach(child => {
        if (child.userData.type === 'lamp') {
            child.children.forEach(c => {
                if (c.isMesh && c.material.type === 'MeshBasicMaterial') {
                    const pulse = 0.8 + Math.sin(Date.now() * 0.002) * 0.2;
                    c.material.color.setHSL(0.1, 0.8, 0.5 * pulse);
                }
            });
        }
    });

    renderer.render(scene, camera);

    // FPS counter
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate > 1000) {
        document.getElementById('fps-display').textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsUpdate = now;
    }
}

// ======================================================================
//  INIT
// ======================================================================
buildRoom();
updateUIFromState();
pushHistory();
setStatus('🏠 Ready — Click a furniture type, then click the floor to place it.');
animate();

console.log('🏠 Interior Studio loaded!');
