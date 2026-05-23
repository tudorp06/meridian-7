'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const CW      = 1920;  // canvas width
const CH      = 1080;  // canvas height
const TILE    = 48;
const MAP_W   = 90;
const MAP_H   = 60;
const VP_COLS = Math.floor(CW / TILE);
const VP_ROWS = Math.floor(CH / TILE);
const LERP    = 0.28; // snappier visual catch-up for real-time movement

// ── Sound System ──────────────────────────────────────────────────────────────
const SFX = {
  fabricate() {},
  pickup() {},
  hit() {},
  shoot() {},
  swing() {},
  death() {},
  step() {},
  alert() {},
  victory() {},
}

const T = { WALL: 0, FLOOR: 1 };

const BASE_COLORS = {
  bg:       '#06090f',
  floor:    '#0d1520',
  wall:     '#111d2e',
  wallEdge: '#1e3048',
  player:   '#4dd9e8',
  enemy:    '#cc3344',
  hazard:   '#cc6622',
  ally:     '#44aa66',
  item:     '#ccaa33',
  hud:      '#6a9ab8',
  hudBg:    'rgba(6, 9, 15, 0.95)',
};

// Level themes - consistent blue aesthetic (alien corruption is RED)
const LEVEL_THEMES = {
  1: { bg: '#06090f', floor: '#0d1520', wall: '#111d2e', wallEdge: '#1e3048', name: 'Cargo Bay' },
  2: { bg: '#070a10', floor: '#0e1622', wall: '#141f30', wallEdge: '#20304a', name: 'Research Labs' },
  3: { bg: '#060b11', floor: '#0d1824', wall: '#15212e', wallEdge: '#223450', name: 'Engineering' },
  4: { bg: '#05091f', floor: '#0c1428', wall: '#162038', wallEdge: '#243858', name: 'Command Deck' },
  5: { bg: '#040814', floor: '#0b1220', wall: '#131c2e', wallEdge: '#1f2c48', name: 'Reactor Core' },
};

let C = {...BASE_COLORS};

// ── Canvas / DOM ──────────────────────────────────────────────────────────────
const canvas      = document.getElementById('gameCanvas');
const ctx         = canvas.getContext('2d');
const fabOverlay  = document.getElementById('fab-overlay');
const fabInput    = document.getElementById('fab-input');
const fabStatus   = document.getElementById('fab-status');
const fabResult   = document.getElementById('fab-result');
const fabResName  = document.getElementById('fab-res-name');
const fabResDesc  = document.getElementById('fab-res-desc');
const fabResStats = document.getElementById('fab-res-stats');
const deadScreen  = document.getElementById('dead-screen');
const winScreen   = document.getElementById('win-screen');
const levelTransition = document.getElementById('level-transition');
const levelNumber = document.getElementById('level-number');
const levelSubtitle = document.getElementById('level-subtitle');

// ── Game state ────────────────────────────────────────────────────────────────
let map, rooms, entities, particles, dmgNums, projectileTrails, player, camera, messages, turn, state, gt;
let shake = { timer:0, intensity:0 };
let exitDoor = null;
let currentLevel = 1;

// ── Real-time input state ─────────────────────────────────────
const heldKeys = new Set();
let mouseX = -1, mouseY = -1; // canvas-pixel coords (-1 = off-canvas)
let lastPlayerStep = 0;
let lastEnemyStep  = 0;
let lastAllyStep   = 0;
let lastWeaponUse  = 0;
const PLAYER_MS  = 130;  // ms between steps while holding a direction
const ENEMY_MS   = 360;  // ms between enemy AI ticks (independent of player)
const ALLY_MS    = 150;  // ms between ally/pet ticks (almost as fast as player)
const WEAPON_MS  = 280;  // ms between weapon uses when holding SPACE
// gt = gameTime frame counter, used for sprite animations

function initGame(resetLevel = true) {
  if (resetLevel) currentLevel = 1;

  // Apply level theme
  const theme = LEVEL_THEMES[currentLevel] || LEVEL_THEMES[1];
  C.bg = theme.bg;
  C.floor = theme.floor;
  C.wall = theme.wall;
  C.wallEdge = theme.wallEdge;

  // Save allies, pets, traps, and fabricated items when advancing to next level
  const savedCompanions = resetLevel ? [] : entities.filter(e =>
    e.type === 'ally' || e.type === 'pet' || e.type === 'trap' || (e.type === 'item' && e.fabricated)
  );

  if (!resetLevel && savedCompanions.length > 0) {
    console.log(`[LEVEL ${currentLevel}] Saving ${savedCompanions.length} companions:`, savedCompanions.map(c => c.name));
  }

  map = []; rooms = []; entities = []; particles = []; dmgNums = []; projectileTrails = []; messages = [];
  heldKeys.clear(); lastPlayerStep = 0; lastEnemyStep = 0; lastAllyStep = 0; lastWeaponUse = 0;
  turn = 0; state = 'playing'; gt = 0;

  generateMap();
  const start = rooms[0];

  // Keep inventory between levels, but reset stats for new run
  if (resetLevel) {
    player = mkPlayer(start.cx, start.cy);
  } else {
    // Advancing to next level - keep inventory but spawn at new start
    player.x = start.cx;
    player.y = start.cy;
    player.rx = start.cx * TILE;
    player.ry = start.cy * TILE;
    // Heal player partially between levels
    player.hp = Math.min(player.maxHp, player.hp + 50);

    // Restore allies, pets, and traps near the player
    let restored = 0;
    savedCompanions.forEach(companion => {
      const pos = nearbyFloor(start.cx, start.cy, 6); // Increased radius to 6
      if (pos) {
        companion.x = pos.x;
        companion.y = pos.y;
        companion.rx = pos.x * TILE;
        companion.ry = pos.y * TILE;
        entities.push(companion);
        restored++;
      }
    });
    if (restored > 0) {
      console.log(`[LEVEL ${currentLevel}] Restored ${restored} companions near player`);
      log(`${restored} companion(s) teleported with you`);
    }
  }

  // Snap camera immediately on first load so there's no slide-in
  camera = {
    rx: clamp(start.cx * TILE - (VP_COLS * TILE) / 2, 0, (MAP_W - VP_COLS) * TILE),
    ry: clamp(start.cy * TILE - (VP_ROWS * TILE) / 2, 0, (MAP_H - VP_ROWS) * TILE),
  };

  spawnEnemies();

  // Place exit in the room farthest from the player's spawn (Manhattan distance)
  const farthestRoom = rooms.slice(1).reduce((best, room) => {
    const d  = Math.abs(room.cx - start.cx) + Math.abs(room.cy - start.cy);
    const bd = Math.abs(best.cx - start.cx) + Math.abs(best.cy - start.cy);
    return d > bd ? room : best;
  }, rooms[1]);
  exitDoor = { x: farthestRoom.cx, y: farthestRoom.cy };

  // Spawn a boss near the exit (guardian of the exit)
  spawnBoss(farthestRoom);

  deadScreen.classList.add('hidden');
  winScreen.classList.add('hidden');
  // Clear victory cinematic stages
  document.querySelectorAll('.win-stage').forEach(s => s.classList.remove('active'));

  if (resetLevel) {
    log('Mission: Escape Meridian-7.');
    log('Press F to open the Fabrication Terminal.');
  } else {
    log(`>>> LEVEL ${currentLevel} <<<`);
    log('Sector cleared. Moving deeper into the station...');
  }
}

// ── Map ───────────────────────────────────────────────────────────────────────
function generateMap() {
  map = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(T.WALL));
  const NUM = 12, MIN = 5, MAX = 11;
  for (let a = 0; a < 200 && rooms.length < NUM; a++) {
    const shape = Math.random();
    let r;
    if (shape < 0.4) {
      // Rectangular room
      const w = ri(MIN, MAX), h = ri(MIN, MAX);
      const x = ri(1, MAP_W - w - 1), y = ri(1, MAP_H - h - 1);
      r = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), shape: 'rect' };
    } else if (shape < 0.7) {
      // Circular room
      const rad = ri(3, 6);
      const x = ri(rad + 1, MAP_W - rad - 1), y = ri(rad + 1, MAP_H - rad - 1);
      r = { x: x-rad, y: y-rad, w: rad*2, h: rad*2, cx: x, cy: y, radius: rad, shape: 'circle' };
    } else {
      // Irregular blob
      const w = ri(MIN, MAX), h = ri(MIN, MAX);
      const x = ri(1, MAP_W - w - 1), y = ri(1, MAP_H - h - 1);
      r = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), shape: 'blob' };
    }
    if (!rooms.some(e => overlaps(e, r, 2))) { carveRoom(r); rooms.push(r); }
  }
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    if (Math.random() < .5) { carveH(a.cx, b.cx, a.cy); carveV(a.cy, b.cy, b.cx); }
    else                    { carveV(a.cy, b.cy, a.cx); carveH(a.cx, b.cx, b.cy); }
  }
}
function carveRoom(r) {
  if (r.shape === 'circle') {
    // Carve circular room
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const dx = x - r.cx, dy = y - r.cy;
        if (dx*dx + dy*dy <= r.radius * r.radius) map[y][x] = T.FLOOR;
      }
    }
  } else if (r.shape === 'blob') {
    // Carve irregular blob with noise
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const dx = Math.abs(x - r.cx) / (r.w/2);
        const dy = Math.abs(y - r.cy) / (r.h/2);
        const dist = dx*dx + dy*dy;
        const noise = Math.random() * 0.3;
        if (dist + noise < 1.2) map[y][x] = T.FLOOR;
      }
    }
  } else {
    // Rectangular room (default)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        map[y][x] = T.FLOOR;
  }
}
function carveH(x1, x2, y) { for (let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++) map[y][x]=T.FLOOR; }
function carveV(y1, y2, x) { for (let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++) map[y][x]=T.FLOOR; }
function overlaps(a, b, p=0) {
  return a.x-p < b.x+b.w+p && a.x+a.w+p > b.x-p &&
         a.y-p < b.y+b.h+p && a.y+a.h+p > b.y-p;
}

// ── Entities ──────────────────────────────────────────────────────────────────
function mkPlayer(x, y) {
  return { id:'player', type:'player', x, y, rx:x*TILE, ry:y*TILE,
           hp:100, maxHp:100, damage:8, defense:2, speedBoost:0, color:C.player,
           inventory:[], equippedWeapon:null, equippedArmor:null, hitFlash:0,
           facing:{ dx:1, dy:0 } };
}

// Enemy templates with level weights — each level has a different mix
const TEMPLATES = [
  { name:'Patrol Drone',   sprite:'drone',    hp:35, damage:10, defense:2, color:'#ff3355',
    levelWeight: [5, 3, 1, 0, 0] },
  { name:'Recon Drone',    sprite:'drone',    hp:28, damage:8,  defense:1, color:'#ff5577',
    levelWeight: [4, 2, 0, 0, 0] },
  { name:'Crawler',        sprite:'crawler',  hp:60, damage:15, defense:4, color:'#ff7700',
    levelWeight: [1, 4, 3, 2, 1] },
  { name:'Venom Crawler',  sprite:'crawler',  hp:55, damage:20, defense:3, color:'#88cc00',
    levelWeight: [0, 2, 4, 3, 1] },
  { name:'Sentinel',       sprite:'sentinel', hp:90, damage:22, defense:8, color:'#ff0088',
    levelWeight: [0, 1, 3, 4, 3] },
  { name:'War Sentinel',   sprite:'sentinel', hp:130,damage:28, defense:10,color:'#dd0066',
    levelWeight: [0, 0, 1, 3, 4] },
  { name:'Xenomorph',      sprite:'alien',    hp:50, damage:14, defense:3, color:'#9944ff',
    levelWeight: [1, 2, 3, 3, 2] },
  { name:'Alpha Xenomorph',sprite:'alien',    hp:85, damage:24, defense:6, color:'#bb22ff',
    levelWeight: [0, 0, 1, 3, 5] },
  { name:'Parasite',       sprite:'alien',    hp:26, damage:9,  defense:0, color:'#33cc55',
    levelWeight: [3, 3, 2, 1, 0] },
  { name:'Shock Drone',    sprite:'drone',    hp:55, damage:18, defense:4, color:'#44aaff',
    levelWeight: [0, 1, 2, 3, 2] },
];

function mkEnemy(x, y) {
  // Weighted random selection based on current level
  const lvl = Math.min(currentLevel, 5) - 1; // 0-indexed
  const weights = TEMPLATES.map(t => t.levelWeight[lvl] || 0);
  const totalWeight = weights.reduce((a,b) => a+b, 0);
  let roll = Math.random() * totalWeight;
  let t = TEMPLATES[0];
  for (let i = 0; i < TEMPLATES.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { t = TEMPLATES[i]; break; }
  }

  // Scale stats with level — gets noticeably harder each floor
  const scale = 1 + (currentLevel - 1) * 0.18;
  const hp = Math.round(t.hp * scale);
  const damage = Math.round(t.damage * scale);
  const defense = Math.round(t.defense * scale);

  return { id:uid(), type:'enemy', x, y, rx:x*TILE, ry:y*TILE,
           name:t.name, sprite:t.sprite, color:t.color,
           hp, maxHp:hp, damage, defense,
           aggroState:'idle', aggroFlash:0, wanderDir:null, wanderTimer:0 };
}

function spawnEnemies() {
  // Scale enemy count with level
  const baseEnemies = 2 + Math.floor(currentLevel / 2);
  const maxEnemies = 3 + currentLevel;

  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const enemyCount = ri(baseEnemies, maxEnemies);
    for (let j = 0; j < enemyCount; j++) {
      const ex = ri(r.x+1, r.x+r.w-2), ey = ri(r.y+1, r.y+r.h-2);
      if (!entityAt(ex, ey)) entities.push(mkEnemy(ex, ey));
    }
  }
}

function spawnBoss(room) {
  // Spawn a powerful boss near the exit (scales with level)
  const bossTypes = [
    { name:'Guardian Sentinel', sprite:'sentinel', color:'#ff0044' },
    { name:'Elite Xenomorph',   sprite:'alien',    color:'#aa00ff' },
    { name:'War Drone',         sprite:'drone',    color:'#ff4400' },
    { name:'Alpha Crawler',     sprite:'crawler',  color:'#ff8800' },
  ];

  const boss = bossTypes[currentLevel % bossTypes.length];

  // Boss stats scale significantly with level
  const hp = 80 + (currentLevel * 40);      // Level 1: 120 HP, Level 5: 280 HP
  const damage = 15 + (currentLevel * 5);   // Level 1: 20 DMG, Level 5: 40 DMG
  const defense = 5 + (currentLevel * 2);   // Level 1: 7 DEF, Level 5: 15 DEF

  // Find a spot near the room center
  for (let attempts = 0; attempts < 10; attempts++) {
    const bx = ri(room.x+2, room.x+room.w-3);
    const by = ri(room.y+2, room.y+room.h-3);
    if (map[by]&&map[by][bx]===T.FLOOR && !entityAt(bx, by)) {
      entities.push({
        id: uid(), type: 'enemy', x: bx, y: by, rx: bx*TILE, ry: by*TILE,
        name: boss.name, sprite: boss.sprite, color: boss.color,
        hp, maxHp: hp, damage, defense,
        aggroState: 'idle', aggroFlash: 0, wanderDir: null, wanderTimer: 0,
        isBoss: true  // Flag for special rendering
      });
      break;
    }
  }
}

