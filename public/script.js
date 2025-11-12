// ===================
// Client.js WebRTC + Chat (Final Fixed)
// ===================

// ===== Socket.io =====
const socket = io("https://192.168.5.60:3000", { secure: true });

// ===== UI Elements =====
const roomIdInput = document.getElementById("roomIdInput");
const roomPasswordInput = document.getElementById("roomPasswordInput");
const nameInput = document.getElementById("nameInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const statusText = document.getElementById("statusText");
const videoGrid = document.getElementById("videoGrid");
const membersList = document.getElementById("membersList");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const toggleVideoBtn = document.getElementById("toggleVideo");
const toggleAudioBtn = document.getElementById("toggleAudio");
const shareScreenBtn = document.getElementById("shareScreenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const currentRoomId = document.getElementById("currentRoomId");

// ===== State =====
let localStream = null;
let peers = {}; // { socketId : { pc, el, name } }
let roomId = null;
let myName = null;
let joined = false;
let canChat = false;
let localScreenCard = null;
let screenPeers = {}; // { targetSocketId : pc }
let localScreenStream = null;
let myScreenShareId = null;

// ===================
// Helper
// ===================
function createVideoCard(id, name, stream = null, muted = false) {
    const wrap = document.createElement("div");
    wrap.className = "cam-card";
    wrap.id = "cam-" + id;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    wrap.appendChild(video);

    const label = document.createElement("div");
    label.className = "cam-overlay";
    wrap.appendChild(label);

    function updateLabel() {
        label.textContent = stream ? name : `${name} (chưa kết nối)`;
    }

    if (stream) video.srcObject = stream;

    wrap.updateStream = function (newStream) {
        stream = newStream;
        video.srcObject = newStream;
        updateLabel();
    };

    updateLabel();
    return wrap;
}

async function startLocalMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const myCard = createVideoCard("me", myName, localStream, true);
    videoGrid.appendChild(myCard);
}

function createPeer(id, name, initiator) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    if (!peers[id]) peers[id] = { name };
    peers[id].pc = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = ev => {
        const stream = ev.streams[0];

        if (!peers[id].el) {
            peers[id].el = createVideoCard(id, name, stream);
            videoGrid.appendChild(peers[id].el);
        } else {
            peers[id].el.updateStream(stream); 
        }
    };

    pc.onicecandidate = ev => {
        if (ev.candidate) socket.emit("signal", { to: id, signal: { candidate: ev.candidate } });
    };

    if (initiator) {
        pc.onnegotiationneeded = async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("signal", { to: id, signal: pc.localDescription });
        };
    }

    return pc;
}

// ===================
// Switch View Functions
// ===================
function showMeetingView() {
    document.getElementById("home").style.display = "none";
    document.getElementById("meeting").style.display = "grid";
    document.getElementById("controls").style.display = "flex";
    currentRoomId.textContent = roomId; // Hiển thị mã phòng hiện tại
    updateFloatingCopyVisibility();
}

function showHomeView() {
    document.getElementById("home").style.display = "flex";
    document.getElementById("meeting").style.display = "none";
    document.getElementById("controls").style.display = "none";
    updateFloatingCopyVisibility();
}

// ===================
// Create Room
// ===================
createBtn.onclick = () => {
    // mã phòng và mật khẩu là số ngẫu nhiên 6 chữ số
    const r = String(Math.floor(100000 + Math.random() * 900000)); // 100000-999999
    const p = String(Math.floor(100000 + Math.random() * 900000));

    roomIdInput.value = r;
    roomPasswordInput.value = p;

    socket.emit("createRoom", { roomId: r, password: p }, res => {
        if (res.success) {
            alert(`Tạo phòng thành công!\nMã phòng: ${r}\nMật khẩu: ${p}`);
        } else alert(res.message);
    });
};

// ===================
// Join Room
// ===================
joinBtn.onclick = async () => {
    if (joined) return;

    roomId = roomIdInput.value.trim();
    myName = nameInput.value.trim() || "Khách";

    statusText.textContent = "Đang kết nối...";
    await startLocalMedia();
    joined = true;

    socket.emit("joinRoom", { roomId, password: roomPasswordInput.value, name: myName }, res => {
        if (!res.success) {
            alert(res.message);
            joined = false;
            statusText.textContent = "Kết nối thất bại";
        } else {
            statusText.textContent = "Đã vào phòng!";
            canChat = true;
            showMeetingView(); // Chuyển sang view phòng họp
        }
    });
};

// ===================
// Copy Room Info
// ===================
copyRoomBtn.onclick = () => {
    navigator.clipboard.writeText(`Mã phòng: ${roomIdInput.value}\nMật khẩu: ${roomPasswordInput.value}`);
    alert("Đã copy!");
};

