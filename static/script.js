document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const socket = io();
    const player = document.getElementById('player');
    const audioInput = document.getElementById('audio-input');
    const uploadBtn = document.getElementById('upload-btn');
    const syncBtn = document.getElementById('sync-btn');
    const fileNameDisplay = document.getElementById('file-name');
    const fileNameText = document.getElementById('file-name-text');
    const coverArt = document.getElementById('cover-art');
    const controlButtons = document.querySelectorAll('.control-button');

    // --- State & Config Variables ---
    const roomId = document.body.dataset.roomId;
    let serverTimeOffset = 0;
    let isReceivingUpdate = false;
    let pingInterval;
    let currentDominantColor = null; // Store the current dominant color
    let themeUpdateTimeout; // Debounce timer for theme updates
    let userHasJustSeeked = false;
    let seekDebounceTimer = null;
    // FIX: Increased buffer to give more time for messages to travel.
    const SYNC_BUFFER_MS = 300; 
    const MAX_ALLOWED_DRIFT_S = 0.5; // How many seconds of drift we tolerate before a hard seek.
    const PLAYBACK_RATE_ADJUST = 0.05; // Adjust speed by 5% to gently catch up or slow down.

    // --- Event Listeners ---
    if (uploadBtn && audioInput) {
        uploadBtn.addEventListener('click', () => audioInput.click());
        audioInput.addEventListener('change', () => {
            const file = audioInput.files[0];
            if (!file) return;
            fileNameText.textContent = `Uploading: ${file.name}`;
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('room', roomId);
            fetch('/upload', { method: 'POST', body: formData })
                .then(response => response.json())
                .then(data => {
                    if (!data.success) fileNameText.textContent = data.error || 'Upload failed.';
                }).catch(error => {
                    console.error('Upload error:', error);
                    fileNameText.textContent = 'Upload error.';
                });
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (!player.src || player.src.endsWith('/null')) return;
            console.log('--- Initiating a manual sync ---');
            const targetTimestamp = (Date.now() + serverTimeOffset) + SYNC_BUFFER_MS;
            socket.emit('sync', {
                time: player.currentTime,
                target_timestamp: targetTimestamp,
                room: roomId
            });
        });
    }

    player.addEventListener('play', () => {
        if (isReceivingUpdate || player.seeking) return; // Add player.seeking check
        fileNameDisplay.classList.add('playing');
        updateThemeForPlayingState(); // Use debounced updater
        console.log("Requesting to PLAY");
        socket.emit('play', { time: player.currentTime, room: roomId });
    });

    player.addEventListener('pause', () => {
        if (isReceivingUpdate || player.seeking) return; // Add player.seeking check
        fileNameDisplay.classList.remove('playing');
        updateThemeForPlayingState(); // Use debounced updater
        player.playbackRate = 1; // Reset playback rate on manual pause
        console.log("Requesting to PAUSE");
        socket.emit('pause', { time: player.currentTime, room: roomId });
    });



    player.addEventListener('seeked', () => {
        // Re-apply theme after seeking to maintain color consistency
        updateThemeForPlayingState();

        // FIX: The logic here is simplified to only fire when not receiving an update.
        // This prevents infinite loops where a 'seek' from the server triggers another 'seek' from the client.
        if (!isReceivingUpdate) {
            console.log(`--- 'seeked' event fired by user. Emitting... ---`);
            socket.emit('seek', { time: player.currentTime, room: roomId });
            // --- ADD THIS PART ---
            userHasJustSeeked = true;
            clearTimeout(seekDebounceTimer); // Clear any old timers
            // Ignore server corrections for the next 3 seconds
            seekDebounceTimer = setTimeout(() => {
                userHasJustSeeked = false;
            }, 3000);
            // --- END OF ADDED PART ---
        }
    });

    // --- SocketIO Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server. Joining room:', roomId);
        socket.emit('join', { room: roomId });

        syncWithServer();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(syncWithServer, 10000);

        fetch(`/current_song?room=${roomId}`)
            .then(response => response.json())
            .then(data => {
                if (data.current_file) {
                    loadAudio(data.current_file, data.current_cover);
                }
            });
    });

    socket.on('play', (data) => {
        console.log('Received play command:', data);
        isReceivingUpdate = true;
        player.currentTime = data.time;
        
        // Update UI state for this device when receiving play from another device
        fileNameDisplay.classList.add('playing');
        updateThemeForPlayingState();
        
        player.play().catch(e => console.error("Play command failed:", e)).finally(() => {
            setTimeout(() => { isReceivingUpdate = false; }, 100);
        });
    });

    socket.on('pause', (data) => {
        console.log('Received pause command:', data);
        isReceivingUpdate = true;
        player.playbackRate = 1; // Reset playback rate on pause
        player.pause();
        player.currentTime = data.time;
        
        // Update UI state for this device when receiving pause from another device
        fileNameDisplay.classList.remove('playing');
        updateThemeForPlayingState();
        
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    });

    socket.on('seek', (data) => {
        console.log('Received seek command:', data);
        isReceivingUpdate = true;
        player.currentTime = data.time;
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    });

    socket.on('new_file', (data) => loadAudio(data.filename, data.cover));

    // This handler receives the complete state when a user first joins a room
    socket.on('room_state', (data) => {
        console.log('Received initial room state:', data);
        loadAudio(data.current_file, data.current_cover);

        if (data.is_playing) {
            // If the room is playing, calculate where it should be and play
            const timeSinceUpdate = ((Date.now() + serverTimeOffset) / 1000) - data.last_updated_at;
            const currentAudioTime = data.last_progress_s + timeSinceUpdate;
            
            isReceivingUpdate = true;
            player.currentTime = currentAudioTime;
            
            // Update UI state when joining a playing room
            fileNameDisplay.classList.add('playing');
            updateThemeForPlayingState();
            
            player.play().catch(e => console.error("Initial play failed:", e)).finally(() => {
                setTimeout(() => { isReceivingUpdate = false; }, 100);
            });
        } else {
            // If the room is paused, just set the time
            isReceivingUpdate = true;
            player.currentTime = data.last_progress_s;
            
            // Update UI state when joining a paused room
            fileNameDisplay.classList.remove('playing');
            updateThemeForPlayingState();
            
            player.pause();
            setTimeout(() => { isReceivingUpdate = false; }, 100);
        }
    });

    socket.on('error', (data) => {
        alert(data.message);
        window.location.href = '/';
    });
    
    socket.on('server_sync', (data) => {
        // --- ADD THIS GUARD CLAUSE AT THE TOP ---
        if (userHasJustSeeked) {
            console.log("Ignoring server_sync because user has just seeked.");
            return;
        }
        // --- END OF GUARD CLAUSE ---
        // 1. Calculate the server's *current* audio position
        const timeSinceServerUpdate = ((Date.now() + serverTimeOffset) / 1000) - data.server_time;
        const serverProgress = data.audio_time + timeSinceServerUpdate;

        // 2. Get our local audio position
        const clientProgress = player.currentTime;

        // 3. Calculate the drift
        const drift = clientProgress - serverProgress;

        // 4. Correct the drift
        // We don't correct if we're seeking or if the user is interacting
        if (isReceivingUpdate || player.seeking) return;

        if (Math.abs(drift) > MAX_ALLOWED_DRIFT_S) {
            // --- Hard Correction: For large drifts ---
            console.warn(`Hard sync. Drift of ${drift.toFixed(2)}s is over the max allowed.`);
            isReceivingUpdate = true;
            player.currentTime = serverProgress;
            player.playbackRate = 1; // Reset playback rate after a hard seek
            setTimeout(() => { isReceivingUpdate = false; }, 150); // Give it time to settle
        } else if (Math.abs(drift) > 0.1) {
            // --- Soft Correction: For small drifts, adjust playback speed ---
            // This provides a much smoother user experience than constant small seeks
            if (drift > 0) { // We are ahead of the server
                player.playbackRate = 1 - PLAYBACK_RATE_ADJUST;
            } else { // We are behind the server
                player.playbackRate = 1 + PLAYBACK_RATE_ADJUST;
            }
        } else {
            // We are in sync, reset to normal speed
            player.playbackRate = 1;
        }
    });
    
    // --- Helper Functions ---
    function syncWithServer() {
        const sendTime = Date.now();
        socket.emit('get_server_time');
        socket.once('server_time', (data) => {
            const rtt = Date.now() - sendTime;
            const newOffset = (data.timestamp * 1000 + rtt / 2) - Date.now();
            console.log(`Time synced. RTT: ${rtt}ms, Server Offset: ${newOffset.toFixed(2)}ms`);
            serverTimeOffset = newOffset;
        });
    }
    
    function loadAudio(filename, cover) {
        console.log(`Loading audio: ${filename}, Cover: ${cover}`);
        fileNameText.title = filename;
        fileNameText.textContent = filename;
        player.src = `/uploads/${filename}`;
        player.load();
        // ... rest of the function is unchanged ...
        fileNameDisplay.classList.remove('playing');
        coverArt.style.boxShadow = 'none';
        resetTheme();
        if (cover) {
            coverArt.onload = () => {
                try {
                    const colorThief = new ColorThief();
                    const dominantColor = colorThief.getColor(coverArt);
                    const [r, g, b] = dominantColor;
                    currentDominantColor = dominantColor; // Store the color
                    coverArt.style.boxShadow = `0 0 15px rgba(${r},${g},${b},0.6), 0 0 35px rgba(${r},${g},${b},0.4)`;
                    applyTheme(dominantColor);
                } catch (e) { console.error("Error processing cover art:", e); resetTheme(); }
            };
            coverArt.onerror = () => { coverArt.style.display = 'none'; resetTheme(); };
            coverArt.src = `/uploads/${cover}`;
            coverArt.style.display = 'block';
        } else {
            coverArt.src = ''; 
            coverArt.style.display = 'none'; 
            currentDominantColor = null; // Clear stored color
            resetTheme();
        }
    }
    
    // --- Helper function to update theme based on playing state (debounced) ---
    function updateThemeForPlayingState() {
        clearTimeout(themeUpdateTimeout);
        themeUpdateTimeout = setTimeout(() => {
            if (currentDominantColor) {
                applyTheme(currentDominantColor);
            } else {
                // If no color, ensure playing-specific styles are removed
                resetTheme();
            }
        }, 60); // Debounce for 60ms
    }

    function getBrightness(r,g,b){return(r*299+g*587+b*114)/1000}
    function applyTheme(c){
        const[r,g,b]=c;
        if(getBrightness(r,g,b)<50){
            // For dark colors, apply theme to buttons but use accent color for border
            controlButtons.forEach(e=>{e.style.background='';e.style.color=''});
            
            if(fileNameDisplay.classList.contains('playing')){
                fileNameDisplay.style.borderColor = 'var(--accent-color)';
                fileNameDisplay.style.borderImage = 'none';
                fileNameDisplay.style.borderImageSlice = 0;
                document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => {
                    bar.style.background = 'var(--accent-color)';
                });
            } else {
                fileNameDisplay.style.borderColor = 'transparent';
                fileNameDisplay.style.borderImage = 'none';
                fileNameDisplay.style.borderImageSlice = 0;
                document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => {
                    bar.style.background = '';
                });
            }
            return;
        }
        
        const t=getBrightness(r,g,b)>140?'#000':'#FFF';
        const gradient=`linear-gradient(90deg,rgb(${r},${g},${b}),rgb(${Math.min(255,r+40)},${Math.min(255,g+40)},${Math.min(255,b+40)}))`;
        const solidColor=`rgb(${r},${g},${b})`;
        
        // Always apply to control buttons
        controlButtons.forEach(e=>{e.style.background=gradient;e.style.color=t});
    
        // Apply solid color to border (not gradient) and gradient to dancing bars only if playing
        if(fileNameDisplay.classList.contains('playing')){
            fileNameDisplay.style.borderColor = solidColor;
            fileNameDisplay.style.borderImage = 'none';
            fileNameDisplay.style.borderImageSlice = 0;
            document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => {
                bar.style.background = gradient;
            });
        } else {
            // Remove playing-specific styles but keep button colors
            fileNameDisplay.style.borderColor = 'transparent';
            fileNameDisplay.style.borderImage = 'none';
            fileNameDisplay.style.borderImageSlice = 0;
            document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => {
                bar.style.background = '';
            });
        }
    }
    function resetTheme(){
        controlButtons.forEach(e=>{e.style.background='';e.style.color=''})
        fileNameDisplay.style.borderColor = 'transparent';
        fileNameDisplay.style.borderImage = 'none';
        fileNameDisplay.style.borderImageSlice = 0;
        document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => {
            bar.style.background = '';
        });
        currentDominantColor = null; // Clear stored color
    }
});
