(function () {
    const $ = id => document.getElementById(id);
    const canvas = $('game');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const TURBO_TIME = 4, TURBO_COOLDOWN = 12, LEVELS = 6;

    const DIFFS = {
        easy:   { label: 'Easy',   lives: 5, spawn: 1.25, speed: 0.85 },
        normal: { label: 'Normal', lives: 3, spawn: 1.0,  speed: 1.0 },
        hard:   { label: 'Hard',   lives: 2, spawn: 0.75, speed: 1.2 }
    };
    const DIFF_ORDER = ['easy', 'normal', 'hard'];

    const SHIPS = {
        flame: { label: 'Flame', a: '#ffe66d', b: '#ff3d81', jet: '#ff9f1c',
            pts: [[0,-26],[21,20],[0,10],[-21,20]] },
        ice:   { label: 'Ice',   a: '#a5f3fc', b: '#3b82f6', jet: '#67e8f9',
            pts: [[0,-28],[7,-6],[26,16],[26,22],[8,14],[0,20],[-8,14],[-26,22],[-26,16],[-7,-6]] },
        jade:  { label: 'Jade',  a: '#bbf7d0', b: '#10b981', jet: '#facc15',
            pts: [[0,-24],[10,-4],[24,6],[20,22],[8,14],[0,18],[-8,14],[-20,22],[-24,6],[-10,-4]] },
        royal: { label: 'Royal', a: '#f5d0fe', b: '#7c3aed', jet: '#f472b6',
            pts: [[0,-30],[14,8],[22,22],[6,14],[0,24],[-6,14],[-22,22],[-14,8]] }
    };
    const SHIP_ORDER = ['flame', 'ice', 'jade', 'royal'];

    const CTRL_MODES = ['all', 'actions', 'off'];
    const CTRL_LABEL = { all: 'All', actions: 'Power & Turbo', off: 'Off' };

    let state = 'menu';            // menu, playing, paused, over
    let score, level, lives, player, bullets, enemies, powerups, particles;
    let spawnTimer, shake, banner, bannerText, flash, power, boost, turboCd;
    let best = 0, soundOn = true, shakeOn = true, audio = null, targetX = null;
    let diffName = 'normal', shipName = 'flame', startLevel = 1, ctrlMode = 'all';
    let settingsFrom = 'main';
    let lastTime = performance.now();
    const keys = {};
    const hold = { left: false, right: false };
    const stars = [];

    // ---------- Saved settings ----------
    function store(k, v) { try { localStorage.setItem('aah_shooter_' + k, v); } catch (e) {} }
    function readStore(k) { try { return localStorage.getItem('aah_shooter_' + k); } catch (e) { return null; } }

    best = Number(readStore('best')) || 0;
    if (DIFFS[readStore('diff')]) diffName = readStore('diff');
    if (SHIPS[readStore('ship')]) shipName = readStore('ship');
    if (CTRL_MODES.includes(readStore('ctrl'))) ctrlMode = readStore('ctrl');
    const sl = Number(readStore('level'));
    if (sl >= 1 && sl <= LEVELS) startLevel = sl;
    if (readStore('sound') === 'off') soundOn = false;
    if (readStore('shake') === 'off') shakeOn = false;

    for (let i = 0; i < 100; i++) stars.push({ x: rand(0, W), y: rand(0, H), s: rand(20, 110), r: rand(0.6, 2.2) });

    // ---------- Sound ----------
    function sfx(freq, dur, type, vol, slide) {
        if (!soundOn) return;
        try {
            if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            const t = audio.currentTime;
            const o = audio.createOscillator();
            const g = audio.createGain();
            o.type = type || 'square';
            o.frequency.setValueAtTime(freq, t);
            if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
            g.gain.setValueAtTime(vol || 0.03, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(audio.destination);
            o.start(t); o.stop(t + dur);
        } catch (e) {}
    }

    // ---------- Ship drawing (used in game and in the ship menu) ----------
    function drawShip(c, name, flame, turbo) {
        const sh = SHIPS[name];
        c.fillStyle = turbo ? '#67e8f9' : sh.jet;
        c.beginPath(); c.moveTo(-8, 14); c.lineTo(0, 20 + flame); c.lineTo(8, 14); c.fill();
        const g = c.createLinearGradient(0, -30, 0, 24);
        g.addColorStop(0, sh.a); g.addColorStop(1, sh.b);
        c.fillStyle = g;
        c.beginPath();
        sh.pts.forEach((p, i) => { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
        c.closePath(); c.fill();
        c.fillStyle = '#1a0a3d'; c.beginPath(); c.arc(0, 0, 5.5, 0, 6.283); c.fill();
    }

    // ---------- Game setup ----------
    function reset() {
        score = 0; level = startLevel; lives = DIFFS[diffName].lives;
        bullets = []; enemies = []; powerups = []; particles = [];
        spawnTimer = 0.8; shake = 0; banner = 0; bannerText = ''; flash = 0;
        power = 0; boost = 0; turboCd = 0;
        player = { x: W / 2, y: H - 175, speed: 430, cool: 0, inv: 0, dbl: 0, shield: 0 };
        targetX = null;
    }

    function fire() {
        if (player.dbl > 0) {
            bullets.push({ x: player.x - 11, y: player.y - 20 }, { x: player.x + 11, y: player.y - 20 });
        } else {
            bullets.push({ x: player.x, y: player.y - 24 });
        }
        sfx(880, 0.07, 'square', 0.010, 440);
    }

    function spawnEnemy() {
        const D = DIFFS[diffName];
        const r = Math.random();
        let e;
        if (level >= 3 && r < 0.2) e = { type: 'tank', hp: 3, r: 28, speed: 55 + level * 3, pts: 30 };
        else if (level >= 2 && r < 0.45) e = { type: 'fast', hp: 1, r: 16, speed: 190 + level * 8, pts: 20 };
        else e = { type: 'grunt', hp: 1, r: 20, speed: 100 + level * 7, pts: 10 };
        e.speed *= D.speed;
        e.baseX = rand(60, W - 60);
        e.x = e.baseX; e.y = -40;
        e.t = 0; e.phase = rand(0, 6.28); e.freq = rand(1.2, 2.4);
        e.amp = e.type === 'fast' ? 0 : rand(10, 55);
        e.hit = 0;
        enemies.push(e);
    }

    function explode(x, y, color, n) {
        for (let i = 0; i < n; i++) {
            const a = rand(0, 6.283), v = rand(40, 240), life = rand(0.3, 0.7);
            particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: rand(1.5, 4.5) });
        }
    }

    function dropPowerup(x, y) {
        const r = Math.random();
        powerups.push({ x, y, type: r < 0.45 ? 'dbl' : r < 0.8 ? 'shield' : 'life' });
    }

    function killEnemy(e, scored) {
        e.dead = true;
        const col = e.type === 'tank' ? '#8b5cf6' : e.type === 'fast' ? '#ff9f1c' : '#ff3d81';
        explode(e.x, e.y, col, e.type === 'tank' ? 26 : 14);
        sfx(160, 0.2, 'sawtooth', 0.025, 40);
        if (scored) {
            score += e.pts;
            power = Math.min(100, power + (e.type === 'tank' ? 12 : 7));
            if (Math.random() < 0.12) dropPowerup(e.x, e.y);
        }
    }

    function collect(type) {
        if (type === 'dbl') player.dbl = 10;
        else if (type === 'shield') player.shield = 8;
        else lives = Math.min(5, lives + 1);
        sfx(520, 0.18, 'sine', 0.04, 1040);
    }

    function hurt() {
        lives--;
        player.inv = 1.6; player.dbl = 0; shake = 0.3;
        explode(player.x, player.y, '#ffe66d', 22);
        sfx(120, 0.4, 'sawtooth', 0.05, 30);
        if (lives <= 0) gameOver();
    }

    function usePower() {
        if (state !== 'playing' || power < 100) return;
        enemies.forEach(e => { if (!e.dead) killEnemy(e, true); });
        power = 0; flash = 0.6; shake = 0.5;
        sfx(90, 0.7, 'sawtooth', 0.06, 25);
    }

    function useTurbo() {
        if (state !== 'playing' || boost > 0 || turboCd > 0) return;
        boost = TURBO_TIME; turboCd = TURBO_COOLDOWN;
        sfx(300, 0.4, 'sawtooth', 0.04, 1200);
    }

    // ---------- Update ----------
    function update(dt) {
        const D = DIFFS[diffName];
        const sp = boost > 0 ? 1.7 : 1;
        let dir = 0;
        if (keys.arrowleft || keys.a || hold.left) dir -= 1;
        if (keys.arrowright || keys.d || hold.right) dir += 1;
        if (dir) { player.x += dir * player.speed * sp * dt; targetX = null; }
        else if (targetX !== null) {
            const step = player.speed * 1.8 * sp * dt;
            player.x += clamp(targetX - player.x, -step, step);
        }
        player.x = clamp(player.x, 22, W - 22);

        player.inv = Math.max(0, player.inv - dt);
        player.dbl = Math.max(0, player.dbl - dt);
        player.shield = Math.max(0, player.shield - dt);
        boost = Math.max(0, boost - dt);
        turboCd = Math.max(0, turboCd - dt);
        flash = Math.max(0, flash - dt);

        player.cool -= dt;
        if (player.cool <= 0) { fire(); player.cool = boost > 0 ? 0.11 : 0.22; }

        bullets.forEach(b => { b.y -= 700 * dt; });
        bullets = bullets.filter(b => b.y > -30);

        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnEnemy();
            spawnTimer = Math.max(0.3, 1.0 - level * 0.07) * rand(0.7, 1.3) * D.spawn;
        }

        enemies.forEach(e => {
            e.t += dt; e.y += e.speed * dt;
            e.x = clamp(e.baseX + Math.sin(e.t * e.freq + e.phase) * e.amp, e.r, W - e.r);
            e.hit = Math.max(0, e.hit - dt);
        });

        bullets.forEach(b => {
            for (const e of enemies) {
                if (e.dead) continue;
                if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + 5) {
                    b.dead = true; e.hp--; e.hit = 0.08;
                    if (e.hp <= 0) killEnemy(e, true); else sfx(300, 0.05, 'triangle', 0.02);
                    break;
                }
            }
        });

        enemies.forEach(e => {
            if (e.dead || state !== 'playing') return;
            if (Math.hypot(player.x - e.x, player.y - e.y) < e.r + 18) {
                if (player.shield > 0) killEnemy(e, false);
                else if (player.inv <= 0) { killEnemy(e, false); hurt(); }
            }
        });

        bullets = bullets.filter(b => !b.dead);
        enemies = enemies.filter(e => !e.dead && e.y < H + 50);

        powerups.forEach(p => {
            p.y += 120 * dt;
            if (Math.hypot(player.x - p.x, player.y - p.y) < 30) { p.dead = true; collect(p.type); }
        });
        powerups = powerups.filter(p => !p.dead && p.y < H + 30);

        particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
        particles = particles.filter(p => p.life > 0);

        const lv = startLevel + Math.floor(score / 300);
        if (lv > level) {
            level = lv; banner = 1.6; bannerText = 'LEVEL ' + level;
            sfx(440, 0.3, 'triangle', 0.04, 880);
        }
        banner = Math.max(0, banner - dt);
        shake = Math.max(0, shake - dt);
    }

    function updateStars(dt) {
        stars.forEach(s => { s.y += s.s * dt; if (s.y > H) { s.y = -4; s.x = rand(0, W); } });
    }

    // ---------- Draw ----------
    let bgGrad = null;

    function drawPlayer() {
        const p = player;
        if (p.inv > 0 && Math.floor(p.inv * 12) % 2 === 0) return;
        ctx.save(); ctx.translate(p.x, p.y);
        const turbo = boost > 0;
        drawShip(ctx, shipName, (turbo ? 18 : 8) + Math.random() * (turbo ? 18 : 10), turbo);
        if (p.shield > 0) {
            ctx.strokeStyle = 'rgba(103,232,249,' + (p.shield < 2 ? 0.4 : 0.9) + ')';
            ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 35, 0, 6.283); ctx.stroke();
        }
        ctx.restore();
    }

    function drawEnemy(e) {
        ctx.save(); ctx.translate(e.x, e.y);
        const fl = e.hit > 0;
        if (e.type === 'fast') {
            ctx.fillStyle = fl ? '#fff' : '#ff9f1c';
            ctx.beginPath(); ctx.moveTo(0, e.r + 6); ctx.lineTo(e.r, -e.r); ctx.lineTo(0, -e.r + 8); ctx.lineTo(-e.r, -e.r); ctx.closePath(); ctx.fill();
        } else if (e.type === 'tank') {
            ctx.fillStyle = fl ? '#fff' : '#8b5cf6';
            ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 6.283); ctx.fill();
            ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, e.r - 6, 0, 6.283); ctx.stroke();
            ctx.fillStyle = '#ffe66d';
            for (let i = 0; i < e.hp; i++) ctx.fillRect(-13 + i * 10, -3, 7, 7);
        } else {
            ctx.fillStyle = fl ? '#fff' : '#ff3d81';
            ctx.beginPath();
            ctx.arc(0, 0, e.r, Math.PI, 0);
            ctx.lineTo(e.r, e.r - 4); ctx.lineTo(e.r * 0.4, e.r - 10); ctx.lineTo(0, e.r - 4);
            ctx.lineTo(-e.r * 0.4, e.r - 10); ctx.lineTo(-e.r, e.r - 4);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#1a0a3d'; ctx.fillRect(-10, -4, 7, 7); ctx.fillRect(3, -4, 7, 7);
        }
        ctx.restore();
    }

    function drawPower(p) {
        const col = p.type === 'dbl' ? '#ffe66d' : p.type === 'shield' ? '#67e8f9' : '#ff3d81';
        const lab = p.type === 'dbl' ? '2x' : p.type === 'shield' ? 'S' : '+';
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, 6.283); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = col;
        ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lab, 0, 1);
        ctx.restore();
    }

    function draw() {
        if (!bgGrad) {
            bgGrad = ctx.createLinearGradient(0, 0, 0, H);
            bgGrad.addColorStop(0, '#0b0422'); bgGrad.addColorStop(0.6, '#1a0a3d'); bgGrad.addColorStop(1, '#3a0f4a');
        }
        ctx.save();
        if (shake > 0 && shakeOn) ctx.translate((Math.random() - 0.5) * shake * 26, (Math.random() - 0.5) * shake * 26);
        ctx.fillStyle = bgGrad; ctx.fillRect(-30, -30, W + 60, H + 60);

        ctx.fillStyle = '#fff';
        stars.forEach(s => { ctx.globalAlpha = 0.35 + s.r / 3; ctx.fillRect(s.x, s.y, s.r, s.r); });
        ctx.globalAlpha = 1;

        powerups.forEach(drawPower);
        enemies.forEach(drawEnemy);

        ctx.shadowColor = boost > 0 ? '#67e8f9' : '#ffe66d'; ctx.shadowBlur = 10;
        ctx.fillStyle = boost > 0 ? '#67e8f9' : '#ffe66d';
        bullets.forEach(b => ctx.fillRect(b.x - 2.5, b.y - 9, 5, 18));
        ctx.shadowBlur = 0;

        if (state !== 'menu') drawPlayer();

        particles.forEach(p => {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
        });
        ctx.globalAlpha = 1;

        if (banner > 0) {
            ctx.globalAlpha = Math.min(1, banner);
            ctx.fillStyle = '#fff'; ctx.font = '800 46px Orbitron, Arial, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(bannerText, W / 2, H / 3);
            ctx.globalAlpha = 1;
        }

        ctx.font = '600 14px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        let ty = 74;
        if (state !== 'menu') {
            if (boost > 0) { ctx.fillStyle = '#67e8f9'; ctx.fillText('TURBO ' + Math.ceil(boost) + 's', 14, ty); ty += 20; }
            if (player.dbl > 0) { ctx.fillStyle = '#ffe66d'; ctx.fillText('DOUBLE SHOT ' + Math.ceil(player.dbl) + 's', 14, ty); ty += 20; }
            if (player.shield > 0) { ctx.fillStyle = '#67e8f9'; ctx.fillText('SHIELD ' + Math.ceil(player.shield) + 's', 14, ty); }
        }

        ctx.restore();

        if (flash > 0) {
            ctx.fillStyle = 'rgba(255,255,255,' + (flash / 0.6 * 0.85) + ')';
            ctx.fillRect(0, 0, W, H);
        }
    }

    // ---------- HUD and buttons ----------
    const hudCache = {};
    function setText(id, v) {
        if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; }
    }
    const bPower = $('btnPower'), bTurbo = $('btnTurbo');

    function hud() {
        setText('sScore', score);
        setText('sLevel', level);
        setText('sBest', Math.max(best, score));
        setText('sLives', '\u2665'.repeat(Math.max(0, lives)));

        bPower.style.setProperty('--p', Math.round(power) + '%');
        bPower.classList.toggle('ready', power >= 100);

        let tp;
        if (boost > 0) tp = (boost / TURBO_TIME) * 100;
        else if (turboCd > 0) tp = (1 - turboCd / TURBO_COOLDOWN) * 100;
        else tp = 100;
        bTurbo.style.setProperty('--p', Math.round(tp) + '%');
        bTurbo.classList.toggle('active', boost > 0);
        bTurbo.classList.toggle('ready', boost <= 0 && turboCd <= 0);
    }

    // ---------- Menus ----------
    const PANELS = ['pMain', 'pLevel', 'pShip', 'pSettings', 'pExit', 'pBye', 'pMsg'];
    function showPanel(id) {
        $('overlay').classList.remove('hidden');
        PANELS.forEach(p => $(p).classList.toggle('hidden', p !== id));
    }
    function hideOverlay() { $('overlay').classList.add('hidden'); }

    function buildLevels() {
        const grid = $('levelGrid'); grid.innerHTML = '';
        for (let i = 1; i <= LEVELS; i++) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'tile'; b.dataset.lv = i;
            const n = document.createElement('b'); n.textContent = i;
            const s = document.createElement('small'); s.textContent = 'Level';
            b.append(n, s);
            b.addEventListener('click', () => { startLevel = i; store('level', String(i)); reset(); updateUI(); });
            grid.appendChild(b);
        }
    }

    function buildShips() {
        const grid = $('shipGrid'); grid.innerHTML = '';
        SHIP_ORDER.forEach(id => {
            const card = document.createElement('button');
            card.type = 'button'; card.className = 'card'; card.dataset.ship = id;
            const cv = document.createElement('canvas'); cv.width = 120; cv.height = 130;
            const c = cv.getContext('2d'); c.translate(60, 70); c.scale(1.6, 1.6); drawShip(c, id, 10, false);
            const name = document.createElement('span'); name.textContent = SHIPS[id].label;
            card.append(cv, name);
            card.addEventListener('click', () => { shipName = id; store('ship', id); updateUI(); });
            grid.appendChild(card);
        });
    }

    function updateUI() {
        $('menuBest').textContent = 'Best score: ' + best;
        $('lvLabel').textContent = 'Level ' + startLevel;
        $('shipLabel').textContent = SHIPS[shipName].label;
        $('sSoundV').textContent = soundOn ? 'On' : 'Off';
        $('sCtrlV').textContent = CTRL_LABEL[ctrlMode];
        $('sDiffV').textContent = DIFFS[diffName].label;
        $('sShakeV').textContent = shakeOn ? 'On' : 'Off';
        $('sFullV').textContent = document.fullscreenElement ? 'On' : 'Off';
        document.querySelectorAll('#levelGrid .tile').forEach(t => t.classList.toggle('sel', Number(t.dataset.lv) === startLevel));
        document.querySelectorAll('#shipGrid .card').forEach(t => t.classList.toggle('sel', t.dataset.ship === shipName));
        document.querySelector('.ctrl-left').classList.toggle('off', ctrlMode !== 'all');
        document.querySelector('.ctrl-right').classList.toggle('off', ctrlMode === 'off');
    }

    function showMessage(title, text, btn) {
        $('ovTitle').textContent = title;
        $('ovText').textContent = text;
        $('ovBtn').textContent = btn;
        showPanel('pMsg');
    }

    function closeTop() {
        $('topbar').classList.add('hidden');
        $('gameMenu').classList.add('hidden');
        $('menuBtn').setAttribute('aria-expanded', 'false');
    }

    function goToMenu() {
        state = 'menu';
        hold.left = hold.right = false;
        reset(); closeTop(); updateUI(); showPanel('pMain');
    }

    function start() {
        reset(); state = 'playing';
        hideOverlay();
        $('topbar').classList.remove('hidden');
        $('gameMenu').classList.add('hidden');
        $('menuBtn').setAttribute('aria-expanded', 'false');
        sfx(660, 0.2, 'triangle', 0.04, 990);
    }

    function openGameMenu() {
        if (state !== 'playing') return;
        hold.left = hold.right = false;
        state = 'paused';
        $('gameMenu').classList.remove('hidden');
        $('menuBtn').setAttribute('aria-expanded', 'true');
    }
    function resumeGame() {
        if (state !== 'paused') return;
        state = 'playing';
        $('gameMenu').classList.add('hidden');
        $('menuBtn').setAttribute('aria-expanded', 'false');
    }

    function gameOver() {
        state = 'over';
        hold.left = hold.right = false;
        closeTop();
        const isBest = score > best;
        if (isBest) { best = score; store('best', String(best)); }
        updateUI();
        showMessage('Game over', 'Score ' + score + ' \u2022 Level ' + level + ' \u2022 ' + DIFFS[diffName].label + (isBest ? ' \u2022 New best!' : ''), 'Play again');
    }

    function toggleSound() {
        soundOn = !soundOn; store('sound', soundOn ? 'on' : 'off'); updateUI();
        if (soundOn) sfx(600, 0.12, 'triangle', 0.04, 900);
    }
    function toggleFull() {
        const stage = $('stage');
        try {
            if (document.fullscreenElement) document.exitFullscreen();
            else if (stage.requestFullscreen) { const p = stage.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
        } catch (e) {}
    }

    // ---------- Menu buttons ----------
    $('mStart').addEventListener('click', start);
    $('mLevel').addEventListener('click', () => showPanel('pLevel'));
    $('mShip').addEventListener('click', () => showPanel('pShip'));
    $('mSettings').addEventListener('click', () => { settingsFrom = 'main'; showPanel('pSettings'); });
    $('mExit').addEventListener('click', () => showPanel('pExit'));
    $('lvBack').addEventListener('click', () => showPanel('pMain'));
    $('shBack').addEventListener('click', () => showpanel('pMain'));
    $('sSound').addEventListener('click', toggleSound);
    $('sCtrl').addEventListener('click', () => {
        ctrlMode = CTRL_MODES[(CTRL_MODES.indexOf(ctrlMode) + 1) % CTRL_MODES.length];
        store('ctrl', ctrlMode); updateUI();
    });
    $('sDiff').addEventListener('click', () => {
        diffName = DIFF_ORDER[(DIFF_ORDER.indexOf(diffName) + 1) % DIFF_ORDER.length];
        store('diff', diffName);
        if (state === 'menu') reset();
        updateUI();
    });
    $('sShake').addEventListener('click', () => { shakeOn = !shakeOn; store('shake', shakeOn ? 'on' : 'off'); updateUI(); });
    $('sFull').addEventListener('click', toggleFull);
    if (!document.fullscreenEnabled) $('sFull').classList.add('hidden');
    document.addEventListener('fullscreenchange', updateUI);
    $('sBack').addEventListener('click', () => {
        if (settingsFrom === 'game') hideOverlay(); else showPanel('pMain');
    });

    $('exNo').addEventListener('click', () => showPanel('pMain'));
    $('exYes').addEventListener('click', () => showPanel('pBye'));
    $('byeBtn').addEventListener('click', () => showPanel('pMain'));

    $('ovBtn').addEventListener('click', start);
    $('ovMenu').addEventListener('click', goToMenu);

    // in-game menu
    $('menuBtn').addEventListener('click', e => {
        if (state === 'playing') openGameMenu();
        else if (state === 'paused' && $('overlay').classList.contains('hidden')) resumeGame();
        e.currentTarget.blur();
    });
    $('gmResume').addEventListener('click', resumeGame);
    $('gmSettings').addEventListener('click', () => { settingsFrom = 'game'; showPanel('pSettings'); });
    $('gmQuit').addEventListener('click', goToMenu);

    // small click sound for menu items
    document.addEventListener('click', e => {
        if (e.target.closest('.mbtn, .tile, .card')) sfx(520, 0.05, 'triangle', 0.03);
    });

    // ---------- Game controls ----------
    function bindHold(id, side) {
        const b = $(id);
        b.addEventListener('pointerdown', e => { e.preventDefault(); hold[side] = true; });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { hold[side] = false; }));
        b.addEventListener('contextmenu', e => e.preventDefault());
    }
    bindHold('btnLeft', 'left');
    bindHold('btnRight', 'right');

    function bindPress(btn, fn) {
        btn.addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
        btn.addEventListener('contextmenu', e => e.preventDefault());
    }
    bindPress(bPower, usePower);
    bindPress(bTurbo, useTurbo);
    window.addEventListener('pointerup', () => { hold.left = hold.right = false; });

    window.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        if (state === 'playing' && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
        keys[k] = true;
        if (k === 'p' || k === 'escape') {
            if (state === 'playing') openGameMenu();
            else if (state === 'paused' && $('overlay').classList.contains('hidden')) resumeGame();
        }
        if (k === ' ' || k === 'e') usePower();
        if (k === 'shift' || k === 'w' || k === 'arrowup') useTurbo();
    });
    window.addEventListener('keyup', e => {
        if (state === 'playing' && e.key === ' ') e.preventDefault();
        keys[e.key.toLowerCase()] = false;
    });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; hold.left = hold.right = false; openGameMenu(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) openGameMenu(); });

    function setTarget(e) {
        if (state !== 'playing') return;
        const r = canvas.getBoundingClientRect();
        targetX = (e.clientX - r.left) * (W / r.width);
    }
    canvas.addEventListener('pointermove', setTarget);
    canvas.addEventListener('pointerdown', setTarget);

    // ---------- Main loop ----------
    function frame(t) {
        const dt = Math.min(0.033, (t - lastTime) / 1000 || 0);
        lastTime = t;
        if (state === 'playing') update(dt);
        updateStars(dt * (state === 'playing' ? 1 : 0.5));
        draw();
        hud();
        requestAnimationFrame(frame);
    }

    window.addEventListener('load', () => setTimeout(() => $('loader').classList.add('hide'), 1800));

    buildLevels();
    buildShips();
    reset();
    updateUI();
    showPanel('pMain');
    hud();
    requestAnimationFrame(frame);
})();