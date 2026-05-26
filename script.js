// ── Firebase Database ──────────────────────────────────────────
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
let turn        = "X";
let board       = ["","","","","","","","",""];
let gameOver    = false;
let playerX     = "Player X";
let playerO     = "Player O";
let mode        = "human";
let mySymbol    = "";
let roomCode    = "";
let gameRef     = null;
let timerInterval = null;
let timeLeft      = 10;
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

// ── Room Code Generator ────────────────────────────────────────
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Render Board from array ────────────────────────────────────
// This redraws every cell from a board array
function renderBoard(b) {
    boxes.forEach((box, i) => {
        const span = box.querySelector(".boxtext");
        span.innerText = b[i] || "";
        box.classList.remove("winner");
    });
    const old = document.getElementById("winLine");
    if (old) old.remove();
}

// ── Create Room ────────────────────────────────────────────────
async function createRoom() {
    const name = document.getElementById("playerX").value.trim() || "Player X";
    roomCode   = generateCode();
    mySymbol   = "X";
    playerX    = name;
    playerO    = "Opponent";

    // stop any old listener
    if (gameRef) gameRef.off();

    gameRef = db.ref("games/" + roomCode);

    try {
        await gameRef.set({
            board:      ["","","","","","","","",""],
            turn:       "X",
            playerX:    name,
            playerO:    "",
            status:     "waiting",
            winPattern: null,
            winner:     null
        });
        console.log("Room created:", roomCode);
    } catch(e) {
        alert("Firebase error: " + e.message);
        return;
    }

    roomDisplay.style.display   = "block";
    roomCodeDisplay.textContent = roomCode;
    onlineOptions.style.display = "none";

    roomCodeDisplay.onclick = () => {
        navigator.clipboard.writeText(roomCode).catch(() => {});
        roomCodeDisplay.textContent = "Copied!";
        setTimeout(() => roomCodeDisplay.textContent = roomCode, 1500);
    };

    // wait for opponent
    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;
        if (data.status === "playing" && !isListening) {
            playerO = data.playerO || "Opponent";
            launchOnlineGame();
        }
    });
}

// ── Join Room ──────────────────────────────────────────────────
async function joinRoom() {
    const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
    const name = document.getElementById("playerX").value.trim() || "Player O";

    if (!code) { alert("Enter a room code!"); return; }

    // stop any old listener
    if (gameRef) gameRef.off();

    gameRef  = db.ref("games/" + code);
    roomCode = code;

    let data;
    try {
        const snap = await gameRef.once("value");
        data = snap.val();
    } catch(e) {
        alert("Firebase error: " + e.message);
        return;
    }

    if (!data) {
        alert("Room not found! Check the code.");
        return;
    }
    if (data.status !== "waiting") {
        alert("Room is full or game already started!");
        return;
    }

    mySymbol = "O";
    playerX  = data.playerX || "Player X";
    playerO  = name;

    try {
        await gameRef.update({ playerO: name, status: "playing" });
        console.log("Joined room:", code);
    } catch(e) {
        alert("Firebase error: " + e.message);
        return;
    }

    launchOnlineGame();
}

// ── Launch Online Game ─────────────────────────────────────────
function launchOnlineGame() {
    if (isListening) return; // prevent double attach
    isListening = true;

    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    modeBadge.textContent       = `🌐 Online — You are ${mySymbol}`;
    onlineStatus.style.display  = "block";
    onlineStatus.className      = "onlineStatus connected";
    onlineStatus.textContent    = `🟢 Connected — Room: ${roomCode}`;

    // reset local state
    board    = ["","","","","","","","",""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    renderBoard(board);

    // detach old listener then reattach fresh
    gameRef.off();
    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;

        console.log("Firebase update:", data.status, "turn:", data.turn);

        // sync board
        board = Array.isArray(data.board) ? data.board : ["","","","","","","","",""];
        turn  = data.turn || "X";

        // always re-render from firebase data
        renderBoard(board);

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
            addWin(winnerName);
            renderLeaderboard();

        } else if (data.status === "draw") {
            stopTimer();
            gameOver = true;
            info.innerText = "It's a Draw!";

        } else {
            gameOver = false;
            if (turn === mySymbol) {
                info.innerText = `Your turn (${mySymbol})`;
            } else {
                const opponentName = mySymbol === "X" ? playerO : playerX;
                info.innerHTML = `<span class="thinking">⏳ ${opponentName} is thinking...</span>`;
            }
            startTimer();
        }
    });

    renderLeaderboard();
}

// ── Winning Line SVG ───────────────────────────────────────────
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
    const svg  = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("id","winLine");
    svg.setAttribute("viewBox","0 0 100 100");
    svg.setAttribute("preserveAspectRatio","none");
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
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

