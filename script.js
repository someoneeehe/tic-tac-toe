// ── Firebase Database ──────────────────────────────────────────
const db = firebase.database();

// ── Local Notifications ───────────────────────────────────────
let notificationsAllowed = false;

async function setupLocalNotifications() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { LocalNotifications } = Capacitor.Plugins;

    const perm = await LocalNotifications.requestPermissions();
    notificationsAllowed = perm && perm.display === "granted";

    LocalNotifications.addListener(
        "localNotificationActionPerformed",
        (action) => {
            const data = action.notification.extra;

            if (data && data.type === "your_turn") {
                console.log("User tapped your turn notification");
            }

            if (data && data.type === "invite") {
                nameScreen.style.display = "flex";
                gameContainer.style.display = "none";
                setMode("online");

                if (data.roomCode) {
                    document.getElementById("roomCodeInput").value =
                        data.roomCode;
                }
            }
        }
    );

    console.log(
        "Local notifications set up. Allowed:",
        notificationsAllowed
    );
}

async function sendLocalNotification(
    id,
    title,
    body,
    extra = {},
    delaySeconds = 1
) {
    if (!notificationsAllowed) return;
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { LocalNotifications } = Capacitor.Plugins;

    try {
        await LocalNotifications.cancel({
            notifications: [{ id }]
        });
    } catch (e) {}

    await LocalNotifications.schedule({
        notifications: [
            {
                id,
                title,
                body,
                extra,
                schedule: {
                    at: new Date(Date.now() + delaySeconds * 1000)
                },
                sound: "default",
                smallIcon: "ic_launcher",
                actionTypeId: "",
                channelId: "tictactoe"
            }
        ]
    });
}

async function cancelNotification(id) {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { LocalNotifications } = Capacitor.Plugins;

    try {
        await LocalNotifications.cancel({
            notifications: [{ id }]
        });
    } catch (e) {}
}

const NOTIF = {
    YOUR_TURN: 1,
    TIMER_WARN: 2,
    OPPONENT_WIN: 3,
    DRAW: 4,
    INVITE: 5,
    IDLE_REMIND: 6
};

setupLocalNotifications();

// ── DOM refs ───────────────────────────────────────────────────
const boxes = document.querySelectorAll(".box");
const info = document.getElementById("info");
const resetBtn = document.getElementById("reset");
const changePlayers = document.getElementById("changePlayers");
const imgbox = document.getElementById("imgbox");
const gameContainer = document.getElementById("gameContainer");
const nameScreen = document.getElementById("nameScreen");
const startBtn = document.getElementById("startBtn");
const lbList = document.getElementById("lbList");
const clearLb = document.getElementById("clearLb");
const darkToggle = document.getElementById("darkToggle");
const boardWrap = document.querySelector(".board-wrap");
const modeBadge = document.getElementById("modeBadge");
const playerOInput = document.getElementById("playerO");
const onlineOptions = document.getElementById("onlineOptions");
const onlineStatus = document.getElementById("onlineStatus");
const roomDisplay = document.getElementById("roomDisplay");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");

// ── State ──────────────────────────────────────────────────────
let turn = "X";
let board = ["", "", "", "", "", "", "", "", ""];
let gameOver = false;
let playerX = "Player X";
let playerO = "Player O";
let mode = "human";
let mySymbol = "";
let roomCode = "";
let gameRef = null;
let timerInterval = null;
let timeLeft = 10;
const TIMER_MAX = 10;
let isListening = false;

const winPatterns = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
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

    document
        .getElementById("btnHuman")
        .classList.toggle("active", m === "human");

    document
        .getElementById("btnCPU")
        .classList.toggle("active", m === "computer");

    document
        .getElementById("btnOnline")
        .classList.toggle("active", m === "online");

    playerOInput.style.display = m === "human" ? "block" : "none";

    onlineOptions.style.display = m === "online" ? "flex" : "none";

    startBtn.style.display = m === "online" ? "none" : "block";

    roomDisplay.style.display = "none";
}

// ── Room Code Generator ────────────────────────────────────────
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Render Board ───────────────────────────────────────────────
function renderBoard(b) {
    boxes.forEach((box, i) => {
        const span = box.querySelector(".boxtext");

        span.innerText = b[i] || "";

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
            return {
                winner: b[a],
                pattern
            };
        }
    }

    if (b.every((cell) => cell !== "")) {
        return {
            winner: "draw",
            pattern: null
        };
    }

    return null;
}

