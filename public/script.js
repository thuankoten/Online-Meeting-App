// ===================
// Client.js WebRTC + Chat (Final Fixed)
// ===================

// ===== Socket.io =====
const socket = io("https://192.168.71.1:3000", { secure: true });

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
const raiseHandBtn = document.getElementById("raiseHandBtn");

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
let existingUsersToProcess = [];

// ===================
// Helper
// ===================
function processExistingUsers(users) {
    console.log('Đang xử lý hàng đợi existing-users:', users);
    
    users.forEach(user => {
        const { id, name } = user;
        if (id.endsWith("_screen")) return; 

        // Logic cũ từ 'existing-users'
        peers[id] = { pc: null, el: createVideoCard(id, name), name };
        videoGrid.appendChild(peers[id].el);
        createPeer(id, name, true); // (Bây giờ 'localStream' đã tồn tại và an toàn)
    });
}

function createVideoCard(id, name, stream = null, muted = false) {
    const wrap = document.createElement("div");
    wrap.className = "cam-card";
    wrap.id = "cam-" + id;

    // === VIDEO ===
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
    if (stream) video.srcObject = stream;

    // === AVATAR ===
    const avatar = document.createElement("div");
    avatar.className = "avatar-placeholder";
    avatar.textContent = (name?.charAt(0) || "?").toUpperCase();
    if (stream) avatar.style.display = "none";

    // === OVERLAY (hiển thị tên) ===
    const label = document.createElement("div");
    label.className = "cam-overlay";
    label.textContent = name || "Người dùng";

    wrap.appendChild(video);
    wrap.appendChild(avatar);
    wrap.appendChild(label);

    wrap.updateStream = function (newStream) {
        if (newStream) {
            video.srcObject = newStream;
            video.style.display = "block";
            avatar.style.display = "none";
        } else {
            video.srcObject = null;
            video.style.display = "none";
            avatar.style.display = "flex";
        }
    };

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
        // ... (code ontrack giữ nguyên)
        const stream = ev.streams[0];
        if (!peers[id].el) {
            peers[id].el = createVideoCard(id, name, stream);
            if (id.endsWith("_screen")) peers[id].el.classList.add("is-sharing");
            videoGrid.appendChild(peers[id].el);
        } else {
            peers[id].el.updateStream(stream); 
        }
    };

    pc.onicecandidate = ev => {
        if (ev.candidate) {
            // Gửi candidate. Server sẽ tự động chuyển hướng
            // nếu 'id' (là 'to') có đuôi là _screen
            socket.emit("signal", { 
                to: id, 
                signal: { candidate: ev.candidate } 
            });
        }
    };

    if (initiator) {
        // ... (code onnegotiationneeded giữ nguyên)
        pc.onnegotiationneeded = async () => {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                // Cam-cam offer đi qua kênh 'signal'
                socket.emit("signal", { to: id, signal: pc.localDescription });
            } catch (err) {
                console.error("Lỗi onnegotiationneeded (cam):", err);
            }
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

    // Thêm kiểm tra
    if (!roomId) {
        alert("Vui lòng nhập mã phòng.");
        statusText.textContent = "Chưa kết nối";
        return;
    }

    statusText.textContent = "Đang kết nối...";
    
    // Reset hàng đợi (quan trọng nếu join thất bại và thử lại)
    existingUsersToProcess = []; 

    // Gửi yêu cầu tham gia TỚI MÁY CHỦ
    socket.emit("joinRoom", { roomId, password: roomPasswordInput.value, name: myName }, async (res) => { // Thêm 'async'
        if (!res.success) {
            // Thất bại: Chỉ cần thông báo. 
            alert(res.message);
            joined = false;
            statusText.textContent = "Kết nối thất bại";
        } else {
            // THÀNH CÔNG:
            try {
                // 1. Bật camera (logic đã sửa)
                await startLocalMedia(); 
                joined = true;
                
                statusText.textContent = "Đã vào phòng!";
                canChat = true;
                showMeetingView(); 

                // 2. (QUAN TRỌNG) Xử lý hàng đợi 'existing-users' (nếu có)
                processExistingUsers(existingUsersToProcess);
                existingUsersToProcess = []; // Xóa hàng đợi
                
            } catch (err) {
                // Lỗi camera
                console.error("Không thể lấy media:", err);
                statusText.textContent = "Lỗi: Không thể lấy camera/micro";
                joined = false;
                socket.disconnect(); // Ngắt kết nối luôn
            }
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
        let displayName = m.name + (m.id === socket.id ? " (Bạn)" : "");
        if (m.handRaised) displayName += " ✋"; // hiện biểu tượng
        li.textContent = displayName;
        membersList.appendChild(li);
    });
});

