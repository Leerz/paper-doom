// Paper DOOM - World's Only First-Person Sheet of Paper
//
// Two modes:
//   PAPER MODE - flat sprite compositing (original)
//   3D MODE - origami flip transitions, panels fold open like book pages
//
// Panels (from asset/ folder), all 670x506 transparent PNGs:
//   floor.png  - floor trapezoid
//   front.png  - back wall
//   left1.png  - far left wall
//   left2.png  - near left wall (large)
//   right1.png - far right wall
//   right2.png - near right wall (large)

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

const W = 670, H = 506;
canvas.width = W;
canvas.height = H;

// ---- Load panel images ----
const PANEL_NAMES = ['black', 'floor', 'front', 'left1', 'left2', 'right1', 'right2'];
const panels = {};
let loadCount = 0;
let allLoaded = false;

PANEL_NAMES.forEach(name => {
  const img = new Image();
  img.onload = () => {
    panels[name] = img;
    loadCount++;
    if (loadCount === PANEL_NAMES.length) allLoaded = true;
  };
  img.onerror = () => console.warn('Failed to load:', name);
  img.src = 'asset/' + name + '.png';
});

// ---- Map ----
const MAP_W = 8, MAP_H = 8;
const map = [];

function initMap() {
  //   0 1 2 3 4 5 6 7
  // 0 . . . . . . . .
  // 1 . . X . . . . .
  // 2 . . X . . X X .
  // 3 . . X X X X X .    Main E-W corridor
  // 4 . X X . X . . .
  // 5 . X . . X X . .
  // 6 . . X . . . . .    Player starts (2,6) facing N
  // 7 . . . . . . . .

  for (let i = 0; i < MAP_W * MAP_H; i++) map[i] = { n: 1, e: 1, s: 1, w: 1 };
  function cell(x, y) { return map[y * MAP_W + x]; }
  function open(x1, y1, x2, y2) {
    if (x2 === x1 + 1) { cell(x1, y1).e = 0; cell(x2, y2).w = 0; }
    if (x2 === x1 - 1) { cell(x1, y1).w = 0; cell(x2, y2).e = 0; }
    if (y2 === y1 + 1) { cell(x1, y1).s = 0; cell(x2, y2).n = 0; }
    if (y2 === y1 - 1) { cell(x1, y1).n = 0; cell(x2, y2).s = 0; }
  }
  for (let y = 1; y < 6; y++) open(2, y, 2, y + 1);
  for (let x = 2; x < 6; x++) open(x, 3, x + 1, 3);
  open(5, 3, 5, 2); open(5, 2, 6, 2); open(6, 2, 6, 3);
  open(4, 3, 4, 4); open(4, 4, 4, 5); open(4, 5, 5, 5);
  open(2, 4, 1, 4); open(1, 4, 1, 5); open(1, 5, 1, 6);
}

// ---- Player ----
let playerX = 2, playerY = 6;
let playerDir = 0; // 0=N, 1=E, 2=S, 3=W
const DIR_DX = [0, 1, 0, -1];
const DIR_DY = [-1, 0, 1, 0];
const DIR_NAMES = ['N', 'E', 'S', 'W'];

let inputLock = false;
let animT = 0, animType = null;
const ANIM_SPEED = 1.5;

// ---- Mode ----
// 'paper' = flat compositing, 'origami' = 3D origami flips, 'doom' = raycaster+paper, 'roam' = free roam
let gameMode = 'paper';

// ---- Input ----
const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; e.preventDefault(); });
document.addEventListener('keyup', e => keys[e.code] = false);

function getCell(x, y) {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return { n: 1, e: 1, s: 1, w: 1 };
  return map[y * MAP_W + x];
}
function wallInDir(x, y, dir) { return [getCell(x,y).n, getCell(x,y).e, getCell(x,y).s, getCell(x,y).w][dir]; }
function isOpen(x, y, dir) { return wallInDir(x, y, dir) === 0; }
function stepXY(x, y, dir) { return [x + DIR_DX[dir], y + DIR_DY[dir]]; }

