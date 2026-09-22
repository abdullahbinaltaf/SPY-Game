const supabaseUrl = 'https://gtuvubfwymjadpjirljv.supabase.co';
const supabaseKey = 'sb_publishable_lftTmhPcziQrb4K5xfmJIQ_QD3uLXlA';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

const apiUrl = `${window.location.protocol}//${window.location.host}/api`;

let user = null;
let profile = null;
let currentRoomCode = null;
let roomState = null;
let players = [];
let roomChannel = null;
let timerInterval = null;

const dom = {
    screens: {
        auth: document.getElementById('auth-screen'),
        home: document.getElementById('home-screen'),
        lobby: document.getElementById('lobby-screen'),
        playing: document.getElementById('playing-screen'),
        voting: document.getElementById('voting-screen'),
        result: document.getElementById('result-screen')
    }
};

function showScreen(screenName) {
    Object.values(dom.screens).forEach(s => s.classList.remove('active'));
    dom.screens[screenName].classList.add('active');
}

function showError(msg, elId = 'auth-error') {
    const el = document.getElementById(elId);
    if(el) {
        el.innerText = msg;
        setTimeout(() => el.innerText = '', 3000);
    }
}

// Auth Logic
async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        user = session.user;
        await loadProfile();
        showScreen('home');
    } else {
        showScreen('auth');
    }
}

async function loadProfile() {
    let { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!data) {
        // Create profile if missing
        await supabase.from('profiles').insert([{ id: user.id, email: user.email }]);
        data = { email: user.email, wins: 0, losses: 0 };
    }
    profile = data;
    document.getElementById('user-email').innerText = profile.email.split('@')[0];
    document.getElementById('user-wins').innerText = profile.wins;
    document.getElementById('user-losses').innerText = profile.losses;
}

document.getElementById('btn-login').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showError(error.message);
    else checkAuth();
};

document.getElementById('btn-signup').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) showError(error.message);
    else showError("Success! Please log in.");
};

document.getElementById('btn-logout').onclick = async () => {
    await supabase.auth.signOut();
    user = null;
    profile = null;
    showScreen('auth');
};

// Game Logic
function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

document.getElementById('btn-create').onclick = async () => {
    const category = document.getElementById('category-input').value.trim() || 'Random';
    const code = generateCode();
    
    const { error } = await supabase.from('rooms').insert([{
        room_code: code,
        host_id: user.id,
        category: category,
        state: 'lobby'
    }]);
    
    if (error) return showError(error.message, 'home-error');
    
    await joinRoom(code);
};

document.getElementById('btn-join').onclick = async () => {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code) return;
    await joinRoom(code);
};

async function joinRoom(code) {
    const { data: room } = await supabase.from('rooms').select('*').eq('room_code', code).single();
    if (!room) return showError('Room not found', 'home-error');
    if (room.state !== 'lobby') return showError('Game already started', 'home-error');

    const { error } = await supabase.from('room_players').upsert({
        room_code: code,
        player_id: user.id
    });
    
    if (error) return showError(error.message, 'home-error');
    
    currentRoomCode = code;
    subscribeToRoom(code);
    await fetchRoomState();
}

function subscribeToRoom(code) {
    if (roomChannel) supabase.removeChannel(roomChannel);
    
    roomChannel = supabase.channel(`room:${code}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `room_code=eq.${code}` }, payload => {
            roomState = payload.new;
            updateUI();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_code=eq.${code}` }, async payload => {
            await fetchPlayers();
            updateUI();
        })
        .subscribe();
}

async function fetchRoomState() {
    const { data } = await supabase.from('rooms').select('*').eq('room_code', currentRoomCode).single();
    roomState = data;
    await fetchPlayers();
    updateUI();
}

async function fetchPlayers() {
    const { data } = await supabase.from('room_players').select('player_id, voted_for, profiles(email)').eq('room_code', currentRoomCode);
    players = data.map(d => ({
        id: d.player_id,
        name: d.profiles.email.split('@')[0],
        voted_for: d.voted_for
    }));
}

