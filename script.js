const boxes = document.querySelectorAll(".box");
const info  = document.getElementById("info");
const resetBtn = document.getElementById("reset");
const changePlayers = document.getElementById("changePlayers");
const imgbox = document.getElementById("imgbox");
const gameContainer = document.getElementById("gameContainer");
const nameScreen = document.getElementById("nameScreen");
const startBtn = document.getElementById("startBtn");
const lbList = document.getElementById("lbList");
const clearLb = document.getElementById("clearLb");

let turn = "X";
let board = ["", "", "", "", "", "", "", "", ""];
let gameOver = false;
let playerX = "Player X";
let playerO = "Player O";

const winPatterns = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
];

// --- Leaderboard helpers ---
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
    const medalClass = ["gold", "silver", "bronze"];
    lbList.innerHTML = sorted.map(([name, wins], i) => {
        const initials = name.slice(0, 2).toUpperCase();
        const pct = Math.round((wins / maxWins) * 100);
        const rankClass = i < 3 ? medalClass[i] : "";
        return `
        <div class="lb-row">
            <span class="lb-rank ${rankClass}">${i + 1}</span>
            <div class="lb-avatar">${initials}</div>
            <div style="flex:1">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span class="lb-name">${name}</span>
                    <span class="lb-wins">${wins} win${wins > 1 ? "s" : ""}</span>
                </div>
                <div class="lb-bar-wrap">
                    <div class="lb-bar" style="width:${pct}%"></div>
                </div>
            </div>
        </div>`;
    }).join("");
}

// --- Game logic ---
function checkWinner() {
    for (let pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    if (board.every(cell => cell !== "")) return "draw";
    return null;
}

function handleClick(e) {
    if (gameOver) return;
    const box = e.currentTarget;
    const idx = parseInt(box.dataset.index);
    if (board[idx]) return;

    board[idx] = turn;
    box.querySelector(".boxtext").innerText = turn;

    const result = checkWinner();
    if (result) {
        gameOver = true;
        if (result === "draw") {
            info.innerText = "It's a Draw!";
        } else {
            const winnerName = result === "X" ? playerX : playerO;
            info.innerText = `${winnerName} wins!`;
            imgbox.style.display = "block";
            addWin(winnerName);
            renderLeaderboard();
        }
    } else {
        turn = turn === "X" ? "O" : "X";
        const nextName = turn === "X" ? playerX : playerO;
        info.innerText = `Turn for ${nextName} (${turn})`;
    }
}

function resetGame() {
    board = ["", "", "", "", "", "", "", "", ""];
    turn = "X";
    gameOver = false;
    imgbox.style.display = "none";
    info.innerText = `Turn for ${playerX} (X)`;
    boxes.forEach(box => {
        box.querySelector(".boxtext").innerText = "";
    });
}

// --- Setup ---
boxes.forEach((box, i) => {
    box.dataset.index = i;
    box.addEventListener("click", handleClick);
});

resetBtn.addEventListener("click", resetGame);

changePlayers.addEventListener("click", () => {
    gameContainer.style.display = "none";
    nameScreen.style.display = "flex";
});

startBtn.addEventListener("click", () => {
    const xVal = document.getElementById("playerX").value.trim();
    const oVal = document.getElementById("playerO").value.trim();
    playerX = xVal || "Player X";
    playerO = oVal || "Player O";
    nameScreen.style.display = "none";
    gameContainer.style.display = "flex";
    resetGame();
    renderLeaderboard();
});

clearLb.addEventListener("click", () => {
    localStorage.removeItem("tttLeaderboard");
    renderLeaderboard();
});