// ── Movement & combat ─────────────────────────────────────────────────────────
function tryMove(ent, dx, dy) {
  const nx = ent.x + dx, ny = ent.y + dy;
  if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H||map[ny][nx]!==T.FLOOR) return false;
  const hit = entityAt(nx, ny);
  if (hit) {
    if (hit.type==='item') {
      if (ent.type==='player') { pickUp(hit); ent.x=nx; ent.y=ny; return true; }
      return false;
    }
    // Player can walk through allies, pets, and traps (they move aside)
    if (ent.type==='player' && (hit.type==='ally' || hit.type==='pet' || hit.type==='trap')) {
      // Swap positions - ally moves to where player was
      const oldX = ent.x, oldY = ent.y;
      ent.x = nx; ent.y = ny;
      hit.x = oldX; hit.y = oldY;
      hit.rx = oldX * TILE; hit.ry = oldY * TILE;
      return true;
    }
    // Pets and traps don't block other entities
    if (hit.type==='pet' || hit.type==='trap') {
      ent.x = nx; ent.y = ny; return true;
    }
    const hostile  = hit.type==='enemy' || hit.type==='hazard';
    // Allies and player NEVER hurt each other
    if (ent.type==='player' && hostile)              { attack(ent, hit); return false; }
    if (ent.type==='ally'   && hostile)              { attack(ent, hit); return false; }
    if (ent.type==='enemy'  && hit.type==='player')  { attack(ent, hit); return false; }
    if (ent.type==='hazard' && hit.type==='player')  { attack(ent, hit); return false; }
    if (ent.type==='enemy'  && hit.type==='ally')    { attack(ent, hit); return false; }
    if (ent.type==='hazard' && hit.type==='ally')    { attack(ent, hit); return false; }
    return false; // everything else: blocked
  }
  ent.x = nx; ent.y = ny;

  // Check level advance / win condition
  if (ent.type === 'player' && exitDoor && ent.x === exitDoor.x && ent.y === exitDoor.y) {
    if (currentLevel >= 5) {
      // Final level completed - show staged victory cinematic
      state = 'won';
      winScreen.classList.remove('hidden');
      log('>>> YOU ESCAPED MERIDIAN-7 <<<');
      SFX.fabricate();
      playVictoryCinematic();
    } else {
      // Advance to next level
      currentLevel++;
      state = 'transitioning';

      // Show level transition screen
      const nextTheme = LEVEL_THEMES[currentLevel];
      levelNumber.textContent = `LEVEL ${currentLevel}`;
      levelSubtitle.textContent = `ENTERING ${nextTheme.name.toUpperCase()}`;
      levelTransition.classList.remove('hidden');

      SFX.pickup(); // level advance sound

      // After 2.5 seconds, start new level
      setTimeout(() => {
        levelTransition.classList.add('hidden');
        initGame(false); // keep inventory
      }, 2500);
    }
  }

  return true;
}

function attack(attacker, defender) {
  const dmg = Math.max(1, (attacker.damage||5) - (defender.defense||0) + ri(-2,2));
  defender.hp -= dmg;

  SFX.hit();

  const hitColor = attacker.type==='player' ? defender.color||C.enemy : '#ff4455';
  hitParticles(defender.rx, defender.ry, hitColor);
  spawnDmgNum(defender.rx, defender.ry, dmg, hitColor);

  if (defender.type==='player') {
    shake.timer = 10; shake.intensity = 5;
    player.hitFlash = 12;
  }

  const an = attacker.type==='player'?'You':(attacker.name||'Enemy');
  const dn = defender.type==='player'?'you':(defender.name||'enemy');
  log(`${an} hit ${dn} for ${dmg} DMG`);

  if (defender.hp <= 0) {
    if (defender.type==='player') {
      state='dead';
      deadScreen.classList.remove('hidden');
      log('>>> SIGNAL LOST <<<');
      SFX.death();
    } else {
      log(`${defender.name||'Entity'} destroyed`);
      entities=entities.filter(e=>e!==defender);
      SFX.death();
    }
  }
}

function spawnDmgNum(px, py, amount, color) {
  const sx = px - camera.rx + TILE/2 + ri(-6,6);
  const sy = py - camera.ry + 4;
  dmgNums.push({ x:sx, y:sy, text:'-'+amount, color, life:1, decay:0.022 });
}

function drawDmgNums() {
  dmgNums = dmgNums.filter(d => d.life > 0);
  for (const d of dmgNums) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life * 1.5);
    ctx.fillStyle = d.color;
    ctx.font = `bold 13px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(d.text, d.x, d.y);
    ctx.restore();
    d.y -= 0.7;
    d.life -= d.decay;
  }
}

function applySpecialEffect(effect, item) {
  if (!effect || effect === 'none') return;

  switch(effect) {
    case 'invisibility':
      player.invisible = true;
      player.invisibleTimer = 600; // 10 seconds at 60fps
      player.color = '#4dd9e855'; // semi-transparent
      log('You fade from view... [10s INVISIBILITY]');
      break;

    case 'colorChange':
      const colors = ['#ff3366', '#33ff66', '#3366ff', '#ffff33', '#ff33ff', '#33ffff'];
      player.color = colors[ri(0, colors.length - 1)];
      log(`Your suit shifts color to ${player.color}!`);
      break;

    case 'sizeChange':
      // Visual size change (could affect hitbox)
      player.sizeMultiplier = (player.sizeMultiplier || 1) * 1.5;
      log('You feel yourself growing larger!');
      break;

    case 'speedBoost':
      player.speedBoost = (player.speedBoost || 0) + 2;
      log('Enhanced mobility protocols activated!');
      break;

    case 'shield':
      player.shieldHP = 50;
      log('[SHIELD ACTIVE - 50 HP]');
      break;

    case 'regen':
      player.regenTimer = 300; // 5 seconds
      player.regenRate = 2; // 2 HP per tick
      log('[REGENERATION ACTIVE - 5s]');
      break;

    default:
      log(`[EFFECT: ${effect}]`);
  }
}

function pickUp(item) {
  SFX.pickup();
  if (item.itemType==='consumable') {
    // Consumables used immediately, don't go to inventory
    const h = item.stats.hp || 25;
    player.hp = Math.min(player.maxHp, player.hp + h);
    entities = entities.filter(e => e !== item);

    // Apply special effects
    if (item.specialEffect) {
      applySpecialEffect(item.specialEffect, item);
    }

    const effectText = item.specialEffect && item.specialEffect !== 'none' ? ` [${item.specialEffect.toUpperCase()}]` : '';
    log(`Used: ${item.name}  [+${h} HP]${effectText}`);
    return;
  }
  if (item.itemType==='vehicle') {
    // Vehicles used immediately for speed boost
    const spd = item.stats.speed || 2;
    player.speedBoost = (player.speedBoost || 0) + spd;
    entities = entities.filter(e => e !== item);
    log(`Mounted: ${item.name}  [SPEED +${spd}]`);
    return;
  }
  if (player.inventory.length >= 8) { log('Inventory full'); return; }
  player.inventory.push(item);
  entities = entities.filter(e => e !== item);
  if (item.itemType==='weapon') {
    player.damage += item.stats.damage || 3;
    player.equippedWeapon = item;
    log(`Equipped: ${item.name}  [ATT +${item.stats.damage||3}]`);
  } else if (item.itemType==='armor') {
    player.defense += item.stats.defense || 2;
    player.equippedArmor = item;
    log(`Equipped: ${item.name}  [DEF +${item.stats.defense||2}]`);
  } else if (item.itemType==='tool') {
    // Tools provide utility bonuses
    if (item.stats.hp > 0) player.maxHp += item.stats.hp;
    if (item.stats.damage > 0) player.damage += item.stats.damage;
    if (item.stats.defense > 0) player.defense += item.stats.defense;
    log(`Equipped: ${item.name}  [UTILITY]`);
  }
}

// ── AI ────────────────────────────────────────────────────────────────────────
const AGGRO   = 9;
const DEAGGRO = 14;

function getThreatLevel(enemy) {
  // Calculate threat level 1-5 based on enemy stats
  const hp = enemy.maxHp || enemy.hp || 0;
  const dmg = enemy.damage || 0;
  const def = enemy.defense || 0;
  const total = hp + (dmg * 8) + (def * 4); // Weighted: damage matters most

  if (total >= 500) return 5; // Extreme (Galactus, 1000+ HP entities)
  if (total >= 300) return 4; // High (Boss-tier, 200+ HP)
  if (total >= 150) return 3; // Moderate threat
  if (total >= 80)  return 2; // Low threat
  return 1; // Minimal
}

function enemyShoot(e) {
  // Drones fire a low-damage shot toward the player
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  // Normalize to cardinal/diagonal direction
  const sdx = dx === 0 ? 0 : Math.sign(dx);
  const sdy = dy === 0 ? 0 : Math.sign(dy);
  if (sdx === 0 && sdy === 0) return;

  // Trace the shot
  let x = e.x + sdx, y = e.y + sdy, hitPlayer = false, endX = e.x, endY = e.y;
  for (let i = 0; i < 12; i++) {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || map[y][x] !== T.FLOOR) break;
    if (x === player.x && y === player.y) { hitPlayer = true; endX = x; endY = y; break; }
    // Don't shoot through other enemies or allies
    const blocker = entityAt(x, y);
    if (blocker) break;
    endX = x; endY = y;
    x += sdx; y += sdy;
  }

  // Visual trail
  projectileTrails.push({
    sx: e.x, sy: e.y, ex: endX, ey: endY,
    color: e.color || '#ff3355', life: 1, decay: 0.12,
    type: 'bullet'
  });

  SFX.shoot();

  if (hitPlayer) {
    // Low damage shot (3-5 base, ignoring most defense)
    const shotDmg = Math.max(1, ri(3, 5) - Math.floor(player.defense * 0.3));
    player.hp -= shotDmg;
    player.hitFlash = 8;
    shake.timer = 4; shake.intensity = 3;
    hitParticles(player.rx, player.ry, '#ff4455');
    spawnDmgNum(player.rx, player.ry, shotDmg, '#ff4455');
    log(`${e.name} shot you for ${shotDmg} DMG`);

    if (player.hp <= 0) {
      state = 'dead';
      deadScreen.classList.remove('hidden');
      log('>>> SIGNAL LOST <<<');
      SFX.death();
    }
  }
}

function runEnemyTurns() {
  entities.filter(e=>e.type==='enemy'||e.type==='hazard').forEach(e => {
    const d = mdist(e, player);

    // Aggro state machine
    if (e.aggroState!=='chase' && d<=AGGRO) {
      e.aggroState='chase';
      e.aggroFlash=4;

      // Threat detection - warn player about dangerous enemies
      if (!e.threatAlertShown) {
        const threatLevel = getThreatLevel(e);
        if (threatLevel >= 3) { // High threat
          const threatLabel = threatLevel === 5 ? '⚠⚠⚠ EXTREME THREAT' :
                             threatLevel === 4 ? '⚠⚠ HIGH THREAT' :
                             '⚠ THREAT DETECTED';
          showFabAlert(`${threatLabel} — ${e.name.toUpperCase()}`,
                       `HP: ${e.maxHp}  |  DMG: ${e.damage}  |  DEF: ${e.defense}`,
                       '#ff3344');
          SFX.alert();
        }
        e.threatAlertShown = true; // Only alert once per enemy
      }
    }
    if (e.aggroState==='chase' && d>DEAGGRO)   { e.aggroState='idle'; }
    if (e.aggroFlash>0) e.aggroFlash--;

    if (e.aggroState==='chase') {
      const dx = player.x-e.x, dy = player.y-e.y;

      // Drones can shoot at the player from range
      if (e.sprite === 'drone' && d <= 10 && d >= 3 && Math.random() < 0.25) {
        enemyShoot(e);
      }

      // 15% random jitter so enemies don't lock into identical columns
      if (Math.random()<0.15) {
        tryMove(e, ri(-1,1), ri(-1,1));
      } else if (Math.abs(dx) > Math.abs(dy)) {
        if (!tryMove(e,Math.sign(dx),0)) tryMove(e,0,Math.sign(dy));
      } else {
        if (!tryMove(e,0,Math.sign(dy))) tryMove(e,Math.sign(dx),0);
      }
    } else {
      // Idle wander
      if (!e.wanderDir || e.wanderTimer<=0) {
        const opts=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:0,dy:0},{dx:0,dy:0}];
        e.wanderDir = opts[ri(0,opts.length-1)];
        e.wanderTimer = ri(2,5);
      }
      e.wanderTimer--;
      tryMove(e, e.wanderDir.dx, e.wanderDir.dy);
    }
  });

  // Traps — trigger when enemy steps on or adjacent to them
  entities.filter(e=>e.type==='trap').forEach(trap => {
    const range = trap.triggerRange || 2;
    const nearbyEnemies = entities.filter(e =>
      (e.type==='enemy'||e.type==='hazard') && mdist(trap, e) <= range
    );

    if (nearbyEnemies.length > 0) {
      // Cooldown: don't fire every single tick
      trap.trapCooldown = (trap.trapCooldown || 0) - 1;
      if (trap.trapCooldown <= 0) {
        trap.trapCooldown = 5; // Fire every 5 enemy ticks (~1.8s)
        const dmg = trap.damage || 10;

        nearbyEnemies.forEach(enemy => {
          enemy.hp -= dmg;
          hitParticles(enemy.rx, enemy.ry, trap.color||'#ff8844');
          spawnDmgNum(enemy.rx, enemy.ry, dmg, trap.color||'#ff8844');
          SFX.hit();

          if (enemy.hp <= 0) {
            log(`${trap.name} destroyed ${enemy.name||'Enemy'}`);
            entities = entities.filter(e => e !== enemy);
          }
        });

        // Trigger flash effect on the trap
        trap.triggerFlash = 8;

        // Consume uses — traps have limited charges
        trap.charges = trap.charges ?? 8;
        trap.charges--;
        if (trap.charges <= 0) {
          log(`${trap.name} depleted`);
          entities = entities.filter(e => e !== trap);
        }
      }
    }
  });
}

// ── Smooth lerp ───────────────────────────────────────────────────────────────
function lerpPositions() {
  const lerp = e => {
    e.rx += (e.x * TILE - e.rx) * LERP;
    e.ry += (e.y * TILE - e.ry) * LERP;
  };
  lerp(player);
  entities.forEach(lerp);

  const tx = clamp(player.x*TILE - (VP_COLS*TILE)/2 + cameraOffsetX, 0, (MAP_W-VP_COLS)*TILE);
  const ty = clamp(player.y*TILE - (VP_ROWS*TILE)/2 + cameraOffsetY, 0, (MAP_H-VP_ROWS)*TILE);
  const camLerp = isDragging ? 0.12 : LERP; // Slower lerp while dragging for smooth pan
  camera.rx += (tx - camera.rx) * camLerp;
  camera.ry += (ty - camera.ry) * camLerp;

  // Handle special effect timers
  if (player.invisibleTimer > 0) {
    player.invisibleTimer--;
    if (player.invisibleTimer === 0) {
      player.invisible = false;
      player.color = C.player;
      log('Invisibility fades...');
    }
  }

  if (player.regenTimer > 0) {
    player.regenTimer--;
    if (player.regenTimer % 30 === 0 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + (player.regenRate || 2));
    }
    if (player.regenTimer === 0) {
      log('Regeneration complete.');
    }
  }
}

// ── FABRICATE ─────────────────────────────────────────────────────────────────
// ── Inventory ─────────────────────────────────────────────────────────────────
const invScreen = document.getElementById('inv-screen');
const invList   = document.getElementById('inv-list');

function openInventory() {
  if (player.inventory.length === 0) { log('Inventory is empty'); return; }
  state = 'inventory';
  invList.innerHTML = '';
  const typeIcon = item => {
    const iconKey = getIconKey(item);
    if (iconKey && ITEM_ICONS[iconKey]) {
      return `<img src="/icons/${iconKey}.png" width="28" height="28" style="image-rendering:pixelated; filter:drop-shadow(0 0 4px ${item.color || '#5bc4d0'});" />`;
    }
    return item.emoji || (item.itemType==='weapon'?'⚔':item.itemType==='armor'?'⬡':item.itemType==='tool'?'🔧':'⊕');
  };
  const typeStat = item =>
    item.itemType==='weapon'     ? `+${item.stats?.damage||0} ATT` :
    item.itemType==='armor'      ? `+${item.stats?.defense||0} DEF` :
    item.itemType==='tool'       ? 'UTILITY' :
                                   `+${item.stats?.hp||0} HP`;

  player.inventory.forEach(item => {
    const ic = item.color || '#5bc4d0';
    const isEq = item === player.equippedWeapon || item === player.equippedArmor;
    const row = document.createElement('div');
    row.className = 'inv-item' + (isEq ? ' equipped' : '');
    row.style.setProperty('--ic', ic);
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <div class="inv-item-icon">${typeIcon(item)}</div>
      <div>
        <div class="inv-item-name">${item.name}</div>
        <div class="inv-item-desc">${item.description || ''}</div>
      </div>
      <div>
        <div class="inv-item-stat">${typeStat(item)}</div>
        ${isEq ? '<div class="inv-item-eq">EQUIPPED</div>' : '<div class="inv-item-eq" style="color:#4a6878">CLICK TO EQUIP</div>'}
      </div>`;

    // Click to equip/unequip
    row.addEventListener('click', () => {
      if (item.itemType === 'weapon') {
        if (player.equippedWeapon === item) {
          // Unequip
          player.damage -= item.stats?.damage || 0;
          player.equippedWeapon = null;
          log(`Unequipped: ${item.name}`);
        } else {
          // Unequip old weapon first
          if (player.equippedWeapon) {
            player.damage -= player.equippedWeapon.stats?.damage || 0;
          }
          // Equip new weapon
          player.damage += item.stats?.damage || 0;
          player.equippedWeapon = item;
          log(`Equipped: ${item.name}  [ATT +${item.stats?.damage||0}]`);
        }
      } else if (item.itemType === 'armor') {
        if (player.equippedArmor === item) {
          // Unequip
          player.defense -= item.stats?.defense || 0;
          player.equippedArmor = null;
          log(`Unequipped: ${item.name}`);
        } else {
          // Unequip old armor first
          if (player.equippedArmor) {
            player.defense -= player.equippedArmor.stats?.defense || 0;
          }
          // Equip new armor
          player.defense += item.stats?.defense || 0;
          player.equippedArmor = item;
          log(`Equipped: ${item.name}  [DEF +${item.stats?.defense||0}]`);
        }
      }
      openInventory(); // Refresh inventory display
    });

    invList.appendChild(row);
  });
  invScreen.classList.remove('hidden');
}

