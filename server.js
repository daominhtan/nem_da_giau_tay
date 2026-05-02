const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const CHARS = [
  {id:'monkey',hp:100,stats:{lo:15,hi:25,crit:.15,cm:2}},
  {id:'panda',hp:130,stats:{lo:12,hi:20,crit:.1,cm:1.8}},
  {id:'dragon',hp:90,stats:{lo:18,hi:30,crit:.2,cm:2.5}},
  {id:'alien',hp:95,stats:{lo:20,hi:28,crit:.25,cm:2}},
  {id:'ghost',hp:85,stats:{lo:22,hi:32,crit:.3,cm:2.2}},
  {id:'cat',hp:100,stats:{lo:14,hi:26,crit:.35,cm:2.8}}
];

function getChar(id) { return CHARS.find(c => c.id === id); }
function randDmg(stats) { return stats.lo + Math.floor(Math.random() * (stats.hi - stats.lo)); }

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'rock_throw_gunny_v3.html')));

const rooms = {};

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join('');
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createRoom', ({charId}) => {
    let code;
    do { code = genCode(); } while(rooms[code]);
    rooms[code] = {
      p1:socket.id, p1Char:charId, p2:null, p2Char:null, turn:1, gameStarted:false,
      p1Hp:null, p2Hp:null, p1Shield:false, p2Shield:false,
      p1Items:{bomb:2,heal:1,shield:1}, p2Items:{bomb:2,heal:1,shield:1}
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerNum = 1;
    socket.emit('roomCreated', {code});
    console.log(`Room ${code} created by ${socket.id}`);
  });

  socket.on('joinRoom', ({code, charId}) => {
    const room = rooms[code];
    if(!room) { socket.emit('error','Phòng không tồn tại!'); return; }
    if(room.p2) { socket.emit('error','Phòng đã đầy!'); return; }
    room.p2 = socket.id;
    room.p2Char = charId;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerNum = 2;
    socket.emit('roomJoined', {code});
    io.to(room.p1).emit('playerJoined', {charId: room.p2Char});
    console.log(`Player 2 joined room ${code}`);
  });

  socket.on('startGame', () => {
    const code = socket.data.roomCode;
    if(!code||!rooms[code]) return;
    const room = rooms[code];
    if(room.gameStarted) return;
    room.gameStarted = true;
    const c1 = getChar(room.p1Char), c2 = getChar(room.p2Char);
    room.p1Hp = c1.hp; room.p2Hp = c2.hp;
    io.to(code).emit('gameStart', {
      p1Char:room.p1Char, p2Char:room.p2Char, turn:room.turn,
      p1Hp:room.p1Hp, p2Hp:room.p2Hp,
      p1Items:room.p1Items, p2Items:room.p2Items
    });
  });

  socket.on('gameAction', (data) => {
    const code = socket.data.roomCode;
    if(!code||!rooms[code]) return;
    const room = rooms[code];
    const myNum = socket.data.playerNum;
    if(room.turn !== myNum) return;
    const opp = myNum===1?2:1;

    if(data.type==='fire'){
      const atkChar = getChar(myNum===1?room.p1Char:room.p2Char);
      let dmg = randDmg(atkChar.stats);
      const crit = Math.random() < atkChar.stats.crit;
      if(crit) dmg = Math.floor(dmg * atkChar.stats.cm);

      let blocked = myNum===1?room.p2Shield:room.p1Shield;
      if(blocked){ dmg = Math.floor(dmg*.3); if(myNum===1) room.p2Shield=false; else room.p1Shield=false; }
      if(myNum===1) room.p2Hp = Math.max(0, room.p2Hp - dmg);
      else room.p1Hp = Math.max(0, room.p1Hp - dmg);

      room.turn = opp;
      io.to(code).emit('gameResult', {
        attacker: myNum, dmg: dmg, crit: crit, blocked: blocked, type: 'fire',
        p1Hp: room.p1Hp, p2Hp: room.p2Hp,
        p1Shield: room.p1Shield, p2Shield: room.p2Shield,
        p1Items: room.p1Items, p2Items: room.p2Items,
        turn: room.turn, angle: data.angle, power: data.power
      });
    }
    else if(data.type==='bomb'){
      const dmg = 30 + Math.floor(Math.random()*15);
      if(myNum===1){ room.p2Hp=Math.max(0,room.p2Hp-dmg); room.p1Items.bomb--; }
      else { room.p1Hp=Math.max(0,room.p1Hp-dmg); room.p2Items.bomb--; }
      room.turn = opp;
      io.to(code).emit('gameResult', {
        attacker:myNum, type:'bomb', dmg: dmg,
        p1Hp:room.p1Hp, p2Hp:room.p2Hp,
        p1Items:room.p1Items, p2Items:room.p2Items,
        turn:room.turn
      });
    }
    else if(data.type==='heal'){
      const heal=25;
      if(myNum===1){room.p1Hp=Math.min(getChar(room.p1Char).hp, room.p1Hp+heal); room.p1Items.heal--;}
      else {room.p2Hp=Math.min(getChar(room.p2Char).hp, room.p2Hp+heal); room.p2Items.heal--;}
      room.turn = opp;
      io.to(code).emit('gameResult', {
        attacker:myNum, type:'heal', heal: heal,
        p1Hp:room.p1Hp, p2Hp:room.p2Hp,
        p1Items:room.p1Items, p2Items:room.p2Items,
        turn:room.turn
      });
    }
    else if(data.type==='shield'){
      if(myNum===1){room.p1Shield=true; room.p1Items.shield--;}
      else {room.p2Shield=true; room.p2Items.shield--;}
      room.turn = opp;
      io.to(code).emit('gameResult', {
        attacker:myNum, type:'shield',
        p1Shield:room.p1Shield, p2Shield:room.p2Shield,
        p1Items:room.p1Items, p2Items:room.p2Items,
        turn:room.turn
      });
    }
    else if(data.type==='turnEnd'){
      // Bắn trượt (miss) -> đổi lượt
      console.log(`[turnEnd] Player ${myNum} missed, switching turn to ${opp}`);
      room.turn = opp;
      io.to(code).emit('gameResult', {
        attacker:myNum, type:'miss',
        p1Hp:room.p1Hp, p2Hp:room.p2Hp,
        p1Shield:room.p1Shield, p2Shield:room.p2Shield,
        p1Items:room.p1Items, p2Items:room.p2Items,
        turn:room.turn
      });
      console.log(`[turnEnd] Sent gameResult with turn=${room.turn}`);
    }
  });

  socket.on('playAgain', () => {
    const code = socket.data.roomCode;
    if(code && rooms[code]){
      const room = rooms[code];
      room.turn=1;
      room.gameStarted=false;
      room.p1Hp=getChar(room.p1Char).hp;
      room.p2Hp=getChar(room.p2Char).hp;
      room.p1Shield=false; room.p2Shield=false;
      room.p1Burn=0; room.p2Burn=0; room.p1Stun=false; room.p2Stun=false;
      room.p1Items={bomb:2,heal:1,shield:1};
      room.p2Items={bomb:2,heal:1,shield:1};
      // Gửi gameStart cho cả 2 người để khởi động lại
      const c1 = getChar(room.p1Char), c2 = getChar(room.p2Char);
      io.to(code).emit('gameStart', {
        p1Char:room.p1Char, p2Char:room.p2Char, turn:room.turn,
        p1Hp:room.p1Hp, p2Hp:room.p2Hp,
        p1Items:room.p1Items, p2Items:room.p2Items
      });
      room.gameStarted = true;
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if(code && rooms[code]){
      socket.to(code).emit('opponentDisconnected');
      delete rooms[code];
      console.log(`Room ${code} closed`);
    }
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
