// ═══════════════════════════════════════════════════════════════
//  MyTicTacToe — script.js
//  Modes : vs Human | vs Computer (minimax) | Online (Firebase)
//  Timer : synced via Firebase in online mode
//  Notifications : Web Notification API (browser) +
//                  Capacitor LocalNotifications (native app)
// ═══════════════════════════════════════════════════════════════

const db = firebase.database();

// ── Platform helpers ───────────────────────────────────────────
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform());

// ════════════════════════════════════════════════════════════════
//  NOTIFICATION IDS
// ════════════════════════════════════════════════════════════════
const NOTIF = {
    YOUR_TURN:    1,
    TIMER_WARN:   2,
    OPPONENT_WIN: 3,
    DRAW:         4,
    IDLE_REMIND:  6
};

let notificationsAllowed = false;

// ── Setup notifications ────────────────────────────────────────
async function setupNotifications() {
    if (isNative()) {
        // Capacitor LocalNotifications
        try {
            const { LocalNotifications } = Capacitor.Plugins;
            const perm = await LocalNotifications.requestPermissions();
            notificationsAllowed = perm && perm.display === "granted";
            if (notificationsAllowed) {
                try {
                    await LocalNotifications.createChannel({
                        id: "tictactoe", name: "TicTacToe",
                        importance: 4, sound: "default",
                        vibration: true, lights: true, lightColor: "#8B00FF"
                    });
                } catch(e) {}

                LocalNotifications.addListener("localNotificationActionPerformed", action => {
                    const data = action.notification.extra || {};
                    if (data.roomCode) {
                        nameScreen.style.display    = "flex";
                        gameContainer.style.display = "none";
                        setMode("online");
                        document.getElementById("roomCodeInput").value = data.roomCode;
                    }
                });
            }
        } catch(e) { console.warn("Native notification setup failed:", e); }

    } else {
        // Web Notification API
        if (!("Notification" in window)) return;
        let perm = Notification.permission;
        if (perm === "default") perm = await Notification.requestPermission();
        notificationsAllowed = perm === "granted";
    }
}

// ── Send notification ──────────────────────────────────────────
async function sendNotification(id, title, body, extra = {}) {
    if (!notificationsAllowed) return;

    if (isNative()) {
        try {
            const { LocalNotifications } = Capacitor.Plugins;
            try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch(e) {}
            await LocalNotifications.schedule({
                notifications: [{
                    id, title, body, extra,
                    schedule: { at: new Date(Date.now() + 300) },
                    sound: "default",
                    smallIcon: "ic_launcher",
                    channelId: "tictactoe"
                }]
            });
        } catch(e) { console.warn("sendNotification failed:", e); }

    } else {
        // Web: show OS notification if tab not visible, else show toast
        if (document.visibilityState !== "visible") {
            try {
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    const sw = await navigator.serviceWorker.ready;
                    sw.showNotification(title, {
                        body, icon: "icon-192.png",
                        tag: String(id), data: extra, vibrate: [200,100,200]
                    });
                } else {
                    new Notification(title, { body, icon: "icon-192.png", tag: String(id) });
                }
            } catch(e) {
                try { new Notification(title, { body }); } catch(e2) {}
            }
        } else {
            showToast(title, body);
        }
    }
}

async function cancelNotif(id) {
    if (!isNative()) return;
    try {
        const { LocalNotifications } = Capacitor.Plugins;
        await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch(e) {}
}

// ── In-app toast ───────────────────────────────────────────────
function showToast(title, body) {
    const toast = document.getElementById("appToast");
    if (!toast) return;
    toast.innerHTML = `<strong>${title}</strong><span>${body}</span>`;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 4000);
}

// ── Firebase push helper (write request so opponent gets notified) ─
function writePushRequest(targetSymbol, id, title, body, extra = {}) {
    if (!gameRef) return;
    gameRef.child("push_request").set({
        target: targetSymbol, id, title, body, extra, ts: Date.now()
    });
}

function listenForPushRequests(ref) {
    ref.child("push_request").on("value", snap => {
        const req = snap.val();
        if (!req || req.target !== mySymbol) return;
        sendNotification(req.id, req.title, req.body, req.extra || {});
        ref.child("push_request").remove();
    });
}

// init notifications (async, non-blocking)
setupNotifications();