// ── Handle Outcome ─────────────────────────────────────────────
function handleOutcome(result) {
    stopTimer();

    gameOver = true;

    if (result.winner === "draw") {
        info.innerText = "It's a Draw!";
    } else {
        const winnerName =
            result.winner === "X" ? playerX : playerO;

        info.innerText = `🎉 ${winnerName} wins!`;

        imgbox.style.display = "block";

        result.pattern.forEach((i) => {
            boxes[i].classList.add("winner");
        });
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
    const numEl = document.getElementById("timerNum");
    const circle = document.getElementById("timerCircle");

    if (!numEl || !circle) return;

    numEl.textContent = t;

    const offset = Math.round(
        ((TIMER_MAX - t) / TIMER_MAX) * 100
    );

    circle.style.strokeDashoffset = offset;

    if (t <= 3) {
        numEl.classList.add("urgent");

        circle.classList.add("urgent");

        if (t === 3 && turn === mySymbol) {
            sendLocalNotification(
                NOTIF.TIMER_WARN,
                "Hurry up! ⏰",
                "Only 3 seconds left!",
                {
                    type: "timer_warning",
                    roomCode
                },
                0
            );
        }
    } else {
        numEl.classList.remove("urgent");

        circle.classList.remove("urgent");
    }
}

function autoSkipTurn() {
    if (gameOver) return;

    const currentName =
        turn === "X" ? playerX : playerO;

    info.innerText = `⏰ ${currentName} ran out of time!`;

    setTimeout(() => {
        if (mode === "online") {
            const nextTurn =
                turn === "X" ? "O" : "X";

            gameRef.update({
                board,
                turn: nextTurn
            });

            cancelNotification(NOTIF.IDLE_REMIND);

            sendLocalNotification(
                NOTIF.IDLE_REMIND,
                "👀 Still waiting...",
                "Your opponent hasn't moved yet.",
                {
                    type: "your_turn",
                    roomCode
                },
                30
            );

            return;
        }

        turn = turn === "X" ? "O" : "X";

        const nextName =
            turn === "X" ? playerX : playerO;

        info.innerText = `Turn for ${nextName} (${turn})`;

        startTimer();
    }, 1000);
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

        box.querySelector(".boxtext").innerText =
            mySymbol;

        const result = checkWinner(board);

        const nextTurn =
            mySymbol === "X" ? "O" : "X";

        if (result && result.winner !== "draw") {
            gameRef.update({
                board,
                turn: nextTurn,
                status: "won",
                winner: result.winner,
                winPattern: result.pattern
            });
        } else if (
            result &&
            result.winner === "draw"
        ) {
            gameRef.update({
                board,
                turn: nextTurn,
                status: "draw"
            });
        } else {
            gameRef.update({
                board,
                turn: nextTurn
            });
        }

        return;
    }

    // LOCAL MODE
    board[idx] = turn;

    box.querySelector(".boxtext").innerText = turn;

    const result = checkWinner();

    if (result) {
        handleOutcome(result);

        return;
    }

    turn = turn === "X" ? "O" : "X";

    const nextName =
        turn === "X" ? playerX : playerO;

    info.innerText = `Turn for ${nextName} (${turn})`;

    startTimer();
}

// ── Reset ──────────────────────────────────────────────────────
function resetGame() {
    board = ["", "", "", "", "", "", "", "", ""];

    turn = "X";

    gameOver = false;

    imgbox.style.display = "none";

    renderBoard(board);

    info.innerText = `Turn for ${playerX} (X)`;

    stopTimer();

    startTimer();
}

// ── Event Listeners ────────────────────────────────────────────
boxes.forEach((box, i) => {
    box.dataset.index = i;

    box.addEventListener("click", handleClick);
});

resetBtn.addEventListener("click", resetGame);

clearLb.addEventListener("click", () => {
    localStorage.removeItem("tttLeaderboard");
});

document.addEventListener(
    "visibilitychange",
    () => {
        if (document.visibilityState === "visible") {
            cancelNotification(
                NOTIF.YOUR_TURN
            );

            cancelNotification(
                NOTIF.TIMER_WARN
            );
        }
    }
);