// floating copy button behavior
const copyRoomFloatingBtn = document.getElementById("copyRoomFloatingBtn");
function updateFloatingCopyVisibility() {
    // show only when in meeting view
    if (document.getElementById("meeting").style.display !== "none") copyRoomFloatingBtn.classList.add("visible");
    else copyRoomFloatingBtn.classList.remove("visible");
}
updateFloatingCopyVisibility(); // initial

// call updateFloatingCopyVisibility when switching views
function showMeetingView() {
    document.getElementById("home").style.display = "none";
    document.getElementById("meeting").style.display = "grid";
    document.getElementById("controls").style.display = "flex";
    currentRoomId.textContent = roomId;
    updateFloatingCopyVisibility();
}

function showHomeView() {
    document.getElementById("home").style.display = "flex";
    document.getElementById("meeting").style.display = "none";
    document.getElementById("controls").style.display = "none";
    updateFloatingCopyVisibility();
}

// floating copy action
copyRoomFloatingBtn.onclick = () => {
    const rid = roomId || roomIdInput.value || currentRoomId.textContent || "";
    const pwd = roomPasswordInput.value || "";
    if (!rid && !pwd) {
        alert("Không có mã phòng / mật khẩu để copy.");
        return;
    }
    navigator.clipboard.writeText(`Mã phòng: ${rid}\nMật khẩu: ${pwd}`).then(() => {
        alert("Đã copy mã phòng và mật khẩu!");
    }).catch(() => {
        alert("Không thể copy vào clipboard.");
    });
};

// ensure visibility updates when leaving/joining
// already existing calls to showMeetingView/showHomeView will handle it

// ===================
// Chat
// ===================
sendBtn.onclick = () => {
    const msg = chatInput.value.trim();
    if (!msg) return;
    socket.emit("chatMessage", msg);
    chatInput.value = "";
};

// small helper to avoid HTML injection
function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