function closeInventory() {
  state = 'playing';
  invScreen.classList.add('hidden');
}

const pauseScreen = document.getElementById('pause-screen');

function playVictoryCinematic() {
  const stage1 = document.getElementById('win-stage1');
  const stage2 = document.getElementById('win-stage2');
  const stage3 = document.getElementById('win-stage3');

  // Reset all stages
  [stage1, stage2, stage3].forEach(s => s.classList.remove('active'));

  // Stage 1: Reactor critical + escape pod (0-4s)
  setTimeout(() => stage1.classList.add('active'), 200);

  // Victory sound effects — alarm → escape → triumph
  SFX.alert();
  setTimeout(() => SFX.alert(), 600);
  setTimeout(() => SFX.alert(), 1200);
  setTimeout(() => SFX.fabricate(), 2500);
  // Triumphant melody when final stage appears
  setTimeout(() => SFX.victory(), 8200);

  // Stage 2: Ship flying through stars (4-8s)
  setTimeout(() => {
    stage1.classList.remove('active');
    stage2.classList.add('active');
  }, 4000);

  // Stage 3: Final summary (8s+)
  setTimeout(() => {
    stage2.classList.remove('active');
    stage3.classList.add('active');

    // Populate stats
    const statsEl = document.getElementById('win-stats-display');
    const enemiesKilled = entities.filter(e => e.type === 'enemy' && e.hp <= 0).length;
    const alliesAlive = entities.filter(e => e.type === 'ally' && e.hp > 0).length;
    statsEl.textContent = `LEVELS CLEARED: 5  ·  ALLIES: ${alliesAlive}  ·  HP: ${player.hp}`;
  }, 8000);
}

function openPause() {
  state = 'paused';
  pauseScreen.classList.remove('hidden');
}

function closePause() {
  state = 'playing';
  pauseScreen.classList.add('hidden');
}

let fabComplete = false;
function openFab() {
  state='fabricating'; fabComplete=false; fabOverlay.classList.remove('hidden');
  fabInput.value=''; fabStatus.textContent=''; fabResult.classList.add('hidden');
  fabInput.disabled=false; setTimeout(()=>fabInput.focus(),30);
}
function closeFab() {
  state='playing'; fabComplete=false; fabOverlay.classList.add('hidden');
  fabInput.value=''; fabStatus.textContent=''; fabResult.classList.add('hidden');
  fabInput.disabled=false;
}

