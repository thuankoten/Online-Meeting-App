// ===================
// Client.js WebRTC + Chat (Final Fixed)
// ===================

// ===== Socket.io =====
const socket = io("https://192.168.1.117:3000", { 
    secure: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
});

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
const reactionBtn = document.getElementById("reactionBtn");
const reactionContainer = document.getElementById("reactionContainer");
const reactionPopup = document.getElementById("reactionPopup");
const emojiButtons = document.querySelectorAll(".emoji-btn");

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
    
    // Cập nhật layout sau khi thêm users - dùng setTimeout để đảm bảo DOM đã được cập nhật
    setTimeout(() => updateVideoGridLayout(), 100);
}

// ===== FUNCTION: Cập nhật layout video grid dựa trên số lượng người =====
function updateVideoGridLayout() {
    // Đếm số lượng cam-card thật (không tính screen sharing)
    // Đếm tất cả cam-card trong videoGrid, loại trừ những card có class "is-sharing"
    const allCards = videoGrid.querySelectorAll('.cam-card');
    const peopleCards = Array.from(allCards).filter(card => 
        !card.classList.contains('is-sharing')
    );
    
    const totalPeople = peopleCards.length;
    
    // Xóa tất cả classes layout cũ
    videoGrid.classList.remove('layout-1', 'layout-2', 'layout-3plus');
    
    // Áp dụng layout dựa trên số lượng người
    if (totalPeople === 1) {
        videoGrid.classList.add('layout-1'); // 1 người: 100%
    } else if (totalPeople === 2) {
        videoGrid.classList.add('layout-2'); // 2 người: 50% mỗi người
    } else if (totalPeople > 2) {
        videoGrid.classList.add('layout-3plus'); // 3+ người: chia đều
    }
    
    console.log(`Layout updated: ${totalPeople} người`, {
        allCards: allCards.length,
        peopleCards: peopleCards.length,
        layout: videoGrid.className
    });
    
    // Force reflow để đảm bảo CSS được áp dụng
    videoGrid.offsetHeight;
}

