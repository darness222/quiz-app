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
  publicPlayers,
  rooms,
  QUESTION_TIME,
} = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 10000,
  pingInterval: 5000,
});

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
  socket.data.connectedAt = Date.now();
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

    const room = getRoom(code);
    io.to(code).emit('lobby_update', {
      players: publicPlayers(room),
      hostId: room.hostId,
    });
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

    const snapshot = {
      ok: true,
      state: room.state,
      currentQ: room.currentQ,
      hostId: room.hostId,
      player: { id: player.id, name: player.name, score: player.score },
      players: publicPlayers(room),
    };

    if (room.state === 'question') {
      const q = room.quiz.questions[room.currentQ];
      const elapsed = Date.now() - room.questionStartAt;
      const left = Math.max(0, QUESTION_TIME - elapsed);
      snapshot.question = {
        index: room.currentQ,
        total: room.quiz.questions.length,
        text: q.text,
        image: q.image || null,
        options: q.options,
        timeLimit: left,
        players: publicPlayers(room),
      };
      snapshot.myAnswer = player.lastAnswer;
    }

    if (room.state === 'answer_reveal') {
      const q = room.quiz.questions[room.currentQ];
      snapshot.answerReveal = {
        correctIndex: q.correct,
        players: publicPlayers(room),
      };
      snapshot.myAnswer = player.lastAnswer;
    }

    if (room.state === 'reveal') {
      snapshot.leaderboard = publicPlayers(room);
    }

    if (room.state === 'finished') {
      snapshot.leaderboard = publicPlayers(room);
    }

    cb(snapshot);
    io.to(code).emit('lobby_update', {
      players: publicPlayers(room),
      hostId: room.hostId,
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ disconnected:', socket.id);
    const playerId = socket.data.playerId;
    const roomCode = socket.data.roomCode;
    if (!playerId || !roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    const p = room.players.get(playerId);
    if (!p) return;

    const disconnectedAt = Date.now();

    setTimeout(() => {
      let stillConnected = false;
      for (const [, s] of io.of('/').sockets) {
        if (
          s.data.playerId === playerId &&
          s.data.roomCode === roomCode &&
          s.data.connectedAt > disconnectedAt
        ) {
          stillConnected = true;
          break;
        }
      }

      if (stillConnected) {
        console.log('ℹ️ у игрока новый активный сокет — оставляем online');
        return;
      }

      p.connected = false;
      io.to(room.code).emit('lobby_update', {
        players: publicPlayers(room),
        hostId: room.hostId,
      });

      // Если отключился хост — через 5 секунд передаём хоста другому
      if (room.hostId === playerId) {
        setTimeout(() => {
          const roomNow = getRoom(roomCode);
          if (!roomNow) return;

          const host = roomNow.players.get(roomNow.hostId);
          if (host && host.connected) return;

          const candidate = [...roomNow.players.values()].find(x => x.connected);
          if (candidate) {
            roomNow.hostId = candidate.id;
            console.log('👑 хост передан:', candidate.name);
            io.to(roomNow.code).emit('host_changed', { hostId: candidate.id });
            io.to(roomNow.code).emit('lobby_update', {
              players: publicPlayers(roomNow),
              hostId: roomNow.hostId,
            });
          }
        }, 5 * 1000);
      }
    }, 15 * 1000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});