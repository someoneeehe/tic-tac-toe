// ═══════════════════════════════════════════════════════════════
//  MyTicTacToe — script.js
//  Screens: Splash → Mode → Series → Name → Game
//  Series: Classic (1) | Best of 3 | Best of 5
//  Modes:  vs Human | vs Computer (minimax) | Online (Firebase)
//  Timer:  synced via Firebase timerEnd epoch in online mode
//  Notifications: Web Notification API + Capacitor LocalNotifications
// ═══════════════════════════════════════════════════════════════

const db = firebase.database();

// ── Platform ───────────────────────────────────────────────────
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform());

// ── Notification IDs ───────────────────────────────────────────
const NOTIF = { YOUR_TURN:1, TIMER_WARN:2, OPPONENT_WIN:3, DRAW:4, IDLE_REMIND:6 };
let notificationsAllowed = false;
let fcmToken = null;    // FCM token for this device (web or native)

// ── VAPID key — get this from Firebase Console:
//    Project Settings → Cloud Messaging → Web Push certificates → Key pair
const VAPID_KEY = "YOUR_VAPID_KEY_HERE";

// ══════════════════════════════════════════════════════════════
//  NOTIFICATION SETUP
//  Call this inside a user-gesture (button click), not on load.
//  That's the only way browsers allow Notification.requestPermission().
// ══════════════════════════════════════════════════════════════
async function setupNotifications() {
    if (isNative()) {
        await setupNative();
    } else {
        await setupWebFCM();
    }
}

// ── Native (Capacitor) ─────────────────────────────────────────
async function setupNative() {
    try {
        const { LocalNotifications, PushNotifications } = Capacitor.Plugins;

        // LocalNotifications for in-app scheduling
        const lperm = await LocalNotifications.requestPermissions();
        notificationsAllowed = lperm && lperm.display === "granted";

        if (notificationsAllowed) {
            try {
                await LocalNotifications.createChannel({
                    id:"tictactoe", name:"TicTacToe",
                    importance:4, sound:"default",
                    vibration:true, lights:true, lightColor:"#c8ff00"
                });
            } catch(e) {}

            LocalNotifications.addListener("localNotificationActionPerformed", action => {
                const d = action.notification.extra || {};
                if (d.roomCode) {
                    goTo("nameScreen");
                    document.getElementById("roomCodeInput").value = d.roomCode;
                }
            });
        }

        // FCM via Capacitor PushNotifications plugin for server-sent push
        if (PushNotifications) {
            const pperm = await PushNotifications.requestPermissions();
            if (pperm.receive === "granted") {
                await PushNotifications.register();
                PushNotifications.addListener("registration", reg => {
                    fcmToken = reg.value;
                    console.log("Native FCM token:", fcmToken.slice(-8));
                    saveFCMToken();
                });
                PushNotifications.addListener("registrationError", err => {
                    console.warn("Push registration error:", err);
                });
                PushNotifications.addListener("pushNotificationReceived", notif => {
                    // App is foreground — show toast
                    showToast(notif.title || "TicTacToe", notif.body || "");
                });
                PushNotifications.addListener("pushNotificationActionPerformed", action => {
                    const d = action.notification.data || {};
                    if (d.roomCode) {
                        goTo("nameScreen");
                        document.getElementById("roomCodeInput").value = d.roomCode;
                    }
                });
            }
        }
    } catch(e) { console.warn("Native notif setup failed:", e); }
}

// ── Web FCM ────────────────────────────────────────────────────
async function setupWebFCM() {
    if (!("Notification" in window)) return;

    // Request permission — MUST be inside a user gesture
    const perm = await Notification.requestPermission();
    notificationsAllowed = perm === "granted";
    if (!notificationsAllowed) return;

    try {
        // Register service worker
        const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        console.log("SW registered");

        // Get FCM token
        const messaging = firebase.messaging();
        fcmToken = await messaging.getToken({
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swReg
        });
        console.log("Web FCM token:", fcmToken ? fcmToken.slice(-8) : "none");
        saveFCMToken();

        // Foreground message handler (tab is open)
        messaging.onMessage(payload => {
            const { title, body } = payload.notification || {};
            showToast(title || "TicTacToe", body || "");
        });

        // Token refresh
        messaging.onTokenRefresh(async () => {
            fcmToken = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
            saveFCMToken();
        });

    } catch(e) {
        console.warn("Web FCM setup failed:", e);
        // Fallback: plain Notification API (no server push, only foreground)
    }
}