fabInput.addEventListener('keydown', async e => {
  if (e.key!=='Enter') return;
  const desc = fabInput.value.trim();
  if (!desc) return;

  fabInput.disabled=true; fabResult.classList.add('hidden');
  let dots=0; fabStatus.style.color='#ffaa00';
  const loader = setInterval(()=>{ dots=(dots+1)%4; fabStatus.textContent='Fabricating'+'.'.repeat(dots); },350);

  try {
    const res = await fetch('https://meridian-7-backend.onrender.com/fabricate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:desc, apiKey:playerApiKey})});
    clearInterval(loader);

    if (!res.ok) {
      let errMsg = '';
      try { const errData = await res.json(); errMsg = errData.error || ''; } catch(e) {}

      if (res.status === 429) {
        fabStatus.style.color='#ffaa00';
        fabStatus.textContent=errMsg ? `⚠ ${errMsg}` : '⚠ RATE LIMITED — Wait a moment and try again.';
      } else if (res.status === 401) {
        fabStatus.style.color='#ff2244';
        fabStatus.textContent=errMsg ? `✗ ${errMsg}` : '✗ NO API KEY — Set GEMINI_API_KEY in server environment.';
      } else if (res.status === 500) {
        fabStatus.style.color='#ff2244';
        fabStatus.textContent=errMsg ? `✗ ${errMsg}` : '✗ FABRICATION OFFLINE — Server error. Check server logs.';
      } else {
        fabStatus.style.color='#ff2244';
        fabStatus.textContent=errMsg ? `✗ ${errMsg}` : `✗ ERROR ${res.status} — Terminal malfunction.`;
      }
      fabInput.disabled=false;
      return;
    }

    const data = await res.json();

    // Check if response has error field
    if (data.error) {
      fabStatus.style.color='#ff2244';
      fabStatus.textContent=`✗ AI ERROR — ${data.error}`;
      fabInput.disabled=false;
      return;
    }

    fabComplete=true;
    fabInput.blur();
    fabStatus.style.color='#44ff88'; fabStatus.textContent='✓ FABRICATION COMPLETE — Press any key to close';
    fabResName.textContent=`[ ${data.name.toUpperCase()} ]`; fabResName.style.color=data.color||'#00ffee';
    fabResDesc.textContent=data.description||'';
    fabResStats.textContent=`TYPE: ${(data.type||'').toUpperCase()}  ·  ATT: ${data.stats?.damage||0}  DEF: ${data.stats?.defense||0}  HP: ${data.stats?.hp||0}`;
    fabResult.classList.remove('hidden');

    // Spawn item immediately, but keep terminal open for user to review
    data._userDesc = desc;
    spawnFabricated(data);
    log(`FABRICATED: ${data.name}`);

    // User closes manually with ESC
  } catch (err) {
    clearInterval(loader);
    fabStatus.style.color='#ff2244';
    fabStatus.textContent='✗ NETWORK ERROR — Check your connection and try again.';
    fabInput.disabled=false;
  }
});

// ── Fabrication alert banner ──────────────────────────────────────────────────
let fabAlert = null; // { title, sub, color, timer }

function showFabAlert(title, sub, color) {
  fabAlert = { title, sub, color, timer: 480 }; // 8s — click canvas to dismiss early
}

// Wraps canvas text across multiple lines, returns final Y
function fillTextWrapped(text, x, y, maxWidth, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

function drawFabAlert() {
  if (!fabAlert) return;
  fabAlert.timer--;
  if (fabAlert.timer <= 0) { fabAlert = null; return; }

  const alpha = Math.min(1, fabAlert.timer / 40);
  const bw = 700, pad = 22;
  const bx = (CW - bw) / 2, by = 44;

  // Measure how many lines the subtitle needs
  ctx.font = '14px monospace';
  const subMaxW = bw - pad * 2 - 8;
  const subWords = fabAlert.sub.split(' ');
  let subLines = 1, subLine = '';
  for (const w of subWords) {
    const test = subLine ? subLine + ' ' + w : w;
    if (ctx.measureText(test).width > subMaxW && subLine) { subLines++; subLine = w; }
    else subLine = test;
  }
  const bh = 28 + 22 + subLines * 18 + 16; // title + gap + sub lines + padding

  ctx.save();
  ctx.globalAlpha = alpha;

  // Background
  ctx.fillStyle = 'rgba(6,9,15,0.94)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = fabAlert.color; ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);

  // Left accent bar
  ctx.fillStyle = fabAlert.color;
  ctx.fillRect(bx, by, 4, bh);

  // Title — bigger, clear
  ctx.shadowBlur = 6; ctx.shadowColor = fabAlert.color;
  ctx.fillStyle = fabAlert.color;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(fabAlert.title, bx + pad, by + 26);

  // Sub — wrapped, visibly separate
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#8aaabb';
  ctx.font = '14px monospace';
  fillTextWrapped(fabAlert.sub, bx + pad, by + 26 + 22, subMaxW, 18);

  ctx.restore();
}

function detectSprite(name) {
  const n = (name||'').toLowerCase();
  if (!n) return null;

  // Drone-like entities (flying mechanical)
  if (n.match(/drone|uav|flyer|copter|helicopter/)) return 'drone';

  // Crawler-like entities (ground insects/arachnids)
  if (n.match(/crawler|spider|scorpion|crab|arachnid/)) return 'crawler';

  // Sentinel-like entities (humanoid robots/mechs) — but NOT "robot dog/cat"
  if (n.match(/sentinel|android|mech|cyborg/)) return 'sentinel';
  if (n.match(/robot/) && !n.match(/dog|cat|pet|puppy|kitten/)) return 'sentinel';

  // Alien-like entities (xenomorphs, aliens)
  if (n.match(/alien|xeno|xenomorph|extraterrestrial/)) return 'alien';

  return null;
}

function spawnFabricated(data) {
  const pos = nearbyFloor(player.x, player.y, 4);
  if (!pos) return;
  const userDesc = data._userDesc || '';
  const sprite = detectSprite(data.name) || detectSprite(userDesc);
  const base = { id:uid(), x:pos.x, y:pos.y, rx:pos.x*TILE, ry:pos.y*TILE,
                 name:data.name, color:data.color||C.ally, sprite,
                 description:data.description||'', emoji:data.emoji||'?',
                 stats:data.stats||{damage:0,defense:0,hp:0,speed:0},
                 specialEffect:data.specialEffect||'none', fabricated:true,
                 userDesc };
  const {type} = data;

  // Detect epic weapons for special effects
  const isEpic = (data.name||'').toLowerCase().match(/planet|orbital|destroyer|annihilator|obliterator|apocalypse|armageddon|god|titan|colossal|legendary|ultimate|supreme|divine|cosmic|galaxy|universe|extinction|cataclysm/);

  SFX.fabricate();
  if (isEpic) {
    // Epic sound (extra burst)
    setTimeout(() => SFX.fabricate(), 100);
    setTimeout(() => SFX.alert(), 200);
  }

  if (type==='weapon'||type==='armor'||type==='consumable'||type==='tool') {
    entities.push({...base, type:'item', itemType:type});
    const label = type==='weapon' ? `ATT +${data.stats?.damage||3}` :
                  type==='armor'  ? `DEF +${data.stats?.defense||2}` :
                  type==='consumable' ? `+${data.stats?.hp||25} HP` :
                  type==='tool' ? 'UTILITY ITEM' : 'ITEM';
    const sym = data.emoji || (type==='weapon'?'⚔':type==='armor'?'⬡':type==='consumable'?'⊕':'🔧');

    // Epic alert color
    const alertColor = isEpic ? '#ffaa00' : (data.color || C.item);
    const epicPrefix = isEpic ? '⚡ LEGENDARY ⚡  ' : '';

    showFabAlert(`${epicPrefix}${sym}  ${data.name.toUpperCase()} — walk over it to pick up`,
                 label + '  ·  ' + (data.description||''), alertColor);
  } else if (type==='ally') {
    entities.push({...base, type:'ally', hp:data.stats?.hp||30, maxHp:data.stats?.hp||30,
                   damage:data.stats?.damage||6, defense:data.stats?.defense||2});
    showFabAlert(`${data.emoji||'◉'}  ${data.name.toUpperCase()} — ally deployed`,
                 data.description||'Will hunt enemies near you.', data.color||C.ally);
  } else if (type==='pet') {
    entities.push({...base, type:'pet', hp:data.stats?.hp||25, maxHp:data.stats?.hp||25,
                   damage:0, defense:0, followDist:2});
    showFabAlert(`${data.emoji||'🐾'}  ${data.name.toUpperCase()} — pet companion`,
                 data.description||'Will follow you around.', data.color||'#ffaa88');
  } else if (type==='vehicle') {
    entities.push({...base, type:'item', itemType:'vehicle'});
    showFabAlert(`${data.emoji||'🚗'}  ${data.name.toUpperCase()} — vehicle deployed`,
                 `SPEED +${data.stats?.speed||2}  ·  ` + (data.description||''), data.color||'#88ccff');
  } else if (type==='trap') {
    entities.push({...base, type:'trap', hp:999, damage:data.stats?.damage||10,
                   trapTimer:0, triggerRange:2});
    showFabAlert(`${data.emoji||'💥'}  ${data.name.toUpperCase()} — trap deployed`,
                 data.description||'Damages enemies that get close.', data.color||'#ff8844');
  } else {
    // hazard - malfunction
    entities.push({...base, type:'hazard',
                   hp:data.stats?.hp||20, maxHp:data.stats?.hp||20,
                   damage:data.stats?.damage||8, defense:data.stats?.defense||1,
                   aggroState:'chase', aggroFlash:6, wanderDir:null, wanderTimer:0});
    showFabAlert(`⚠  AI MALFUNCTION — ${data.name.toUpperCase()} IS HOSTILE`,
                 'The fabricator misread your request. Eliminate it.', '#cc6622');
    SFX.alert();
  }

  // Epic weapons get MASSIVE particle burst
  materializeParticles(pos.x*TILE, pos.y*TILE, data.color||C.ally);
  if (isEpic) {
    setTimeout(() => materializeParticles(pos.x*TILE, pos.y*TILE, '#ffaa00'), 100);
    setTimeout(() => materializeParticles(pos.x*TILE, pos.y*TILE, data.color||C.ally), 200);
  }
}

function nearbyFloor(cx, cy, radius) {
  for (let r=1;r<=radius;r++)
    for (let dy=-r;dy<=r;dy++)
      for (let dx=-r;dx<=r;dx++) {
        const x=cx+dx, y=cy+dy;
        if (x>=0&&y>=0&&x<MAP_W&&y<MAP_H&&map[y][x]===T.FLOOR&&!entityAt(x,y)) return {x,y};
      }
  return null;
}

// ── Particles ─────────────────────────────────────────────────────────────────
function hitParticles(px, py, color) {
  const sx=px-camera.rx+TILE/2, sy=py-camera.ry+TILE/2;
  for (let i=0;i<7;i++)
    particles.push({x:sx,y:sy,vx:(Math.random()-.5)*5,vy:(Math.random()-.5)*5,
                    life:1,decay:.06+Math.random()*.04,color,size:3+Math.random()*2});
}
function materializeParticles(px, py, color) {
  const sx=px-camera.rx+TILE/2, sy=py-camera.ry+TILE/2;
  for (let i=0;i<24;i++) {
    const a=(i/24)*Math.PI*2, sp=1.5+Math.random()*3;
    particles.push({x:sx,y:sy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
                    life:1,decay:.018+Math.random()*.015,color,size:2+Math.random()*4});
  }
}
function tickParticles() {
  particles=particles.filter(p=>p.life>0);
  for (const p of particles) { p.x+=p.vx; p.y+=p.vy; p.vx*=.93; p.vy*=.93; p.life-=p.decay; }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function drawTile(tx, ty) {
  const sx=Math.round(tx*TILE-camera.rx), sy=Math.round(ty*TILE-camera.ry);
  if (sx<-TILE||sx>CW||sy<-TILE||sy>CH) return;

  ctx.save(); // Prevent canvas state leaking

  const tileHash = (tx * 73 + ty * 37) % 100; // Pseudo-random based on position
  const pulse = Math.sin(gt * 0.02 + tileHash) * 0.5 + 0.5; // Pulsing glow

  // Corruption scales with level: level 1 = almost none, level 5 = heavy
  const corruption = (currentLevel - 1) / 4; // 0.0 to 1.0
  const corruptThreshWall = 95 - corruption * 30;   // veins: 95→65 (more common later)
  const corruptThreshFloor = 92 - corruption * 22;  // biomass: 92→70
  const corruptThreshGoo = 96 - corruption * 11;    // goo: 96→85
  const corruptAlpha = corruption * 0.8;             // glow intensity

  if (map[ty][tx]===T.WALL) {
    // ── WALLS ─────────────────────────────────────────
    ctx.fillStyle = C.wall;
    ctx.fillRect(sx, sy, TILE, TILE);

    // Torn metal edges
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    if (tileHash > 60) ctx.fillRect(sx, sy, 8, TILE);
    if (tileHash > 75) ctx.fillRect(sx + TILE - 8, sy, 8, TILE);

    // Alien biomass veins — scaled by level
    if (tileHash > corruptThreshWall) {
      const veinAlpha = (0.15 + pulse * 0.15) * corruptAlpha;
      ctx.strokeStyle = `rgba(255, 80, 100, ${veinAlpha})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 4 * corruption;
      ctx.shadowColor = '#ff4466';

      if (tileHash % 3 === 0) {
        ctx.beginPath();
        ctx.moveTo(sx + TILE * 0.3, sy);
        ctx.lineTo(sx + TILE * 0.3, sy + TILE);
        ctx.stroke();
      }
      if (tileHash % 5 === 0) {
        ctx.beginPath();
        ctx.moveTo(sx, sy + TILE * 0.6);
        ctx.lineTo(sx + TILE, sy + TILE * 0.6);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // Panel edges
    ctx.strokeStyle = C.wallEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);

    // Sparking wires (rare)
    if (tileHash > 92) {
      const sparkX = sx + (tileHash % 20) + 4;
      const sparkY = sy + ((tileHash * 3) % 20) + 4;
      ctx.fillStyle = '#ffaa00';
      ctx.shadowBlur = 8; ctx.shadowColor = '#ffaa00';
      ctx.fillRect(sparkX, sparkY, 2, 2);
      ctx.shadowBlur = 0;
    }

  } else {
    // ── FLOOR ─────────────────────────────────────────
    ctx.fillStyle = C.floor;
    ctx.fillRect(sx, sy, TILE, TILE);

    // Panel cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    if (tileHash > 40) {
      ctx.beginPath();
      ctx.moveTo(sx + TILE * 0.2, sy);
      ctx.lineTo(sx + TILE * 0.3, sy + TILE);
      ctx.stroke();
    }
    if (tileHash > 65) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + TILE * 0.4);
      ctx.lineTo(sx + TILE, sy + TILE * 0.5);
      ctx.stroke();
    }

    // Alien biomass — scaled by level
    if (tileHash > corruptThreshFloor && corruption > 0.1) {
      const biomassAlpha = (0.1 + pulse * 0.1) * corruptAlpha;
      ctx.fillStyle = `rgba(200, 60, 80, ${biomassAlpha})`;
      ctx.shadowBlur = 3 * corruption;
      ctx.shadowColor = '#ff4466';
      ctx.beginPath();
      ctx.arc(sx + 6, sy + 6, 3 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Alien goo puddles — scaled by level
    if (tileHash > corruptThreshGoo && corruption > 0.2) {
      const gooAlpha = (0.15 + pulse * 0.08) * corruptAlpha;
      ctx.fillStyle = `rgba(255, 70, 90, ${gooAlpha})`;
      ctx.shadowBlur = 4 * corruption;
      ctx.shadowColor = '#ff4466';
      ctx.beginPath();
      ctx.ellipse(sx + TILE/2, sy + TILE/2, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Center bolt/rivet
    ctx.fillStyle = tileHash > 50 ? '#050a10' : '#0c1e30';
    ctx.fillRect(sx + TILE/2 - 1, sy + TILE/2 - 1, 2, 2);
  }

  ctx.restore(); // Restore canvas state
}

function drawEntity(e) {
  const sx=Math.round(e.rx-camera.rx), sy=Math.round(e.ry-camera.ry);

  // Add idle floating animation (sine wave bobbing)
  // Use position as seed instead of ID (which might be a string)
  let floatOffset = 0;
  const seed = e.x * 7 + e.y * 13; // Position-based seed
  if (e.type === 'item' || e.type === 'pet') {
    floatOffset = Math.sin(gt * 0.05 + seed * 0.1) * 3; // Gentle bob
  } else if (e.type === 'ally' || e.type === 'enemy' || e.type === 'hazard') {
    floatOffset = Math.sin(gt * 0.03 + seed * 0.05) * 1.5; // Subtle breathing
  }

  const cx=sx+TILE/2, cy=sy+TILE/2 + floatOffset;
  if (sx<-TILE||sx>CW||sy<-TILE||sy>CH) return;
  ctx.save();
  if      (e.type==='player')                    drawPlayer(cx, cy);
  else if (e.type==='enemy'||e.type==='hazard')  drawEnemy(cx, cy, e);
  else if (e.type==='ally')                      drawAlly(cx, cy, e);
  else if (e.type==='pet')                       drawPet(cx, cy, e);
  else if (e.type==='trap')                      drawTrap(cx, cy, e);
  else if (e.type==='item')                      drawItem(cx, cy, e);

  // HP bar
  if (e.maxHp && e.type!=='player' && e.type!=='item' && e.type!=='trap') {
    const bx=sx+3, by=sy+TILE-6, bw=TILE-6, bh=4;
    ctx.shadowBlur=0;
    ctx.fillStyle='#111'; ctx.fillRect(bx,by,bw,bh);
    const pct=e.hp/e.maxHp;

    // Color-coded by type: Green for allies/pets, Red for enemies/hazards
    let barColor;
    if (e.type==='ally' || e.type==='pet') {
      barColor = pct>.5 ? '#44ff44' : pct>.25 ? '#88ff44' : '#ffaa00'; // Green → yellow
    } else if (e.type==='enemy' || e.type==='hazard') {
      barColor = pct>.5 ? '#ff2244' : pct>.25 ? '#ff4444' : '#ff6666'; // Red shades
    } else {
      barColor = '#44ff44'; // Default green
    }

    ctx.fillStyle = barColor;
    ctx.fillRect(bx,by,bw*pct,bh);
  }
  // Aggro "!" indicator
  if (e.aggroFlash>0) {
    ctx.shadowBlur=14; ctx.shadowColor='#ffff00';
    ctx.fillStyle='#ffff00'; ctx.font='bold 15px monospace'; ctx.textAlign='center';
    ctx.fillText('!', cx, sy-2);
  }
  ctx.restore();
}

// ── Sprite drawers ────────────────────────────────────────────────────────────
function drawPlayer(cx, cy) {
  // Hit flash
  if (player.hitFlash > 0) {
    player.hitFlash--;
    ctx.fillStyle = `rgba(255,40,40,${(player.hitFlash / 12) * 0.45})`;
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI*2); ctx.fill();
  }

  const col = C.player;
  const bob = Math.sin(gt * 0.09) * 1.5; // subtle breathing animation
  const y = cy + bob;

  ctx.save();
  glow(col, 6);

  // Armor color overlay if equipped
  const armorCol = player.equippedArmor ? player.equippedArmor.color : null;
  const baseCol = armorCol || col;

  ctx.fillStyle = baseCol;

  // Boots
  ctx.fillRect(cx-8,  y+14, 7, 5);
  ctx.fillRect(cx+1,  y+14, 7, 5);
  // Legs
  ctx.fillRect(cx-7,  y+6,  5, 10);
  ctx.fillRect(cx+2,  y+6,  5, 10);
  // Torso
  ctx.fillRect(cx-10, y-5,  20, 13);

  // Enhanced shoulder pads if armor equipped
  if (player.equippedArmor) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = armorCol;
    ctx.fillRect(cx-16, y-7,  7,  9);
    ctx.fillRect(cx+9,  y-7,  7,  9);
    // Armor plate on chest
    ctx.fillRect(cx-8, y-4, 16, 10);
    // Armor glow
    glow(armorCol, 4);
    ctx.strokeStyle = armorCol; ctx.lineWidth = 1;
    ctx.strokeRect(cx-8, y-4, 16, 10);
  } else {
    // Normal shoulder pads
    ctx.fillStyle = col;
    ctx.fillRect(cx-14, y-6,  5,  7);
    ctx.fillRect(cx+9,  y-6,  5,  7);
  }

  // Arms
  ctx.fillStyle = baseCol;
  ctx.fillRect(cx-14, y+1,  4,  9);
  ctx.fillRect(cx+10, y+1,  4,  9);

  // Equipped weapon in hand - always horizontal (left or right only)
  if (player.equippedWeapon) {
    const wc = player.equippedWeapon.color || C.item;
    ctx.shadowBlur = 0;

    // Track last horizontal direction (ignore vertical)
    if (!player.lastHorizontalDir) player.lastHorizontalDir = 1; // default right
    if (player.facing.dx !== 0) player.lastHorizontalDir = player.facing.dx;

    // Check if we have a loaded icon for this weapon
    const iconKey = getIconKey(player.equippedWeapon);
    const weaponIcon = ITEM_ICONS[iconKey];

    // Weapon always at player's side, pointing horizontally
    const pointingRight = player.lastHorizontalDir > 0;
    const wx = pointingRight ? cx + 14 : cx - 14;
    const wy = y + 2; // always at side height

    ctx.save();
    ctx.translate(wx, wy);

    // Flip if pointing left
    if (!pointingRight) {
      ctx.scale(-1, 1);
    }

    if (weaponIcon) {
      // Draw colored background first
      glow(wc, 8);
      ctx.fillStyle = wc;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(-12, -12, 24, 24);
      ctx.globalAlpha = 1;

      // Draw icon on top (black becomes darker, bright parts stay visible)
      ctx.shadowBlur = 0;
      ctx.drawImage(weaponIcon, -12, -12, 24, 24);
    } else {
      // Fallback to emoji
      const weaponEmoji = player.equippedWeapon.emoji || '⚔';
      glow(wc, 6);
      ctx.fillStyle = wc;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(weaponEmoji, 0, 0);
    }

    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // Neck
  ctx.fillStyle = col; ctx.shadowBlur = 0;
  ctx.fillRect(cx-3,  y-8,  6,  4);

  // Helmet (round)
  glow(col, 6);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(cx, y-15, 11, 0, Math.PI*2); ctx.fill();

  // Visor (dark)
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#030e18';
  ctx.beginPath(); ctx.ellipse(cx, y-15, 7, 6, 0, 0, Math.PI*2); ctx.fill();

  // Visor inner glow
  glow(col, 5);
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, y-15, 6, 5, 0, 0, Math.PI*2); ctx.stroke();

  // Visor highlight (reflection)
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(150,240,255,0.4)';
  ctx.beginPath(); ctx.ellipse(cx-2, y-18, 2, 1.5, -0.5, 0, Math.PI*2); ctx.fill();

  // Chest light
  glow('#ffffff', 4);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, y+2, 2.5, 0, Math.PI*2); ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawEnemy(cx, cy, e) {
  const col = e.color || C.enemy;

  // Scale up bosses slightly
  if (e.isBoss) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.3, 1.3);
    cx = 0;
    cy = 0;
  }

  // For fabricated hazards: use sprite ONLY if detectSprite returned a valid match
  if (e.fabricated && (!e.sprite || e.sprite === null) && e.emoji && e.emoji !== '?') {
    // No known sprite → use emoji (no shadow for performance)
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.fillText(e.emoji, cx, cy);
    ctx.textBaseline = 'alphabetic';
    // Warning indicator for hazards
    if (e.type === 'hazard') {
      ctx.fillStyle = '#cc6622';
      ctx.font = 'bold 12px Arial';
      ctx.fillText('⚠', cx, cy - 28);
    }
  } else if (e.sprite && e.sprite !== null) {
    // Has a known sprite → use it
    glow(col, 6);
    const s = e.sprite;
    if      (s==='drone')    drawDrone(cx, cy, col);
    else if (s==='crawler')  drawCrawler(cx, cy, col);
    else if (s==='sentinel') drawSentinel(cx, cy, col);
    else if (s==='alien')    drawAlien(cx, cy, col);
    else { ctx.fillStyle=col; ctx.beginPath(); ctx.arc(cx,cy,11,0,Math.PI*2); ctx.fill(); }
  } else {
    // Fallback for natural enemies without sprite info
    glow(col, 6);
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(cx,cy,11,0,Math.PI*2); ctx.fill();
  }

  if (e.isBoss) {
    ctx.restore();
    // Crown indicator above boss
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffdd00';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('👑', cx, cy - 32);
  }
}

function drawAlly(cx, cy, e) {
  const col = e.color || C.ally;

  // For fabricated allies: use sprite ONLY if detectSprite returned a valid match
  // Otherwise use emoji (dog, dragon, cat, vehicle, etc.)
  if (e.fabricated && (!e.sprite || e.sprite === null) && e.emoji && e.emoji !== '?') {
    // No known sprite → use emoji (no shadow for performance)
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.fillText(e.emoji, cx, cy);
    ctx.textBaseline = 'alphabetic';
  } else if (e.sprite && e.sprite !== null) {
    // Has a known sprite → use it
    glow(col, 6);
    const s = e.sprite;
    if      (s==='drone')    drawDrone(cx, cy, col);
    else if (s==='crawler')  drawCrawler(cx, cy, col);
    else if (s==='sentinel') drawSentinel(cx, cy, col);
    else if (s==='alien')    drawAlien(cx, cy, col);
    else { ctx.fillStyle=col; ctx.beginPath(); ctx.arc(cx,cy,11,0,Math.PI*2); ctx.fill(); }
  } else {
    // Fallback: circle
    glow(col, 6);
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(cx,cy,11,0,Math.PI*2); ctx.fill();
  }

  // Friendly indicator: small solid triangle above
  ctx.shadowBlur=0; ctx.fillStyle=col;
  ctx.beginPath(); ctx.moveTo(cx,cy-26); ctx.lineTo(cx-5,cy-19); ctx.lineTo(cx+5,cy-19); ctx.closePath(); ctx.fill();
  // Name tag
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(cx-26,cy-40,52,13);
  ctx.fillStyle=col; ctx.font='bold 8px monospace'; ctx.textAlign='center';
  ctx.fillText((e.name||'ALLY').toUpperCase().slice(0,13), cx, cy-30);
}

function drawPet(cx, cy, e) {
  const col = e.color || '#ffaa88';
  // Draw emoji if available, otherwise simple shape
  if (e.emoji && e.emoji !== '?') {
    ctx.shadowBlur = 6; ctx.shadowColor = col;
    ctx.font = 'bold 32px Arial'; // larger font for emoji
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.emoji, cx, cy);
    ctx.textBaseline = 'alphabetic';
  } else {
    glow(col, 6);
    ctx.fillStyle = col;
    // Simple pet shape - rounded blob with ears
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI*2); ctx.fill();
    // Ears
    ctx.beginPath(); ctx.arc(cx-7, cy-8, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+7, cy-8, 4, 0, Math.PI*2); ctx.fill();
    // Eyes
    ctx.fillStyle = '#111'; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(cx-4, cy-2, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+4, cy-2, 2, 0, Math.PI*2); ctx.fill();
  }
  // Heart indicator above
  ctx.shadowBlur=0; ctx.fillStyle='#ff6688';
  ctx.font='14px Arial'; ctx.textAlign='center';
  ctx.fillText('♥', cx, cy-22);
}

function drawTrap(cx, cy, e) {
  const col = e.color || '#ff8844';
  const pulse = Math.sin(gt * 0.1) * 0.3 + 0.7;
  const triggered = (e.triggerFlash || 0) > 0;

  // Trigger flash — bright burst when trap fires
  if (triggered) {
    e.triggerFlash--;
    ctx.fillStyle = col;
    ctx.globalAlpha = e.triggerFlash / 8 * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 20 + (8 - e.triggerFlash) * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Draw emoji if available
  if (e.emoji && e.emoji !== '?') {
    ctx.shadowBlur = triggered ? 16 : 8 * pulse;
    ctx.shadowColor = triggered ? '#ffffff' : col;
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.emoji, cx, cy);
    ctx.textBaseline = 'alphabetic';
  } else {
    glow(col, triggered ? 16 : 8 * pulse);
    ctx.fillStyle = col; ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy-12); ctx.lineTo(cx+11, cy+8); ctx.lineTo(cx-11, cy+8);
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = col; ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', cx, cy+4);
  }

  // Range indicator (pulsing circle)
  ctx.shadowBlur = 0; ctx.strokeStyle = col + '44';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const range = (e.triggerRange || 2) * TILE;
  ctx.arc(cx, cy, range * pulse, 0, Math.PI*2);
  ctx.stroke();

  // Charges remaining
  const charges = e.charges ?? 8;
  ctx.fillStyle = charges <= 2 ? '#ff3333' : '#88aacc';
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`${charges}`, cx, cy + 18);
}

function drawItem(cx, cy, e) {
  const col = e.color || C.item;

  // Detect EPIC/LEGENDARY weapons by name
  const name = (e.name || '').toLowerCase();
  const isEpic = name.match(/planet|orbital|destroyer|annihilator|obliterator|apocalypse|armageddon|god|titan|colossal|legendary|ultimate|supreme|divine|cosmic|galaxy|universe|extinction|cataclysm/);

  const size = isEpic ? 28 : 22;
  const halfSize = size / 2;

  ctx.strokeStyle = col;
  ctx.lineWidth = isEpic ? 2.5 : 1.5;
  ctx.strokeRect(cx - halfSize + 1, cy - halfSize + 1, size - 2, size - 2);

  // Corner accents (larger for epic)
  ctx.lineWidth = isEpic ? 2.5 : 2;
  const accentSize = isEpic ? 7 : 4;
  for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx*halfSize, cy + sy*halfSize);
    ctx.lineTo(cx + sx*(halfSize - accentSize), cy + sy*halfSize);
    ctx.moveTo(cx + sx*halfSize, cy + sy*halfSize);
    ctx.lineTo(cx + sx*halfSize, cy + sy*(halfSize - accentSize));
    ctx.stroke();
  }

  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;

  const iconImg = ITEM_ICONS[getIconKey(e)];
  if (iconImg) {
    // Draw colored background
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(cx-10, cy-10, 20, 20);
    ctx.globalAlpha = 1;

    // Draw icon on top
    ctx.shadowBlur = 0;
    ctx.drawImage(iconImg, cx-10, cy-10, 20, 20);
  } else if (e.emoji && e.emoji !== '?' && e.emoji !== '❓') {
    // No icon match → render emoji (epic weapons, unusual items)
    const emojiSize = isEpic ? 28 : 20;
    glow(col, isEpic ? 14 : 6);
    ctx.font = `bold ${emojiSize}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.emoji, cx, cy);
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
  } else {
    // Final fallback: canvas-drawn sprites
    if (e.itemType === 'weapon')          drawWeaponSprite(cx, cy, col, e.name || '');
    else if (e.itemType === 'armor')      drawShieldSprite(cx, cy, col);
    else if (e.itemType === 'consumable') drawVialSprite(cx, cy, col);
    else if (e.itemType === 'tool')       { ctx.fillStyle=col; ctx.font='bold 14px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('🔧', cx, cy); }
    else {
      glow(col, 8);
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy);
    }
    ctx.textBaseline = 'alphabetic';
  }
}

function drawWeaponSprite(cx, cy, col, name) {
  const n = name.toLowerCase();
  if (n.match(/sword|blade|knife|dagger|katana|saber|sabre|axe|hatchet/)) {
    drawSwordSprite(cx, cy, col);
  } else if (n.match(/staff|wand|rod|spear|lance|pole/)) {
    drawStaffSprite(cx, cy, col);
  } else {
    drawGunSprite(cx, cy, col); // default: blaster / gun / bazooka / rifle
  }
}

// ── Item sprites ──────────────────────────────────────────────────────────────
function drawGunSprite(cx, cy, col) {
  glow(col, 8);
  ctx.fillStyle = col;
  // Barrel
  ctx.fillRect(cx - 1, cy - 4, 12, 4);
  // Body / receiver
  ctx.fillRect(cx - 6, cy - 3, 8, 6);
  // Grip
  ctx.fillRect(cx - 4, cy + 3, 3, 5);
  // Trigger guard (outline)
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx - 2, cy + 4, 3, 0, Math.PI); ctx.stroke();
  // Muzzle highlight
  ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 8; ctx.shadowColor = col;
  ctx.fillRect(cx + 10, cy - 3, 2, 2);
}

function drawSwordSprite(cx, cy, col) {
  glow(col, 8);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = col;
  // Blade
  ctx.beginPath();
  ctx.moveTo(0, -12); ctx.lineTo(2, 0); ctx.lineTo(-2, 0);
  ctx.closePath(); ctx.fill();
  // Crossguard
  ctx.fillRect(-7, 0, 14, 2);
  // Handle
  ctx.fillRect(-1, 2, 2, 7);
  // Pommel
  ctx.beginPath(); ctx.arc(0, 10, 2, 0, Math.PI*2); ctx.fill();
  // Blade shine
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(0, -11, 1, 9);
  ctx.restore();
}

function drawStaffSprite(cx, cy, col) {
  glow(col, 8);
  ctx.fillStyle = col;
  // Shaft
  ctx.fillRect(cx - 1, cy - 10, 2, 20);
  // Orb top
  ctx.beginPath(); ctx.arc(cx, cy - 10, 5, 0, Math.PI*2); ctx.fill();
  // Inner orb glow
  ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 10; ctx.shadowColor = col;
  ctx.beginPath(); ctx.arc(cx, cy - 10, 2, 0, Math.PI*2); ctx.fill();
  // Base tip
  ctx.fillStyle = col; ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.moveTo(cx-1, cy+10); ctx.lineTo(cx+1, cy+10); ctx.lineTo(cx, cy+14); ctx.closePath(); ctx.fill();
}

function drawShieldSprite(cx, cy, col) {
  glow(col, 8);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx,    cy - 11);
  ctx.lineTo(cx+9,  cy - 7);
  ctx.lineTo(cx+9,  cy + 2);
  ctx.lineTo(cx,    cy + 11);
  ctx.lineTo(cx-9,  cy + 2);
  ctx.lineTo(cx-9,  cy - 7);
  ctx.closePath(); ctx.fill();
  // Cross emblem
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cx-1, cy-7, 2, 14);
  ctx.fillRect(cx-5, cy-1, 10, 2);
}

