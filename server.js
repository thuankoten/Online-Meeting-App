const fs = require("fs");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");

console.log("Starting HTTPS server...");

const app = express();
app.use(express.static("public"));

// ---- TLS ----
const key = fs.readFileSync("192.168.1.201+2-key.pem");
const cert = fs.readFileSync("192.168.1.201+2.pem");
const server = https.createServer({ key, cert }, app);

// ---- Socket.IO ----
const io = new Server(server, { cors: { origin: "*" } });

// ---- In-memory rooms ----
/*
rooms = {
  [roomId]: {
    password,
    members: {
      [socketId]: { name, status, audioOn, handRaised, realSocketId }
    },
    chat: []
  }
}
*/
const rooms = {};

// ---- Utils ----
const safe = s => String(s || "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const genRoom = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do id = Array.from({ length: 6 }, () => chars[Math.random() * chars.length | 0]).join("");
  while (rooms[id]);
  return id;
};

// =============================================================
//                        SOCKET MAIN
// =============================================================
io.on("connection", socket => {
  console.log("🔌", socket.id);

  const updateList = roomId => {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit("memberList",
      Object.entries(room.members).map(([id, u]) => ({
        id, name: u.name, status: u.status, audioOn: u.audioOn, handRaised: u.handRaised
      }))
    );
  };

  // ================== CREATE ROOM ==================
  socket.on("createRoom", ({ roomId, password, autoJoin, name } = {}, cb) => {
    try {
      roomId ||= genRoom();
      if (rooms[roomId]) return cb?.({ success: false, message: "Mã phòng trùng" });

      rooms[roomId] = { password: String(password || ""), members: {}, chat: [] };
      console.log("✅ Created:", roomId);

      cb?.({ success: true, roomId });

      if (autoJoin && name) {
        rooms[roomId].members[socket.id] = { name, status: "pending" };
        socket.data = { roomId, userName: name };
        socket.join(roomId);
        setImmediate(() => {
          socket.emit("chatHistory", rooms[roomId].chat);
          updateList(roomId);
        });
      }
    } catch {
      cb?.({ success: false, message: "Server error" });
    }
  });

  // ================== JOIN ROOM ==================
  socket.on("joinRoom", ({ roomId, password, name } = {}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb?.({ success: false, message: "Phòng không tồn tại" });
    if (room.password !== String(password || "")) return cb?.({ success: false, message: "Sai mật khẩu" });

    const existing = Object.entries(room.members).map(([id, u]) => ({
      id, name: u.name, status: u.status
    }));

    room.members[socket.id] = { name, status: "pending" };
    socket.data = { roomId, userName: name };
    socket.join(roomId);

    socket.emit("existing-users", existing);

    setImmediate(() => {
      socket.emit("chatHistory", room.chat);
      updateList(roomId);
      socket.to(roomId).emit("user-connected", { id: socket.id, name });
    });

    console.log(`➡️ ${name} joined ${roomId}`);
    cb?.({ success: true });
  });

  // ================== SIGNALING ==================
  socket.on("signal", ({ to, signal, name }) => {
    if (!to) return;

    const room = rooms[socket.data.roomId];
    if (to.endsWith("_screen") && room?.members[to]) {
      const real = room.members[to].realSocketId;
      if (real) {
        io.to(real).emit("signal-screen-reply", { from: socket.id, signal });
        return;
      }
    }

    io.to(to).emit("signal", {
      from: socket.id,
      signal,
      name: socket.data.userName || name
    });
  });

  socket.on("signal-screen", ({ to, signal }) => {
    const roomId = socket.data.roomId;
    const screenId = socket.id + "_screen";
    const name = rooms[roomId]?.members[screenId]?.name || "Screen";

    io.to(to).emit("signal", { from: screenId, signal, name });
  });

  // ================== STATUS UPDATE ==================
  socket.on("updateStatus", ({ id, status, audioOn }) => {
    const room = rooms[socket.data.roomId];
    if (!room?.members[id]) return;

    if (status !== undefined) room.members[id].status = status;
    if (audioOn !== undefined) room.members[id].audioOn = !!audioOn;

    io.to(socket.data.roomId).emit("peer-status-update", {
      id, status: room.members[id].status, audioOn: room.members[id].audioOn
    });

    io.to(socket.data.roomId).emit("peer-audio-update", {
      id, audioOn: room.members[id].audioOn
    });

    updateList(socket.data.roomId);
  });

  // ================== CHAT ==================
  socket.on("chatMessage", text => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    text = safe(String(text).trim()).slice(0, 1000);
    if (!text) return;

    const msg = {
      id: socket.id,
      name: safe(socket.data.userName || "User"),
      text,
      time: Date.now()
    };

    room.chat.push(msg);
    if (room.chat.length > 500) room.chat.shift();

    io.to(roomId).emit("chatMessage", msg);
  });

  // ================== RAISE HAND ==================
  socket.on("raiseHand", ({ raised }) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;

    room.members[socket.id].handRaised = raised;
    updateList(socket.data.roomId);
  });

  // ================== REACTIONS ==================
  socket.on("sendReaction", ({ emoji }) => {
    const roomId = socket.data.roomId;
    io.to(roomId).emit("receiveReaction", {
      emoji: String(emoji).slice(0, 5),
      fromId: socket.id,
      name: socket.data.userName
    });
  });

  // ================== SCREEN SHARE ==================
  socket.on("start-sharing", ({ name }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const screenId = socket.id + "_screen";

    room.members[screenId] = {
      name: name || "Screen",
      status: "sharing",
      realSocketId: socket.id
    };

    socket.emit("sharing-started-you", { screenShareId: screenId });
    socket.to(roomId).emit("user-connected", { id: screenId, name });
    updateList(roomId);
  });

  socket.on("stop-sharing", () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;

    const id = socket.id + "_screen";
    delete room.members[id];

    socket.to(socket.data.roomId).emit("user-disconnected", id);
    updateList(socket.data.roomId);
  });

  // ================== DISCONNECT ==================
  socket.on("disconnect", r => {
    const { roomId } = socket.data;
    const room = rooms[roomId];
    if (!room) return;

    const screenId = socket.id + "_screen";
    delete room.members[screenId];
    socket.to(roomId).emit("user-disconnected", screenId);

    delete room.members[socket.id];
    socket.to(roomId).emit("user-disconnected", socket.id);

    updateList(roomId);

    if (!Object.keys(room.members).length) {
      delete rooms[roomId];
      console.log("🗑️ Room removed:", roomId);
    }
  });
});

// ---- Start server ----
server.listen(3000, () => console.log("HTTPS: https://192.168.1.201:3000"));