// ---- Panel visibility logic ----
function getVisiblePanels() {
  const fwd = playerDir;
  const lft = (playerDir + 3) % 4;
  const rgt = (playerDir + 1) % 4;
  const cx = playerX, cy = playerY;

  const nearLeft = !isOpen(cx, cy, lft);
  const nearRight = !isOpen(cx, cy, rgt);
  const frontBlocked = !isOpen(cx, cy, fwd);

  let farLeft = nearLeft, farRight = nearRight, farFront = frontBlocked;
  if (!frontBlocked) {
    const [nx, ny] = stepXY(cx, cy, fwd);
    farLeft = !isOpen(nx, ny, lft);
    farRight = !isOpen(nx, ny, rgt);
    farFront = !isOpen(nx, ny, fwd);
  }

  return {
    floor: true,
    front: farFront,
    left2: nearLeft,
    right2: nearRight,
    left1: farLeft,
    right1: farRight,
  };
}

// Get panels for a hypothetical position/direction
function getVisiblePanelsAt(px, py, pd) {
  const fwd = pd;
  const lft = (pd + 3) % 4;
  const rgt = (pd + 1) % 4;

  const nearLeft = !isOpen(px, py, lft);
  const nearRight = !isOpen(px, py, rgt);
  const frontBlocked = !isOpen(px, py, fwd);

  let farLeft = nearLeft, farRight = nearRight, farFront = frontBlocked;
  if (!frontBlocked) {
    const [nx, ny] = stepXY(px, py, fwd);
    farLeft = !isOpen(nx, ny, lft);
    farRight = !isOpen(nx, ny, rgt);
    farFront = !isOpen(nx, ny, fwd);
  }

  return { floor: true, front: farFront, left2: nearLeft, right2: nearRight, left1: farLeft, right1: farRight };
}

// ---- Manual / Auto mode ----
let manualMode = false; // start in auto

let layerOrder = ['floor', 'left1', 'right1', 'left2', 'right2', 'front'];

function getToggles() {
  return {
    floor:  document.getElementById('tog-floor').checked,
    front:  document.getElementById('tog-front').checked,
    left1:  document.getElementById('tog-left1').checked,
    left2:  document.getElementById('tog-left2').checked,
    right1: document.getElementById('tog-right1').checked,
    right2: document.getElementById('tog-right2').checked,
    black:  document.getElementById('tog-black').checked,
  };
}

document.getElementById('mode-toggle').addEventListener('click', function() {
  manualMode = !manualMode;
  this.textContent = manualMode ? 'Mode: MANUAL' : 'Mode: AUTO';
});

// ---- 3D Origami flip rendering ----
// Each panel has an anchor edge and flips around it:
//   left2  - anchored on LEFT edge, flips open to the left (rotateY)
//   left1  - anchored on LEFT edge, flips open to the left
//   right2 - anchored on RIGHT edge, flips open to the right
//   right1 - anchored on RIGHT edge, flips open to the right
//   front  - anchored on TOP edge, flips up (rotateX)
//   floor  - anchored on BOTTOM edge, flips down (rotateX)
//
// During a forward step transition:
//   - Current "near" panels (left2, right2) fold OPEN (away from viewer)
//   - Current front wall folds up/away
//   - Next cell's panels fold IN (from open to closed)
//
// We simulate the 3D fold using canvas 2D by applying a horizontal scale
// (for left/right walls) or vertical scale (for floor/front) anchored at the edge.