// ── Handle Outcome (local games only) ─────────────────────────
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
        drawWinLine(result.pattern);
        addWin(winnerName);
        renderLeaderboard();
    }
}
//--Turn Timer
function startTimer() {
    stopTimer();
    timeLeft = TIMER_MAX;
    updateTimerUI(timeLeft);

    const wrap = document.getElementById("timerWrap");
    const numE1 = document.getElementById("timerNum");
    const circle = document.getElementById("timerCircle");
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
    const numE1 = document.getElementById("timerNum");
    const circle = document.getElementById("timerCircle");
    if (!numE1 || !circle) return;

    numE1.textContent = t;

    const offset = Math.round(((TIMER_MAX - t) / TIMER_MAX) * 100);
    circle.style.strokeDashoffset = offset;

    if (t <= 3) {
        numE1.classList.add("urgent");
        circle.classList.add("urgent");
    } else {
        numE1.classList.remove("urgent");
        circle.classList.remove("urgent");
    }
}

function autoSkipTurn() {
    if (gameOver) return;
    const currentName = turn === "X" ? playerX : playerO;
    info.innerText = `⏰ ${currentName} ran out of time!`;

    setTimeout(() => {
        if (mode === "online") {
            if (turn === mySymbol) {
                const nextTurn = mySymbol === "X" ? "O" : "X";
                gameRef.update({ turn: nextTurn });
            }
            return;
        }

        turn = turn === "X" ? "O" : "X";
        const nextName = turn === "X" ? playerX : playerO;

        if (mode === "computer" && turn === "O") {
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
                    startTimer();
                }
            }, 450);
        } else {
            info.innerText = `Turn for ${nextName} (${turn})`;
            startTimer();
        }
    }, 1000);
}

// ── Handle Click ───────────────────────────────────────────────
function handleClick(e) {
    if (gameOver) return;

    const box = e.currentTarget;
    const idx = parseInt(box.dataset.index);
    if (board[idx] !== "") return; // cell already taken

    // ── ONLINE MODE ──
    if (mode === "online") {
        if (turn !== mySymbol) {
            console.log("Not your turn. You are", mySymbol, "current turn:", turn);
            return;
        }

        // optimistic local update
        board[idx] = mySymbol;
        box.querySelector(".boxtext").innerText = mySymbol;

        const result = checkWinner(board);
        const nextTurn = mySymbol === "X" ? "O" : "X";

        if (result && result.winner !== "draw") {
            // write win to firebase
            gameRef.update({
                board:      board,
                turn:       nextTurn,
                status:     "won",
                winner:     result.winner,
                winPattern: result.pattern
            });
        } else if (result && result.winner === "draw") {
            gameRef.update({
                board:  board,
                turn:   nextTurn,
                status: "draw"
            });
        } else {
            // normal move — write board + new turn
            gameRef.update({
                board: board,
                turn:  nextTurn
            });
        }
        return;
    }

    // ── COMPUTER MODE ──
    if (mode === "computer" && turn === "O") return;

    // ── LOCAL / COMPUTER MOVE ──
    board[idx] = turn;
    box.querySelector(".boxtext").innerText = turn;

    const result = checkWinner();
    if (result) {
        handleOutcome(result);
        return;
    }

    turn = turn === "X" ? "O" : "X";

    if (mode === "online") {
        gameRef.update({ board, turn });
    } else if (mode === "computer" && turn === "O" && !gameOver) {
        stopTimer();
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
                startTimer();
            }
        }, 450);
    } else {
        const nextName = turn === "X" ? playerX : playerO;
        info.innerText = `Turn for ${nextName} (${turn})`;
        startTimer();
    }
}

// ── Reset ──────────────────────────────────────────────────────
function resetGame() {
    board    = ["","","","","","","","",""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    info.innerText = mode === "online"
        ? (mySymbol === "X" ? "Your turn (X)" : `⏳ Waiting for X...`)
        : `Turn for ${playerX} (X)`;
    renderBoard(board);
    stopTimer();
    if (mode !== "online") startTimer();

    if (mode === "online" && gameRef) {
        gameRef.update({
            board:      ["","","","","","","","",""],
            turn:       "X",
            status:     "playing",
            winner:     null,
            winPattern: null
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
    stopTimer();
    if (gameRef) { gameRef.off(); gameRef = null; }
    isListening = false;
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
    board    = ["","","","","","","","",""];
    turn     = "X";
    gameOver = false;
    imgbox.style.display = "none";
    info.innerText = `Turn for ${playerX} (X)`;
    renderBoard(board);
    renderLeaderboard();
    startTimer();
});

clearLb.addEventListener("click", () => {
    localStorage.removeItem("tttLeaderboard");
    renderLeaderboard();
});