// Alien — big elongated head, 3 glowing eyes, tentacle limbs
function drawAlien(cx, cy, col) {
  ctx.save();
  glow(col, 5);

  // Tentacle legs (2 each side, animated)
  ctx.strokeStyle = col; ctx.lineWidth = 1.8;
  for (const side of [-1, 1]) {
    for (let t = 0; t < 2; t++) {
      const bx = cx + side * 4, by = cy + 12;
      const wobble = Math.sin(gt * 0.08 + t * 1.4 + side) * 4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + side*(10+t*4), by + 6 + wobble, bx + side*(8+t*4), by + 14);
      ctx.stroke();
    }
  }

  // Small torso
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(cx, cy+6, 6, 8, 0, 0, Math.PI*2); ctx.fill();

  // Elongated head
  ctx.beginPath(); ctx.ellipse(cx, cy-8, 9, 13, 0, 0, Math.PI*2); ctx.fill();

  // 3 eyes
  ctx.shadowBlur = 0;
  const eyePositions = [-5, 0, 5];
  eyePositions.forEach((ex, i) => {
    // Sclera
    ctx.fillStyle = '#e8ffe0';
    ctx.beginPath(); ctx.arc(cx+ex, cy-10, 3, 0, Math.PI*2); ctx.fill();
    // Pupil (slit)
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(cx+ex, cy-10, 1, 2.5, 0, 0, Math.PI*2); ctx.fill();
    // Glow
    glow(col, 4);
    ctx.strokeStyle = col; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(cx+ex, cy-10, 3, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  });

  // Two thin arms
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx-6, cy+4); ctx.lineTo(cx-14, cy-2); ctx.lineTo(cx-16, cy+4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+6, cy+4); ctx.lineTo(cx+14, cy-2); ctx.lineTo(cx+16, cy+4); ctx.stroke();

  ctx.restore();
}

function drawVialSprite(cx, cy, col) {
  glow(col, 8);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.3);
  ctx.fillStyle = col;
  // Vial body
  ctx.beginPath();
  ctx.roundRect(-3, -9, 6, 14, 2); ctx.fill();
  // Cork
  ctx.fillStyle = '#aaaaaa'; ctx.shadowBlur = 0;
  ctx.fillRect(-2, -12, 4, 4);
  // Liquid fill (lighter shade)
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.roundRect(-2, -3, 4, 7, 1); ctx.fill();
  // Shine line
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(-1, -8, 1, 10);
  ctx.restore();
}

// Patrol Drone — flying mechanical unit with rotors
function drawDrone(cx, cy, col) {
  ctx.strokeStyle=col; ctx.lineWidth=1.5;
  // Rotor arms + spinning ellipses
  for (const side of [-1,1]) {
    ctx.beginPath(); ctx.moveTo(cx+side*8,cy); ctx.lineTo(cx+side*17,cy-2); ctx.stroke();
    const wobble = Math.sin(gt*0.18)*1.5;
    ctx.beginPath(); ctx.ellipse(cx+side*17,cy-2,7+wobble,3,0,0,Math.PI*2); ctx.stroke();
  }
  // Main body
  ctx.fillStyle=col;
  ctx.beginPath(); ctx.arc(cx,cy,9,0,Math.PI*2); ctx.fill();
  // Landing struts
  ctx.beginPath(); ctx.moveTo(cx-5,cy+9); ctx.lineTo(cx-8,cy+16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+5,cy+9); ctx.lineTo(cx+8,cy+16); ctx.stroke();
  // Sensor eye
  ctx.fillStyle='#ffffff'; ctx.shadowBlur=4; ctx.shadowColor='#ffffff';
  ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fill();
  // Danger stripe on body
  ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx-6,cy-3); ctx.lineTo(cx+6,cy+3); ctx.stroke();
}

// Crawler — spider-like ground unit with animated legs
function drawCrawler(cx, cy, col) {
  ctx.strokeStyle=col; ctx.lineWidth=1.5;
  // 3 legs per side, animated
  for (const side of [-1,1]) {
    for (let i=0;i<3;i++) {
      const bx=cx+side*8, by=cy-3+i*4;
      const legX=cx+side*(17+Math.sin(gt*0.07+i*1.1)*2);
      const legY=by+10;
      ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(legX,legY); ctx.stroke();
      // Claw tip
      ctx.beginPath(); ctx.arc(legX,legY,1.5,0,Math.PI*2);
      ctx.fillStyle=col; ctx.fill();
    }
  }
  // Body
  ctx.fillStyle=col;
  ctx.beginPath(); ctx.ellipse(cx,cy,12,7,0,0,Math.PI*2); ctx.fill();
  // Carapace ridge
  ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(cx-8,cy); ctx.lineTo(cx+8,cy); ctx.stroke();
  // Three eyes (bright)
  ctx.shadowBlur=8; ctx.shadowColor='#ffff00';
  for (let i=-1;i<=1;i++) {
    ctx.fillStyle=i===0?'#ffffff':'#ffff00';
    ctx.beginPath(); ctx.arc(cx+i*4,cy-2,2,0,Math.PI*2); ctx.fill();
  }
  // Fangs
  ctx.shadowBlur=0; ctx.strokeStyle='rgba(200,200,200,0.8)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(cx-3,cy+7); ctx.lineTo(cx-5,cy+14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+3,cy+7); ctx.lineTo(cx+5,cy+14); ctx.stroke();
}

