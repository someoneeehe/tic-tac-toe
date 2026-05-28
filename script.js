// ── Firebase Database ──────────────────────────────────────────
const db = firebase.database();

// ── Local Notifications ───────────────────────────────────────
let notificationsAllowed = false;

async function setupLocalNotifications() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    const { LocalNotifications } = Capacitor.Plugins;
    const perm = await LocalNotifications.requestPermissions();
    notificationsAllowed = perm && perm.display === "granted";
    LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
        const data = action.notification.extra;
        if (data && data.type === "your_turn") {
            console.log("User tapped your turn notification");
        }
        if (data && data.type === "invite") {
            nameScreen.style.display = "flex";
            gameContainer.style.display = "none";
            setMode("online");
            if (data.roomCode) {
                document.getElementById("roomCodeInput").value = data.roomCode;
            }
        }
    });
}

async function sendLocalNotification(id, title, body, extra = {}, delaySeconds = 1) {
    if (!notificationsAllowed) return;
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    const { LocalNotifications } = Capacitor.Plugins;
    try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (e) {}
    await LocalNotifications.schedule({
        notifications: [{
            id, title, body, extra,
            schedule: { at: new Date(Date.now() + delaySeconds * 1000) },
            sound: "default",
            smallIcon: "ic_launcher",
            actionTypeId: "",
            channelId: "tictactoe"
        }]
    });
}

async function cancelNotification(id) {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    const { LocalNotifications } = Capacitor.Plugins;
    try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (e) {}
}

const NOTIF = { YOUR_TURN: 1, TIMER_WARN: 2, OPPONENT_WIN: 3, DRAW: 4, INVITE: 5, IDLE_REMIND: 6 };
setupLocalNotifications();

// ── DOM refs ───────────────────────────────────────────────────
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

// ── State ──────────────────────────────────────────────────────
let turn      = "X";
let board     = ["", "", "", "", "", "", "", "", ""];
let gameOver  = false;
let playerX   = "Player X";
let playerO   = "Player O";
let mode      = "human";
let mySymbol  = "";
let roomCode  = "";
let gameRef   = null;
let timerInterval = null;
let timeLeft  = 10;
const TIMER_MAX = 10;
let isListening = false;

const winPatterns = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
];

// ── Dark Mode ──────────────────────────────────────────────────
function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    darkToggle.textContent = dark ? "☀️" : "🌙";
    localStorage.setItem("tttDark", dark ? "1" : "0");
}
darkToggle.addEventListener("click", () => {
    applyTheme(!document.body.classList.contains("dark"));
});
applyTheme(localStorage.getItem("tttDark") === "1");

// ── Mode Selector ──────────────────────────────────────────────
function setMode(m) {
    mode = m;
    document.getElementById("btnHuman").classList.toggle("active", m === "human");
    document.getElementById("btnCPU").classList.toggle("active", m === "computer");
    document.getElementById("btnOnline").classList.toggle("active", m === "online");
    playerOInput.style.display  = m === "human"  ? "block" : "none";
    onlineOptions.style.display = m === "online" ? "flex"  : "none";
    startBtn.style.display      = m === "online" ? "none"  : "block";
    roomDisplay.style.display   = "none";
}

// ── Leaderboard ────────────────────────────────────────────────
/**
 * FIX: leaderboard was never saved/loaded or rendered.
 * Now it reads from localStorage, renders sorted rows, and
 * is updated on every win.
 */
function loadLeaderboard() {
    try {
        return JSON.parse(localStorage.getItem("tttLeaderboard") || "{}");
    } catch {
        return {};
    }
}

function saveLeaderboard(lb) {
    localStorage.setItem("tttLeaderboard", JSON.stringify(lb));
}

function recordWin(name) {
    if (!name || name === "draw") return;
    const lb = loadLeaderboard();
    lb[name] = (lb[name] || 0) + 1;
    saveLeaderboard(lb);
    renderLeaderboard();
}