function drawPanelWithFlip(name, flipAmount) {
  // flipAmount: 0 = fully visible (flat), 1 = fully folded away (invisible)
  // Negative = folding toward viewer (for incoming panels)
  const img = panels[name];
  if (!img) return;

  const t = Math.max(0, Math.min(1, Math.abs(flipAmount)));
  // Scale factor: cos of the flip angle (0° = flat, 90° = edge-on)
  const scale = Math.cos(t * Math.PI / 2);
  if (scale < 0.01) return; // fully folded, invisible

  // Darken as it folds (simulates light falloff on angled paper)
  const shade = 0.3 + 0.7 * scale;

  ctx.save();

  if (name === 'left2' || name === 'left1') {
    // Anchored on LEFT edge - scale horizontally from left
    ctx.translate(0, 0);
    ctx.scale(scale, 1);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fillRect(0, 0, W, H);
  } else if (name === 'right2' || name === 'right1') {
    // Anchored on RIGHT edge - scale horizontally from right
    ctx.translate(W, 0);
    ctx.scale(-scale, 1);
    ctx.translate(-W, 0);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fillRect(0, 0, W, H);
  } else if (name === 'front') {
    // Anchored on TOP edge - scale vertically from top
    ctx.translate(0, 0);
    ctx.scale(1, scale);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fillRect(0, 0, W, H);
  } else if (name === 'floor') {
    // Floor never flips, just draw it flat
    ctx.drawImage(img, 0, 0);
  }

  ctx.restore();
}

// ---- DOOM mode state ----
// Continuous position for free movement (center of cell = x+0.5, y+0.5)
let doomX = playerX + 0.5, doomY = playerY + 0.5;
let doomAngle = -Math.PI / 2; // radians, -PI/2 = North
const DOOM_MOVE_SPEED = 2.5;
const DOOM_TURN_SPEED = 2.5;
const DOOM_FOV = Math.PI / 3; // 60 degrees

// Sync doom position when switching modes
function syncDoomFromGrid() {
  doomX = playerX + 0.5;
  doomY = playerY + 0.5;
  doomAngle = [- Math.PI / 2, 0, Math.PI / 2, Math.PI][playerDir];
}

function syncGridFromDoom() {
  playerX = Math.floor(doomX);
  playerY = Math.floor(doomY);
  // Snap to nearest cardinal direction
  let a = ((doomAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (a < Math.PI / 4 || a >= 7 * Math.PI / 4) playerDir = 1; // East
  else if (a < 3 * Math.PI / 4) playerDir = 2; // South
  else if (a < 5 * Math.PI / 4) playerDir = 3; // West
  else playerDir = 0; // North
}

// Check if a world position hits a wall
function doomWallAt(wx, wy) {
  const gx = Math.floor(wx), gy = Math.floor(wy);
  if (gx < 0 || gx >= MAP_W || gy < 0 || gy >= MAP_H) return true;
  // Check wall boundaries between cells
  return false; // cells are open space; walls are on edges
}

// DDA raycaster - cast a single ray and return distance + side hit
function castRay(ox, oy, angle) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  let mapX = Math.floor(ox), mapY = Math.floor(oy);
  const deltaDistX = Math.abs(1 / dirX);
  const deltaDistY = Math.abs(1 / dirY);
  let stepX, stepY, sideDistX, sideDistY;

  if (dirX < 0) { stepX = -1; sideDistX = (ox - mapX) * deltaDistX; }
  else { stepX = 1; sideDistX = (mapX + 1 - ox) * deltaDistX; }
  if (dirY < 0) { stepY = -1; sideDistY = (oy - mapY) * deltaDistY; }
  else { stepY = 1; sideDistY = (mapY + 1 - oy) * deltaDistY; }

  let side = 0;
  for (let i = 0; i < 64; i++) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0; // vertical wall (E/W face)
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1; // horizontal wall (N/S face)
    }

    // Check if we hit a wall edge
    const prevX = mapX - (side === 0 ? stepX : 0);
    const prevY = mapY - (side === 1 ? stepY : 0);

    if (mapX < 0 || mapX >= MAP_W || mapY < 0 || mapY >= MAP_H) {
      // Out of bounds = wall
      const dist = side === 0
        ? (mapX - ox + (1 - stepX) / 2) / dirX
        : (mapY - oy + (1 - stepY) / 2) / dirY;
      return { dist: Math.max(0.01, dist), side, dark: side === 1 };
    }

    // Check wall between previous cell and current cell
    let hitWall = false;
    if (side === 0) {
      // Crossed a vertical edge (E/W)
      if (stepX > 0) hitWall = getCell(prevX, prevY).e; // walked East
      else hitWall = getCell(prevX, prevY).w; // walked West
    } else {
      // Crossed a horizontal edge (N/S)
      if (stepY > 0) hitWall = getCell(prevX, prevY).s; // walked South
      else hitWall = getCell(prevX, prevY).n; // walked North
    }

    if (hitWall) {
      const dist = side === 0
        ? (mapX - ox + (1 - stepX) / 2) / dirX
        : (mapY - oy + (1 - stepY) / 2) / dirY;
      return { dist: Math.max(0.01, dist), side, dark: side === 1 };
    }
  }

  return { dist: 20, side: 0, dark: false };
}