// ===================
// Khi người khác bật/tắt camera
// ===================
socket.on("peer-status-update", ({ id, status }) => {
    const card = document.getElementById("cam-" + id);
    if (!card) return;

    const video = card.querySelector("video");
    const avatar = card.querySelector(".avatar-placeholder");

    if (status === "off") {
        if (video) video.style.display = "none";
        if (avatar) avatar.style.display = "flex";
    } else {
        if (video) video.style.display = "block";
        if (avatar) avatar.style.display = "none";
    }
});

socket.on("user-connected", ({ id, name }) => {
    if (peers[id]) return; // Đã xử lý (tránh lặp)

    if (id.endsWith("_screen")) {
        // Logic màn hình giữ nguyên: chỉ tạo thẻ, chờ offer
        console.log("Một màn hình đã tham gia:", name);
        peers[id] = { pc: null, el: createVideoCard(id, name), name };
        peers[id].el.classList.add("is-sharing"); 
        videoGrid.appendChild(peers[id].el);
    } else {
        // == Đây là một NGƯỜI DÙNG thật MỚI ==
        console.log("Một người dùng MỚI đã tham gia:", name);
        
        // 1. Chỉ tạo thẻ video
        peers[id] = { pc: null, el: createVideoCard(id, name), name };
        videoGrid.appendChild(peers[id].el);
        
        // 2. KHÔNG GỌI createPeer. 
        // Chúng ta (người cũ) sẽ chờ người mới (newcomer) gửi 'offer'.
        
        // Logic "if (myScreenShareId)" để kết nối màn hình giữ nguyên
        if (myScreenShareId && localScreenStream) {
            console.log("Tạo kết nối màn hình cho người mới:", name);
            const vTrack = localScreenStream.getTracks().find(t => t.kind === 'video');
            const aTrack = localScreenStream.getTracks().find(t => t.kind === 'audio');
            const pc = createScreenPeer(id, vTrack, aTrack);
            screenPeers[id] = pc;
        }
    }
});