function updateUI() {
    if (!roomState || !players) return;
    const isHost = roomState.host_id === user.id;

    if (roomState.state === 'lobby') {
        showScreen('lobby');
        document.getElementById('lobby-room-code').innerText = roomState.room_code;
        document.getElementById('lobby-category').innerText = roomState.category;
        document.getElementById('player-count').innerText = players.length;
        
        document.getElementById('lobby-players').innerHTML = players.map(p => 
            `<li>${p.name} ${p.id === roomState.host_id ? '👑' : ''}</li>`
        ).join('');

        const btnStart = document.getElementById('btn-start');
        if (isHost) {
            btnStart.classList.remove('hidden');
            document.getElementById('waiting-msg').classList.add('hidden');
            btnStart.disabled = players.length < 3;
        } else {
            btnStart.classList.add('hidden');
            document.getElementById('waiting-msg').classList.remove('hidden');
        }
        clearInterval(timerInterval);
    }
    else if (roomState.state === 'playing') {
        showScreen('playing');
        document.getElementById('playing-players').innerHTML = players.map(p => `<li>${p.name}</li>`).join('');
        
        const amISpy = roomState.spies.includes(user.id);
        document.getElementById('role-display').innerText = amISpy ? "You are the Spy!" : `The word is: ${roomState.word}`;
        
        if (isHost) document.getElementById('btn-start-voting').classList.remove('hidden');
        else document.getElementById('btn-start-voting').classList.add('hidden');
        
        startTimer(roomState.timer_end);
    }
    else if (roomState.state === 'voting') {
        clearInterval(timerInterval);
        showScreen('voting');
        
        const optionsDiv = document.getElementById('voting-options');
        optionsDiv.innerHTML = players.filter(p => p.id !== user.id).map(p => 
            `<button class="vote-btn" data-id="${p.id}">${p.name}</button>`
        ).join('');
        
        document.querySelectorAll('.vote-btn').forEach(btn => {
            btn.onclick = async () => {
                document.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                await supabase.from('room_players')
                    .update({ voted_for: btn.dataset.id })
                    .eq('room_code', currentRoomCode)
                    .eq('player_id', user.id);
            };
        });
        
        const votedCount = players.filter(p => p.voted_for).length;
        document.getElementById('voting-status').innerText = `${votedCount} / ${players.length} players have voted.`;
        
        if (isHost && votedCount === players.length) {
            calculateResults();
        }
    }
    else if (roomState.state === 'result') {
        showScreen('result');
        const spiesNames = players.filter(p => roomState.spies.includes(p.id)).map(p => p.name).join(', ');
        document.getElementById('spies-reveal').innerHTML = `The Spy was:<br><span style="color:var(--primary)">${spiesNames}</span>`;
        
        const voteCounts = {};
        players.forEach(p => {
            if(p.voted_for) voteCounts[p.voted_for] = (voteCounts[p.voted_for] || 0) + 1;
        });
        
        document.getElementById('voting-results-list').innerHTML = players.map(p => {
            const votes = voteCounts[p.id] || 0;
            return `<div class="result-item"><strong>${p.name}</strong> received ${votes} votes</div>`;
        }).join('');
        
        if (isHost) document.getElementById('btn-restart').classList.remove('hidden');
        else document.getElementById('btn-restart').classList.add('hidden');
    }
}

document.getElementById('btn-start').onclick = async () => {
    document.getElementById('btn-start').disabled = true;
    
    // Call Python API to get AI Word
    const res = await fetch(`${apiUrl}/generate_word`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: roomState.category })
    });
    const data = await res.json();
    if(!data.success) {
        document.getElementById('btn-start').disabled = false;
        return alert("Failed to get word");
    }
    
    const numSpies = players.length < 7 ? 1 : 2;
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    const spies = shuffled.slice(0, numSpies).map(p => p.id);
    
    await supabase.from('rooms').update({
        state: 'playing',
        category: data.category,
        word: data.word,
        spies: spies,
        timer_end: (Date.now() / 1000) + (5 * 60)
    }).eq('room_code', currentRoomCode);
};

document.getElementById('btn-start-voting').onclick = async () => {
    await supabase.from('rooms').update({ state: 'voting' }).eq('room_code', currentRoomCode);
};

async function calculateResults() {
    const spies = roomState.spies;
    let spyCaught = false;
    
    const voteCounts = {};
    players.forEach(p => { if(p.voted_for) voteCounts[p.voted_for] = (voteCounts[p.voted_for] || 0) + 1; });
    
    let maxVotes = 0;
    let mostVotedIds = [];
    for(const [id, count] of Object.entries(voteCounts)) {
        if(count > maxVotes) { maxVotes = count; mostVotedIds = [id]; }
        else if(count === maxVotes) { mostVotedIds.push(id); }
    }
    
    if (mostVotedIds.some(id => spies.includes(id))) spyCaught = true;
    
    const winnerIds = [];
    const loserIds = [];
    
    players.forEach(p => {
        const isSpy = spies.includes(p.id);
        if ((spyCaught && !isSpy) || (!spyCaught && isSpy)) {
            winnerIds.push(p.id);
        } else {
            loserIds.push(p.id);
        }
    });
    
    // Increment wins/losses
    await supabase.rpc('update_game_stats', { winner_ids: winnerIds, loser_ids: loserIds });
    // Transition to result state
    await supabase.from('rooms').update({ state: 'result' }).eq('room_code', currentRoomCode);
}

document.getElementById('btn-restart').onclick = async () => {
    await supabase.from('room_players').update({ voted_for: null }).eq('room_code', currentRoomCode);
    await supabase.from('rooms').update({
        state: 'lobby',
        word: null,
        spies: [],
        timer_end: null
    }).eq('room_code', currentRoomCode);
};

function leaveRoom() {
    if(currentRoomCode && user) {
        supabase.from('room_players').delete().eq('room_code', currentRoomCode).eq('player_id', user.id).then();
    }
    currentRoomCode = null;
    roomState = null;
    players = [];
    if(roomChannel) supabase.removeChannel(roomChannel);
    loadProfile();
    showScreen('home');
}

document.getElementById('btn-leave-lobby').onclick = leaveRoom;
document.getElementById('btn-leave-result').onclick = leaveRoom;

function startTimer(endTime) {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const now = Date.now() / 1000;
        let remaining = Math.floor(endTime - now);
        if (remaining <= 0) { remaining = 0; clearInterval(timerInterval); }
        const m = Math.floor(remaining / 60).toString().padStart(2, '0');
        const s = (remaining % 60).toString().padStart(2, '0');
        const el = document.getElementById('time-left');
        if(el) el.innerText = `${m}:${s}`;
    }, 1000);
}

checkAuth();