function updateDoom(dt) {
  const turnL = keys['KeyA'] || keys['ArrowLeft'];
  const turnR = keys['KeyD'] || keys['ArrowRight'];
  const fwd = keys['KeyW'] || keys['ArrowUp'];
  const bck = keys['KeyS'] || keys['ArrowDown'];

  if (turnL) doomAngle -= DOOM_TURN_SPEED * dt;
  if (turnR) doomAngle += DOOM_TURN_SPEED * dt;

  let mx = 0, my = 0;
  if (fwd) { mx += Math.cos(doomAngle) * DOOM_MOVE_SPEED * dt; my += Math.sin(doomAngle) * DOOM_MOVE_SPEED * dt; }
  if (bck) { mx -= Math.cos(doomAngle) * DOOM_MOVE_SPEED * dt; my -= Math.sin(doomAngle) * DOOM_MOVE_SPEED * dt; }

  // Collision with wall edges using player radius
  const r = 0.15;
  const nx = doomX + mx, ny = doomY + my;

  // Try X first
  const gx0 = Math.floor(doomX), gy0 = Math.floor(doomY);
  let canX = true;
  // Check if moving into a wall edge
  if (mx > 0 && Math.floor(nx + r) > gx0 && !isOpen(gx0, gy0, 1)) canX = false;
  if (mx < 0 && Math.floor(nx - r) < gx0 && !isOpen(gx0, gy0, 3)) canX = false;
  if (canX) doomX = nx;

  // Try Y with updated X
  const gx1 = Math.floor(doomX), gy1 = Math.floor(doomY);
  let canY = true;
  if (my > 0 && Math.floor(ny + r) > gy1 && !isOpen(gx1, gy1, 2)) canY = false;
  if (my < 0 && Math.floor(ny - r) < gy1 && !isOpen(gx1, gy1, 0)) canY = false;
  if (canY) doomY = ny;

  syncGridFromDoom();
}

function renderRaycast(camX, camY, camAngle) {
  const fogDist = parseFloat(document.getElementById('fog-dist').value);
  const fogR = 10, fogG = 8, fogB = 6; // dark brownish fog

  // Ceiling
  ctx.fillStyle = `rgb(${fogR + 20},${fogG + 16},${fogB + 14})`;
  ctx.fillRect(0, 0, W, H / 2);
  // Floor
  ctx.fillStyle = `rgb(${fogR + 40},${fogG + 32},${fogB + 28})`;
  ctx.fillRect(0, H / 2, W, H / 2);

  const wallScale = 0.7;
  const numRays = W;
  for (let x = 0; x < numRays; x++) {
    const cameraX = 2 * x / numRays - 1;
    const rayAngle = camAngle + Math.atan(cameraX * Math.tan(DOOM_FOV / 2));
    const hit = castRay(camX, camY, rayAngle);

    const perpDist = hit.dist * Math.cos(rayAngle - camAngle);
    const lineHeight = Math.min(H * 3, (H * wallScale) / perpDist);
    const drawStart = (H - lineHeight) / 2;

    // Fog factor: 0 = clear, 1 = fully fogged
    const fog = Math.min(1, perpDist / fogDist);

    // Wall color with distance shading
    const shade = Math.min(1, 1 / (perpDist * 0.4));
    const base = hit.dark ? 0.55 : 0.75;
    const wr = 120 * base * shade;
    const wg = 110 * base * shade;
    const wb = 100 * base * shade;

    // Blend wall color toward fog
    const r = Math.floor(wr * (1 - fog) + fogR * fog);
    const g = Math.floor(wg * (1 - fog) + fogG * fog);
    const b = Math.floor(wb * (1 - fog) + fogB * fog);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, drawStart, 1, lineHeight);
  }
}