// Sentinel — bipedal armored robot
function drawSentinel(cx, cy, col) {
  ctx.fillStyle=col;
  // Legs
  ctx.fillRect(cx-8,cy+6,6,13);
  ctx.fillRect(cx+2,cy+6,6,13);
  // Feet
  ctx.fillRect(cx-10,cy+17,8,4);
  ctx.fillRect(cx+2, cy+17,8,4);
  // Torso
  ctx.fillRect(cx-10,cy-5,20,13);
  // Shoulder pads
  ctx.fillRect(cx-15,cy-6,5,8);
  ctx.fillRect(cx+10,cy-6,5,8);
  // Arms
  ctx.fillRect(cx-15,cy+2,5,9);
  ctx.fillRect(cx+10,cy+2,5,9);
  // Neck
  ctx.fillRect(cx-3,cy-9,6,5);
  // Head
  ctx.beginPath(); ctx.arc(cx,cy-14,9,0,Math.PI*2); ctx.fill();
  // Helmet rim
  ctx.fillRect(cx-10,cy-17,20,4);
  // Visor glow strip
  ctx.strokeStyle='#ffffff'; ctx.shadowBlur=4; ctx.shadowColor='#ffffff'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(cx-6,cy-14); ctx.lineTo(cx+6,cy-14); ctx.stroke();
  // Chest reactor core
  ctx.fillStyle='#ffffff'; ctx.shadowBlur=4;
  ctx.beginPath(); ctx.arc(cx,cy+1,3,0,Math.PI*2); ctx.fill();
  // Knuckle details
  ctx.shadowBlur=0; ctx.fillStyle=col;
  ctx.fillRect(cx-16,cy+8,3,3);
  ctx.fillRect(cx+13,cy+8,3,3);
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha=Math.max(0,p.life);
    ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

function drawHUD() {
  const HH = 120; // taller for 1080p
  const hy = CH - HH;

  // Background + top border
  ctx.fillStyle = C.hudBg;
  ctx.fillRect(0, hy, CW, HH);
  ctx.strokeStyle = '#1e3450'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(CW, hy); ctx.stroke();
  ctx.shadowBlur = 0;

  // ── LEFT: HP bar ──────────────────────────────────────────────
  const hpLabelX = 20, hpBarX = 80, hpBarY = hy + 22;
  const hpBarW = 320, hpBarH = 26;
  const hpPct = Math.max(0, player.hp / player.maxHp);
  const hpCol = '#33cc77'; // Always green for player

  ctx.fillStyle = '#5a8090'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'left';
  ctx.fillText('HP', hpLabelX, hpBarY + 19);

  ctx.fillStyle = '#0d1a28'; ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
  ctx.fillStyle = hpCol;
  ctx.fillRect(hpBarX, hpBarY, hpBarW * hpPct, hpBarH);

  // Segment ticks
  ctx.strokeStyle = 'rgba(6,9,15,0.45)'; ctx.lineWidth = 1;
  for (let i=1; i<10; i++) {
    const tx = hpBarX + (hpBarW/10)*i;
    ctx.beginPath(); ctx.moveTo(tx,hpBarY); ctx.lineTo(tx,hpBarY+hpBarH); ctx.stroke();
  }

  // HP value inside bar
  ctx.fillStyle = '#d0e8ff'; ctx.font = 'bold 15px monospace';
  ctx.fillText(`${player.hp} / ${player.maxHp}`, hpBarX + 8, hpBarY + 18);

  // ── ATT / DEF / SPEED / LEVEL ──────────────────────────────────────────
  const statY = hy + 82;
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#cc7733'; ctx.fillText(`ATT  ${player.damage}`, hpLabelX, statY);
  ctx.fillStyle = '#3388cc'; ctx.fillText(`DEF  ${player.defense}`, hpLabelX + 180, statY);
  if (player.speedBoost && player.speedBoost > 0) {
    ctx.fillStyle = '#88ccff'; ctx.fillText(`SPD  +${player.speedBoost}`, hpLabelX + 360, statY);
  }
  // Level indicator
  ctx.fillStyle = '#44ffcc'; ctx.font = 'bold 20px monospace';
  ctx.fillText(`LEVEL ${currentLevel}`, player.speedBoost > 0 ? hpLabelX + 540 : hpLabelX + 370, statY);

  // ── INVENTORY ─────────────────────────────────────────────────
  const slotW = 150, slotH = 86, slotGap = 10;
  const slotStart = 620, slotTop = hy + 14; // Moved right to avoid overlap with LEVEL

  ctx.fillStyle = '#3a6080'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
  ctx.fillText('INVENTORY', slotStart, hy + 13);

  player.inventory.forEach((item, i) => {
    const ix = slotStart + i * (slotW + slotGap);
    if (ix + slotW > CW - 20) return; // don't overflow screen
    const ic = item.color || C.item;
    const isEq = item === player.equippedWeapon || item === player.equippedArmor;

    ctx.fillStyle = 'rgba(8,16,30,0.85)';
    ctx.fillRect(ix, slotTop + 4, slotW, slotH);

    ctx.shadowBlur = isEq ? 6 : 2; ctx.shadowColor = ic;
    ctx.strokeStyle = isEq ? ic : ic + '66';
    ctx.lineWidth = isEq ? 2 : 1;
    ctx.strokeRect(ix, slotTop + 4, slotW, slotH);
    ctx.shadowBlur = 0;

    // Use PNG icon if available, otherwise fallback
    const iconImg = ITEM_ICONS[getIconKey(item)];
    if (iconImg) {
      // Draw colored background
      ctx.fillStyle = ic;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(ix + 6, slotTop + 8, 24, 24);
      ctx.globalAlpha = 1;

      // Draw icon with glow
      ctx.shadowBlur = 4; ctx.shadowColor = ic;
      ctx.drawImage(iconImg, ix + 6, slotTop + 8, 24, 24);
      ctx.shadowBlur = 0;
    } else {
      // Type tag fallback (no emoji!)
      const tag = item.itemType==='weapon'?'WPN':item.itemType==='armor'?'ARM':item.itemType==='tool'?'TL':'CON';
      ctx.fillStyle = ic + 'aa'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(tag, ix+8, slotTop+16);
    }

    // EQ badge (top right)
    if (isEq) {
      ctx.fillStyle = ic; ctx.textAlign = 'right'; ctx.font = 'bold 10px monospace';
      ctx.fillText('EQ', ix+slotW-6, slotTop+16);
      ctx.textAlign = 'left';
    }

    // Item name — clear spacing from icon
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#c8e0f8'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
    const nm = item.name.length > 15 ? item.name.slice(0,14)+'…' : item.name;
    ctx.fillText(nm, ix+8, slotTop+46);

    // Stat - clear spacing from name
    const stat = item.itemType==='weapon' ? `+${item.stats?.damage||0} ATT`
               : item.itemType==='armor'  ? `+${item.stats?.defense||0} DEF`
               : item.itemType==='tool'   ? 'UTIL'
               :                            `+${item.stats?.hp||0} HP`;
    ctx.fillStyle = ic; ctx.font = 'bold 12px monospace';
    ctx.fillText(stat, ix+8, slotTop+68);
  });

  // Empty slot outlines
  for (let i=player.inventory.length; i<6; i++) {
    const ix = slotStart + i*(slotW+slotGap);
    if (ix+slotW > CW-20) break;
    ctx.strokeStyle = '#0e1e2e'; ctx.lineWidth = 1;
    ctx.strokeRect(ix, slotTop+4, slotW, slotH);
  }

  // ── Controls hint (styled with F Fabricate accent) ──────────────────
  const ctrlY = hy + HH - 14;
  const ctrlX = hpLabelX;
  ctx.font = '14px monospace'; ctx.textAlign = 'left';

  // Draw each control, highlighting F Fabricate
  const controls = [
    { key: 'WASD', label: 'Move', accent: false },
    { key: 'F', label: 'Fabricate', accent: true },
    { key: 'SPACE', label: 'Attack', accent: false },
    { key: 'I', label: 'Inventory', accent: false },
  ];
  let cx2 = ctrlX;
  for (const c of controls) {
    // Key background
    const keyW = ctx.measureText(c.key).width + 10;
    if (c.accent) {
      // Pulsing cyan accent for F Fabricate
      const pulse = Math.sin(gt * 0.06) * 0.15 + 0.85;
      ctx.fillStyle = `rgba(77, 217, 232, ${0.25 * pulse})`;
      ctx.fillRect(cx2 - 2, ctrlY - 12, keyW, 16);
      ctx.fillStyle = '#4dd9e8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(c.key, cx2 + 3, ctrlY);
      cx2 += keyW + 4;
      ctx.fillStyle = '#4dd9e8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(c.label, cx2, ctrlY);
      cx2 += ctx.measureText(c.label).width + 20;
      ctx.font = '14px monospace';
    } else {
      ctx.fillStyle = 'rgba(42, 64, 80, 0.6)';
      ctx.fillRect(cx2 - 2, ctrlY - 12, keyW, 16);
      ctx.fillStyle = '#5a8a9a';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(c.key, cx2 + 3, ctrlY);
      cx2 += keyW + 4;
      ctx.fillStyle = '#3a5a6a';
      ctx.font = '13px monospace';
      ctx.fillText(c.label, cx2, ctrlY);
      cx2 += ctx.measureText(c.label).width + 18;
    }
  }
}

// ── Weapon use (SPACE) ────────────────────────────────────────────────────────
function isMelee(name) {
  return !!(name||'').toLowerCase().match(/sword|blade|knife|axe|dagger|saber|sabre|katana|scimitar|rapier|cutlass|hammer|mace|club|spear|lance|bat|wrench|staff|rod|stick|pipe|crowbar|fist|gauntlet|claw/);
}

function useEquippedWeapon() {
  const weapon = player.equippedWeapon;
  if (!weapon) { log('No weapon equipped — press F to fabricate one'); return; }

  const col = weapon.color || C.item;

  if (isMelee(weapon.name)) {
    SFX.swing();
    // ── Melee swing: hit all 8 adjacent tiles ─────────────────
    let hits = 0;
    for (const [ddx,ddy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const ent = entityAt(player.x+ddx, player.y+ddy);
      if (ent && (ent.type==='enemy'||ent.type==='hazard')) { attack(player, ent); hits++; }
    }
    if (!hits) log(`${weapon.name}: no targets adjacent`);
    // Visual: burst ring around player
    for (let i=0;i<12;i++) {
      const a = (i/12)*Math.PI*2;
      particles.push({ x: player.rx-camera.rx+TILE/2, y: player.ry-camera.ry+TILE/2,
        vx:Math.cos(a)*4, vy:Math.sin(a)*4, life:1, decay:.07, color:col, size:4 });
    }
  } else {
    SFX.shoot();
    // ── Ranged shot in facing direction ───────────────────────
    const {dx,dy} = player.facing;
    let x=player.x+dx, y=player.y+dy, hitEnt=null, hitX=player.x, hitY=player.y;
    while (x>=0&&y>=0&&x<MAP_W&&y<MAP_H&&map[y][x]===T.FLOOR) {
      const ent = entityAt(x,y);
      if (ent && (ent.type==='enemy'||ent.type==='hazard')) { hitEnt=ent; hitX=x; hitY=y; break; }
      hitX=x; hitY=y; x+=dx; y+=dy;
    }

    // Determine projectile type based on weapon name
    const weaponName = (weapon.name||'').toLowerCase();
    const isLaser = weaponName.match(/laser|plasma|beam|ray|photon|phaser|blaster|energy/);
    const projType = isLaser ? 'laser' : 'bullet';

    // Visual projectile from player to impact
    projectileTrails.push({
      sx: player.x, sy: player.y, ex: hitX, ey: hitY,
      color: col, life: 1, decay: projType === 'laser' ? .055 : .15,
      type: projType
    });

    // Muzzle flash
    particles.push({ x:player.rx-camera.rx+TILE/2, y:player.ry-camera.ry+TILE/2,
      vx:dx*5,vy:dy*5, life:1, decay:.12, color:'#ffffff', size:6 });

    // Alert enemies near the shot path (sound/visual detection)
    entities.filter(e => (e.type==='enemy'||e.type==='hazard') && e.aggroState==='idle').forEach(enemy => {
      // Check if enemy is within 8 tiles of the shot path
      const distToShot = Math.abs((hitY-player.y)*enemy.x - (hitX-player.x)*enemy.y + hitX*player.y - hitY*player.x) /
                        Math.sqrt((hitY-player.y)**2 + (hitX-player.x)**2);
      if (distToShot < 8 && mdist(enemy, player) < 15) {
        enemy.aggroState = 'alert';
        enemy.aggroFlash = 30;
      }
    });

    if (hitEnt) { attack(player, hitEnt); log(`${weapon.name} → hit ${hitEnt.name}`); }
    else log(`${weapon.name} → missed`);
  }
}

function drawProjectileTrails() {
  projectileTrails = projectileTrails.filter(t=>t.life>0);
  for (const t of projectileTrails) {
    const sx = Math.round(t.sx*TILE - camera.rx + TILE/2);
    const sy = Math.round(t.sy*TILE - camera.ry + TILE/2);
    const ex = Math.round(t.ex*TILE - camera.rx + TILE/2);
    const ey = Math.round(t.ey*TILE - camera.ry + TILE/2);

    ctx.save();
    ctx.globalAlpha = t.life;

    if (t.type === 'bullet') {
      // Bullet: moving projectile along the path
      const progress = 1 - (t.life * 0.8); // Bullets move over time
      const bx = sx + (ex - sx) * progress;
      const by = sy + (ey - sy) * progress;

      // Draw bullet trail
      const trailLength = 20;
      const tx = bx - (ex - sx) * 0.15;
      const ty = by - (ey - sy) * 0.15;

      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = t.color;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // Bullet head (bright dot)
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#fff';
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI*2);
      ctx.fill();

    } else {
      // Laser: instant beam (original style)
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 12;
      ctx.shadowColor = t.color;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // Impact flash
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#fff';
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
    t.life -= t.decay;
  }
}

function drawExitDoor() {
  if (!exitDoor) return;
  const sx = Math.round(exitDoor.x * TILE - camera.rx);
  const sy = Math.round(exitDoor.y * TILE - camera.ry);
  if (sx < -TILE || sx > CW || sy < -TILE || sy > CH) return;

  const cx = sx + TILE/2, cy = sy + TILE/2;
  const pulse = 0.65 + Math.sin(gt * 0.04) * 0.35;
  const col = '#44ffcc';

  ctx.save();
  glow(col, 8 * pulse);
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  // Door frame
  ctx.strokeRect(cx - 13, cy - 17, 26, 34);
  // Arch top
  ctx.beginPath(); ctx.arc(cx, cy - 17, 13, Math.PI, 0); ctx.stroke();
  // Inner fill
  ctx.fillStyle = `rgba(68,255,204,${0.06 + pulse * 0.07})`;
  ctx.fillRect(cx - 11, cy - 15, 22, 30);
  // Centre glow dot
  ctx.fillStyle = col; ctx.shadowBlur = 14; ctx.shadowColor = col;
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI*2); ctx.fill();
  // Label
  ctx.shadowBlur = 0;
  ctx.fillStyle = col; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('EXIT', cx, sy + 3);
  ctx.restore();
}

function drawExitArrowHUD() {
  if (!exitDoor || !player) return;
  const dx = exitDoor.x - player.x, dy = exitDoor.y - player.y;
  const dist = Math.round(Math.sqrt(dx*dx + dy*dy));
  const angle = Math.atan2(dy, dx);
  const ax = 52, ay = 44; // arrow position in HUD (top-left area)
  const r = 14;
  const col = '#44ffcc';

  ctx.save();
  ctx.translate(ax, ay);
  glow(col, 8);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
  // Arrow inside
  ctx.fillStyle = col;
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(r - 4, 0); ctx.lineTo(r - 10, -4); ctx.lineTo(r - 10, 4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // Distance
  ctx.shadowBlur = 0; ctx.fillStyle = col;
  ctx.font = '9px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`${dist}m`, 0, 4);
  ctx.restore();
}

function drawMessageLog() {
  const msgs = messages.slice(-5);
  const HH = 120;
  const baseY = CH - HH - 12;
  ctx.save();
  msgs.forEach((m, i) => {
    const y = baseY - (msgs.length - 1 - i) * 22; // 22px line height
    const alpha = 0.3 + (i / msgs.length) * 0.7;
    ctx.font = '15px monospace';
    const tw = ctx.measureText(m).width + 22;
    ctx.fillStyle = 'rgba(0,4,12,0.7)';
    ctx.fillRect(8, y - 14, tw, 18);
    ctx.fillStyle = `rgba(150,210,255,${alpha})`;
    ctx.textAlign = 'left';
    ctx.fillText(m, 16, y);
  });
  ctx.restore();
}

function drawMinimap() {
  const mmW=200,mmH=135,mmX=CW-mmW-14,mmY=14;
  const scX=mmW/MAP_W, scY=mmH/MAP_H;

  // Background
  ctx.fillStyle='rgba(0,6,18,0.92)'; ctx.fillRect(mmX-2,mmY-2,mmW+4,mmH+4);
  ctx.strokeStyle='#1a4878'; ctx.lineWidth=1; ctx.strokeRect(mmX-2,mmY-2,mmW+4,mmH+4);

  // Draw walls as darker color, floors as lighter — shows room shapes clearly
  for (let y=0;y<MAP_H;y++) {
    for (let x=0;x<MAP_W;x++) {
      const px = mmX+x*scX, py = mmY+y*scY;
      if (map[y][x]===T.FLOOR) {
        ctx.fillStyle='#162a42';
        ctx.fillRect(px, py, scX+.5, scY+.5);
      } else {
        // Only draw wall pixels that border a floor (outlines rooms)
        const adj = (y>0 && map[y-1][x]===T.FLOOR) || (y<MAP_H-1 && map[y+1][x]===T.FLOOR) ||
                    (x>0 && map[y][x-1]===T.FLOOR) || (x<MAP_W-1 && map[y][x+1]===T.FLOOR);
        if (adj) {
          ctx.fillStyle='#0e1e30';
          ctx.fillRect(px, py, scX+.5, scY+.5);
        }
      }
    }
  }

  // Camera viewport rectangle
  const vpX = mmX + (camera.rx / TILE) * scX;
  const vpY = mmY + (camera.ry / TILE) * scY;
  const vpW = VP_COLS * scX;
  const vpH = VP_ROWS * scY;
  ctx.strokeStyle = 'rgba(77,217,232,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(vpX, vpY, vpW, vpH);

  // Items on ground
  entities.filter(e=>e.type==='item').forEach(e=>{
    ctx.fillStyle=e.color||C.item; ctx.fillRect(mmX+e.x*scX,mmY+e.y*scY,1.5,1.5); });

  // Enemies (pulsing)
  const enemyPulse = Math.sin(gt * 0.1) * 0.3 + 0.7;
  entities.filter(e=>e.type==='enemy'||e.type==='hazard').forEach(e=>{
    const s = e.isBoss ? 4 : 2;
    ctx.fillStyle=e.color||C.enemy;
    ctx.globalAlpha = e.isBoss ? 1 : enemyPulse;
    ctx.fillRect(mmX+e.x*scX-s/2,mmY+e.y*scY-s/2,s,s);
  });
  ctx.globalAlpha = 1;

  // Allies
  entities.filter(e=>e.type==='ally').forEach(e=>{
    ctx.fillStyle=e.color||C.ally; ctx.fillRect(mmX+e.x*scX-1,mmY+e.y*scY-1,3,3); });
  // Pets
  entities.filter(e=>e.type==='pet').forEach(e=>{
    ctx.fillStyle='#ffaa88'; ctx.fillRect(mmX+e.x*scX-1,mmY+e.y*scY-1,2,2); });
  // Traps
  entities.filter(e=>e.type==='trap').forEach(e=>{
    ctx.fillStyle='#ff8844'; ctx.fillRect(mmX+e.x*scX-1,mmY+e.y*scY-1,2,2); });

  // Exit door (glowing)
  if (exitDoor) {
    ctx.fillStyle='#44ffcc'; ctx.shadowBlur=6; ctx.shadowColor='#44ffcc';
    ctx.fillRect(mmX+exitDoor.x*scX-3,mmY+exitDoor.y*scY-3,6,6);
    ctx.shadowBlur=0;
  }

  // Player (bright, always on top)
  ctx.fillStyle=C.player; ctx.shadowBlur=6; ctx.shadowColor=C.player;
  ctx.fillRect(mmX+player.x*scX-2,mmY+player.y*scY-2,5,5); ctx.shadowBlur=0;

  // Level label
  ctx.fillStyle='#3a6080'; ctx.font='bold 9px monospace'; ctx.textAlign='right';
  ctx.fillText(`L${currentLevel}`, mmX+mmW-2, mmY+mmH+10);
  ctx.textAlign='left';
}

// ── Input ─────────────────────────────────────────────────────────────────────
// Single-press actions only — movement is handled in the real-time loop
document.addEventListener('keydown', e => {
  if (introScreen && !introScreen.classList.contains('hidden')) return;

  if (state === 'fabricating') {
    if (fabComplete) { e.preventDefault(); closeFab(); }
    return;
  }

  // Normal game key handling
  heldKeys.add(e.code);
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();

  if (state==='paused') { if (e.code==='Escape') closePause(); return; }
  if (state==='dead' || state==='won')  { if (e.code==='KeyR') initGame(); return; }
  if (state==='inventory') { if (e.code==='KeyI'||e.code==='Escape') closeInventory(); return; }
  if (state==='playing' && e.code==='Escape') { openPause(); return; }
  if (e.code==='KeyI') { e.preventDefault(); openInventory(); return; }
  if (e.code==='KeyF') { openFab(); return; }
});

document.addEventListener('keyup', e => { heldKeys.delete(e.code); });

// ── Mouse hover + drag-to-pan tracking ───────────────────────
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let cameraOffsetX = 0, cameraOffsetY = 0;

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * (canvas.width  / r.width);
  mouseY = (e.clientY - r.top)  * (canvas.height / r.height);

  if (isDragging && state === 'playing') {
    const dx = (e.clientX - dragStartX) * (canvas.width / r.width);
    const dy = (e.clientY - dragStartY) * (canvas.height / r.height);
    cameraOffsetX = -dx * 1.5; // Invert + amplify for natural feel
    cameraOffsetY = -dy * 1.5;
    // Clamp so you can't scroll infinitely
    const maxPan = TILE * 20;
    cameraOffsetX = Math.max(-maxPan, Math.min(maxPan, cameraOffsetX));
    cameraOffsetY = Math.max(-maxPan, Math.min(maxPan, cameraOffsetY));
  }
});