// ── Save FCM token to Firebase room ───────────────────────────
// Called after token is obtained AND after joining a room.
function saveFCMToken() {
    if (!fcmToken || !gameRef || !mySymbol) return;
    const field = mySymbol === "X" ? "fcmTokenX" : "fcmTokenO";
    gameRef.update({ [field]: fcmToken })
        .then(() => console.log("FCM token saved to room"))
        .catch(e => console.warn("Could not save FCM token:", e));
}

// ── Local / foreground notification (fallback when tab is open) ─
async function sendLocalNotification(id, title, body) {
    if (!notificationsAllowed) return;
    if (document.visibilityState === "visible") {
        showToast(title, body);
        return;
    }
    if (isNative()) {
        try {
            const { LocalNotifications } = Capacitor.Plugins;
            try { await LocalNotifications.cancel({ notifications:[{id}] }); } catch(e) {}
            await LocalNotifications.schedule({ notifications:[{
                id, title, body,
                schedule:{ at: new Date(Date.now()+300) },
                sound:"default", smallIcon:"ic_launcher", channelId:"tictactoe"
            }]});
        } catch(e) {}
    } else {
        // Service worker show (background tab)
        try {
            const sw = await navigator.serviceWorker.ready;
            await sw.showNotification(title, {
                body, icon:"/icon-192.png", badge:"/badge-72.png",
                tag: String(id), vibrate:[200,100,200]
            });
        } catch(e) {
            try { new Notification(title, { body }); } catch(e2) {}
        }
    }
}

async function cancelNotif(id) {
    if (!isNative()) return;
    try {
        const {LocalNotifications} = Capacitor.Plugins;
        await LocalNotifications.cancel({ notifications:[{id}] });
    } catch(e) {}
}

// ── Write push_request → Cloud Function picks it up ──────────
// The Cloud Function reads the target's FCM token from the room
// and calls FCM API server-side. This works even when target's
// tab is closed or phone is locked.
function writePushRequest(targetSym, id, title, body, extra={}) {
    if (!gameRef) return;
    gameRef.child("push_request").set({
        target: targetSym, id, title, body,
        extra:  { ...extra },
        ts:     Date.now()
    });
}

// No longer needed — Cloud Function handles delivery.
// Kept as a stub so existing call sites don't break.
function listenForPushRequests() {}

// Timer warning — local only (you're in the foreground by definition)
function notifyTimerWarn() {
    sendLocalNotification(NOTIF.TIMER_WARN, "⏰ 5 seconds left!", "Hurry! Make your move.");
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(title, body) {
    const t = document.getElementById("appToast");
    document.getElementById("toastTitle").textContent = title + " ";
    document.getElementById("toastBody").textContent  = body;
    t.classList.add("show");
    clearTimeout(t._tmr);
    t._tmr = setTimeout(() => t.classList.remove("show"), 4000);
}

// ══════════════════════════════════════════════════════════════
//  SCREEN NAVIGATION
// ══════════════════════════════════════════════════════════════
let currentScreen = "splashScreen";

function goTo(id) {
    const prev = document.getElementById(currentScreen);
    const next = document.getElementById(id);
    if (!next || currentScreen === id) return;
    prev.classList.add("exit");
    prev.classList.remove("active");
    setTimeout(() => prev.classList.remove("exit"), 400);
    next.classList.add("active");
    currentScreen = id;
    closeMenu();
}

function goToMode() { goTo("modeScreen"); }

// ══════════════════════════════════════════════════════════════
//  GAME CONFIG STATE
// ══════════════════════════════════════════════════════════════
let opponentMode = "human";   // "human" | "computer" | "online"
let seriesTarget = 1;          // 1 | 3 | 5   (games in series)

function selectOpponent(m) {
    opponentMode = m;
    goTo("seriesScreen");
}

function selectSeries(n) {
    seriesTarget = n;
    goTo("nameScreen");
    // Show/hide relevant fields
    document.getElementById("playerOField").style.display  = opponentMode === "human"   ? "flex"  : "none";
    document.getElementById("onlineOptions").style.display = opponentMode === "online"  ? "flex"  : "none";
    document.getElementById("startBtn").style.display      = opponentMode === "online"  ? "none"  : "block";
    document.getElementById("roomDisplay").style.display   = "none";
}

// Also called from back buttons
function setOpponent(m) { opponentMode = m; }

// ══════════════════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════════════════
let board          = ["","","","","","","","",""];
let turn           = "X";
let gameOver       = false;
let playerX        = "Player X";
let playerO        = "Player O";
let mySymbol       = "";         // online only
let roomCode       = "";
let gameRef        = null;
let isListening    = false;

// Series state
let seriesX        = 0;          // wins by X this series
let seriesO        = 0;          // wins by O this series
let roundNum       = 1;
let seriesOver     = false;
let seriesFirst    = "";         // "X" | "O" | "" — who starts next round (alternates)

// Timer
let timerInterval  = null;
let timeLeft       = 10;
const TIMER_MAX    = 10;
const CIRC         = 2 * Math.PI * 18;   // r=18 → 113.1
let onlineTimerOwned = false;
let lastTimerEnd     = null;

const winPatterns = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
];