// ════════════════════════════════════════════════════════════════
//  DOM REFS
// ════════════════════════════════════════════════════════════════
const boxes           = document.querySelectorAll(".box");
const info            = document.getElementById("info");
const resetBtn        = document.getElementById("reset");
const changePlayers   = document.getElementById("changePlayers");
const imgbox          = document.getElementById("imgbox");
const gameContainer   = document.getElementById("gameContainer");
const nameScreen      = document.getElementById("nameScreen");
const startBtn        = document.getElementById("startBtn");
const lbList          = document.getElementById("lbList");
const clearLb         = document.getElementById("clearLb");
const darkToggle      = document.getElementById("darkToggle");
const boardWrap       = document.querySelector(".board-wrap");
const modeBadge       = document.getElementById("modeBadge");
const playerOInput    = document.getElementById("playerO");
const onlineOptions   = document.getElementById("onlineOptions");
const onlineStatus    = document.getElementById("onlineStatus");
const roomDisplay     = document.getElementById("roomDisplay");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");

// ════════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════════
let turn          = "X";
let board         = ["","","","","","","","",""];
let gameOver      = false;
let playerX       = "Player X";
let playerO       = "Player O";
let mode          = "human";   // "human" | "computer" | "online"
let mySymbol      = "";        // "X" or "O" in online mode
let roomCode      = "";
let gameRef       = null;
let isListening   = false;

// Timer
let timerInterval    = null;
let timeLeft         = 10;
const TIMER_MAX      = 10;
const CIRC           = 2 * Math.PI * 16; // ≈ 100.53
let onlineTimerOwned = false;
let lastTimerEnd     = null;

const winPatterns = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
];

// ════════════════════════════════════════════════════════════════
//  DARK MODE
// ════════════════════════════════════════════════════════════════
function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    darkToggle.textContent = dark ? "☀️" : "🌙";
    localStorage.setItem("tttDark", dark ? "1" : "0");
}
darkToggle.addEventListener("click", () => applyTheme(!document.body.classList.contains("dark")));
applyTheme(localStorage.getItem("tttDark") === "1");

// ════════════════════════════════════════════════════════════════
//  MODE SELECTOR
// ════════════════════════════════════════════════════════════════
function setMode(m) {
    mode = m;
    document.getElementById("btnHuman").classList.toggle("active",  m === "human");
    document.getElementById("btnCPU").classList.toggle("active",    m === "computer");
    document.getElementById("btnOnline").classList.toggle("active", m === "online");

    playerOInput.style.display  = m === "human"  ? "block" : "none";
    onlineOptions.style.display = m === "online" ? "flex"  : "none";
    startBtn.style.display      = m === "online" ? "none"  : "block";
    roomDisplay.style.display   = "none";
}

// ════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ════════════════════════════════════════════════════════════════
function loadLeaderboard() {
    try { return JSON.parse(localStorage.getItem("tttLeaderboard") || "{}"); }
    catch { return {}; }
}
function saveLeaderboard(lb) { localStorage.setItem("tttLeaderboard", JSON.stringify(lb)); }

function recordWin(name) {
    if (!name || name === "draw") return;
    const lb = loadLeaderboard();
    lb[name] = (lb[name] || 0) + 1;
    saveLeaderboard(lb);
    renderLeaderboard();
}

function renderLeaderboard() {
    const lb      = loadLeaderboard();
    const entries = Object.entries(lb).sort((a,b) => b[1]-a[1]);
    if (!entries.length) {
        lbList.innerHTML = `<div class="lb-empty">No games played yet</div>`;
        return;
    }
    const maxWins = entries[0][1];
    const medals  = ["gold","silver","bronze"];
    lbList.innerHTML = entries.map(([name, wins], i) => {
        const rank = i===0?"🥇":i===1?"🥈":i===2?"🥉":(i+1);
        const pct  = maxWins > 0 ? Math.round((wins/maxWins)*100) : 0;
        return `<div class="lb-row">
            <span class="lb-rank ${medals[i]||""}">${rank}</span>
            <div class="lb-avatar">${name.slice(0,2).toUpperCase()}</div>
            <div class="lb-name-wrap">
                <div class="lb-name">${name}</div>
                <div class="lb-bar-wrap"><div class="lb-bar" style="width:${pct}%"></div></div>
            </div>
            <span class="lb-wins">${wins}W</span>
        </div>`;
    }).join("");
}