canvas.addEventListener('mousedown', e => {
  if (e.button === 0 && state === 'playing') {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mouseup', () => {
  isDragging = false;
  cameraOffsetX = 0;
  cameraOffsetY = 0;
  canvas.style.cursor = 'default';
});

canvas.addEventListener('mouseleave', () => {
  mouseX = mouseY = -1;
  isDragging = false;
  cameraOffsetX = 0;
  cameraOffsetY = 0;
  canvas.style.cursor = 'default';
});

function getHoveredEntity() {
  if (mouseX < 0 || mouseY < 0 || state !== 'playing') return null;
  const tx = Math.floor((mouseX + camera.rx) / TILE);
  const ty = Math.floor((mouseY + camera.ry) / TILE);
  if (exitDoor && exitDoor.x === tx && exitDoor.y === ty) {
    return { _kind:'door', name:'EXIT', description:'Reach this door to escape Meridian-7.' };
  }
  if (player && player.x === tx && player.y === ty) return player;
  return entities.find(e => e.x === tx && e.y === ty) || null;
}

function drawTooltip() {
  const e = getHoveredEntity();
  if (!e) return;

  // Build content lines
  const lines = [];
  const push = (text, color, size=14, opts={}) =>
    lines.push({ text, color, size, bold: opts.bold, italic: opts.italic });

  if (e._kind === 'door') {
    push('EXIT', '#44ffcc', 16, { bold:true });
    push('Objective', '#44ffcc', 11);
    push(e.description, '#8aaabb', 13, { italic:true });
  } else if (e.type === 'player') {
    push('YOU', '#4dd9e8', 16, { bold:true });
    push('Survivor', '#5a8090', 11);
    push(`HP   ${e.hp} / ${e.maxHp}`, '#c8e0f8', 13);
    push(`ATT  ${e.damage}`, '#cc8844', 13);
    push(`DEF  ${e.defense}`, '#4488cc', 13);
  } else if (e.type === 'enemy' || e.type === 'hazard') {
    push(e.name.toUpperCase(), e.color || '#cc3344', 16, { bold:true });
    push(e.type === 'hazard' ? '⚠  FABRICATION MALFUNCTION — HOSTILE' : 'HOSTILE',
         e.type === 'hazard' ? '#cc6622' : '#cc3344', 11);
    push(`HP   ${e.hp} / ${e.maxHp}`, '#c8e0f8', 13);
    push(`ATT  ${e.damage}    DEF  ${e.defense}`, '#8aa0b0', 13);
    if (e.aggroState === 'chase') push('STATUS: pursuing you', '#cc7733', 12, { italic:true });
    else if (e.aggroState === 'idle') push('STATUS: patrolling', '#557788', 12, { italic:true });
    if (e.description) push(e.description, '#6a8898', 12, { italic:true });
  } else if (e.type === 'ally') {
    push(e.name.toUpperCase(), e.color || '#44aa66', 16, { bold:true });
    push('ALLY', '#44aa66', 11);
    push(`HP   ${e.hp} / ${e.maxHp}`, '#c8e0f8', 13);
    push(`ATT  ${e.damage}    DEF  ${e.defense}`, '#8aa0b0', 13);
    if (e.description) push(e.description, '#6a8898', 12, { italic:true });
  } else if (e.type === 'item') {
    push(e.name.toUpperCase(), e.color || '#ccaa33', 16, { bold:true });
    const typeLabel = e.itemType === 'weapon' ? 'WEAPON' :
                      e.itemType === 'armor' ? 'ARMOR' :
                      e.itemType === 'consumable' ? 'CONSUMABLE' :
                      e.itemType === 'vehicle' ? 'VEHICLE' :
                      e.itemType === 'tool' ? 'TOOL' : 'ITEM';
    push(typeLabel, e.color || '#ccaa33', 11);
    const stat = e.itemType === 'weapon' ? `+${e.stats?.damage||0} ATT` :
                 e.itemType === 'armor'  ? `+${e.stats?.defense||0} DEF` :
                 e.itemType === 'consumable' ? `+${e.stats?.hp||0} HP (instant)` :
                 e.itemType === 'vehicle' ? `SPEED +${e.stats?.speed||2}` :
                 e.itemType === 'tool' ? 'UTILITY' : '';
    if (stat) push(stat, '#c8e0f8', 13);
    if (e.description) push(e.description, '#6a8898', 12, { italic:true });
    push('Walk over it to pick up', '#557788', 11, { italic:true });
  } else if (e.type === 'pet') {
    push(e.name.toUpperCase(), e.color || '#ffaa88', 16, { bold:true });
    push('PET COMPANION', '#ffaa88', 11);
    push(`HP   ${e.hp} / ${e.maxHp}`, '#c8e0f8', 13);
    if (e.description) push(e.description, '#6a8898', 12, { italic:true });
    push('Non-combat, follows you', '#557788', 11, { italic:true });
  } else if (e.type === 'trap') {
    push(e.name.toUpperCase(), e.color || '#ff8844', 16, { bold:true });
    push('TRAP', '#ff8844', 11);
    push(`DMG  ${e.damage || 10}   RANGE  ${e.triggerRange || 2} tiles`, '#c8e0f8', 13);
    if (e.description) push(e.description, '#6a8898', 12, { italic:true });
    push('Damages nearby enemies automatically', '#557788', 11, { italic:true });
  }

  // Measure
  const padX = 16, padY = 14, lh = 20;
  let maxW = 0;
  for (const l of lines) {
    ctx.font = `${l.bold ? 'bold ' : ''}${l.italic ? 'italic ' : ''}${l.size}px monospace`;
    maxW = Math.max(maxW, ctx.measureText(l.text).width);
  }
  const w = maxW + padX * 2;
  const h = lines.length * lh + padY * 2;

  // Position — offset from mouse, keep on-screen
  let bx = mouseX + 22, by = mouseY + 14;
  if (bx + w > CW - 12) bx = mouseX - w - 22;
  if (by + h > CH - 12) by = CH - h - 12;
  if (bx < 12) bx = 12;
  if (by < 12) by = 12;

  // Background
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(6,12,22,0.96)';
  ctx.fillRect(bx, by, w, h);
  // Accent left bar (uses first line's colour)
  ctx.fillStyle = lines[0].color;
  ctx.fillRect(bx, by, 3, h);
  // Border
  ctx.strokeStyle = '#2a4060'; ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, w, h);

  // Lines
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    ctx.font = `${l.bold ? 'bold ' : ''}${l.italic ? 'italic ' : ''}${l.size}px monospace`;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, bx + padX, by + padY + i * lh + 14);
  });
}

// ── Real-time input processing (called every frame) ───────────────────────────
function processInput(ts) {
  if (state !== 'playing') return;

  // Continuous movement while key held
  const speedMult = 1 + (player.speedBoost || 0) * 0.3; // each speed point = 30% faster
  const moveDelay = PLAYER_MS / speedMult;
  if (ts - lastPlayerStep > moveDelay) {
    let dx=0, dy=0;
    if (heldKeys.has('ArrowUp')   ||heldKeys.has('KeyW')) dy=-1;
    if (heldKeys.has('ArrowDown') ||heldKeys.has('KeyS')) dy= 1;
    if (heldKeys.has('ArrowLeft') ||heldKeys.has('KeyA')) dx=-1;
    if (heldKeys.has('ArrowRight')||heldKeys.has('KeyD')) dx= 1;
    if (dx||dy) {
      const nx=player.x+dx, ny=player.y+dy;
      const inBounds = nx>=0&&ny>=0&&nx<MAP_W&&ny<MAP_H;
      const blocked = !inBounds||(map[ny]?.[nx]!==T.FLOOR&&!entityAt(nx,ny));
      if (tryMove(player,dx,dy)) {
        player.facing={dx,dy};
        if (Math.random() < 0.3) SFX.step();
      }
      if (!blocked) turn++;
      lastPlayerStep = ts;
    }
  }

  // Hold SPACE = keep firing with cooldown (but NOT when fabricating!)
  if (state === 'playing' && heldKeys.has('Space') && ts - lastWeaponUse > WEAPON_MS) {
    useEquippedWeapon();
    lastWeaponUse = ts;
  }
}

// Enemies tick on their own timer — totally independent of player input
function runAllyTurns() {
  entities.filter(e=>e.type==='ally').forEach(ally => {
    const GUARD_RANGE = 7;
    const threat = entities
      .filter(e => (e.type==='enemy'||e.type==='hazard') && mdist(player, e) <= GUARD_RANGE)
      .sort((a,b) => mdist(ally,a) - mdist(ally,b))[0];

    if (threat) {
      const dx=threat.x-ally.x, dy=threat.y-ally.y;
      if (Math.abs(dx)>Math.abs(dy)) { if(!tryMove(ally,Math.sign(dx),0)) tryMove(ally,0,Math.sign(dy)); }
      else                           { if(!tryMove(ally,0,Math.sign(dy))) tryMove(ally,Math.sign(dx),0); }
    } else {
      const dx=player.x-ally.x, dy=player.y-ally.y;
      if (Math.abs(dx)+Math.abs(dy) > 2) {
        if (Math.abs(dx)>Math.abs(dy)) { if(!tryMove(ally,Math.sign(dx),0)) tryMove(ally,0,Math.sign(dy)); }
        else                           { if(!tryMove(ally,0,Math.sign(dy))) tryMove(ally,Math.sign(dx),0); }
      }
    }
  });

  entities.filter(e=>e.type==='pet').forEach(pet => {
    const dx=player.x-pet.x, dy=player.y-pet.y;
    const dist = Math.abs(dx)+Math.abs(dy);
    const followDist = pet.followDist || 2;
    if (dist > followDist) {
      if (Math.abs(dx)>Math.abs(dy)) { if(!tryMove(pet,Math.sign(dx),0)) tryMove(pet,0,Math.sign(dy)); }
      else                           { if(!tryMove(pet,0,Math.sign(dy))) tryMove(pet,Math.sign(dx),0); }
    } else if (dist < followDist - 1 && Math.random() < 0.3) {
      tryMove(pet, ri(-1,1), ri(-1,1));
    }
  });
}