// ===== ERROR & NOTIFICATION HELPERS =====
function showError(message) {
    // Tạo toast notification
    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(90deg, #ff6b6b, #f03e3e);
        color: white;
        padding: 14px 24px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(240, 62, 62, 0.4);
        z-index: 10000;
        font-weight: 600;
        animation: slideDown 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showSuccess(message) {
    const toast = document.createElement('div');
    toast.className = 'success-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(90deg, #51cf66, #40c057);
        color: white;
        padding: 14px 24px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(64, 192, 87, 0.4);
        z-index: 10000;
        font-weight: 600;
        animation: slideDown 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function setLoading(isLoading) {
    if (isLoading) {
        joinBtn.disabled = true;
        createBtn.disabled = true;
        joinBtn.textContent = 'Đang kết nối...';
        createBtn.textContent = 'Đang tạo...';
    } else {
        joinBtn.disabled = false;
        createBtn.disabled = false;
        joinBtn.textContent = 'Tham gia';
        createBtn.textContent = 'Tạo phòng ngẫu nhiên';
    }
}

// Hàm mới để hiển thị biểu cảm bay lên
function showReactionOnCard(emoji, fromId) {
  let targetCardId = "cam-" + fromId;
  
  if (fromId === socket.id) {
    targetCardId = "cam-me"; // Trường hợp là chính mình
  }

  const targetCard = document.getElementById(targetCardId);
  if (!targetCard) return; // Không tìm thấy card

  const reactionEl = document.createElement("div");
  reactionEl.className = "reaction-float";
  reactionEl.textContent = emoji;

  // Thêm vào card video
  targetCard.appendChild(reactionEl);

  // Tự động xóa sau khi animation kết thúc
  setTimeout(() => {
    reactionEl.remove();
  }, 2500); // 2.5 giây (khớp với thời gian animation)
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
    // Sử dụng setTimeout để đảm bảo DOM đã được cập nhật
    setTimeout(() => updateVideoGridLayout(), 100);
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

    // ===== ERROR HANDLING: WebRTC Connection State =====
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${name}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            console.error(`WebRTC connection failed/disconnected for ${name}`);
            showError(`Kết nối với ${name} bị gián đoạn. Đang thử kết nối lại...`);
            // Thử restart ICE
            if (pc.iceConnectionState === 'failed') {
                pc.restartIce();
            }
        } else if (pc.iceConnectionState === 'connected') {
            console.log(`WebRTC connected to ${name}`);
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`Connection state for ${name}:`, pc.connectionState);
        if (pc.connectionState === 'failed') {
            console.error(`Peer connection failed for ${name}`);
            showError(`Không thể kết nối với ${name}. Vui lòng kiểm tra mạng.`);
        } else if (pc.connectionState === 'closed') {
            console.log(`Peer connection closed for ${name}`);
        }
    };

    pc.onerror = (err) => {
        console.error(`WebRTC error for ${name}:`, err);
        showError(`Lỗi kết nối với ${name}`);
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
                showError(`Lỗi khi thiết lập kết nối với ${name}`);
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
    // Validation: Kiểm tra tên người dùng
    const name = nameInput.value.trim();
    if (!name || name.length < 2) {
        showError("Vui lòng nhập tên (ít nhất 2 ký tự)");
        nameInput.focus();
        return;
    }
    if (name.length > 50) {
        showError("Tên quá dài (tối đa 50 ký tự)");
        nameInput.focus();
        return;
    }

    setLoading(true);
    
    // mã phòng và mật khẩu là số ngẫu nhiên 6 chữ số
    const r = String(Math.floor(100000 + Math.random() * 900000)); // 100000-999999
    const p = String(Math.floor(100000 + Math.random() * 900000));

    roomIdInput.value = r;
    roomPasswordInput.value = p;

    socket.emit("createRoom", { roomId: r, password: p }, res => {
        setLoading(false);
        if (res.success) {
            showSuccess(`Tạo phòng thành công! Mã phòng: ${r}`);
            // Tự động join sau khi tạo
            setTimeout(() => {
                joinBtn.click();
            }, 500);
        } else {
            showError(res.message || "Không thể tạo phòng");
        }
    });
};

// ===================
// Join Room
// ===================
joinBtn.onclick = async () => {
    if (joined) return;

    roomId = roomIdInput.value.trim();
    myName = nameInput.value.trim() || "Khách";

    // ===== INPUT VALIDATION =====
    if (!roomId) {
        showError("Vui lòng nhập mã phòng");
        roomIdInput.focus();
        statusText.textContent = "Chưa kết nối";
        return;
    }
    
    if (roomId.length < 4 || roomId.length > 20) {
        showError("Mã phòng phải từ 4-20 ký tự");
        roomIdInput.focus();
        return;
    }

    if (!myName || myName.length < 2) {
        showError("Vui lòng nhập tên (ít nhất 2 ký tự)");
        nameInput.focus();
        return;
    }
    
    if (myName.length > 50) {
        showError("Tên quá dài (tối đa 50 ký tự)");
        nameInput.focus();
        return;
    }

    setLoading(true);
    statusText.textContent = "Đang kết nối...";
    
    // Reset hàng đợi (quan trọng nếu join thất bại và thử lại)
    existingUsersToProcess = []; 

    // Gửi yêu cầu tham gia TỚI MÁY CHỦ
    socket.emit("joinRoom", { roomId, password: roomPasswordInput.value, name: myName }, async (res) => { // Thêm 'async'
        setLoading(false);
        if (!res.success) {
            // Thất bại: Hiển thị lỗi
            showError(res.message || "Không thể tham gia phòng");
            joined = false;
            statusText.textContent = "Kết nối thất bại";
        } else {
            // THÀNH CÔNG:
            try {
                statusText.textContent = "Đang khởi động camera...";
                // 1. Bật camera (logic đã sửa)
                await startLocalMedia(); 
                joined = true;
                
                statusText.textContent = "Đã vào phòng!";
                showSuccess("Đã tham gia phòng thành công!");
                canChat = true;
                showMeetingView(); 

                // 2. (QUAN TRỌNG) Xử lý hàng đợi 'existing-users' (nếu có)
                processExistingUsers(existingUsersToProcess);
                existingUsersToProcess = []; // Xóa hàng đợi
                
            } catch (err) {
                // Lỗi camera
                console.error("Không thể lấy media:", err);
                let errorMsg = "Không thể lấy camera/micro";
                if (err.name === 'NotAllowedError') {
                    errorMsg = "Bạn đã từ chối quyền truy cập camera/micro";
                } else if (err.name === 'NotFoundError') {
                    errorMsg = "Không tìm thấy camera/micro";
                } else if (err.name === 'NotReadableError') {
                    errorMsg = "Camera/micro đang được sử dụng bởi ứng dụng khác";
                }
                showError(errorMsg);
                statusText.textContent = "Lỗi: " + errorMsg;
                joined = false;
                socket.emit("leaveRoom"); // Thông báo server
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
function sendChatMessage() {
    if (!canChat) {
        showError("Bạn chưa tham gia phòng");
        return;
    }
    
    const msg = chatInput.value.trim();
    if (!msg) return;
    
    if (msg.length > 1000) {
        showError("Tin nhắn quá dài (tối đa 1000 ký tự)");
        return;
    }
    
    socket.emit("chatMessage", msg);
    chatInput.value = "";
}

sendBtn.onclick = sendChatMessage;

// ===== ENTER KEY HANDLER FOR CHAT =====
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

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
        
        // Cập nhật layout sau khi thêm người mới - dùng setTimeout để đảm bảo DOM đã được cập nhật
        setTimeout(() => updateVideoGridLayout(), 100);
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
        
        // Cập nhật layout sau khi người dùng rời đi - dùng setTimeout để đảm bảo DOM đã được cập nhật
        setTimeout(() => updateVideoGridLayout(), 100);
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
            // Cập nhật layout khi có người mới - dùng setTimeout để đảm bảo DOM đã được cập nhật
            setTimeout(() => updateVideoGridLayout(), 100);
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
    // Xóa layout classes khi rời phòng
    videoGrid.classList.remove('layout-1', 'layout-2', 'layout-3plus');
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
        shareScreenBtn.textContent = "Dừng chia sẻ";
        showSuccess("Đã bắt đầu chia sẻ màn hình");

        // Lắng nghe sự kiện "Stop" từ nút của trình duyệt
        localScreenStream.getTracks()[0].onended = () => {
            stopScreenShare();
        };

    } catch (err) {
        console.error("Lỗi getDisplayMedia:", err);
        let errorMsg = "Không thể chia sẻ màn hình";
        if (err.name === 'NotAllowedError') {
            errorMsg = "Bạn đã từ chối quyền chia sẻ màn hình";
        } else if (err.name === 'NotFoundError') {
            errorMsg = "Không tìm thấy màn hình để chia sẻ";
        } else if (err.name === 'NotReadableError') {
            errorMsg = "Không thể truy cập màn hình";
        }
        showError(errorMsg);
    }
};
function createScreenPeer(targetId, vTrack, aTrack) {
    console.log("Đang tạo screen peer đến:", targetId);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    if (vTrack) pc.addTrack(vTrack, localScreenStream);
    if (aTrack) pc.addTrack(aTrack, localScreenStream);

    // ===== ERROR HANDLING: Screen Share WebRTC =====
    pc.oniceconnectionstatechange = () => {
        console.log(`Screen share ICE state for ${targetId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            console.error(`Screen share connection failed for ${targetId}`);
            if (pc.iceConnectionState === 'failed') {
                pc.restartIce();
            }
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`Screen share connection state for ${targetId}:`, pc.connectionState);
        if (pc.connectionState === 'failed') {
            console.error(`Screen share peer connection failed for ${targetId}`);
        }
    };

    pc.onerror = (err) => {
        console.error(`Screen share WebRTC error for ${targetId}:`, err);
    };

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
            showError("Lỗi khi thiết lập chia sẻ màn hình");
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
    shareScreenBtn.textContent = "Chia sẻ màn hình";

    // Báo server
    socket.emit("stop-sharing");

    // Đóng tất cả peer kết nối màn hình
    Object.values(screenPeers).forEach(pc => pc.close());
    screenPeers = {};
    
    showSuccess("Đã dừng chia sẻ màn hình");
}

// ===================
// Reactions Logic
// ===================

// Bật/tắt khay biểu cảm
reactionBtn.onclick = () => {
  reactionPopup.classList.toggle("visible");
};

// Gửi biểu cảm khi bấm
emojiButtons.forEach(btn => {
  btn.onclick = () => {
    const emoji = btn.getAttribute("data-emoji");
    
    // 1. Gửi lên server
    socket.emit("sendReaction", { emoji });
    
    // 2. Hiển thị ngay cho mình
    showReactionOnCard(emoji, socket.id);
    
    // 3. Tắt popup
    reactionPopup.classList.remove("visible");
  };
});

// Nhận biểu cảm từ người khác
socket.on("receiveReaction", ({ emoji, fromId, name }) => {
  // Không hiển thị lại của chính mình (vì mình đã hiển thị ở bước 2)
  if (fromId === socket.id) return;
  
  showReactionOnCard(emoji, fromId);
});

// (Nâng cao) Tắt popup khi bấm ra ngoài
document.addEventListener("click", (e) => {
  if (!reactionContainer.contains(e.target) && reactionPopup.classList.contains("visible")) {
    reactionPopup.classList.remove("visible");
  }
});

// ===================
// Socket Error & Reconnection Handling
// ===================
socket.on('connect', () => {
    console.log('✅ Đã kết nối với server');
    if (statusText) {
        statusText.textContent = "Đã kết nối";
    }
});

socket.on('disconnect', (reason) => {
    console.log('❌ Mất kết nối:', reason);
    
    if (joined) {
        showError("Mất kết nối với server. Đang thử kết nối lại...");
        statusText.textContent = "Đang kết nối lại...";
    } else {
        statusText.textContent = "Chưa kết nối";
    }
    
    // Nếu server disconnect, không tự động reconnect
    // Nếu mất kết nối mạng, socket.io sẽ tự động reconnect
    if (reason === 'io server disconnect') {
        // Server đã ngắt kết nối, cần reconnect thủ công
        socket.connect();
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log('✅ Đã kết nối lại sau', attemptNumber, 'lần thử');
    showSuccess("Đã kết nối lại với server");
    
    if (joined && roomId) {
        // Nếu đang trong phòng, thử join lại
        statusText.textContent = "Đang tham gia lại phòng...";
        socket.emit("joinRoom", { 
            roomId, 
            password: roomPasswordInput.value, 
            name: myName 
        }, async (res) => {
            if (res.success) {
                showSuccess("Đã tham gia lại phòng thành công");
                statusText.textContent = "Đã vào phòng!";
            } else {
                showError("Không thể tham gia lại phòng: " + res.message);
                statusText.textContent = "Kết nối thất bại";
                joined = false;
            }
        });
    }
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('🔄 Đang thử kết nối lại... Lần thử:', attemptNumber);
    if (statusText) {
        statusText.textContent = `Đang kết nối lại... (${attemptNumber})`;
    }
});

socket.on('reconnect_error', (error) => {
    console.error('❌ Lỗi khi kết nối lại:', error);
    showError("Không thể kết nối lại với server");
});

socket.on('reconnect_failed', () => {
    console.error('❌ Không thể kết nối lại sau nhiều lần thử');
    showError("Không thể kết nối với server. Vui lòng tải lại trang.");
    statusText.textContent = "Kết nối thất bại";
});

socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
    showError("Lỗi kết nối: " + (error.message || "Lỗi không xác định"));
});