clearLb.addEventListener("click", () => {
    localStorage.removeItem("tttLeaderboard");
    renderLeaderboard();
});

// ════════════════════════════════════════════════════════════════
//  BOARD HELPERS
// ════════════════════════════════════════════════════════════════
function generateCode() {
    return Math.random().toString(36).substring(2,8).toUpperCase();
}

function renderBoard(b) {
    boxes.forEach((box,i) => {
        box.querySelector(".boxtext").innerText = b[i] || "";
        box.classList.remove("winner");
        box.classList.toggle("taken", !!b[i]);
    });
    const old = document.getElementById("winLine");
    if (old) old.remove();
}

function checkWinner(b = board) {
    for (const p of winPatterns) {
        const [a,bb,c] = p;
        if (b[a] && b[a]===b[bb] && b[a]===b[c]) return { winner: b[a], pattern: p };
    }
    if (b.every(cell => cell !== "")) return { winner: "draw", pattern: null };
    return null;
}

function drawWinLine(pattern) {
    const old = document.getElementById("winLine");
    if (old) old.remove();
    if (!pattern) return;

    const totalSize = 3 * Math.min(window.innerWidth * 0.28, 110);
    const cellSize  = totalSize / 3;

    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("id","winLine");
    svg.setAttribute("viewBox",`0 0 ${totalSize} ${totalSize}`);
    svg.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;`;

    const cx = i => (i%3)*cellSize + cellSize/2;
    const cy = i => Math.floor(i/3)*cellSize + cellSize/2;

    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", cx(pattern[0]));
    line.setAttribute("y1", cy(pattern[0]));
    line.setAttribute("x2", cx(pattern[2]));
    line.setAttribute("y2", cy(pattern[2]));
    svg.appendChild(line);
    boardWrap.appendChild(svg);
}

// ════════════════════════════════════════════════════════════════
//  OUTCOME
// ════════════════════════════════════════════════════════════════
function handleOutcome(result) {
    stopTimer();
    gameOver = true;
    if (result.winner === "draw") {
        info.innerText = "It's a Draw! 🤝";
        sendNotification(NOTIF.DRAW, "It's a Draw! 🤝", "Neither player won. Rematch?");
    } else {
        const winnerName = result.winner === "X" ? playerX : playerO;
        info.innerText = `🎉 ${winnerName} wins!`;
        imgbox.style.display = "block";
        result.pattern.forEach(i => boxes[i].classList.add("winner"));
        drawWinLine(result.pattern);
        recordWin(winnerName);
        const iWon = (mode === "online" && result.winner === mySymbol) ||
                     (mode !== "online");
        if (iWon) {
            sendNotification(NOTIF.OPPONENT_WIN, "You won! 🏆", `Congratulations ${winnerName}!`);
        }
    }
}

// ════════════════════════════════════════════════════════════════
//  TIMER — LOCAL
// ════════════════════════════════════════════════════════════════
function startTimer() {
    stopTimer();
    timeLeft = TIMER_MAX;
    updateTimerUI(timeLeft);
    document.getElementById("timerWrap").style.display = "flex";

    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerUI(timeLeft);
        if (timeLeft <= 0) { stopTimer(); autoSkipLocal(); }
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    const w = document.getElementById("timerWrap");
    if (w) w.style.display = "none";
    const tw = document.getElementById("timerWrap");
    if (tw) tw.classList.remove("urgent-pulse");
}

function updateTimerUI(t) {
    const numEl  = document.getElementById("timerNum");
    const circle = document.getElementById("timerCircle");
    const wrap   = document.getElementById("timerWrap");
    if (!numEl || !circle) return;

    numEl.textContent = t;
    circle.style.strokeDasharray  = CIRC;
    circle.style.strokeDashoffset = ((TIMER_MAX - t) / TIMER_MAX) * CIRC;

    const urgent = t <= 3;
    numEl.classList.toggle("urgent",  urgent);
    circle.classList.toggle("urgent", urgent);
    if (wrap) wrap.classList.toggle("urgent-pulse", urgent);

    // warn at 5 seconds on your turn
    if (t === 5) {
        sendNotification(NOTIF.TIMER_WARN, "⏰ 5 seconds left!", "Hurry! Make your move now!");
    }
}

function autoSkipLocal() {
    if (gameOver) return;
    const skippedName = turn === "X" ? playerX : playerO;
    info.innerText = `⏰ ${skippedName} ran out of time!`;
    setTimeout(() => {
        if (gameOver) return;
        turn = turn === "X" ? "O" : "X";
        info.innerText = `Turn for ${turn==="X"?playerX:playerO} (${turn})`;
        if (mode === "computer" && turn === "O") makeCPUMove();
        else startTimer();
    }, 1200);
}

// ════════════════════════════════════════════════════════════════
//  TIMER — ONLINE (synced via Firebase timerEnd epoch)
// ════════════════════════════════════════════════════════════════
function startOnlineTimer(endEpoch, iAmOwner) {
    stopTimer();
    onlineTimerOwned = iAmOwner;
    document.getElementById("timerWrap").style.display = "flex";

    timerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endEpoch - Date.now()) / 1000));
        updateTimerUI(remaining);
        if (remaining <= 0) {
            stopTimer();
            if (onlineTimerOwned && !gameOver) autoSkipOnline();
        }
    }, 250);
}

function autoSkipOnline() {
    if (gameOver || !gameRef) return;
    const skippedName = turn === "X" ? playerX : playerO;
    info.innerText = `⏰ ${skippedName} ran out of time!`;
    const nextTurn = turn === "X" ? "O" : "X";
    setTimeout(() => {
        if (gameOver || !gameRef) return;
        const nextEnd = Date.now() + TIMER_MAX * 1000;
        gameRef.update({ turn: nextTurn, timerEnd: nextEnd });
        writePushRequest(nextTurn, NOTIF.YOUR_TURN,
            "Your turn! 🎮", "Opponent timed out — make your move.", { roomCode });
    }, 1200);
}

// ════════════════════════════════════════════════════════════════
//  CPU — MINIMAX
// ════════════════════════════════════════════════════════════════
function minimax(b, isMax) {
    const r = checkWinner(b);
    if (r) { if (r.winner==="O") return 10; if (r.winner==="X") return -10; return 0; }
    if (isMax) {
        let best = -Infinity;
        for (let i=0;i<9;i++) { if(!b[i]){b[i]="O";best=Math.max(best,minimax(b,false));b[i]="";} }
        return best;
    } else {
        let best = Infinity;
        for (let i=0;i<9;i++) { if(!b[i]){b[i]="X";best=Math.min(best,minimax(b,true));b[i]="";} }
        return best;
    }
}

function getBestMove() {
    let bestVal=-Infinity, bestIdx=-1;
    for (let i=0;i<9;i++) {
        if (!board[i]) {
            board[i]="O";
            const val = minimax(board, false);
            board[i]="";
            if (val > bestVal) { bestVal=val; bestIdx=i; }
        }
    }
    return bestIdx;
}

function makeCPUMove() {
    if (gameOver || turn !== "O") return;
    info.innerHTML = `<span class="thinking">🤖 thinking…</span>`;
    stopTimer();
    setTimeout(() => {
        if (gameOver) return;
        const idx = getBestMove();
        if (idx === -1) return;
        board[idx] = "O";
        boxes[idx].querySelector(".boxtext").innerText = "O";
        boxes[idx].classList.add("taken");
        const result = checkWinner();
        if (result) { handleOutcome(result); return; }
        turn = "X";
        info.innerText = `Turn for ${playerX} (X)`;
        startTimer();
    }, 450);
}

// ════════════════════════════════════════════════════════════════
//  CLICK HANDLER
// ════════════════════════════════════════════════════════════════
function handleClick(e) {
    if (gameOver) return;
    const box = e.currentTarget;
    const idx = parseInt(box.dataset.index);
    if (board[idx] !== "") return;

    // ── ONLINE MODE ──
    if (mode === "online") {
        if (turn !== mySymbol) {
            showToast("Not your turn", "Wait for your opponent to play.");
            return;
        }
        board[idx] = mySymbol;
        box.querySelector(".boxtext").innerText = mySymbol;
        box.classList.add("taken");
        stopTimer();

        const result   = checkWinner(board);
        const nextTurn = mySymbol === "X" ? "O" : "X";

        if (result && result.winner !== "draw") {
            gameRef.update({
                board, turn: nextTurn,
                status: "won", winner: result.winner, winPattern: result.pattern,
                timerEnd: null
            });
        } else if (result && result.winner === "draw") {
            gameRef.update({ board, turn: nextTurn, status: "draw", timerEnd: null });
        } else {
            const nextEnd = Date.now() + TIMER_MAX * 1000;
            gameRef.update({ board, turn: nextTurn, timerEnd: nextEnd });
            // notify opponent
            const myName = mySymbol === "X" ? playerX : playerO;
            writePushRequest(nextTurn, NOTIF.YOUR_TURN,
                "Your turn! 🎮", `${myName} just played. Make your move!`, { roomCode });
            // idle reminder if opponent doesn't respond in 30s
            cancelNotif(NOTIF.IDLE_REMIND);
            sendNotification(NOTIF.IDLE_REMIND, "👀 Still waiting...",
                "Your opponent hasn't moved yet.");
        }
        return;
    }

    // ── COMPUTER / HUMAN MODE ──
    if (mode === "computer" && turn === "O") return;

    board[idx] = turn;
    box.querySelector(".boxtext").innerText = turn;
    box.classList.add("taken");

    const result = checkWinner();
    if (result) { handleOutcome(result); return; }

    turn = turn === "X" ? "O" : "X";
    info.innerText = `Turn for ${turn==="X"?playerX:playerO} (${turn})`;

    if (mode === "computer" && turn === "O") {
        makeCPUMove();
    } else {
        startTimer();
    }
}

// ════════════════════════════════════════════════════════════════
//  RESET
// ════════════════════════════════════════════════════════════════
function resetGame() {
    board    = ["","","","","","","","",""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    renderBoard(board);
    stopTimer();

    if (mode === "online") {
        info.innerText = mySymbol === "X" ? `Your turn (X)` : `Waiting for ${playerX}…`;
        if (gameRef && mySymbol === "X") {
            const endEpoch = Date.now() + TIMER_MAX * 1000;
            gameRef.update({
                board, turn: "X", status: "playing",
                winner: null, winPattern: null,
                timerEnd: endEpoch
            });
        }
    } else {
        info.innerText = `Turn for ${playerX} (X)`;
        startTimer();
    }
}

// ════════════════════════════════════════════════════════════════
//  ONLINE: CREATE ROOM
// ════════════════════════════════════════════════════════════════
function createRoom() {
    const xName = document.getElementById("playerX").value.trim();
    playerX  = xName || "Player X";
    mySymbol = "X";
    roomCode = generateCode();

    if (gameRef) gameRef.off();
    gameRef = db.ref("rooms/" + roomCode);
    isListening = false;

    const endEpoch = Date.now() + TIMER_MAX * 1000;
    gameRef.set({
        board: ["","","","","","","","",""],
        turn: "X", status: "waiting",
        playerX: playerX, playerO: "",
        timerEnd: endEpoch, winner: null, winPattern: null
    }).then(() => {
        roomCodeDisplay.textContent = roomCode;
        roomDisplay.style.display   = "block";
        onlineOptions.style.display = "none";
        startBtn.style.display      = "none";

        roomCodeDisplay.onclick = () => {
            navigator.clipboard.writeText(roomCode)
                .then(() => { roomCodeDisplay.textContent = "Copied! ✓"; setTimeout(() => roomCodeDisplay.textContent = roomCode, 1500); })
                .catch(() => {});
        };

        // wait for opponent
        gameRef.on("value", snap => {
            const data = snap.val();
            if (!data) return;
            if (data.status === "playing" && !isListening) {
                playerO = data.playerO || "Opponent";
                startOnlineGame();
            }
        });
    }).catch(e => alert("Firebase error: " + e.message));
}

// ════════════════════════════════════════════════════════════════
//  ONLINE: JOIN ROOM
// ════════════════════════════════════════════════════════════════
function joinRoom() {
    const name = document.getElementById("playerX").value.trim();
    const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
    if (!code) { alert("Enter a room code!"); return; }

    playerO  = name || "Player O";
    mySymbol = "O";
    roomCode = code;

    if (gameRef) gameRef.off();
    gameRef = db.ref("rooms/" + roomCode);
    isListening = false;

    gameRef.once("value").then(snap => {
        const data = snap.val();
        if (!data)                     { alert("Room not found! Check the code."); return; }
        if (data.status !== "waiting") { alert("Room is full or already started!"); return; }

        playerX = data.playerX || "Player X";
        return gameRef.update({ playerO: playerO, status: "playing" });
    }).then(() => {
        startOnlineGame();
    }).catch(e => alert("Connection error: " + e.message));
}

// ════════════════════════════════════════════════════════════════
//  ONLINE GAME: Firebase listener
// ════════════════════════════════════════════════════════════════
function startOnlineGame() {
    if (isListening) return;
    isListening = true;

    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    roomDisplay.style.display   = "none";
    modeBadge.textContent       = "🌐 Online";
    onlineStatus.style.display  = "block";
    onlineStatus.textContent    = `You are ${mySymbol} · Room: ${roomCode}`;
    onlineStatus.className      = "onlineStatus connected";

    renderLeaderboard();
    listenForPushRequests(gameRef);

    gameRef.off(); // clear waiting-room listener
    lastTimerEnd = null;

    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;

        board    = Array.isArray(data.board) ? data.board : ["","","","","","","","",""];
        turn     = data.turn || "X";

        renderBoard(board);

        // ── Game over ──
        if (data.status === "won") {
            stopTimer();
            gameOver = true;
            const winnerName = data.winner === "X" ? playerX : playerO;
            info.innerText = `🎉 ${winnerName} wins!`;
            imgbox.style.display = "block";
            if (Array.isArray(data.winPattern)) {
                data.winPattern.forEach(i => boxes[i].classList.add("winner"));
                drawWinLine(data.winPattern);
            }
            // only record once (the winning player's device)
            if (data.winner === mySymbol) recordWin(winnerName);
            cancelNotif(NOTIF.YOUR_TURN);
            cancelNotif(NOTIF.IDLE_REMIND);
            return;
        }

        if (data.status === "draw") {
            stopTimer();
            gameOver = true;
            info.innerText = "It's a Draw! 🤝";
            cancelNotif(NOTIF.YOUR_TURN);
            cancelNotif(NOTIF.IDLE_REMIND);
            return;
        }

        gameOver = false;

        // ── Sync timer ──
        const timerEnd = data.timerEnd || (Date.now() + TIMER_MAX * 1000);
        if (timerEnd !== lastTimerEnd) {
            lastTimerEnd = timerEnd;
            startOnlineTimer(timerEnd, turn === mySymbol);
        }

        // ── Turn display ──
        if (turn === mySymbol) {
            info.innerText = `Your turn (${mySymbol})`;
            cancelNotif(NOTIF.IDLE_REMIND);
            // notify if tab/app was backgrounded
            if (document.visibilityState !== "visible") {
                sendNotification(NOTIF.YOUR_TURN, "Your turn! 🎮",
                    "Your opponent played. Make your move!");
            }
        } else {
            const waitName = turn === "X" ? playerX : playerO;
            info.innerText = `Waiting for ${waitName}…`;
        }
    });
}

// ════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════════════════════════════
boxes.forEach((box, i) => {
    box.dataset.index = i;
    box.addEventListener("click", handleClick);
});

resetBtn.addEventListener("click", resetGame);

changePlayers.addEventListener("click", () => {
    stopTimer();
    if (gameRef) { gameRef.off(); gameRef = null; }
    isListening  = false;
    roomCode     = "";
    lastTimerEnd = null;
    gameContainer.style.display = "none";
    nameScreen.style.display    = "flex";
    onlineStatus.style.display  = "none";
    document.getElementById("playerX").value = "";
    document.getElementById("playerO").value = "";
    roomDisplay.style.display = "none";
    setMode("human");
    cancelNotif(NOTIF.YOUR_TURN);
    cancelNotif(NOTIF.IDLE_REMIND);
});

startBtn.addEventListener("click", () => {
    const xName = document.getElementById("playerX").value.trim();
    const oName = playerOInput.value.trim();
    playerX = xName || "Player X";
    playerO = mode === "computer" ? "🤖 CPU" : (oName || "Player O");
    modeBadge.textContent       = mode==="computer" ? "🤖 vs Computer" : "👥 vs Human";
    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    board    = ["","","","","","","","",""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    renderBoard(board);
    info.innerText = `Turn for ${playerX} (X)`;
    startTimer();
    renderLeaderboard();
});

// cancel notifications when user returns to app
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        cancelNotif(NOTIF.YOUR_TURN);
        cancelNotif(NOTIF.TIMER_WARN);
    }
});

// ── Initial render ─────────────────────────────────────────────
renderLeaderboard();