function processEnemies(ts) {
  if (state !== 'playing') return;
  if (ts - lastEnemyStep > ENEMY_MS) {
    runEnemyTurns();
    lastEnemyStep = ts;
  }
  if (ts - lastAllyStep > ALLY_MS) {
    runAllyTurns();
    lastAllyStep = ts;
  }
}

// Ambient dust particles — make the world feel alive
function spawnAmbient() {
  if (Math.random() > 0.04) return;
  const ox = ri(-10,10), oy = ri(-8,8);
  const tx = player.x+ox, ty = player.y+oy;
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H||map[ty][tx]!==T.FLOOR) return;
  const sx = Math.round(tx*TILE - camera.rx + ri(4,TILE-4));
  const sy = Math.round(ty*TILE - camera.ry + ri(4,TILE-4));
  particles.push({ x:sx, y:sy,
    vx:(Math.random()-.5)*.25, vy:-(0.15+Math.random()*.2),
    life:1, decay:0.003+Math.random()*0.004,
    color:'#1a3a58', size:1+Math.random()*1.2 });
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop(ts) {
  gt++;
  processInput(ts);
  processEnemies(ts);
  spawnAmbient();
  lerpPositions();
  tickParticles();

  ctx.fillStyle=C.bg; ctx.fillRect(0,0,CW,CH);

  // Screen shake
  if (shake.timer > 0) {
    shake.timer--;
    const s = shake.intensity * (shake.timer / 10);
    ctx.save();
    ctx.translate(ri(-s,s), ri(-s,s));
  }

  const sx=Math.max(0,Math.floor(camera.rx/TILE));
  const sy=Math.max(0,Math.floor(camera.ry/TILE));
  for (let ty=sy;ty<Math.min(MAP_H,sy+VP_ROWS+2);ty++)
    for (let tx=sx;tx<Math.min(MAP_W,sx+VP_COLS+2);tx++)
      drawTile(tx,ty);

  drawExitDoor();
  [...entities,player].sort((a,b)=>a.y-b.y).forEach(drawEntity);
  drawParticles();
  drawProjectileTrails();
  drawDmgNums();
  if (shake.timer === 0 && ctx.restore) ctx.restore(); // end shake transform
  drawFabAlert();
  drawMessageLog();
  drawMinimap();
  drawHUD();
  drawExitArrowHUD();
  drawTooltip();

  requestAnimationFrame(loop);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ri(a,b)       { return Math.floor(Math.random()*(b-a+1))+a; }
function uid()         { return Math.random().toString(36).slice(2,9); }
function mdist(a,b)    { return Math.abs(a.x-b.x)+Math.abs(a.y-b.y); }
function clamp(v,a,b)  { return Math.max(a,Math.min(b,v)); }
function log(msg)      { messages.push(msg); if(messages.length>20) messages.shift(); }
function entityAt(x,y) {
  if(player&&player.x===x&&player.y===y) return player;
  return entities.find(e=>e.x===x&&e.y===y)||null;
}
function glow(color,blur) { ctx.shadowBlur=blur; ctx.shadowColor=color; }
function diamond(cx,cy,ry,rx) {
  ctx.beginPath();
  ctx.moveTo(cx,cy-ry); ctx.lineTo(cx+rx,cy);
  ctx.lineTo(cx,cy+ry); ctx.lineTo(cx-rx,cy);
  ctx.closePath(); ctx.fill();
}

// ── Intro card system ─────────────────────────────────────────────────────────
const introScreen = document.getElementById('intro-screen');
const introTag    = document.getElementById('intro-card-tag');
const introTitle  = document.getElementById('intro-card-title');
const introBody   = document.getElementById('intro-card-body');
const introNext   = document.getElementById('intro-next');
const introProg   = document.getElementById('intro-progress');

const CARDS = [
  {
    title: 'Mission: Escape Meridian-7',
    tag:   'Briefing',
    html: `<div class="mission-strip">
  <div class="ms-node">
    <div class="ms-icon" style="color:#4dd9e8;border-color:#4dd9e8">&#9670;</div>
    <div class="ms-label" style="color:#4dd9e8">YOU</div>
  </div>
  <div class="ms-arrow">&#8594;&#8594;</div>
  <div class="ms-node">
    <div class="ms-icon" style="color:#5bc4d0;border-color:#2a5070;font-size:13px">F</div>
    <div class="ms-label" style="color:#5bc4d0">FABRICATE</div>
  </div>
  <div class="ms-arrow">&#8594;&#8594;</div>
  <div class="ms-node">
    <div class="ms-icon" style="color:#cc3344;border-color:#cc3344">&#9650;</div>
    <div class="ms-label" style="color:#cc3344">DESTROY</div>
  </div>
  <div class="ms-arrow">&#8594;&#8594;</div>
  <div class="ms-node">
    <div class="ms-icon" style="color:#44ffcc;border-color:#44ffcc;font-size:13px">EXIT</div>
    <div class="ms-label" style="color:#44ffcc">ESCAPE</div>
  </div>
</div>
<p><span class="highlight">Day 31.</span> You are the last survivor on research station <span class="highlight">Meridian-7</span>. The defense AI went rogue and reprogrammed every combat unit to eliminate all personnel.</p>
<br>
<p><span class="warn">The armory is locked. Communications are down. Life support is failing.</span></p>
<br>
<p>Your only option: the experimental <span class="accent">AI Fabrication Terminal</span> — a military prototype that can materialize weapons and equipment from raw matter using neural-pattern synthesis. It was never approved for field use, but it's your <span class="highlight">last resort</span>.</p>`,
  },
  {
    title: 'AI Fabrication Terminal',
    tag:   'Your last resort',
    html: `<p>The terminal uses <span class="highlight">neural-pattern synthesis</span> — an AI interprets your description and materializes equipment from available matter. Originally designed for deep-space emergencies.</p>
<br>
<p>Press <span class="key">F</span> — describe <strong>anything</strong> you need — press <span class="key">Enter</span>. The AI terminal interprets your request and materializes it in real-time.</p>
<div class="fab-grid">
  <div class="fab-icon" style="color:#cc7733;border-color:#cc7733">&#9876;</div>
  <div><span class="highlight">WEAPON</span> &nbsp;<span class="dim">— guns, swords, miniguns, lasers. Press SPACE to use.</span></div>
  <div class="fab-icon" style="color:#3388cc;border-color:#3388cc">&#11041;</div>
  <div><span class="highlight">ARMOR</span> &nbsp;<span class="dim">— shields, suits. Permanently raises DEF.</span></div>
  <div class="fab-icon" style="color:#44aa66;border-color:#44aa66">&#9673;</div>
  <div><span class="highlight">ALLY</span> &nbsp;<span class="dim">— combat robots/drones. Hunts enemies automatically.</span></div>
  <div class="fab-icon" style="color:#ffaa88;border-color:#ffaa88">&#9829;</div>
  <div><span class="highlight">PET</span> &nbsp;<span class="dim">— cats, dogs, creatures. Follows you, non-combat.</span></div>
  <div class="fab-icon" style="color:#88ccff;border-color:#88ccff">&#128664;</div>
  <div><span class="highlight">VEHICLE</span> &nbsp;<span class="dim">— speed boost. Move faster across the station.</span></div>
  <div class="fab-icon" style="color:#ff8844;border-color:#ff8844">&#128165;</div>
  <div><span class="highlight">TRAP</span> &nbsp;<span class="dim">— damages enemies nearby automatically.</span></div>
  <div class="fab-icon" style="color:#cc6622;border-color:#cc6622">&#9888;</div>
  <div><span class="warn">HAZARD</span> &nbsp;<span class="dim">— AI malfunction for absurd requests. Spawns hostile.</span></div>
</div>
<p class="warn">Numbers are respected: "200HP potion" gives 200 HP. "Minigun" deals massive damage. AI handles creative requests!</p>`,
  },
  {
    title: 'Controls',
    tag:   'How to play',
    html: `<div class="controls-grid">
  <span><span class="key">W A S D</span> or <span class="key">Arrows</span></span><span>Move</span>
  <span><span class="key">F</span></span><span>Open Fabrication Terminal</span>
  <span><span class="key">SPACE</span></span><span>Use equipped weapon — shoot (ranged) or swing (melee)</span>
  <span><span class="key">Walk into enemy</span></span><span>Bump-attack (melee damage)</span>
  <span><span class="key">Walk over item</span></span><span>Pick it up / equip it</span>
  <span><span class="key">R</span></span><span>Restart after death</span>
</div>
<br>
<p class="dim">The <span class="highlight">minimap</span> (top-right) shows <span style="color:#4dd9e8">you</span>, <span style="color:#cc3344">enemies</span>, and the <span style="color:#44ffcc">exit door</span>. The compass arrow below the minimap points toward the exit.</p>`,
  },
  {
    title: 'Ready?',
    tag:   'Setup',
    html: `<p>The fabrication terminal is powered by AI. Type anything you can imagine and the station will build it for you.</p>
<br>
<p class="dim">You get <span class="highlight">20 fabrications per hour</span> — choose wisely.</p>
<br>
<p class="accent">Good luck, survivor.</p>`,
  },
];

let cardIndex = 0;

function renderCard(i) {
  const card = CARDS[i];
  introTag.textContent  = card.tag.toUpperCase() + '  ·  ' + (i+1) + ' / ' + CARDS.length;
  introTitle.textContent = card.title;
  introBody.innerHTML   = card.html;
  introProg.innerHTML   = '';
  CARDS.forEach((_, j) => {
    const dot = document.createElement('div');
    dot.className = 'intro-dot' + (j === i ? ' active' : '');
    introProg.appendChild(dot);
  });
  const last = i === CARDS.length - 1;
  introNext.textContent = last ? 'SPACE  to begin' : 'SPACE  to continue  →';
  introNext.className   = last ? 'final' : '';
}

let playerApiKey = '';

function advanceIntro() {
  if (cardIndex < CARDS.length - 1) {
    cardIndex++;
    renderCard(cardIndex);
  } else {
    introScreen.classList.add('hidden');
    initGame();
    requestAnimationFrame(loop);
  }
}

// ── Icon preloader ────────────────────────────────────────────────────────────
const ITEM_ICONS = {};
(function preloadIcons() {
  // Map internal key → actual filename in /icons/
  const files = {
    // Weapons
    weapon_gun:          'weapon_gun',
    weapon_revolver:     'weapon_revolver',
    weapon_tec9:         'weapon_tec9',
    weapon_minigun:      'weapon_minigun',
    weapon_sword:        'weapon_sword',
    weapon_katana:       'weapon_katana',
    weapon_spikedbat:    'weapon_spikedbat',
    weapon_crossbow:     'weapon_crossbow',
    weapon_bazooka:      'weapon_bazooka',
    weapon_flamethrower: 'weapon_flamethrower',
    weapon_laser:        'weapon_laser',
    // Armor & Consumables
    armor:               'armor',
    consumable:          'health-potion',
    consumable_heart:    'heart-drop',
    // Creatures (for allies/pets)
    creature_minotaur:   'creature_minotaur',
    creature_demon:      'creature_demon',
  };
  Object.entries(files).forEach(([key, filename]) => {
    const img = new Image();
    img.onload = () => { ITEM_ICONS[key] = img; };
    img.onerror = () => { /* Icon not found, will use canvas fallback */ };
    img.src = `/icons/${filename}.png`;
  });
})();

function getIconKey(e) {
  if (e.itemType === 'armor')      return 'armor';
  if (e.itemType === 'consumable') {
    const n = (e.name||'').toLowerCase();
    if (n.match(/heart|life|blood/)) return 'consumable_heart';
    return 'consumable';
  }
  if (e.itemType === 'weapon') {
    const n = ((e.name||'') + ' ' + (e.userDesc||'')).toLowerCase();

    // Epic/legendary/cosmic weapons → return null so emoji renders instead of generic gun
    if (n.match(/planet|orbital|destroyer|annihilator|obliterator|apocalypse|armageddon|god|titan|colossal|legendary|ultimate|supreme|divine|cosmic|galaxy|universe|extinction|cataclysm|omega|infinity|void|nova|singularity|quantum|antimatter|dark.?matter|black.?hole|supernova|nebula|pulsar|quasar/)) {
      return null;
    }

    // MELEE weapons first (so "fire sword" → sword, not flamethrower)
    if (n.match(/katana/))                return 'weapon_katana';
    if (n.match(/sword|blade|saber|sabre|lightsaber|claymore|scimitar|rapier|cutlass/)) return 'weapon_sword';
    if (n.match(/knife|dagger|axe|hatchet/)) return 'weapon_sword';
    if (n.match(/bat|club|mace|hammer/))  return 'weapon_spikedbat';

    // Ranged weapons
    if (n.match(/minigun|gatling|vulcan/)) return 'weapon_minigun';
    if (n.match(/revolver/))              return 'weapon_revolver';
    if (n.match(/tec-?9|tec9|machine pistol|tommy|thompson|submachine/)) return 'weapon_tec9';
    if (n.match(/crossbow|bow/))          return 'weapon_crossbow';
    if (n.match(/bazooka|rocket|launcher|grenade|rpg|missile/)) return 'weapon_bazooka';
    if (n.match(/flame|fire|torch|incinerator|flamethrower/)) return 'weapon_flamethrower';
    if (n.match(/laser|plasma|beam|ray|photon|blaster|cannon/)) return 'weapon_laser';
    if (n.match(/rifle|automatic|smg|uzi|assault|ak|m4|ar-?15/)) return 'weapon_minigun';
    if (n.match(/pistol|gun|glock|beretta|magnum|colt|handgun|sidearm|shotgun/)) return 'weapon_gun';

    // Fallback to gun icon for all other weapons
    return 'weapon_gun';
  }
  return null;
}

renderCard(0);

document.addEventListener('keydown', e => {
  if (!introScreen.classList.contains('hidden')) {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') {
      e.preventDefault(); advanceIntro();
    }
    return;
  }
});

// ── Fullscreen ────────────────────────────────────────────────────────────────
const btnFS = document.getElementById('btn-fullscreen');

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

function onFullscreenChange() {
  const container = document.getElementById('game-container');
  if (document.fullscreenElement) {
    const scaleX = window.screen.width  / CW;
    const scaleY = window.screen.height / CH;
    const scale  = Math.min(scaleX, scaleY);
    container.style.transform = `scale(${scale})`;
    btnFS.textContent = '⛶ EXIT FULL';
  } else {
    container.style.transform = '';
    btnFS.textContent = '⛶ FULLSCREEN';
  }
}

// Click canvas to dismiss fabrication alert
canvas.addEventListener('click', () => { if (fabAlert) fabAlert = null; });

// Click overlay background to close fabrication when complete
fabOverlay.addEventListener('click', e => {
  if (fabComplete && e.target === fabOverlay) closeFab();
});

btnFS.addEventListener('click', toggleFullscreen);
document.addEventListener('keydown', e => { if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); } });
document.addEventListener('fullscreenchange', onFullscreenChange);
