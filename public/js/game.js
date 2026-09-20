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

socket.on('answer_accepted', ({ playerId: pid, points, correct }) => {
  if (pid === playerId) {
    $('answerStatus').textContent = correct
      ? `✅ Верно! +${points}`
      : '❌ Неверно';
  }
});

socket.on('reveal', ({ leaderboard }) => {
  clearInterval(timerInterval);
  showScreen('reveal');
  $('leaderboard').innerHTML = leaderboard
    .map((p, i) => `<li>${medal(i)} ${escapeHtml(p.name)} — ${p.score}</li>`)
    .join('');
});

socket.on('game_over', ({ leaderboard }) => {
  showScreen('final');
  $('finalBoard').innerHTML = leaderboard
    .map((p, i) => `<li>${medal(i)} ${escapeHtml(p.name)} — ${p.score}</li>`)
    .join('');

  $('restartBtn').classList.toggle('hidden', !isHost);
  $('restartHint').classList.toggle('hidden', isHost);
});

$('restartBtn').onclick = () => {
  socket.emit('restart', { code });
};

socket.on('back_to_lobby', players => {
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
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}