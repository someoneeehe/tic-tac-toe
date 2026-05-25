const db = firebase.database();

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
let turn     = "X";
let board    = ["","","","","","","","",""];
let gameOver = false;
let playerX  = "Player X";
let playerO  = "Player O";
let mode     = "human";
let mySymbol = "";
let roomCode = "";
let gameRef  = null;

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

// ── Room Code Generator ────────────────────────────────────────
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Create Room ────────────────────────────────────────────────
async function createRoom() {
    const name = document.getElementById("playerX").value.trim() || "Player X";
    roomCode   = generateCode();
    gameRef    = db.ref("games/" + roomCode);
    mySymbol   = "X";
    playerX    = name;

    await gameRef.set({
        board:   ["","","","","","","","",""],
        turn:    "X",
        playerX: name,
        playerO: "",
        status:  "waiting"
    });

    roomDisplay.style.display   = "block";
    roomCodeDisplay.textContent = roomCode;
    onlineOptions.style.display = "none";

    roomCodeDisplay.onclick = () => {
        navigator.clipboard.writeText(roomCode);
        roomCodeDisplay.textContent = "Copied!";
        setTimeout(() => roomCodeDisplay.textContent = roomCode, 1500);
    };

    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;
        if (data.status === "playing") {
            playerO = data.playerO;
            startOnlineGame();
        }
    });
}

// ── Join Room ──────────────────────────────────────────────────
async function joinRoom() {
    const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
    const name = document.getElementById("playerX").value.trim() || "Player O";

    if (!code) { alert("Enter a room code!"); return; }

    gameRef  = db.ref("games/" + code);
    roomCode = code;

    const snap = await gameRef.once("value");
    const data = snap.val();

    if (!data)                    { alert("Room not found! Check the code."); return; }
    if (data.status !== "waiting"){ alert("Room is full or game already started!"); return; }

    mySymbol = "O";
    playerX  = data.playerX;
    playerO  = name;

    await gameRef.update({ playerO: name, status: "playing" });
    startOnlineGame();
}

// ── Start Online Game ──────────────────────────────────────────
function startOnlineGame() {
    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    modeBadge.textContent       = `🌐 Online — You are ${mySymbol}`;
    onlineStatus.style.display  = "block";
    onlineStatus.className      = "onlineStatus connected";
    onlineStatus.textContent    = `🟢 Connected — Room: ${roomCode}`;

    resetGame();

    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;

        board = data.board;
        turn  = data.turn;

        boxes.forEach((box, i) => {
            box.querySelector(".boxtext").innerText = board[i];
        });

        if (data.status === "won") {
            const winnerName = data.winner === "X" ? playerX : playerO;
            info.innerText = `🎉 ${winnerName} wins!`;
            gameOver = true;
            if (data.winPattern) {
                data.winPattern.forEach(i => boxes[i].classList.add("winner"));
                drawWinLine(data.winPattern);
            }
            imgbox.style.display = "block";
            addWin(winnerName);
            renderLeaderboard();
        } else if (data.status === "draw") {
            info.innerText = "It's a Draw!";
            gameOver = true;
        } else {
            gameOver = false;
            if (turn === mySymbol) {
                info.innerText = `Your turn (${mySymbol})`;
            } else {
                const nextName = turn === "X" ? playerX : playerO;
                info.innerHTML = `<span class="thinking">⏳ ${nextName} is thinking...</span>`;
            }
        }
    });
}

// ── Winning Line ───────────────────────────────────────────────
function getLineCoords(pattern) {
    const centers = [
        [16.7,16.7],[50,16.7],[83.3,16.7],
        [16.7,50],  [50,50],  [83.3,50],
        [16.7,83.3],[50,83.3],[83.3,83.3]
    ];
    return {
        x1: centers[pattern[0]][0], y1: centers[pattern[0]][1],
        x2: centers[pattern[2]][0], y2: centers[pattern[2]][1]
    };
}

function drawWinLine(pattern) {
    const old = document.getElementById("winLine");
    if (old) old.remove();
    const { x1, y1, x2, y2 } = getLineCoords(pattern);
    const svg  = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "winLine");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    svg.appendChild(line);
    boardWrap.appendChild(svg);
}

// ── Leaderboard ────────────────────────────────────────────────
function getLeaderboard() {
    return JSON.parse(localStorage.getItem("tttLeaderboard") || "{}");
}
function saveLeaderboard(lb) {
    localStorage.setItem("tttLeaderboard", JSON.stringify(lb));
}
function addWin(name) {
    const lb = getLeaderboard();
    lb[name] = (lb[name] || 0) + 1;
    saveLeaderboard(lb);
}
function renderLeaderboard() {
    const lb     = getLeaderboard();
    const sorted = Object.entries(lb).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        lbList.innerHTML = '<p class="lb-empty">No wins yet. Start playing!</p>';
        return;
    }
    const maxWins    = sorted[0][1];
    const medalClass = ["gold","silver","bronze"];
    lbList.innerHTML = sorted.map(([name, wins], i) => {
        const initials  = name.slice(0, 2).toUpperCase();
        const pct       = Math.round((wins / maxWins) * 100);
        const rankClass = i < 3 ? medalClass[i] : "";
        return `
        <div class="lb-row">
            <span class="lb-rank ${rankClass}">${i + 1}</span>
            <div class="lb-avatar">${initials}</div>
            <div style="flex:1">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span class="lb-name">${name}</span>
                    <span class="lb-wins">${wins} win${wins !== 1 ? "s" : ""}</span>
                </div>
                <div class="lb-bar-wrap">
                    <div class="lb-bar" style="width:${pct}%"></div>
                </div>
            </div>
        </div>`;
    }).join("");
}