function renderDoom() {
  const dirAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const angle = dirAngles[playerDir];
  const camX = playerX + 0.5 - Math.cos(angle) * 0.45;
  const camY = playerY + 0.5 - Math.sin(angle) * 0.45;
  renderRaycast(camX, camY, angle);
}

function renderRoam() {
  renderRaycast(doomX, doomY, doomAngle);
}

// ---- Rendering ----
function renderView() {
  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#111');
  bg.addColorStop(0.5, '#2a2a2a');
  bg.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (!allLoaded) {
    ctx.fillStyle = '#666';
    ctx.font = '18px monospace';
    ctx.fillText('Loading panels...', W / 2 - 70, H / 2);
    return;
  }

  let visible;
  if (manualMode) {
    visible = getToggles();
  } else {
    visible = getVisiblePanels();
    for (const [k, v] of Object.entries(visible)) {
      const el = document.getElementById('tog-' + k);
      if (el) el.checked = v;
    }
  }

  // Are we in a transition animation?
  const animating = animT > 0 && animType;
  const animProgress = animating ? (1 - animT) : 0; // 0 = start, 1 = end

  if (gameMode === 'roam') {
    renderRoam();
  } else if (gameMode === 'doom') {
    renderDoom();
    // Overlay paper panels on top of the raycaster
    const opa = parseFloat(document.getElementById('overlay-opacity').value) / 100;
    if (opa > 0) {
      ctx.globalAlpha = opa;
      for (const name of layerOrder) {
        if (visible[name] && panels[name]) {
          ctx.drawImage(panels[name], 0, 0);
        }
      }
      ctx.globalAlpha = 1;
    }
  } else if (gameMode === 'origami' && animating) {
    render3DTransition(animProgress, animType);
  } else {
    // Standard flat compositing
    for (const name of layerOrder) {
      if (visible[name] && panels[name]) {
        ctx.drawImage(panels[name], 0, 0);
      }
    }
  }

  // Paper grain overlay (not in doom mode)
  if (paperNoise && gameMode !== 'doom' && gameMode !== 'roam') {
    ctx.globalAlpha = 0.025;
    ctx.drawImage(paperNoise, 0, 0);
    ctx.globalAlpha = 1;
  }
}