socket.on('existing-users', (users) => {
    if (localStream) {
        // Nếu localStream đã sẵn sàng (trường hợp hiếm), xử lý ngay
        processExistingUsers(users);
    } else {
        // Nếu chưa, lưu vào hàng đợi để 'joinBtn.onclick' xử lý
        console.log("Nhận 'existing-users' trước khi media sẵn sàng. Đang đưa vào hàng đợi...");
        existingUsersToProcess = users;
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

socket.on("signal", async ({ from, signal, name }) => {
    
    // 1. XỬ LÝ OFFER MÀN HÌNH (LOGIC CỦA NGƯỜI XEM)
    if (signal.type === "offer" && from.endsWith("_screen")) {
        console.log("Nhận Screen Share 'offer' từ:", name);
        
        // Tạo thẻ video (nếu chưa có)
        if (!peers[from]) {
            peers[from] = { pc: null, el: createVideoCard(from, name), name };
            peers[from].el.classList.add("is-sharing");
            videoGrid.appendChild(peers[from].el);
        }

        // Tạo peer (non-initiator)
        const pc = createPeer(from, name, false); 
        
        // Set remote, create answer
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        
        // Gửi answer: Server sẽ tự động bắt 'to' (là _screen ID)
        // và chuyển nó sang kênh 'signal-screen-reply'
        socket.emit("signal", { 
            to: from, // Gửi TỚI _screen ID
            signal: pc.localDescription 
        });
        return; // Xong logic cho screen offer
    }

    // 2. XỬ LÝ TÍN HIỆU CAM-CAM (Logic cũ)
    let pc = peers[from]?.pc;

    if (signal.type === "offer") {
        // Nhận cam-cam offer
        if (!peers[from]) {
            peers[from] = { pc: null, el: createVideoCard(from, name), name };
            videoGrid.appendChild(peers[from].el);
        }
        pc = createPeer(from, peers[from].name, false);
        
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit("signal", { to: from, signal: pc.localDescription });

    } else if (signal.type === "answer") {
        // Nhận cam-cam answer
        if (!pc) return console.error("Nhận 'answer' (cam) nhưng không có peer:", from);
        await pc.setRemoteDescription(new RTCSessionDescription(signal));

    } else if (signal.candidate) {
        // Nhận cam-cam candidate HOẶC screen-candidate (từ sharer)
        if (!pc) {
             // 'pc' có thể chưa tồn tại nếu candidate đến trước offer
             // Điều này sẽ được xử lý bởi 'addIceCandidate' sau
             return console.log("Nhận 'candidate' sớm, tạm bỏ qua:", from);
        }
        try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (err) {
            console.warn('Lỗi add candidate (bỏ qua):', err);
        }
    }
});

socket.on('signal-screen-reply', async ({ from, signal }) => {
    // 'from' = ID của người xem (e.g., may_2_id)
    
    const pc = screenPeers[from]; // Lấy đúng peer connection
    if (!pc) {
        return console.error("Nhận 'signal-screen-reply' nhưng không có peer:", from);
    }

    try {
        if (signal.type === "answer") {
            console.log("Nhận 'answer' CHO MÀN HÌNH từ:", from);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.candidate) {
            // console.log("Nhận 'candidate' CHO MÀN HÌNH từ:", from);
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    } catch (err) {
        console.error("Lỗi khi xử lý 'signal-screen-reply':", err);
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
// ===================
// Audio / Video / Share Screen (có avatar khi tắt cam)
// ===================
toggleVideoBtn.onclick = () => {
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    toggleVideoBtn.textContent = track.enabled ? "Tắt Camera" : "Mở Camera";

    // Gửi trạng thái camera lên server
    socket.emit("updateStatus", {
        id: socket.id,
        status: track.enabled ? "on" : "off"
    });

    // Cập nhật giao diện local ngay
    const myCard = document.getElementById("cam-me");
    if (myCard) {
        const video = myCard.querySelector("video");
        const avatar = myCard.querySelector(".avatar-placeholder");
        if (track.enabled) {
            video.style.display = "block";
            avatar.style.display = "none";
        } else {
            video.style.display = "none";
            avatar.style.display = "flex";
        }
    }
};
toggleAudioBtn.onclick = () => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    toggleAudioBtn.textContent = track.enabled ? "Tắt Micro" : "Mở Micro";
};


let handRaised = false;

raiseHandBtn.onclick = () => {
    handRaised = !handRaised;
    raiseHandBtn.textContent = handRaised ? "✋ Đang giơ tay" : "✋ Giơ tay";
    raiseHandBtn.classList.toggle("raised", handRaised);
    socket.emit("raiseHand", { raised: handRaised });
};

socket.on("peer-status-update", ({ id, status }) => {
    const card = document.getElementById("cam-" + id);
    if (!card) return;

    const video = card.querySelector("video");
    const avatar = card.querySelector(".avatar-placeholder");

    if (status === "off") {
        if (video) video.style.display = "none";
        if (avatar) avatar.style.display = "flex";
    } else {
        if (video) video.style.display = "block";
        if (avatar) avatar.style.display = "none";
    }
});

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