// ── Check Winner ───────────────────────────────────────────────
function checkWinner(b = board) {
    for (let pattern of winPatterns) {
        const [a, bc, c] = pattern;
        if (b[a] && b[a] === b[bc] && b[a] === b[c]) {
            return { winner: b[a], pattern };
        }
    }
    if (b.every(cell => cell !== "")) return { winner: "draw", pattern: null };
    return null;
}

// ── Minimax ────────────────────────────────────────────────────
function minimax(b, isAITurn) {
    const result = checkWinner(b);
    if (result) {
        if (result.winner === "O") return +1;
        if (result.winner === "X") return -1;
        return 0;
    }
    const scores = [];
    for (let i = 0; i < 9; i++) {
        if (b[i] === "") {
            b[i] = isAITurn ? "O" : "X";
            scores.push(minimax(b, !isAITurn));
            b[i] = "";
        }
    }
    return isAITurn ? Math.max(...scores) : Math.min(...scores);
}

function getBestMove() {
    let bestScore = -Infinity;
    let bestIndex = -1;
    for (let i = 0; i < 9; i++) {
        if (board[i] === "") {
            board[i] = "O";
            const score = minimax(board, false);
            board[i] = "";
            if (score > bestScore) { bestScore = score; bestIndex = i; }
        }
    }
    return bestIndex;
}

// ── Handle Outcome ─────────────────────────────────────────────
function handleOutcome(result) {
    gameOver = true;
    if (result.winner === "draw") {
        info.innerText = "It's a Draw!";
        if (mode === "online") gameRef.update({ status: "draw" });
    } else {
        const winnerName = result.winner === "X" ? playerX : playerO;
        info.innerText = `🎉 ${winnerName} wins!`;
        imgbox.style.display = "block";
        result.pattern.forEach(i => boxes[i].classList.add("winner"));
        drawWinLine(result.pattern);
        if (mode === "online") {
            gameRef.update({
                status:     "won",
                winner:     result.winner,
                winPattern: result.pattern
            });
        } else {
            addWin(winnerName);
            renderLeaderboard();
        }
    }
}

// ── Handle Click ───────────────────────────────────────────────
function handleClick(e) {
    if (gameOver) return;
    if (mode === "computer" && turn === "O") return;
    if (mode === "online" && turn !== mySymbol) return;

    const box = e.currentTarget;
    const idx = parseInt(box.dataset.index);
    if (board[idx]) return;

    board[idx] = turn;
    box.querySelector(".boxtext").innerText = turn;

    const result = checkWinner();
    if (result) {
        handleOutcome(result);
        if (mode === "online") gameRef.update({ board });
        return;
    }

    turn = turn === "X" ? "O" : "X";

    if (mode === "online") {
        gameRef.update({ board, turn });
    } else if (mode === "computer" && turn === "O" && !gameOver) {
        info.innerHTML = `<span class="thinking">🤖 Computer is thinking...</span>`;
        setTimeout(() => {
            const aiIdx = getBestMove();
            board[aiIdx] = "O";
            boxes[aiIdx].querySelector(".boxtext").innerText = "O";
            const aiResult = checkWinner();
            if (aiResult) {
                handleOutcome(aiResult);
            } else {
                turn = "X";
                info.innerText = `Turn for ${playerX} (X)`;
            }
        }, 450);
    } else {
        const nextName = turn === "X" ? playerX : playerO;
        info.innerText = `Turn for ${nextName} (${turn})`;
    }
}

// ── Reset ──────────────────────────────────────────────────────
function resetGame() {
    board    = ["","","","","","","","",""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    info.innerText = `Turn for ${playerX} (X)`;
    boxes.forEach(box => {
        box.querySelector(".boxtext").innerText = "";
        box.classList.remove("winner");
    });
    const old = document.getElementById("winLine");
    if (old) old.remove();
    if (mode === "online" && gameRef) {
        gameRef.update({
            board:  ["","","","","","","","",""],
            turn:   "X",
            status: "playing"
        });
    }
}

// ── Event Listeners ────────────────────────────────────────────
boxes.forEach((box, i) => {
    box.dataset.index = i;
    box.addEventListener("click", handleClick);
});

resetBtn.addEventListener("click", resetGame);

changePlayers.addEventListener("click", () => {
    if (gameRef) gameRef.off();
    gameContainer.style.display = "none";
    nameScreen.style.display    = "flex";
    onlineStatus.style.display  = "none";
    setMode("human");
});

startBtn.addEventListener("click", () => {
    const xVal = document.getElementById("playerX").value.trim();
    const oVal = playerOInput.value.trim();
    playerX = xVal || "Player X";
    playerO = mode === "computer" ? "Computer 🤖" : (oVal || "Player O");
    modeBadge.textContent       = mode === "computer" ? "🤖 vs Computer" : "👥 vs Human";
    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    resetGame();
    renderLeaderboard();
});

clearLb.addEventListener("click", () => {
    localStorage.removeItem("tttLeaderboard");
    renderLeaderboard();
});