function render3DTransition(t, type) {
  // t goes from 0 (just started) to 1 (about to complete)
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  if (type === 'forward' || type === 'back') {
    const currentPanels = getVisiblePanels();
    const stepDir = type === 'forward' ? playerDir : (playerDir + 2) % 4;
    const [nx, ny] = stepXY(playerX, playerY, stepDir);
    const nextPanels = getVisiblePanelsAt(nx, ny, playerDir);

    // The animation unfolds in reverse render order (top layer first),
    // then stows the new panels in render order (bottom layer first).
    //
    // Render order: floor, left1, right1, left2, right2, front
    // So to unstow: front first, then right2, left2, right1, left1, floor
    // Then stow new: floor, left1, right1, left2, right2, front
    //
    // We split the animation into sequential sub-phases per panel.
    // Each panel that needs to change gets a time slice.

    // Determine which panels are leaving (current has, next doesn't or panel changes)
    // and which are arriving (next has, current didn't)
    const leaving = [];
    const arriving = [];
    const staying = [];

    // Process in reverse render order for leaving (unstow top-to-bottom)
    const reverseOrder = [...layerOrder].reverse();
    for (const name of reverseOrder) {
      if (name === 'floor') continue; // floor never flips
      if (currentPanels[name] && !nextPanels[name]) {
        leaving.push(name);
      }
    }
    // Process in render order for arriving (stow bottom-to-top)
    for (const name of layerOrder) {
      if (name === 'floor') continue; // floor never flips
      if (nextPanels[name] && !currentPanels[name]) {
        arriving.push(name);
      }
    }
    // Panels that stay
    for (const name of layerOrder) {
      if (currentPanels[name] && nextPanels[name]) {
        staying.push(name);
      }
    }

    const totalSteps = leaving.length + arriving.length;
    if (totalSteps === 0) {
      // Nothing changes, just draw current
      for (const name of layerOrder) {
        if (currentPanels[name] && panels[name]) ctx.drawImage(panels[name], 0, 0);
      }
      return;
    }

    // Each leaving/arriving panel gets an equal time slice
    const sliceSize = 1 / totalSteps;

    // Calculate per-panel flip amount
    const panelFlip = {}; // name -> 0 (flat) to 1 (folded away), or -1 to 0 (folding in)

    // Leaving panels fold away in sequence (first half of animation)
    for (let i = 0; i < leaving.length; i++) {
      const start = i * sliceSize;
      const end = (i + 1) * sliceSize;
      const localT = Math.max(0, Math.min(1, (ease - start) / (end - start)));
      panelFlip[leaving[i]] = localT; // 0→1 fold away
    }

    // Arriving panels fold in after leaving is done
    for (let i = 0; i < arriving.length; i++) {
      const start = (leaving.length + i) * sliceSize;
      const end = (leaving.length + i + 1) * sliceSize;
      const localT = Math.max(0, Math.min(1, (ease - start) / (end - start)));
      panelFlip[arriving[i]] = 1 - localT; // 1→0 fold in
    }

    // Draw everything in render order
    for (const name of layerOrder) {
      if (!panels[name]) continue;

      if (name in panelFlip) {
        const flip = panelFlip[name];
        if (flip < 0.99) {
          drawPanelWithFlip(name, flip);
        }
      } else if (staying.includes(name)) {
        ctx.drawImage(panels[name], 0, 0);
      } else if (currentPanels[name]) {
        // Still visible but not changing
        ctx.drawImage(panels[name], 0, 0);
      }
    }

  } else if (type === 'turnLeft' || type === 'turnRight') {
    const currentPanels = getVisiblePanels();
    const nextDir = type === 'turnLeft' ? (playerDir + 3) % 4 : (playerDir + 1) % 4;
    const nextPanels = getVisiblePanelsAt(playerX, playerY, nextDir);
    const flipDir = type === 'turnRight' ? 1 : -1;

    // For turns: the whole view swings like turning a page
    // Current view swings out, next view swings in
    // Anchored on the side we're turning toward

    if (ease < 0.5) {
      // First half: current view folds away
      const foldT = ease * 2; // 0→1
      for (const name of layerOrder) {
        if (currentPanels[name] && panels[name]) {
          ctx.save();
          if (flipDir > 0) {
            // Turning right: anchor on right edge, fold rightward
            const scale = Math.cos(foldT * Math.PI / 2);
            ctx.translate(W, 0);
            ctx.scale(-scale, 1);
            ctx.translate(-W, 0);
          } else {
            // Turning left: anchor on left edge, fold leftward
            const scale = Math.cos(foldT * Math.PI / 2);
            ctx.scale(scale, 1);
          }
          ctx.drawImage(panels[name], 0, 0);
          const shade = 0.3 + 0.7 * Math.cos(foldT * Math.PI / 2);
          ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }
    } else {
      // Second half: next view folds in
      const foldT = (ease - 0.5) * 2; // 0→1
      for (const name of layerOrder) {
        if (nextPanels[name] && panels[name]) {
          ctx.save();
          if (flipDir > 0) {
            // Coming from left
            const scale = Math.cos((1 - foldT) * Math.PI / 2);
            ctx.scale(scale, 1);
          } else {
            // Coming from right
            const scale = Math.cos((1 - foldT) * Math.PI / 2);
            ctx.translate(W, 0);
            ctx.scale(-scale, 1);
            ctx.translate(-W, 0);
          }
          ctx.drawImage(panels[name], 0, 0);
          const shade = 0.3 + 0.7 * Math.cos((1 - foldT) * Math.PI / 2);
          ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }
    }
  }
}

// ---- Paper noise ----
let paperNoise = null;
function makePaperNoise() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const id = g.createImageData(W, H);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    id.data[i] = 128 + n; id.data[i+1] = 125 + n; id.data[i+2] = 118 + n; id.data[i+3] = 255;
  }
  g.putImageData(id, 0, 0);
  paperNoise = c;
}

