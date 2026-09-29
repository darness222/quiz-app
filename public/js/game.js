const socket = io();
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const code = (params.get('code') || localStorage.getItem('roomCode') || '').toUpperCase();
const playerId = localStorage.getItem('playerId');

let isHost = false;
let timerInterval = null;

if (!code || !playerId) {
  location.href = '/';
}

$('roomCode').textContent = code;

socket.on('connect', () => {
  socket.emit('rejoin', { code, playerId }, res => {
    if (!res || !res.ok) {
      localStorage.removeItem('roomCode');
      location.href = '/';
      return;
    }
    updateHostUI(res.players);
  });
});

function updateHostUI(players) {
  // создатель — первый в списке (сервер добавляет его первым)
  isHost = players[0] && players[0].id === playerId;
  $('startBtn').classList.toggle('hidden', !isHost);
  $('waitHint').classList.toggle('hidden', isHost);
}

socket.on('lobby_update', players => {
  const ul = $('players');
  ul.innerHTML = players
    .map(
      p =>
        `<li class="${p.connected ? '' : 'offline'}">${escapeHtml(p.name)}${
          p.connected ? '' : ' (offline)'
        }</li>`
    )
    .join('');
  updateHostUI(players);
});

$('startBtn').onclick = () => {
  socket.emit('start_game', { code });
};

socket.on('question', q => {
  showScreen('question');
  $('qCounter').textContent = `Вопрос ${q.index + 1} / ${q.total}`;
  $('qText').textContent = q.text;
  $('answerStatus').textContent = '';

  if (q.image) {
    $('qImage').src = q.image;
    $('qImage').classList.remove('hidden');
  } else {
    $('qImage').classList.add('hidden');
  }

  const opts = $('options');
  opts.innerHTML = q.options
    .map((o, i) => `<button class="opt" data-i="${i}">${escapeHtml(o)}</button>`)
    .join('');

  opts.querySelectorAll('.opt').forEach(btn => {
    btn.onclick = () => {
      opts.querySelectorAll('.opt').forEach(b => (b.disabled = true));
      btn.classList.add('picked');
      socket.emit('answer', { code, optionIndex: +btn.dataset.i });
    };
  });

  startTimer(q.timeLimit);
  renderMiniLeaderboard(q.players);
});

socket.on('answer_reveal', ({ correctIndex, players }) => {
  clearInterval(timerInterval);
  $('answerStatus').textContent = '';

  const opts = $('options');
  opts.querySelectorAll('.opt').forEach((btn, i) => {
    btn.disabled = true;
    if (i === correctIndex) {
      btn.classList.add('correct');
    } else if (btn.classList.contains('picked')) {
      btn.classList.add('wrong');
    }
  });

   const me = opts.querySelector('.opt.picked');
  if (!me) {
    $('answerStatus').textContent = '⏰ Время вышло';
  }

  renderMiniLeaderboard(players);
});

function startTimer(ms) {
  clearInterval(timerInterval);
  const el = $('timer');
  const start = Date.now();
  el.textContent = (ms / 1000).toFixed(1);

  timerInterval = setInterval(() => {
    const left = Math.max(0, ms - (Date.now() - start));
    el.textContent = (left / 1000).toFixed(1);
    if (left <= 0) clearInterval(timerInterval);
  }, 100);
}

socket.on('answer_accepted', ({ playerId: pid, points, correct, players }) => {
  if (pid === playerId) {
    $('answerStatus').textContent = correct
      ? `✅ Верно! +${points}`
      : '❌ Неверно';
  }
  renderMiniLeaderboard(players);
});

socket.on('reveal', ({ leaderboard }) => {
  clearInterval(timerInterval);
  showScreen('reveal');
  $('leaderboard').innerHTML = leaderboard
    .map((p, i) => `<li>${medal(i)} ${escapeHtml(p.name)} — ${p.score}</li>`)
    .join('');
});

socket.on('game_over', ({ leaderboard }) => {
  hideMiniLeaderboard();
  showScreen('final');

  $('finalBoard').innerHTML = leaderboard
    .map((p, i) => `<li>${medal(i)} ${escapeHtml(p.name)} — ${p.score}</li>`)
    .join('');

  $('restartBtn').classList.toggle('hidden', !isHost);
  $('restartHint').classList.toggle('hidden', isHost);

  launchConfetti();
});

$('restartBtn').onclick = () => {
  socket.emit('restart', { code });
};

socket.on('back_to_lobby', players => {
  hideMiniLeaderboard();
  stopConfetti();
  showScreen('lobby');
  socket.emit('rejoin', { code, playerId }, () => {});
  const ul = $('players');
  ul.innerHTML = players
    .map(p => `<li>${escapeHtml(p.name)}</li>`)
    .join('');
  updateHostUI(players);
});

socket.on('error_msg', msg => alert(msg));

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function medal(i) {
  return ['🥇', '🥈', '🥉'][i] || '•';
}
// ─── Конфетти на финале ─────────────────────
let confettiAnimId = null;

function launchConfetti(duration = 5000) {
  const canvas = $('confettiCanvas');
  console.log('confetti called, canvas =', canvas);
  if (!canvas) {
    console.log('canvas НЕ НАЙДЕН! Проверь room.html');
    return;
  }
  
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const W = canvas.width = rect.width || window.innerWidth;
  const H = canvas.height = rect.height || window.innerHeight; 

  const COLORS = ['#667eea', '#764ba2', '#ffeb3b', '#4caf50', '#f44336', '#00bcd4', '#ff9800'];
  const COUNT = 180;

  const pieces = [];
  for (let i = 0; i < COUNT; i++) {
    pieces.push({
      x: Math.random() * W,
      y: -Math.random() * H * 0.5,
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 10,
      vy: 2 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 2,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  const startTime = Date.now();

  function draw() {
    const elapsed = Date.now() - startTime;
    const fade = elapsed > duration - 1000
      ? Math.max(0, 1 - (elapsed - (duration - 1000)) / 1000)
      : 1;

    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = fade;

    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.angle += p.spin;

      if (p.y > H + 20) {
        p.y = -20;
        p.x = Math.random() * W;
        p.vy = 2 + Math.random() * 3;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    if (elapsed < duration) {
      confettiAnimId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, W, H);
      confettiAnimId = null;
    }
  }

  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  draw();
}

function stopConfetti() {
  if (confettiAnimId) {
    cancelAnimationFrame(confettiAnimId);
    confettiAnimId = null;
  }
  const canvas = $('confettiCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
// ─── Мини-таблица игроков ────────────────────
function renderMiniLeaderboard(players) {
  const box = $('miniLeaderboard');
  const list = $('miniLeaderboardList');
  if (!box || !list || !players || !players.length) return;

  box.classList.remove('hidden');

  list.innerHTML = players
    .map((p, i) => {
      const meClass = p.id === playerId ? ' class="me"' : '';
      const medal = ['🥇', '🥈', '🥉'][i] || '';
      return `<li${meClass}>
        <span class="name">${medal} ${escapeHtml(p.name)}</span>
        <span class="score">${p.score}</span>
      </li>`;
    })
    .join('');
}

// ─── Скрыть таблицу ──────────────────────────
function hideMiniLeaderboard() {
  const box = $('miniLeaderboard');
  if (box) box.classList.add('hidden');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
// ─── Выход из комнаты ────────────────────────────
$('leaveBtn').onclick = () => {
  localStorage.removeItem('roomCode');
  localStorage.removeItem('playerId');
  socket.disconnect();
  location.href = '/';
};