function renderLeaderboard() {
    const lb = loadLeaderboard();
    const entries = Object.entries(lb).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        lbList.innerHTML = `<div class="lb-empty">No games played yet</div>`;
        return;
    }
    const maxWins = entries[0][1];
    const medals  = ["gold", "silver", "bronze"];
    lbList.innerHTML = entries.map(([name, wins], i) => {
        const rankClass = medals[i] || "";
        const rankLabel = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
        const pct = maxWins > 0 ? Math.round((wins / maxWins) * 100) : 0;
        const initials = name.slice(0, 2).toUpperCase();
        return `
        <div class="lb-row">
            <span class="lb-rank ${rankClass}">${rankLabel}</span>
            <div class="lb-avatar">${initials}</div>
            <div class="lb-name-wrap" style="flex:1;">
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

// ── Room Code Generator ────────────────────────────────────────
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Render Board ───────────────────────────────────────────────
function renderBoard(b) {
    boxes.forEach((box, i) => {
        box.querySelector(".boxtext").innerText = b[i] || "";
        box.classList.remove("winner");
    });
    const old = document.getElementById("winLine");
    if (old) old.remove();
}

// ── Check Winner ───────────────────────────────────────────────
function checkWinner(b = board) {
    for (let pattern of winPatterns) {
        const [a, bb, c] = pattern;
        if (b[a] && b[a] === b[bb] && b[a] === b[c]) {
            return { winner: b[a], pattern };
        }
    }
    if (b.every(cell => cell !== "")) {
        return { winner: "draw", pattern: null };
    }
    return null;
}

// ── Draw Win Line ──────────────────────────────────────────────
/**
 * FIX: win line SVG was built but never drawn onto the board.
 */
function drawWinLine(pattern) {
    const old = document.getElementById("winLine");
    if (old) old.remove();
    if (!pattern) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "winLine");
    svg.setAttribute("viewBox", "0 0 330 330");
    svg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";

    const cellW = 110, cellH = 110;
    const cx = i => (i % 3) * cellW + cellW / 2;
    const cy = i => Math.floor(i / 3) * cellH + cellH / 2;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", cx(pattern[0]));
    line.setAttribute("y1", cy(pattern[0]));
    line.setAttribute("x2", cx(pattern[2]));
    line.setAttribute("y2", cy(pattern[2]));
    svg.appendChild(line);
    boardWrap.appendChild(svg);
}

// ── Handle Outcome ─────────────────────────────────────────────
function handleOutcome(result) {
    stopTimer();
    gameOver = true;

    if (result.winner === "draw") {
        info.innerText = "It's a Draw!";
    } else {
        const winnerName = result.winner === "X" ? playerX : playerO;
        info.innerText = `🎉 ${winnerName} wins!`;
        imgbox.style.display = "block";
        result.pattern.forEach(i => boxes[i].classList.add("winner"));
        drawWinLine(result.pattern);          // FIX: actually draw the line
        recordWin(winnerName);                // FIX: save win to leaderboard
    }
}

// ── Timer ──────────────────────────────────────────────────────
function startTimer() {
    stopTimer();
    timeLeft = TIMER_MAX;
    updateTimerUI(timeLeft);
    const wrap = document.getElementById("timerWrap");
    wrap.style.display = "flex";
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerUI(timeLeft);
        if (timeLeft <= 0) {
            stopTimer();
            autoSkipTurn();
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    const wrap = document.getElementById("timerWrap");
    if (wrap) wrap.style.display = "none";
}

function updateTimerUI(t) {
    const numEl  = document.getElementById("timerNum");
    const circle = document.getElementById("timerCircle");
    if (!numEl || !circle) return;
    numEl.textContent = t;
    // FIX: circumference of r=16 circle ≈ 100.5; dasharray was hardcoded 100.
    // Use correct circumference so the ring depletes accurately.
    const circ  = 2 * Math.PI * 16;   // ≈ 100.53
    const offset = ((TIMER_MAX - t) / TIMER_MAX) * circ;
    circle.style.strokeDasharray  = circ;
    circle.style.strokeDashoffset = offset;

    if (t <= 3) {
        numEl.classList.add("urgent");
        circle.classList.add("urgent");
        if (t === 3 && mode === "online" && turn === mySymbol) {
            sendLocalNotification(NOTIF.TIMER_WARN, "Hurry up! ⏰", "Only 3 seconds left!", { type: "timer_warning", roomCode }, 0);
        }
    } else {
        numEl.classList.remove("urgent");
        circle.classList.remove("urgent");
    }
}

function autoSkipTurn() {
    if (gameOver) return;
    const currentName = turn === "X" ? playerX : playerO;
    info.innerText = `⏰ ${currentName} ran out of time!`;

    setTimeout(() => {
        if (mode === "online") {
            const nextTurn = turn === "X" ? "O" : "X";
            gameRef.update({ board, turn: nextTurn });
            return;
        }
        turn = turn === "X" ? "O" : "X";
        const nextName = turn === "X" ? playerX : playerO;
        info.innerText = `Turn for ${nextName} (${turn})`;

        // FIX: don't run CPU move on a skipped CPU turn immediately —
        // the CPU turn starts fresh after the timeout.
        if (mode === "computer" && turn === "O") {
            makeCPUMove();
        } else {
            startTimer();
        }
    }, 1200);
}

// ── Computer (AI) Opponent ─────────────────────────────────────
/**
 * FIX: CPU opponent was completely missing. Added minimax AI.
 */
function minimax(b, isMaximising) {
    const result = checkWinner(b);
    if (result) {
        if (result.winner === "O") return  10;
        if (result.winner === "X") return -10;
        return 0; // draw
    }
    if (isMaximising) {
        let best = -Infinity;
        for (let i = 0; i < 9; i++) {
            if (b[i] === "") {
                b[i] = "O";
                best = Math.max(best, minimax(b, false));
                b[i] = "";
            }
        }
        return best;
    } else {
        let best = Infinity;
        for (let i = 0; i < 9; i++) {
            if (b[i] === "") {
                b[i] = "X";
                best = Math.min(best, minimax(b, true));
                b[i] = "";
            }
        }
        return best;
    }
}

function getBestMove() {
    let bestVal = -Infinity, bestIdx = -1;
    for (let i = 0; i < 9; i++) {
        if (board[i] === "") {
            board[i] = "O";
            const val = minimax(board, false);
            board[i] = "";
            if (val > bestVal) { bestVal = val; bestIdx = i; }
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

        const result = checkWinner();
        if (result) { handleOutcome(result); return; }

        turn = "X";
        info.innerText = `Turn for ${playerX} (X)`;
        startTimer();
    }, 400);
}

// ── Handle Click ───────────────────────────────────────────────
function handleClick(e) {
    if (gameOver) return;
    const box = e.currentTarget;
    const idx = parseInt(box.dataset.index);
    if (board[idx] !== "") return;

    // ONLINE MODE
    if (mode === "online") {
        if (turn !== mySymbol) return;
        board[idx] = mySymbol;
        box.querySelector(".boxtext").innerText = mySymbol;
        const result  = checkWinner(board);
        const nextTurn = mySymbol === "X" ? "O" : "X";
        if (result && result.winner !== "draw") {
            gameRef.update({ board, turn: nextTurn, status: "won", winner: result.winner, winPattern: result.pattern });
        } else if (result && result.winner === "draw") {
            gameRef.update({ board, turn: nextTurn, status: "draw" });
        } else {
            gameRef.update({ board, turn: nextTurn });
        }
        return;
    }

    // LOCAL MODES (human & computer)
    // FIX: block clicks during CPU turn
    if (mode === "computer" && turn === "O") return;

    board[idx] = turn;
    box.querySelector(".boxtext").innerText = turn;

    const result = checkWinner();
    if (result) { handleOutcome(result); return; }

    turn = turn === "X" ? "O" : "X";
    const nextName = turn === "X" ? playerX : playerO;
    info.innerText = `Turn for ${nextName} (${turn})`;

    if (mode === "computer" && turn === "O") {
        makeCPUMove();
    } else {
        startTimer();
    }
}

// ── Reset ──────────────────────────────────────────────────────
function resetGame() {
    board    = ["", "", "", "", "", "", "", "", ""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    renderBoard(board);
    info.innerText = `Turn for ${playerX} (X)`;

    if (mode === "online" && gameRef) {
        // FIX: only the room creator (X) should reset in online mode
        if (mySymbol === "X") {
            gameRef.update({ board, turn: "X", status: "playing" });
        }
    } else {
        stopTimer();
        startTimer();
    }
}

// ── Change Players ─────────────────────────────────────────────
/**
 * FIX: changePlayers button had no handler — wired up here.
 */
changePlayers.addEventListener("click", () => {
    // Detach online listeners before going back
    if (gameRef && isListening) {
        gameRef.off();
        isListening = false;
        gameRef = null;
        roomCode = "";
    }
    stopTimer();
    gameContainer.style.display = "none";
    nameScreen.style.display    = "flex";
    // Reset mode UI back to default
    setMode("human");
    document.getElementById("playerX").value = "";
    document.getElementById("playerO").value = "";
    roomDisplay.style.display = "none";
    onlineStatus.style.display = "none";
});

// ── Start Game ─────────────────────────────────────────────────
/**
 * FIX: startBtn only showed the gameContainer but never initialised state,
 * never wired player names, never showed the leaderboard.
 */
startBtn.addEventListener("click", () => {
    const xName = document.getElementById("playerX").value.trim();
    const oName = document.getElementById("playerO").value.trim();

    playerX = xName || "Player X";
    playerO = mode === "computer" ? "🤖 CPU" : (oName || "Player O");

    nameScreen.style.display  = "none";
    gameContainer.style.display = "flex";

    modeBadge.textContent =
        mode === "computer" ? "🤖 vs Computer" :
        mode === "human"    ? "👥 vs Human"    : "🌐 Online";

    resetGame();
    renderLeaderboard();   // FIX: show leaderboard on game start
});

// ── Online: Create Room ────────────────────────────────────────
/**
 * FIX: createRoom / joinRoom were called but never defined in original
 * script. Full implementation below using Firebase Realtime Database.
 */
function createRoom() {
    const xName = document.getElementById("playerX").value.trim();
    playerX  = xName || "Player X";
    mySymbol = "X";
    roomCode = generateCode();

    gameRef = db.ref("rooms/" + roomCode);
    gameRef.set({
        board:  ["", "", "", "", "", "", "", "", ""],
        turn:   "X",
        status: "waiting",
        playerX: playerX,
        playerO: ""
    });

    roomCodeDisplay.textContent    = roomCode;
    roomDisplay.style.display      = "block";
    startBtn.style.display         = "none";

    // Copy code to clipboard on click
    roomCodeDisplay.onclick = () => {
        navigator.clipboard.writeText(roomCode).catch(() => {});
    };

    // Wait for opponent to join
    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;
        if (data.status === "playing" && !isListening) {
            playerO = data.playerO || "Player O";
            startOnlineGame();
        }
    });
}

function joinRoom() {
    const oName = document.getElementById("playerX").value.trim();
    const code  = document.getElementById("roomCodeInput").value.trim().toUpperCase();
    if (!code) { alert("Enter a room code."); return; }

    playerO  = oName || "Player O";
    mySymbol = "O";
    roomCode = code;
    gameRef  = db.ref("rooms/" + roomCode);

    gameRef.once("value").then(snap => {
        const data = snap.val();
        if (!data) { alert("Room not found. Check the code."); return; }
        if (data.status !== "waiting") { alert("Room is already full or game in progress."); return; }

        playerX = data.playerX || "Player X";

        gameRef.update({ playerO: playerO, status: "playing" });

        startOnlineGame();
    }).catch(() => alert("Could not connect. Check your internet connection."));
}

function startOnlineGame() {
    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    roomDisplay.style.display   = "none";
    modeBadge.textContent = "🌐 Online";
    onlineStatus.style.display  = "block";
    onlineStatus.textContent    = `You are ${mySymbol} · Room: ${roomCode}`;
    onlineStatus.className      = "onlineStatus connected";
    renderLeaderboard();

    if (isListening) return;
    isListening = true;

    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;

        board    = data.board || ["", "", "", "", "", "", "", "", ""];
        turn     = data.turn  || "X";
        gameOver = false;

        renderBoard(board);

        if (data.status === "won") {
            gameOver = true;
            stopTimer();
            const winnerName = data.winner === "X" ? playerX : playerO;
            info.innerText = `🎉 ${winnerName} wins!`;
            imgbox.style.display = "block";
            if (data.winPattern) {
                data.winPattern.forEach(i => boxes[i].classList.add("winner"));
                drawWinLine(data.winPattern);
            }
            // FIX: record win for online mode too
            if (mySymbol === "X") recordWin(winnerName);
            return;
        }

        if (data.status === "draw") {
            gameOver = true;
            stopTimer();
            info.innerText = "It's a Draw!";
            return;
        }

        // Update turn display
        const currentName = turn === "X" ? playerX : playerO;
        if (turn === mySymbol) {
            info.innerText = `Your turn (${mySymbol})`;
            startTimer();
            sendLocalNotification(NOTIF.YOUR_TURN, "Your turn! 🎮", "Make your move in TicTacToe.", { type: "your_turn", roomCode }, 0);
        } else {
            info.innerText = `Waiting for ${currentName}…`;
            stopTimer();
        }
    });
}

// ── Boxes setup ────────────────────────────────────────────────
boxes.forEach((box, i) => {
    box.dataset.index = i;
    box.addEventListener("click", handleClick);
});

resetBtn.addEventListener("click", resetGame);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        cancelNotification(NOTIF.YOUR_TURN);
        cancelNotification(NOTIF.TIMER_WARN);
    }
});

// ── Initial render ─────────────────────────────────────────────
renderLeaderboard();