// ---- Movement ----
function tryMove() {
  if (inputLock) return;
  if (keys['KeyW'] || keys['ArrowUp']) {
    if (isOpen(playerX, playerY, playerDir)) {
      inputLock = true; animType = 'forward'; animT = 1;
    }
  } else if (keys['KeyS'] || keys['ArrowDown']) {
    if (isOpen(playerX, playerY, (playerDir + 2) % 4)) {
      inputLock = true; animType = 'back'; animT = 1;
    }
  } else if (keys['KeyA'] || keys['ArrowLeft']) {
    inputLock = true; animType = 'turnLeft'; animT = 1;
  } else if (keys['KeyD'] || keys['ArrowRight']) {
    inputLock = true; animType = 'turnRight'; animT = 1;
  }
}

function updateAnim(dt) {
  if (animT <= 0) return;
  animT -= dt * ANIM_SPEED;
  if (animT <= 0) {
    animT = 0; inputLock = false;
    if (animType === 'forward') [playerX, playerY] = stepXY(playerX, playerY, playerDir);
    else if (animType === 'back') [playerX, playerY] = stepXY(playerX, playerY, (playerDir + 2) % 4);
    else if (animType === 'turnLeft') playerDir = (playerDir + 3) % 4;
    else if (animType === 'turnRight') playerDir = (playerDir + 1) % 4;
    animType = null;
  }
}

// ---- Mini-map ----
function renderMinimap() {
  const sz = 110, cs = sz / MAP_W;
  const mx = W - sz - 10, my = 10;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(mx - 3, my - 3, sz + 6, sz + 6);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = getCell(x, y);
      const px = mx + x * cs, py = my + y * cs;
      ctx.fillStyle = (x === playerX && y === playerY) ? '#cc4' : '#2a2a2a';
      ctx.fillRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5;
      if (c.n) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px+cs, py); ctx.stroke(); }
      if (c.s) { ctx.beginPath(); ctx.moveTo(px, py+cs); ctx.lineTo(px+cs, py+cs); ctx.stroke(); }
      if (c.w) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py+cs); ctx.stroke(); }
      if (c.e) { ctx.beginPath(); ctx.moveTo(px+cs, py); ctx.lineTo(px+cs, py+cs); ctx.stroke(); }
    }
  }
  let pcx, pcy;
  if (gameMode === 'roam') {
    pcx = mx + doomX * cs;
    pcy = my + doomY * cs;
    const al = cs * 0.5;
    ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pcx, pcy);
    ctx.lineTo(pcx + Math.cos(doomAngle) * al, pcy + Math.sin(doomAngle) * al);
    ctx.stroke();
  } else {
    pcx = mx + (playerX + 0.5) * cs;
    pcy = my + (playerY + 0.5) * cs;
    const al = cs * 0.4;
    ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pcx, pcy);
    ctx.lineTo(pcx + DIR_DX[playerDir] * al, pcy + DIR_DY[playerDir] * al);
    ctx.stroke();
  }

  const modeStr = gameMode.toUpperCase();
  const v = getVisiblePanels();
  const active = Object.entries(v).filter(([k,val]) => val).map(([k]) => k).join(', ');
  hud.textContent = `PAPER DOOM [${modeStr}] | ${DIR_NAMES[playerDir]} | (${playerX},${playerY}) | ${active}`;
}