// ── Dark mode ──────────────────────────────────────────────────
function applyTheme(light) {
    document.body.classList.toggle("light", light);
    localStorage.setItem("tttLight", light ? "1" : "0");
}
applyTheme(localStorage.getItem("tttLight") === "1");

// ══════════════════════════════════════════════════════════════
//  MENU (⋮)
// ══════════════════════════════════════════════════════════════
function toggleMenu() {
    const m = document.getElementById("dropMenu");
    m.style.display = m.style.display === "none" ? "block" : "none";
}
function closeMenu() {
    document.getElementById("dropMenu").style.display = "none";
}
document.addEventListener("click", e => {
    if (!e.target.closest("#dropMenu") && !e.target.closest("#dotsBtn")) closeMenu();
});

function menuAction(action) {
    closeMenu();
    if (action === "reset")        { resetRound(true); }
    if (action === "leaderboard")  { openLB(); }
    if (action === "dark")         { applyTheme(!document.body.classList.contains("light")); }
    if (action === "changePlayers"){ exitGame(); }
}

// ══════════════════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════════════════
function loadLB() { try { return JSON.parse(localStorage.getItem("tttLB")||"{}"); } catch{return{};} }
function saveLB(lb) { localStorage.setItem("tttLB", JSON.stringify(lb)); }

function recordWin(name) {
    if (!name) return;
    const lb = loadLB();
    lb[name] = (lb[name]||0) + 1;
    saveLB(lb);
}

function openLB() {
    renderLB();
    document.getElementById("sheetOverlay").style.display = "block";
    document.getElementById("lbSheet").style.display      = "block";
}
function closeLB() {
    document.getElementById("sheetOverlay").style.display = "none";
    document.getElementById("lbSheet").style.display      = "none";
}
function clearLB() {
    localStorage.removeItem("tttLB");
    renderLB();
}

function renderLB() {
    const lb      = loadLB();
    const entries = Object.entries(lb).sort((a,b)=>b[1]-a[1]);
    const el      = document.getElementById("lbList");
    if (!entries.length) { el.innerHTML=`<div class="lb-empty">No wins recorded yet</div>`; return; }
    const max = entries[0][1];
    const medals = ["gold","silver","bronze"];
    el.innerHTML = entries.map(([name,wins],i)=>{
        const rank  = i===0?"🥇":i===1?"🥈":i===2?"🥉":(i+1);
        const pct   = max>0 ? Math.round((wins/max)*100) : 0;
        const init  = name.slice(0,2).toUpperCase();
        return `<div class="lb-row">
            <span class="lb-rank ${medals[i]||""}">${rank}</span>
            <div class="lb-avatar">${init}</div>
            <div class="lb-name-wrap">
                <div class="lb-name">${name}</div>
                <div class="lb-bar-wrap"><div class="lb-bar" style="width:${pct}%"></div></div>
            </div>
            <span class="lb-wins">${wins}W</span>
        </div>`;
    }).join("");
}

