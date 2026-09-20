const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const {
  createRoom,
  joinRoom,
  startGame,
  submitAnswer,
  resetRoom,
  getRoom,
  rooms,
} = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

if (process.env.NODE_ENV === 'production') {
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

  setInterval(() => {
    fetch(`${SELF_URL}/health`)
      .then(() => console.log('💓 self-ping ok'))
      .catch(err => console.error('self-ping failed:', err.message));
  }, 14 * 60 * 1000);
}

io.on('connection', socket => {
  console.log('🔌 connected:', socket.id);

  socket.on('create_room', ({ name, quizId }, cb) => {
    if (!name || !name.trim()) return cb({ ok: false, error: 'Нужно имя' });
    const playerId = 'p_' + Math.random().toString(36).slice(2, 12);
    const room = createRoom(playerId, name.trim(), quizId);
    socket.data.playerId = playerId;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    console.log('🏠 room created:', room.code, 'host:', playerId);
    cb({ ok: true, code: room.code, playerId });
  });

  socket.on('join_room', ({ code, name, playerId }, cb) => {
    if (!code || !name) return cb({ ok: false, error: 'Заполните все поля' });
    code = code.toUpperCase().trim();

    const pid = playerId || 'p_' + Math.random().toString(36).slice(2, 12);
    const res = joinRoom(code, pid, name.trim());
    if (!res.ok) return cb(res);

    socket.data.playerId = pid;
    socket.data.roomCode = code;
    socket.join(code);
    console.log('👤 joined:', pid, 'в комнату', code);
    io.to(code).emit('lobby_update', res.players);
    cb({ ok: true, code, playerId: pid });
  });

  socket.on('start_game', ({ code }) => {
    const ok = startGame(code, socket.data.playerId, io);
    if (!ok) {
      console.log('❌ start_game провалился. playerId:', socket.data.playerId);
      socket.emit('error_msg', 'Только создатель может начать игру');
    }
  });

  socket.on('answer', ({ code, optionIndex }) => {
    submitAnswer(code, socket.data.playerId, optionIndex, io);
  });

  socket.on('restart', ({ code }) => {
    resetRoom(code, socket.data.playerId, io);
  });

  socket.on('rejoin', ({ code, playerId }, cb) => {
    const room = getRoom(code);
    if (!room || !room.players.has(playerId)) return cb({ ok: false });

    socket.data.playerId = playerId;
    socket.data.roomCode = code;

    const player = room.players.get(playerId);
    player.connected = true;
    socket.join(code);

    cb({
      ok: true,
      state: room.state,
      currentQ: room.currentQ,
      player: { id: player.id, name: player.name, score: player.score },
      players: [...room.players.values()],
    });

    io.to(code).emit('lobby_update', [...room.players.values()]);
  });

  socket.on('disconnect', () => {
    console.log('❌ disconnected:', socket.id);
    const playerId = socket.data.playerId;
    const roomCode = socket.data.roomCode;
    if (!playerId || !roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    const p = room.players.get(playerId);
    if (p) {
      p.connected = false;
      io.to(room.code).emit('lobby_update', [...room.players.values()]);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});