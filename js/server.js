const fs = require('fs');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');

console.log("Starting HTTPS server...");

const app = express();
app.use(express.static('public'));

let keyPath = '192.168.71.1+2-key.pem';
let certPath = '192.168.71.1+2.pem';
let server;
try {
  server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  }, app);
} catch (err) {
  console.error('Failed to read TLS files:', err.message);
  process.exit(1);
}

const io = new Server(server, { cors: { origin: "*" } });

// In-memory rooms: { roomId: { password, members: { socketId: { name, status } }, chat: [msg] } }
const rooms = {};

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[id]);
  return id;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

io.on('connection', socket => {
  console.log('🔌 New socket:', socket.id);

  // Create room
  socket.on('createRoom', ({ roomId, password, autoJoin, name } = {}, callback) => {
    try {
      if (!roomId) roomId = generateRoomId();
      if (rooms[roomId]) {
        return callback?.({ success: false, message: 'Mã phòng trùng, vui lòng thử lại' }) || null;
      }
      rooms[roomId] = { password: String(password || ''), members: {}, chat: [] };
      console.log(`✅ Room created: ${roomId}`);

      callback?.({ success: true, roomId });

      // Optional: immediately join the creator if requested (safer to let client call join)
      if (autoJoin && name) {
        // mark member, set socket data, join and broadcast after join completes
        rooms[roomId].members[socket.id] = { name, status: 'pending' };
        socket.data.roomId = roomId;
        socket.data.userName = name;
        socket.join(roomId);
        setImmediate(() => {
          socket.emit('chatHistory', rooms[roomId].chat);
          io.to(roomId).emit('memberList', Object.entries(rooms[roomId].members).map(([id, info]) => ({
            id, name: info.name, status: info.status
          })));
        });
      }
    } catch (err) {
      console.error('createRoom error:', err);
      callback?.({ success: false, message: 'Lỗi server' });
    }
  });

  // Join room
  socket.on('joinRoom', ({ roomId, password, name } = {}, callback) => {
    try {
      if (!roomId) return callback?.({ success: false, message: 'Thiếu mã phòng' });
      const room = rooms[roomId];
      if (!room) return callback?.({ success: false, message: 'Phòng không tồn tại' });
      if (room.password !== String(password || '')) return callback?.({ success: false, message: 'Sai mật khẩu' });

      room.members[socket.id] = { name, status: 'pending' };
      socket.data.roomId = roomId;
      socket.data.userName = name;

      socket.join(roomId);
      // ensure join finished before broadcasting
      setImmediate(() => {
        socket.emit('chatHistory', room.chat);
        io.to(roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
          id, name: info.name, status: info.status
        })));
        socket.to(roomId).emit('user-connected', { id: socket.id, name });
      });

      console.log(`✅ ${name} joined room: ${roomId}`);
      callback?.({ success: true });
    } catch (err) {
      console.error('joinRoom error:', err);
      callback?.({ success: false, message: 'Lỗi server' });
    }
  });

  // WebRTC signaling
  socket.on('signal', ({ to, signal, name } = {}) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, signal, name: socket.data.userName || name });
  });

  // Update peer status
  socket.on('updateStatus', ({ id, status } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.members[id]) return;
    room.members[id].status = status;
    socket.to(socket.data.roomId).emit('peer-status-update', { id, status });
    io.to(socket.data.roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
      id, name: info.name, status: info.status
    })));
  });

  // Chat
  socket.on('chatMessage', msg => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    let text = String(msg || '').trim();
    if (!text) return;
    if (text.length > 1000) text = text.slice(0, 1000);

    const name = socket.data.userName || 'Người lạ';
    const message = {
      id: socket.id,
      name: escapeHtml(name),
      text: escapeHtml(text),
      time: Date.now()
    };

    room.chat.push(message);
    // bound history
    if (room.chat.length > 500) room.chat.shift();

    io.to(roomId).emit('chatMessage', message);
  });

  // Disconnect
  socket.on('disconnect', reason => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) {
      console.log('🔌 Disconnected:', socket.id, 'reason:', reason);
      return;
    }

    delete rooms[roomId].members[socket.id];
    socket.to(roomId).emit('user-disconnected', socket.id);

    io.to(roomId).emit('memberList', Object.entries(rooms[roomId].members).map(([id, info]) => ({
      id, name: info.name, status: info.status
    })));

    if (Object.keys(rooms[roomId].members).length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room ${roomId} removed (empty)`);
    }

    console.log(`❌ ${socket.data.userName || socket.id} left (${reason})`);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`✅ HTTPS running: https://192.168.71.1:${PORT}`));