// ══════════════════════════════════════════════════════════════
//  BOARD HELPERS
// ══════════════════════════════════════════════════════════════
function renderBoard(b) {
    document.querySelectorAll(".cell").forEach((cell, i) => {
        const span = cell.querySelector(".cell-text");
        span.textContent = b[i] || "";
        span.className   = "cell-text" + (b[i]==="X"?" is-x":b[i]==="O"?" is-o":"");
        cell.classList.remove("winner","taken","popped");
        if (b[i]) cell.classList.add("taken");
    });
    document.getElementById("winLine").style.display = "none";
}

function playCell(idx, sym) {
    const cell = document.querySelector(`.cell[data-index="${idx}"]`);
    const span = cell.querySelector(".cell-text");
    span.textContent = sym;
    span.className   = "cell-text " + (sym==="X"?"is-x":"is-o");
    cell.classList.add("taken","popped");
}

function checkWinner(b = board) {
    for (const p of winPatterns) {
        const [a,bb,c] = p;
        if (b[a] && b[a]===b[bb] && b[a]===b[c]) return { winner:b[a], pattern:p };
    }
    if (b.every(c=>c!=="")) return { winner:"draw", pattern:null };
    return null;
}

function drawWinLine(pattern) {
    const svg  = document.getElementById("winLine");
    const line = document.getElementById("winLinePath");
    if (!pattern) { svg.style.display="none"; return; }

    const wrap = document.getElementById("boardWrap");
    const sz   = wrap.offsetWidth;
    const cell = sz / 3;
    const cx   = i => (i%3)*cell + cell/2;
    const cy   = i => Math.floor(i/3)*cell + cell/2;

    svg.setAttribute("viewBox", `0 0 ${sz} ${sz}`);
    line.setAttribute("x1", cx(pattern[0]));
    line.setAttribute("y1", cy(pattern[0]));
    line.setAttribute("x2", cx(pattern[2]));
    line.setAttribute("y2", cy(pattern[2]));
    // reset animation
    line.style.animation = "none";
    line.getBoundingClientRect();
    line.style.animation = "";
    svg.style.display = "block";
    pattern.forEach(i => document.querySelector(`.cell[data-index="${i}"]`).classList.add("winner"));
}

// ══════════════════════════════════════════════════════════════
//  SERIES TRACKER UI
// ══════════════════════════════════════════════════════════════
function updateTracker() {
    const st = document.getElementById("seriesTracker");
    if (seriesTarget <= 1) { st.style.display="none"; return; }
    st.style.display = "flex";
    const needed = Math.ceil(seriesTarget/2);

    const makePips = (wins, sym) => {
        let html = "";
        for (let i=0;i<needed;i++) {
            html += `<div class="pip ${i<wins ? (sym==="X"?"won-x":"won-o") : ""}"></div>`;
        }
        return html;
    };
    document.getElementById("trackerX").innerHTML = makePips(seriesX,"X");
    document.getElementById("trackerO").innerHTML = makePips(seriesO,"O");
}

// ══════════════════════════════════════════════════════════════
//  TURN / PLAYER UI
// ══════════════════════════════════════════════════════════════
function updateTurnUI() {
    document.getElementById("pillX").classList.toggle("active-turn", turn==="X" && !gameOver);
    document.getElementById("pillO").classList.toggle("active-turn", turn==="O" && !gameOver);
    document.getElementById("pillNameX").textContent = playerX;
    document.getElementById("pillNameO").textContent = opponentMode==="computer" ? "🤖 CPU" : playerO;
    document.getElementById("scoreX").textContent = seriesX;
    document.getElementById("scoreO").textContent = seriesO;
    document.getElementById("gameTitleSmall").textContent =
        seriesTarget>1 ? `Best of ${seriesTarget}` : "MyTicTacToe";
}

