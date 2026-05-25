const boxes         = document.querySelectorAll(".box");
const info          = document.getElementById("info");
const resetBtn      = document.getElementById("reset");
const changePlayers = document.getElementById("changePlayers");
const imgbox        = document.getElementById("imgbox");
const gameContainer = document.getElementById("gameContainer");
const nameScreen    = document.getElementById("nameScreen");
const startBtn      = document.getElementById("startBtn");
const lbList        = document.getElementById("lbList");
const clearLb       = document.getElementById("clearLb");
const darkToggle    = document.getElementById("darkToggle");
const boardWrap     = document.querySelector(".board-wrap");
const modeBadge     = document.getElementById("modeBadge");
const playerOInput  = document.getElementById("playerO");

let turn     = "X";
let board    = ["","","","","","","","",""];
let gameOver = false;
let playerX  = "Player X";
let playerO  = "Computer";
let mode     = "human"; // "human" or "computer"

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

    // show/hide Player O name input
    if (m === "computer") {
        playerOInput.classList.add("hidden");
        playerOInput.value = "";
    } else {
        playerOInput.classList.remove("hidden");
    }
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
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
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
    const lb = getLeaderboard();
    const sorted = Object.entries(lb).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        lbList.innerHTML = '<p class="lb-empty">No wins yet. Start playing!</p>';
        return;
    }
    const maxWins = sorted[0][1];
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

// ── checkWinner (updated to accept any board) ──────────────────
// KEY CHANGE: accepts a board parameter so minimax can
// check winners on simulated boards, not just the real one
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

// ── Minimax Algorithm ──────────────────────────────────────────
// isAITurn = true  → AI is placing "O", wants to MAXIMISE score
// isAITurn = false → Human is placing "X", wants to MINIMISE score
function minimax(b, isAITurn) {
    // Step 1: check if game is already over (base case)
    const result = checkWinner(b);
    if (result) {
        if (result.winner === "O") return +1;  // AI wins
        if (result.winner === "X") return -1;  // Human wins
        return 0;                               // Draw
    }

    // Step 2: try every empty cell and collect scores
    const scores = [];
    for (let i = 0; i < 9; i++) {
        if (b[i] === "") {
            b[i] = isAITurn ? "O" : "X"; // place piece
            scores.push(minimax(b, !isAITurn)); // recurse with flipped turn
            b[i] = ""; // UNDO move (backtrack)
        }
    }

    // Step 3: AI picks max, human picks min
    return isAITurn ? Math.max(...scores) : Math.min(...scores);
}

// ── Get Best Move for AI ───────────────────────────────────────
function getBestMove() {
    let bestScore = -Infinity;
    let bestIndex = -1;

    for (let i = 0; i < 9; i++) {
        if (board[i] === "") {
            board[i] = "O";                        // try placing O
            const score = minimax(board, false);   // human's turn next
            board[i] = "";                         // undo
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }
    }
    return bestIndex;
}

// ── Handle win/draw outcome ────────────────────────────────────
function handleOutcome(result) {
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

// ── Handle Click ───────────────────────────────────────────────
function handleClick(e) {
    // Block clicks if game over, or if it's the computer's turn
    if (gameOver) return;
    if (mode === "computer" && turn === "O") return; // block during CPU turn

    const box = e.currentTarget;
    const idx = parseInt(box.dataset.index);
    if (board[idx]) return;

    // Human places X
    board[idx] = turn;
    box.querySelector(".boxtext").innerText = turn;

    const result = checkWinner();
    if (result) {
        handleOutcome(result);
        return;
    }

    // Switch turn
    turn = turn === "X" ? "O" : "X";

    // If vs computer and it's now O's turn → trigger AI move
    if (mode === "computer" && turn === "O" && !gameOver) {
        info.innerHTML = `<span class="thinking">🤖 Computer is thinking...</span>`;

        // Small delay so it feels natural, not instant
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

// ── Reset Game ─────────────────────────────────────────────────
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
}

// ── Event Listeners ────────────────────────────────────────────
boxes.forEach((box, i) => {
    box.dataset.index = i;
    box.addEventListener("click", handleClick);
});

resetBtn.addEventListener("click", resetGame);

changePlayers.addEventListener("click", () => {
    gameContainer.style.display = "none";
    nameScreen.style.display    = "flex";
});

startBtn.addEventListener("click", () => {
    const xVal = document.getElementById("playerX").value.trim();
    const oVal = playerOInput.value.trim();

    playerX = xVal || "Player X";
    playerO = mode === "computer" ? "Computer 🤖" : (oVal || "Player O");

    // Update mode badge
    modeBadge.textContent = mode === "computer" ? "human vs Computer" : "👥 vs Human";

    nameScreen.style.display    = "none";
    gameContainer.style.display = "flex";
    resetGame();
    renderLeaderboard();
});

clearLb.addEventListener("click", () => {
    localStorage.removeItem("tttLeaderboard");
    renderLeaderboard();
});  