// ---- Main loop ----
let lastTime = 0;
let prevMode = 'paper';
function loop(time) {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  // Sync positions on mode switch
  if (gameMode !== prevMode) {
    if (gameMode === 'roam') syncDoomFromGrid();
    else if (prevMode === 'roam') syncGridFromDoom();
    prevMode = gameMode;
  }

  if (gameMode === 'roam') {
    updateDoom(dt);
  } else {
    tryMove();
    updateAnim(dt);
  }
  renderView();
  renderMinimap();
  requestAnimationFrame(loop);
}

// ---- Layer order UI ----
function buildLayerList() {
  const list = document.getElementById('layer-list');
  list.innerHTML = '';
  layerOrder.forEach((name, i) => {
    const div = document.createElement('div');
    div.className = 'layer-item';
    div.draggable = true;
    div.dataset.name = name;
    div.innerHTML = `<span class="num">${i + 1}.</span> ${name}`;
    div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', name); div.style.opacity = '0.4'; });
    div.addEventListener('dragend', () => { div.style.opacity = '1'; });
    div.addEventListener('dragover', e => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => {
      e.preventDefault(); div.classList.remove('drag-over');
      const from = layerOrder.indexOf(e.dataTransfer.getData('text/plain'));
      const to = layerOrder.indexOf(name);
      if (from !== -1 && to !== -1 && from !== to) {
        layerOrder.splice(from, 1);
        layerOrder.splice(to, 0, e.dataTransfer.getData('text/plain'));
        buildLayerList();
      }
    });
    list.appendChild(div);
  });
}

// ---- Init ----
initMap();
makePaperNoise();
buildLayerList();

// Mode buttons
function updateModeButtons() {
  document.getElementById('btn-paper').classList.toggle('active', gameMode === 'paper');
  document.getElementById('btn-3d').classList.toggle('active', gameMode === 'origami');
  document.getElementById('btn-doom').classList.toggle('active', gameMode === 'doom');
  document.getElementById('btn-roam').classList.toggle('active', gameMode === 'roam');
  document.getElementById('overlay-control').style.display = gameMode === 'doom' ? 'block' : 'none';
  const showFog = gameMode === 'doom' || gameMode === 'roam';
  document.getElementById('fog-control').style.display = showFog ? 'block' : 'none';
}
document.getElementById('overlay-opacity').addEventListener('input', function() {
  document.getElementById('overlay-val').textContent = this.value;
});
document.getElementById('fog-dist').addEventListener('input', function() {
  document.getElementById('fog-val').textContent = this.value;
});
document.getElementById('btn-paper').addEventListener('click', () => { gameMode = 'paper'; updateModeButtons(); });
document.getElementById('btn-3d').addEventListener('click', () => { gameMode = 'origami'; updateModeButtons(); });
document.getElementById('btn-doom').addEventListener('click', () => { gameMode = 'doom'; updateModeButtons(); });
document.getElementById('btn-roam').addEventListener('click', () => { gameMode = 'roam'; updateModeButtons(); });
updateModeButtons();

function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H, 1.5);
  canvas.style.width = (W * scale) + 'px';
  canvas.style.height = (H * scale) + 'px';
}
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(loop);
