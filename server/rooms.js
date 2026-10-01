const quizzes = require('./quizzes.json');

const rooms = new Map();

const QUESTION_TIME = 15000;       // 15 секунд на ответ
const REVEAL_TIME = 4000;          // 4 секунды показываем лидерборд
const ANSWER_REVEAL_TIME = 5000;   // 5 секунд показываем правильный ответ

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function publicPlayers(room) {
  return [...room.players.values()]
    .map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      streak: p.streak,
    }))
    .sort((a, b) => b.score - a.score);
}

function createRoom(hostId, hostName, quizId) {
  const code = genCode();
  const baseQuiz = quizzes.find(q => q.id === quizId) || quizzes[0];

  // Перемешиваем вопросы, берём 10 случайных, затем перемешиваем варианты
  const QUESTIONS_PER_GAME = 10;
  const shuffledQuestions = shuffle(baseQuiz.questions)
    .slice(0, QUESTIONS_PER_GAME)
    .map(q => {
      const correctText = q.options[q.correct];
      const shuffledOptions = shuffle(q.options);
      return {
        ...q,
        options: shuffledOptions,
        correct: shuffledOptions.indexOf(correctText),
      };
    });

  const quiz = {
    ...baseQuiz,
    questions: shuffledQuestions,
  };

  const room = {
    code,
    hostId,
    createdAt: Date.now(),
    quiz,
    players: new Map([
      [hostId, {
        id: hostId,
        name: hostName,
        score: 0,
        streak: 0,
        connected: true,
        lastAnswer: null,
      }],
    ]),
    state: 'lobby',
    currentQ: 0,
    questionStartAt: 0,
    timer: null,
  };

  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerId, name) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Комната не найдена' };
  if (room.state !== 'lobby') return { ok: false, error: 'Игра уже началась' };

  const nameTaken = [...room.players.values()].some(
    p => p.name.toLowerCase() === name.toLowerCase()
  );
  if (nameTaken) return { ok: false, error: 'Такое имя уже занято' };

  room.players.set(playerId, {
    id: playerId,
    name,
    score: 0,
    streak: 0,
    connected: true,
    lastAnswer: null,
  });

  return { ok: true, players: publicPlayers(room), state: room.state };
}

function startGame(code, byId, io) {
  const room = rooms.get(code);
  if (!room || room.hostId !== byId) return false;

  room.state = 'question';
  room.currentQ = 0;
  emitQuestion(room, io);
  return true;
}

function emitQuestion(room, io) {
  const q = room.quiz.questions[room.currentQ];
  room.questionStartAt = Date.now();
  room.state = 'question';

  [...room.players.values()].forEach(p => (p.lastAnswer = null));

  io.to(room.code).emit('question', {
    index: room.currentQ,
    total: room.quiz.questions.length,
    text: q.text,
    image: q.image || null,
    options: q.options,
    timeLimit: QUESTION_TIME,
    players: publicPlayers(room),
  });

  clearTimeout(room.timer);
  room.timer = setTimeout(() => revealAnswer(room, io), QUESTION_TIME);
}

function submitAnswer(code, playerId, optionIndex, io) {
  const room = rooms.get(code);
  if (!room || room.state !== 'question') return;

  const player = room.players.get(playerId);
  if (!player || player.lastAnswer !== null) return;

  const q = room.quiz.questions[room.currentQ];
  const elapsed = Date.now() - room.questionStartAt;
  const correct = optionIndex === q.correct;
  player.lastAnswer = optionIndex;

  let points = 0;
  if (correct) {
    const speedFactor = Math.max(0, 1 - elapsed / QUESTION_TIME / 2);
    points = Math.round(1000 * speedFactor);
    player.streak += 1;
    if (player.streak >= 3) points = Math.round(points * 1.2);
  } else {
    player.streak = 0;
  }

  player.score += points;

  io.to(code).emit('answer_accepted', {
    playerId,
    name: player.name,
    points,
    correct,
    players: publicPlayers(room),
  });
}

function revealAnswer(room, io) {
  clearTimeout(room.timer);

  const q = room.quiz.questions[room.currentQ];

  // ─── Фаза 1: показываем правильный ответ 5 секунд ───
  room.state = 'answer_reveal';
  io.to(room.code).emit('answer_reveal', {
    correctIndex: q.correct,
    players: publicPlayers(room),
  });

  room.timer = setTimeout(() => {
    // ─── Фаза 2: показываем лидерборд 4 секунды ───
    room.state = 'reveal';

    const leaderboard = publicPlayers(room);

    io.to(room.code).emit('reveal', {
      correctIndex: q.correct,
      leaderboard,
      isLast: room.currentQ === room.quiz.questions.length - 1,
    });

    room.timer = setTimeout(() => {
      if (room.currentQ < room.quiz.questions.length - 1) {
        room.currentQ += 1;
        emitQuestion(room, io);
      } else {
        room.state = 'finished';
        io.to(room.code).emit('game_over', { leaderboard });
      }
    }, REVEAL_TIME);
  }, ANSWER_REVEAL_TIME);
}

function resetRoom(code, byId, io) {
  const room = rooms.get(code);
  if (!room || room.hostId !== byId) return;

  room.state = 'lobby';
  room.currentQ = 0;
  clearTimeout(room.timer);

  [...room.players.values()].forEach(p => {
    p.score = 0;
    p.streak = 0;
    p.lastAnswer = null;
  });

  io.to(code).emit('back_to_lobby', publicPlayers(room));
}

function getRoom(code) {
  return rooms.get(code);
}

// ─── Автоочистка старых комнат ────────────────────
const ROOM_TTL = 60 * 60 * 1000; // 1 час

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const allOffline = [...room.players.values()].every(p => !p.connected);
    const finished = room.state === 'finished';
    const tooOld = room.createdAt && now - room.createdAt > ROOM_TTL;

    if ((finished || allOffline) && tooOld) {
      clearTimeout(room.timer);
      rooms.delete(code);
      console.log('🧹 удалена комната', code);
    }
  }
}, 10 * 60 * 1000); // раз в 10 минут

module.exports = {
  createRoom,
  joinRoom,
  startGame,
  submitAnswer,
  resetRoom,
  getRoom,
  publicPlayers,
  rooms,
  QUESTION_TIME,
};