socket.on("chatMessage", ({ id, name, text, time }) => {
    const item = document.createElement("div");
    const t = new Date(time).toLocaleTimeString();
    item.className = id === socket.id ? "chat-item chat-me" : "chat-item";
    // structured content so CSS can style pieces
    item.innerHTML = `
        <div class="meta"><span class="time">${escapeHtml(t)}</span><span class="name">${escapeHtml(name)}</span></div>
        <div class="text">${escapeHtml(text)}</div>
    `;
    chatMessages.appendChild(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// ===================
// Member List & WebRTC
// ===================
socket.on("memberList", members => {
    membersList.innerHTML = "";
    members.forEach(m => {
        const li = document.createElement("div");
        li.textContent = m.name + (m.id === socket.id ? " (Bạn)" : "");
        membersList.appendChild(li);
    });
});

socket.on("user-connected", ({ id, name }) => {
    if (id.endsWith("_screen")) {
        // == Đây là một MÀN HÌNH ==
        console.log("Một màn hình đã tham gia:", name);
        // Chỉ tạo thẻ video, không tạo peer
        peers[id] = { pc: null, el: createVideoCard(id, name), name };
        peers[id].el.classList.add("is-sharing"); // Thêm CSS
        videoGrid.appendChild(peers[id].el);
        // Chúng ta sẽ đợi tín hiệu 'offer' TỪ màn hình này
    } else {
        // == Đây là một NGƯỜI DÙNG thật ==
        console.log("Một người dùng đã tham gia:", name);
        // Logic cũ: tạo thẻ video VÀ chủ động tạo peer
        peers[id] = { pc: null, el: createVideoCard(id, name), name };
        videoGrid.appendChild(peers[id].el);
        createPeer(id, name, true); // true = initiator

        // KHI CHÚNG TA ĐANG CHIA SẺ, và có người mới vào
        if (myScreenShareId && localScreenStream) {
            console.log("Tạo kết nối màn hình cho người mới:", name);
            const vTrack = localScreenStream.getTracks().find(t => t.kind === 'video');
            const aTrack = localScreenStream.getTracks().find(t => t.kind === 'audio');
            const pc = createScreenPeer(id, vTrack, aTrack);
            screenPeers[id] = pc;
        }
    }
});

socket.on("user-disconnected", id => {
    if (id.endsWith("_screen")) {
        // Màn hình đã thoát
        console.log("Màn hình đã thoát:", id);
        peers[id]?.pc?.close();
        peers[id]?.el?.remove();
        delete peers[id];
    } else {
        // Người dùng thật đã thoát
        console.log("Người dùng đã thoát:", id);
        peers[id]?.pc?.close();
        peers[id]?.el?.remove();
        delete peers[id];
        
        // Dọn dẹp kết nối màn hình ĐẾN người này (nếu có)
        if (screenPeers[id]) {
            console.log("Dọn dẹp screen peer cho:", id);
            screenPeers[id].close();
            delete screenPeers[id];
        }
    }
});
socket.on('sharing-started-you', ({ screenShareId }) => {
    console.log("Server xác nhận, ID màn hình của tôi là:", screenShareId);
    myScreenShareId = screenShareId;

    // Tạo card video local cho màn hình
    const myScreenCard = createVideoCard(screenShareId, "Màn hình của tôi", localScreenStream, true);
    myScreenCard.classList.add("is-sharing");
    videoGrid.prepend(myScreenCard); // Đặt lên đầu

    // Lấy track
    const vTrack = localScreenStream.getTracks().find(t => t.kind === 'video');
    const aTrack = localScreenStream.getTracks().find(t => t.kind === 'audio');
    
    // Tạo kết nối màn hình đến TẤT CẢ user thật đang có
    for (const id in peers) {
        // Chỉ kết nối đến user thật (không phải màn hình)
        if (!id.endsWith("_screen")) {
            const pc = createScreenPeer(id, vTrack, aTrack);
            screenPeers[id] = pc;
        }
    }
});

socket.on("signal", async ({ from, signal }) => {
    let pc = peers[from]?.pc || createPeer(from, peers[from].name, false);
    if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit("signal", { to: from, signal: pc.localDescription });
    } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
});
socket.on("sharing-state-changed", ({ id, isSharing }) => {
    const peer = peers[id];
    if (!peer || !peer.el) return; // Không tìm thấy peer hoặc thẻ video

    // Thêm/xóa class CSS để sửa lỗi cắt xén
    if (isSharing) {
        peer.el.classList.add("is-sharing");
    } else {
        peer.el.classList.remove("is-sharing");
    }
});

// ===================
// Leave Room
// ===================
leaveBtn.onclick = () => {
    // Dừng chia sẻ màn hình NẾU có
    if (myScreenShareId) {
        stopScreenShare();
    }
    
    // Logic dọn dẹp cũ (giữ nguyên)
    Object.values(peers).forEach(p => p.pc?.close());
    peers = {};
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    videoGrid.innerHTML = "";
    chatMessages.innerHTML = "";
    joined = false;
    canChat = false;
    // socket.emit("leaveRoom"); // Dòng này không cần thiết
    socket.disconnect(); // Ngắt kết nối luôn
    showHomeView(); // Quay về trang chủ
    statusText.textContent = "Đã rời phòng";
    location.reload(); // Tải lại trang cho chắc
};

// ===================
// Audio / Video / Share Screen
// ===================
toggleVideoBtn.onclick = () => {
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    toggleVideoBtn.textContent = track.enabled ? "Tắt Camera" : "Mở Camera";
};
toggleAudioBtn.onclick = () => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    toggleAudioBtn.textContent = track.enabled ? "Tắt Micro" : "Mở Micro";
};

shareScreenBtn.onclick = async () => {
    if (myScreenShareId) {
        // Nếu đang chia sẻ, nhấn nút này để DỪNG
        stopScreenShare();
        return;
    }

    try {
        localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
        // Báo cho server biết tôi muốn chia sẻ
        socket.emit("start-sharing", { name: myName + " (Màn hình)" });

        // Lắng nghe sự kiện "Stop" từ nút của trình duyệt
        localScreenStream.getTracks()[0].onended = () => {
            stopScreenShare();
        };

    } catch (err) {
        console.error("Lỗi getDisplayMedia:", err);
    }
};
function createScreenPeer(targetId, vTrack, aTrack) {
    console.log("Đang tạo screen peer đến:", targetId);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    if (vTrack) pc.addTrack(vTrack, localScreenStream);
    if (aTrack) pc.addTrack(aTrack, localScreenStream);

    pc.onnegotiationneeded = async () => {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            // Gửi offer bằng kênh tín hiệu MÀN HÌNH
            socket.emit("signal-screen", { 
                to: targetId, 
                signal: pc.localDescription 
            });
        } catch (err) {
            console.error("Lỗi onnegotiationneeded (screen):", err);
        }
    };

    pc.onicecandidate = ev => {
        if (ev.candidate) {
            socket.emit("signal-screen", { 
                to: targetId, 
                signal: { candidate: ev.candidate } 
            });
        }
    };
    return pc;
}
function stopScreenShare() {
    if (!localScreenStream) return;

    console.log("Đang dừng chia sẻ màn hình...");
    localScreenStream.getTracks().forEach(t => t.stop());
    localScreenStream = null;

    // Xóa card local
    const localScreenCard = document.getElementById('cam-' + myScreenShareId);
    if (localScreenCard) localScreenCard.remove();
    
    myScreenShareId = null;

    // Báo server
    socket.emit("stop-sharing");

    // Đóng tất cả peer kết nối màn hình
    Object.values(screenPeers).forEach(pc => pc.close());
    screenPeers = {};
}