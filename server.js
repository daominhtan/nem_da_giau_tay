const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'rock_throw_gunny_v3.html'));
});

const rooms = {};

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createRoom', ({ charId }) => {
    let code;
    do { code = genCode(); } while (rooms[code]);
    rooms[code] = {
      p1: socket.id, p1Char: charId, p2: null, p2Char: null,
      turn: 1, gameStarted: false
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerNum = 1;
    socket.emit('roomCreated', { code });
    console.log(`Room ${code} created by ${socket.id}`);
  });

  socket.on('joinRoom', ({ code, charId }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', 'Phòng không tồn tại!'); return; }
    if (room.p2) { socket.emit('error', 'Phòng đã đầy!'); return; }
    room.p2 = socket.id;
    room.p2Char = charId;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerNum = 2;
    socket.emit('roomJoined', { code });
    io.to(room.p1).emit('playerJoined', { charId: room.p2Char });
    console.log(`Player 2 joined room ${code}`);
  });

  socket.on('startGame', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (room.gameStarted) return;
    room.gameStarted = true;
    io.to(code).emit('gameStart', {
      p1Char: room.p1Char,
      p2Char: room.p2Char,
      turn: room.turn
    });
  });

  socket.on('gameAction', (data) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const myNum = socket.data.playerNum;

    if (room.turn !== myNum) return;

    socket.to(code).emit('gameAction', Object.assign({}, data, { player: myNum }));

    if (data.type === 'fire' || data.type === 'bomb' || data.type === 'heal' || data.type === 'shield') {
      room.turn = room.turn === 1 ? 2 : 1;
      io.to(code).emit('turnUpdate', { turn: room.turn });
    }
  });

  socket.on('playAgain', () => {
    const code = socket.data.roomCode;
    if (code) {
      rooms[code].turn = 1;
      socket.to(code).emit('playAgain');
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code && rooms[code]) {
      socket.to(code).emit('opponentDisconnected');
      delete rooms[code];
      console.log(`Room ${code} closed`);
    }
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
