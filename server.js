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

      // 1. Lấy danh sách NHỮNG NGƯỜI KHÁC đã có trong phòng
      const otherMembers = Object.entries(room.members)
        .map(([id, info]) => ({ 
            id, 
            name: info.name, 
            status: info.status 
        }));

      // 2. Thêm người mới vào phòng
      room.members[socket.id] = { name, status: 'pending' };
      socket.data.roomId = roomId;
      socket.data.userName = name;

      socket.join(roomId);

      // 3. Gửi danh sách người cũ CHỈ CHO người mới
      socket.emit('existing-users', otherMembers);

      // ensure join finished before broadcasting
      setImmediate(() => {
        socket.emit('chatHistory', room.chat);
        // 4. Báo cho MỌI NGƯỜI (cũ + mới) cập nhật memberList
        io.to(roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
          id, name: info.name, status: info.status
        })));
        // 5. Báo cho NHỮNG NGƯỜI CŨ biết có người mới
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
    
    let targetSocketId = to;
    const room = rooms[socket.data.roomId];

    // Kiểm tra xem 'to' có phải là ID màn hình không
    if (to.endsWith('_screen') && room && room.members[to]) {
      // Đây là tín hiệu trả lời (answer/candidate) DÀNH CHO màn hình
      
      // 1. Tìm socket ID thật của người đang chia sẻ
      const realSocketId = room.members[to].realSocketId;
      
      if (realSocketId) {
        // 2. Gửi tín hiệu đến người chia sẻ thật
        // qua một kênh 'reply' (trả lời) riêng biệt
        io.to(realSocketId).emit('signal-screen-reply', {
            from: socket.id, // Tín hiệu này ĐẾN TỪ người xem (socket.id)
            signal
        });
        return; // Dừng lại, không chạy code bên dưới
      }
    }

    // Nếu không phải trả lời màn hình, thì đó là tín hiệu cam-cam bình thường
    io.to(targetSocketId).emit('signal', { 
        from: socket.id, 
        signal, 
        name: socket.data.userName || name 
    });
  });

  // Update peer status
  // Update peer status (camera on/off)
socket.on('updateStatus', ({ id, status } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.members[id]) return;
    room.members[id].status = status;
    io.to(socket.data.roomId).emit('peer-status-update', { id, status });
    io.to(socket.data.roomId).emit(
        'memberList',
        Object.entries(room.members).map(([mid, info]) => ({
            id: mid,
            name: info.name,
            status: info.status
        }))
    );
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

    // Raise Hand ✋
  socket.on('raiseHand', ({ raised } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.members[socket.id].handRaised = raised;

    io.to(roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
      id,
      name: info.name,
      handRaised: info.handRaised || false
    })));
  });
socket.on('start-sharing', ({ name } = {}) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const screenShareId = socket.id + '_screen';
    const screenShareName = name || 'Màn hình';

    // Thêm user ảo vào phòng
    room.members[screenShareId] = {
      name: screenShareName,
      status: 'sharing',
      realSocketId: socket.id // Liên kết với socket thật
    };

    // 1. Báo cho CHÍNH BẠN biết ID màn hình của bạn
    socket.emit('sharing-started-you', { screenShareId });

    // 2. Báo cho NHỮNG NGƯỜI KHÁC có "user" mới
    socket.to(roomId).emit('user-connected', {
      id: screenShareId,
      name: screenShareName
    });
    
    // 3. Cập nhật danh sách thành viên cho TẤT CẢ
    io.to(roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
      id, name: info.name, status: info.status
    })));
  });

  // === THÊM MỚI: Dừng chia sẻ màn hình ===
  socket.on('stop-sharing', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const screenShareId = socket.id + '_screen';
    if (!room.members[screenShareId]) return; // Không có gì để dừng

    // Xóa user ảo
    delete room.members[screenShareId];

    // Báo mọi người user ảo đã thoát
    io.to(roomId).emit('user-disconnected', screenShareId);

    // Cập nhật danh sách thành viên
    io.to(roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
      id, name: info.name, status: info.status
    })));
  });

  // === THÊM MỚI: Kênh tín hiệu riêng cho màn hình ===
  socket.on('signal-screen', ({ to, signal }) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    
    const screenShareId = socket.id + '_screen';
    const screenShareName = room.members[screenShareId]?.name || 'Màn hình';

    // Gửi Offer CHO Viewer (VẪN DÙNG KÊNH 'signal' CHUNG)
    io.to(to).emit('signal', {
      from: screenShareId, // TỪ user ảo
      signal,
      name: screenShareName
    });
  });

  // Disconnect
socket.on('disconnect', reason => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) {
      console.log('🔌 Disconnected (no room):', socket.id, 'reason:', reason);
      return;
    }

    const room = rooms[roomId];
    
    // 1. Dọn dẹp user ảo (màn hình) NẾU CÓ
    const screenShareId = socket.id + '_screen';
    if (room.members[screenShareId]) {
      delete room.members[screenShareId];
      // Báo những người còn lại là màn hình cũng disconnect
      socket.to(roomId).emit('user-disconnected', screenShareId);
    }
    
    // 2. Dọn dẹp user thật
    if (room.members[socket.id]) {
        delete room.members[socket.id];
        socket.to(roomId).emit('user-disconnected', socket.id);
    }
    
    console.log(`❌ ${socket.data.userName || socket.id} left (${reason})`);

    // 3. Cập nhật danh sách thành viên cho những người còn lại
    io.to(roomId).emit('memberList', Object.entries(room.members).map(([id, info]) => ({
      id, name: info.name, status: info.status
    })));

    // 4. Dọn dẹp phòng NẾU rỗng
    if (Object.keys(room.members).length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room ${roomId} removed (empty)`);
    }
  });
});



const PORT = 3000;
server.listen(PORT, () => console.log(`✅ HTTPS running: https://192.168.71.1:${PORT}`));
