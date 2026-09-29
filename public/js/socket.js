const socket = io();

const $ = id => document.getElementById(id);
const nameInput = $('name');
const codeInput = $('code');
const quizSelect = $('quizSelect');
const errorEl = $('error');



function showError(msg) {
  errorEl.textContent = msg;
  setTimeout(() => (errorEl.textContent = ''), 3000);
}

$('createBtn').onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return showError('Введите имя');
  const quizId = quizSelect.value;

  // очищаем прошлую сессию перед созданием новой комнаты
  localStorage.removeItem('playerId');
  localStorage.removeItem('roomCode');

  socket.emit('create_room', { name, quizId }, res => {
    if (!res.ok) return showError(res.error || 'Ошибка');
    localStorage.setItem('playerId', res.playerId);
    localStorage.setItem('roomCode', res.code);
    location.href = `/room.html?code=${res.code}`;
  });
};

$('joinBtn').onclick = () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) return showError('Введите имя');
  if (!code) return showError('Введите код');

  // если ранее были в другой комнате — чистим
  const oldRoom = localStorage.getItem('roomCode');
  if (oldRoom && oldRoom !== code) {
    localStorage.removeItem('playerId');
    localStorage.removeItem('roomCode');
  }

  const playerId = localStorage.getItem('playerId') || undefined;

  socket.emit('join_room', { code, name, playerId }, res => {
    if (!res.ok) return showError(res.error || 'Ошибка');
    localStorage.setItem('playerId', res.playerId);
    localStorage.setItem('roomCode', res.code);
    location.href = `/room.html?code=${res.code}`;
  });
};