function setStatus(html) {
    document.getElementById("gameStatus").innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
//  TIMER — LOCAL
// ══════════════════════════════════════════════════════════════
function startTimer() {
    stopTimer();
    timeLeft = TIMER_MAX;
    updateTimerUI(timeLeft);
    document.getElementById("timerRow").style.display = "flex";
    timerInterval = setInterval(()=>{
        timeLeft--;
        updateTimerUI(timeLeft);
        if (timeLeft<=0) { stopTimer(); autoSkipLocal(); }
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    document.getElementById("timerRow").style.display = "none";
}

function updateTimerUI(t) {
    const num  = document.getElementById("timerNum");
    const ring = document.getElementById("timerCircle");
    if (!num||!ring) return;
    num.textContent = t;
    ring.style.strokeDasharray  = CIRC;
    ring.style.strokeDashoffset = ((TIMER_MAX-t)/TIMER_MAX)*CIRC;
    const urg = t<=3;
    num.classList.toggle("urgent",urg);
    ring.classList.toggle("urgent",urg);
    if (t===5) notifyTimerWarn();
}

function autoSkipLocal() {
    if (gameOver) return;
    setStatus(`⏰ ${turn==="X"?playerX:playerO} timed out!`);
    setTimeout(()=>{
        if (gameOver) return;
        turn = turn==="X"?"O":"X";
        updateTurnUI();
        setStatus(`Turn for ${turn==="X"?playerX:playerO}`);
        if (opponentMode==="computer"&&turn==="O") makeCPUMove();
        else startTimer();
    },1200);
}

// ── Online timer (synced via Firebase timerEnd) ────────────────
function startOnlineTimer(endEpoch, iAmOwner) {
    stopTimer();
    onlineTimerOwned = iAmOwner;
    document.getElementById("timerRow").style.display = "flex";
    timerInterval = setInterval(()=>{
        const rem = Math.max(0, Math.ceil((endEpoch-Date.now())/1000));
        updateTimerUI(rem);
        if (rem<=0) { stopTimer(); if (onlineTimerOwned&&!gameOver) autoSkipOnline(); }
    }, 250);
}

function autoSkipOnline() {
    if (gameOver||!gameRef) return;
    const nextTurn = turn==="X"?"O":"X";
    setStatus(`⏰ Timed out! Switching…`);
    setTimeout(()=>{
        if (gameOver||!gameRef) return;
        const nextEnd = Date.now()+TIMER_MAX*1000;
        gameRef.update({ turn:nextTurn, timerEnd:nextEnd });
        writePushRequest(nextTurn, NOTIF.YOUR_TURN, "Your turn! 🎮", "Opponent timed out.", { roomCode });
    },1200);
}

// ══════════════════════════════════════════════════════════════
//  CPU — MINIMAX
// ══════════════════════════════════════════════════════════════
function minimax(b, isMax) {
    const r = checkWinner(b);
    if (r) { if(r.winner==="O")return 10; if(r.winner==="X")return -10; return 0; }
    if (isMax) {
        let best=-Infinity;
        for(let i=0;i<9;i++){if(!b[i]){b[i]="O";best=Math.max(best,minimax(b,false));b[i]="";}}
        return best;
    } else {
        let best=Infinity;
        for(let i=0;i<9;i++){if(!b[i]){b[i]="X";best=Math.min(best,minimax(b,true));b[i]="";}}
        return best;
    }
}

function getBestMove() {
    let bestVal=-Infinity,bestIdx=-1;
    for(let i=0;i<9;i++){
        if(!board[i]){
            board[i]="O";
            const v=minimax(board,false);
            board[i]="";
            if(v>bestVal){bestVal=v;bestIdx=i;}
        }
    }
    return bestIdx;
}

function makeCPUMove() {
    if (gameOver||turn!=="O") return;
    setStatus(`<span style="display:flex;align-items:center;justify-content:center;gap:8px">🤖 thinking <span class="thinking-dots"><span></span><span></span><span></span></span></span>`);
    stopTimer();
    setTimeout(()=>{
        if (gameOver) return;
        const idx = getBestMove();
        if (idx===-1) return;
        board[idx]="O";
        playCell(idx,"O");
        const result = checkWinner();
        if (result) { handleOutcome(result); return; }
        turn="X";
        updateTurnUI();
        setStatus(`Your turn, ${playerX}`);
        startTimer();
    },450);
}

// ══════════════════════════════════════════════════════════════
//  OUTCOME (single round)
// ══════════════════════════════════════════════════════════════
function handleOutcome(result) {
    stopTimer();
    gameOver = true;
    updateTurnUI();

    if (result.winner==="draw") {
        drawWinLine(null);
        setStatus("It's a Draw! 🤝  —  tap to continue");
        showRoundBanner("🤝","It's a Draw!", `Round ${roundNum}`, false);
        // Tap anywhere on board or banner to start next round
        enableTapToContinue();
    } else {
        drawWinLine(result.pattern);
        const winnerName = result.winner==="X" ? playerX : playerO;
        setStatus(`🎉 ${winnerName} wins!`);

        // Update series score
        if (result.winner==="X") seriesX++;
        else seriesO++;

        updateTurnUI();
        updateTracker();
        recordWin(winnerName);

        // Check series winner
        const needed = Math.ceil(seriesTarget/2);
        if (seriesTarget>1 && (seriesX>=needed||seriesO>=needed)) {
            setTimeout(()=>showSeriesWinner(winnerName, result.winner), 1200);
            return;
        }

        showRoundBanner("🎉", `${winnerName} wins!`, `Round ${roundNum}`, true);
    }
}

function showRoundBanner(emoji, msg, sub, showNext) {
    document.getElementById("bannerEmoji").textContent = emoji;
    document.getElementById("bannerMsg").textContent   = msg;
    document.getElementById("bannerSub").textContent   = sub;
    document.getElementById("nextRoundBtn").style.display = (showNext && seriesTarget>1) ? "block" : "none";
    document.getElementById("roundBanner").style.display  = "block";

    // If classic (1 game) or draw, auto-dismiss after delay and just show reset
    if (seriesTarget===1 || !showNext) {
        document.getElementById("nextRoundBtn").style.display = "none";
        // Leave banner up; user hits Reset from menu
    }
}

function enableTapToContinue() {
    // One-time tap on either the board or the banner dismisses and continues
    const targets = [
        document.getElementById("boardWrap"),
        document.getElementById("roundBanner")
    ];
    function onTap() {
        targets.forEach(t => t.removeEventListener("click", onTap));
        if (seriesTarget > 1) {
            nextRound();
        } else {
            // Classic — just reset the single game
            document.getElementById("roundBanner").style.display = "none";
            resetRound(false);
        }
    }
    targets.forEach(t => t.addEventListener("click", onTap));
}

function nextRound() {
    document.getElementById("roundBanner").style.display = "none";
    roundNum++;
    // Alternate who starts
    seriesFirst = seriesFirst===""||seriesFirst==="X" ? "O" : "X";
    startRound(seriesFirst);
}

function showSeriesWinner(name, sym) {
    document.getElementById("roundBanner").style.display = "none";
    document.getElementById("swName").textContent  = name;
    document.getElementById("swScore").textContent = `${seriesX} — ${seriesO}`;
    document.getElementById("seriesWinner").style.display = "flex";
    seriesOver = true;
}

function playAgainSeries() {
    seriesX = seriesO = 0;
    roundNum = 1;
    seriesFirst = "";
    seriesOver = false;
    document.getElementById("seriesWinner").style.display = "none";
    updateTracker();
    startRound("X");
}

// ══════════════════════════════════════════════════════════════
//  ROUND MANAGEMENT
// ══════════════════════════════════════════════════════════════
function startRound(startTurn) {
    board    = ["","","","","","","","",""];
    turn     = startTurn || "X";
    gameOver = false;
    renderBoard(board);
    updateTurnUI();
    updateTracker();

    document.getElementById("roundBanner").style.display   = "none";
    document.getElementById("seriesWinner").style.display  = "none";

    if (opponentMode==="online") {
        if (gameRef && mySymbol==="X") {
            const endEpoch = Date.now()+TIMER_MAX*1000;
            gameRef.update({ board, turn:"X", status:"playing", winner:null, winPattern:null, timerEnd:endEpoch });
        }
        const myTurn = turn===mySymbol;
        setStatus(myTurn ? `Your turn (${mySymbol})` : `Waiting for opponent…`);
    } else {
        setStatus(`Turn for ${turn==="X"?playerX:playerO}`);
        if (opponentMode==="computer"&&turn==="O") makeCPUMove();
        else startTimer();
    }
}

// ══════════════════════════════════════════════════════════════
//  CLICK HANDLER
// ══════════════════════════════════════════════════════════════
document.getElementById("board").addEventListener("click", e => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const idx = parseInt(cell.dataset.index);
    handleMove(idx);
});

function handleMove(idx) {
    if (gameOver) return;
    if (board[idx] !== "") return;

    // ONLINE
    if (opponentMode==="online") {
        if (turn!==mySymbol) { showToast("Not your turn","Wait for your opponent."); return; }
        board[idx]=mySymbol;
        playCell(idx,mySymbol);
        stopTimer();
        const result   = checkWinner(board);
        const nextTurn = mySymbol==="X"?"O":"X";
        if (result&&result.winner!=="draw") {
            gameRef.update({ board, turn:nextTurn, status:"won", winner:result.winner, winPattern:result.pattern, timerEnd:null });
        } else if (result&&result.winner==="draw") {
            gameRef.update({ board, turn:nextTurn, status:"draw", timerEnd:null });
        } else {
            const nextEnd = Date.now()+TIMER_MAX*1000;
            gameRef.update({ board, turn:nextTurn, timerEnd:nextEnd });
            writePushRequest(nextTurn, NOTIF.YOUR_TURN, "Your turn! 🎮",
                `${mySymbol==="X"?playerX:playerO} just played.`, { roomCode });
        }
        return;
    }

    // CPU guard
    if (opponentMode==="computer"&&turn==="O") return;

    board[idx]=turn;
    playCell(idx,turn);
    const result = checkWinner();
    if (result) { handleOutcome(result); return; }
    turn = turn==="X"?"O":"X";
    updateTurnUI();
    setStatus(`Turn for ${turn==="X"?playerX:playerO}`);
    if (opponentMode==="computer"&&turn==="O") makeCPUMove();
    else startTimer();
}

// ══════════════════════════════════════════════════════════════
//  RESET (current round, keeps series score)
// ══════════════════════════════════════════════════════════════
function resetRound(full=false) {
    if (full) { seriesX=seriesO=0; roundNum=1; seriesFirst=""; seriesOver=false; }
    document.getElementById("roundBanner").style.display  = "none";
    document.getElementById("seriesWinner").style.display = "none";
    startRound(seriesFirst||"X");
}

// ══════════════════════════════════════════════════════════════
//  START GAME (from name screen)
// ══════════════════════════════════════════════════════════════
function startGame() {
    // User gesture — safe to request notification permission here
    setupNotifications();

    playerX = document.getElementById("playerXInput").value.trim() || "Player X";
    playerO = opponentMode==="computer" ? "CPU"
            : (document.getElementById("playerOInput").value.trim() || "Player O");

    seriesX=seriesO=0;
    roundNum=1;
    seriesFirst="";
    seriesOver=false;

    // Badge
    document.getElementById("onlineStatus").style.display = "none";

    goTo("gameScreen");
    updateTracker();
    updateTurnUI();
    startRound("X");
}

// ══════════════════════════════════════════════════════════════
//  ONLINE: CREATE / JOIN ROOM
// ══════════════════════════════════════════════════════════════
function createRoom() {
    setupNotifications();   // user gesture
    playerX  = document.getElementById("playerXInput").value.trim() || "Player X";
    mySymbol = "X";
    roomCode = Math.random().toString(36).substring(2,8).toUpperCase();

    if (gameRef) gameRef.off();
    gameRef = db.ref("rooms/"+roomCode);
    isListening = false;

    gameRef.set({
        board:["","","","","","","","",""], turn:"X", status:"waiting",
        playerX:playerX, playerO:"",
        timerEnd: Date.now()+TIMER_MAX*1000,
        winner:null, winPattern:null
    }).then(()=>{
        const disp = document.getElementById("roomCodeDisplay");
        disp.textContent = roomCode;
        document.getElementById("roomDisplay").style.display   = "block";
        document.getElementById("onlineOptions").style.display = "none";
        document.getElementById("startBtn").style.display      = "none";

        disp.onclick = () => {
            navigator.clipboard.writeText(roomCode)
                .then(()=>{ disp.textContent="Copied ✓"; setTimeout(()=>disp.textContent=roomCode,1500); })
                .catch(()=>{});
        };

        // Wait for opponent
        gameRef.on("value", snap=>{
            const d = snap.val();
            if (!d) return;
            if (d.status==="playing" && !isListening) {
                playerO = d.playerO||"Opponent";
                saveFCMToken();   // save token now that mySymbol and gameRef are set
                _startOnlineGame();
            }
        });
    }).catch(e=>alert("Firebase error: "+e.message));
}

function joinRoom() {
    setupNotifications();   // user gesture
    const name = document.getElementById("playerXInput").value.trim();
    const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
    if (!code) { alert("Enter a room code!"); return; }

    playerO  = name||"Player O";
    mySymbol = "O";
    roomCode = code;

    if (gameRef) gameRef.off();
    gameRef = db.ref("rooms/"+roomCode);
    isListening = false;

    gameRef.once("value").then(snap=>{
        const d = snap.val();
        if (!d)                   { alert("Room not found!"); return; }
        if (d.status!=="waiting") { alert("Room is full or already started."); return; }
        playerX = d.playerX||"Player X";
        return gameRef.update({ playerO:playerO, status:"playing" });
    }).then(()=>{
        saveFCMToken();   // save token now that mySymbol and gameRef are set
        _startOnlineGame();
    })
    .catch(e=>alert("Connection error: "+e.message));
}

function _startOnlineGame() {
    if (isListening) return;
    isListening = true;

    seriesX=seriesO=0;
    roundNum=1;

    goTo("gameScreen");
    updateTracker();
    updateTurnUI();

    const os = document.getElementById("onlineStatus");
    os.style.display = "block";
    os.textContent   = `You are ${mySymbol} · Room: ${roomCode}`;
    os.className     = "online-status connected";

    listenForPushRequests(); // no-op — Cloud Function handles delivery now

    // Re-request notification permission after user interaction
    if (!isNative() && Notification.permission==="default") {
        Notification.requestPermission().then(p=>{ notificationsAllowed=p==="granted"; });
    }

    lastTimerEnd = null;

    gameRef.on("value", snap=>{
        const d = snap.val();
        if (!d) return;

        board    = Array.isArray(d.board)?d.board:["","","","","","","","",""];
        turn     = d.turn||"X";

        renderBoard(board);

        if (d.status==="won") {
            stopTimer(); gameOver=true; updateTurnUI();
            const wName = d.winner==="X"?playerX:playerO;
            setStatus(`🎉 ${wName} wins!`);
            if (Array.isArray(d.winPattern)) drawWinLine(d.winPattern);
            if (d.winner===mySymbol) { seriesX+=d.winner==="X"?1:0; seriesO+=d.winner==="O"?1:0; recordWin(wName); updateTurnUI(); }
            cancelNotif(NOTIF.YOUR_TURN);
            return;
        }
        if (d.status==="draw") {
            stopTimer(); gameOver=true; updateTurnUI();
            setStatus("It's a Draw! 🤝");
            cancelNotif(NOTIF.YOUR_TURN);
            return;
        }

        gameOver=false;

        const timerEnd = d.timerEnd||(Date.now()+TIMER_MAX*1000);
        if (timerEnd!==lastTimerEnd) {
            lastTimerEnd=timerEnd;
            startOnlineTimer(timerEnd, turn===mySymbol);
        }

        if (turn===mySymbol) {
            setStatus(`Your turn (${mySymbol})`);
            cancelNotif(NOTIF.IDLE_REMIND);
            if (document.visibilityState!=="visible") {
                sendLocalNotification(NOTIF.YOUR_TURN,"Your turn! 🎮","Opponent played. Make your move!");
            }
        } else {
            setStatus(`Waiting for ${turn==="X"?playerX:playerO}…`);
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  EXIT GAME
// ══════════════════════════════════════════════════════════════
function exitGame() {
    stopTimer();
    if (gameRef) { gameRef.off(); gameRef=null; }
    isListening  = false;
    roomCode     = "";
    lastTimerEnd = null;
    closeMenu();
    document.getElementById("onlineStatus").style.display = "none";
    document.getElementById("roundBanner").style.display  = "none";
    document.getElementById("seriesWinner").style.display = "none";
    goTo("splashScreen");
}

// ══════════════════════════════════════════════════════════════
//  VISIBILITY CHANGE
// ══════════════════════════════════════════════════════════════
document.addEventListener("visibilitychange", ()=>{
    if (document.visibilityState==="visible") {
        cancelNotif(NOTIF.YOUR_TURN);
        cancelNotif(NOTIF.TIMER_WARN);
    }
});