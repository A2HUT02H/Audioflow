document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements & Initial Setup ---
    const socket = io();
    const colorThief = new ColorThief();
    const player = document.getElementById('player');
    const audioInput = document.getElementById('audio-input');
    const uploadBtn = document.getElementById('upload-btn');
    const syncBtn = document.getElementById('sync-btn');
    const fileNameDisplay = document.getElementById('file-name');
    const fileNameText = document.getElementById('file-name-text');
    const coverArt = document.getElementById('cover-art');
    const controlButtons = document.querySelectorAll('.control-button');
    const nowPlayingIndicator = document.querySelector('.now-playing-indicator');

    // --- State & Configuration ---
    const roomId = document.body.dataset.roomId;
    let isReceivingUpdate = false;
    let userHasJustSeeked = false;
    let seekDebounceTimer = null;
    let pingInterval;
    let currentDominantColor = null;
    let themeUpdateTimeout;

    // FIX: Removed duplicate declaration of serverTimeOffset. This was the main bug.
    let serverTimeOffset = 0;

    // Configuration for drift correction
    const MAX_ALLOWED_DRIFT_S = 0.5;
    const PLAYBACK_RATE_ADJUST = 0.05;

    // =================================================================================
    // Clock Synchronization
    // =================================================================================
    function syncClock() {
        const startTime = Date.now();
        socket.emit('client_ping');
        socket.once('server_pong', (data) => {
            const roundTripTime = Date.now() - startTime;
            const serverTime = data.timestamp * 1000;
            const estimatedServerTime = serverTime + (roundTripTime / 2);
            serverTimeOffset = estimatedServerTime - Date.now();
            console.log(`Clock synced. RTT: ${roundTripTime}ms, Offset: ${serverTimeOffset.toFixed(2)}ms`);
        });
    }

    // =================================================================================
    // User Action Event Listeners
    // =================================================================================

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
                    // FIX: Added explicit handling for both success and failure from the fetch response.
                    if (data.success) {
                        // The UI will be updated by the 'new_file' socket event,
                        // so we don't need to do anything here except log success.
                        console.log('Upload successful. Waiting for new_file event.');
                    } else {
                        alert(data.error || 'Upload failed.');
                        fileNameText.textContent = 'Upload failed.';
                    }
                }).catch(error => {
                    alert('An unexpected error occurred during upload.');
                    console.error('Upload fetch error:', error);
                    fileNameText.textContent = 'Upload error.';
                });
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (!player.src || player.src.endsWith('/null')) return;
            console.log('--- User initiated manual sync ---');
            socket.emit('sync', { room: roomId, time: player.currentTime });
        });
    }

    player.addEventListener('play', () => {
        if (isReceivingUpdate) return;
        socket.emit('play', { room: roomId, time: player.currentTime });
    });

    player.addEventListener('pause', () => {
        if (isReceivingUpdate || player.seeking) return;
        player.playbackRate = 1.0;
        socket.emit('pause', { room: roomId });
    });

    player.addEventListener('seeked', () => {
        if (isReceivingUpdate) return;
        socket.emit('seek', { room: roomId, time: player.currentTime });
        userHasJustSeeked = true;
        clearTimeout(seekDebounceTimer);
        seekDebounceTimer = setTimeout(() => {
            userHasJustSeeked = false;
        }, 2000);
    });

    // =================================================================================
    // Socket.IO Event Handlers (Commands from Server)
    // =================================================================================

    socket.on('connect', () => {
        console.log('Connected! Joining room:', roomId);
        socket.emit('join', { room: roomId });
        syncClock();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(syncClock, 15000);
    });

    socket.on('scheduled_play', (data) => {
        isReceivingUpdate = true;
        const targetTimestamp = (data.target_timestamp * 1000) + serverTimeOffset;
        const delay = targetTimestamp - Date.now();
        player.currentTime = data.audio_time;
        if (delay > 0) {
            setTimeout(() => player.play(), delay);
        } else {
            player.play();
        }
        fileNameDisplay.classList.add('playing');
        nowPlayingIndicator.classList.add('playing');
        updateThemeForPlayingState();
        setTimeout(() => { isReceivingUpdate = false; }, delay > 0 ? delay + 100 : 100);
    });

    socket.on('pause', (data) => {
        isReceivingUpdate = true;
        player.pause();
        player.playbackRate = 1.0;
        player.currentTime = data.time;
        fileNameDisplay.classList.remove('playing');
        nowPlayingIndicator.classList.remove('playing');
        updateThemeForPlayingState();
        setTimeout(() => { isReceivingUpdate = false; }, 150);
    });

    socket.on('new_file', (data) => {
        loadAudio(data.filename, data.cover);
    });

    socket.on('room_state', (data) => {
        if (data.current_file) {
            loadAudio(data.current_file, data.current_cover);
            let intendedTime = data.last_progress_s;
            if (data.is_playing) {
                const timeSinceUpdate = (Date.now() + serverTimeOffset) / 1000 - data.last_updated_at;
                intendedTime += timeSinceUpdate;
                const delay = 500; // Join buffer
                isReceivingUpdate = true;
                player.currentTime = intendedTime;
                setTimeout(() => player.play(), delay);
                fileNameDisplay.classList.add('playing');
                nowPlayingIndicator.classList.add('playing');
                updateThemeForPlayingState();
                setTimeout(() => { isReceivingUpdate = false; }, delay + 100);
            } else {
                player.currentTime = intendedTime;
                player.pause();
            }
        }
    });

    socket.on('server_sync', (data) => {
        if (userHasJustSeeked || player.paused || isReceivingUpdate || player.seeking) {
            return;
        }
        const timeSinceServerUpdate = ((Date.now() + serverTimeOffset) / 1000) - data.server_time;
        const serverProgress = data.audio_time + timeSinceServerUpdate;
        const clientProgress = player.currentTime;
        const drift = clientProgress - serverProgress;

        if (Math.abs(drift) > MAX_ALLOWED_DRIFT_S) {
            player.currentTime = serverProgress;
            player.playbackRate = 1.0;
        } else if (Math.abs(drift) > 0.08) {
            player.playbackRate = (drift > 0) ? 1.0 - PLAYBACK_RATE_ADJUST : 1.0 + PLAYBACK_RATE_ADJUST;
        } else {
            player.playbackRate = 1.0;
        }
    });

    socket.on('error', (data) => {
        alert(data.message);
        window.location.href = '/';
    });

    // =================================================================================
    // UI & Theme Helper Functions
    // =================================================================================
    
    function loadAudio(filename, cover) {
        if (!filename) {
            fileNameText.textContent = "No file selected.";
            return;
        }
        fileNameText.title = filename.replace(/_/g, " ");
        fileNameText.textContent = filename.replace(/_/g, " ");
        player.src = `/uploads/${filename}`;
        player.load();
        
        fileNameDisplay.classList.remove('playing');
        nowPlayingIndicator.classList.remove('playing');
        coverArt.style.boxShadow = 'none';
        resetTheme();

        if (cover) {
            coverArt.src = `/uploads/${cover}`;
            coverArt.style.display = 'block';
            coverArt.onload = () => {
                try {
                    const dominantColor = colorThief.getColor(coverArt);
                    currentDominantColor = dominantColor;
                    const [r, g, b] = dominantColor;
                    coverArt.style.boxShadow = `0 0 15px rgba(${r},${g},${b},0.6), 0 0 35px rgba(${r},${g},${b},0.4)`;
                    applyTheme(dominantColor);
                } catch (e) {
                    resetTheme();
                }
            };
            coverArt.onerror = () => {
                coverArt.style.display = 'none';
                resetTheme();
            };
        } else {
            coverArt.src = '';
            coverArt.style.display = 'none';
            currentDominantColor = null;
            resetTheme();
        }
    }

    function updateThemeForPlayingState() {
        clearTimeout(themeUpdateTimeout);
        themeUpdateTimeout = setTimeout(() => {
            if (currentDominantColor) {
                applyTheme(currentDominantColor);
            } else {
                resetTheme();
            }
        }, 60);
    }
    
    function getBrightness(r, g, b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    function applyTheme(c) {
        const [r, g, b] = c;
        const isDarkColor = getBrightness(r, g, b) < 50;
        const textColor = getBrightness(r, g, b) > 140 ? '#000' : '#FFF';
        const gradient = `linear-gradient(90deg,rgb(${r},${g},${b}),rgb(${Math.min(255,r+40)},${Math.min(255,g+40)},${Math.min(255,b+40)}))`;

        // Always set border color for #file-name.playing
        if (fileNameDisplay.classList.contains('playing')) {
            fileNameDisplay.style.borderColor = isDarkColor ? 'var(--accent-color)' : `rgb(${r},${g},${b})`;
        } else {
            fileNameDisplay.style.borderColor = '';
        }

        if (isDarkColor) {
            controlButtons.forEach(e => {
                e.style.background = '';
                e.style.color = ''
            });
            if (nowPlayingIndicator.classList.contains('playing')) {
                document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => bar.style.background = 'var(--accent-color)');
            } else {
                document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => bar.style.background = '');
            }
            return;
        }

        controlButtons.forEach(e => {
            e.style.background = gradient;
            e.style.color = textColor
        });
        if (nowPlayingIndicator.classList.contains('playing')) {
            document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => bar.style.background = gradient);
        } else {
            document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => bar.style.background = '');
        }
    }

    function resetTheme() {
        controlButtons.forEach(e => {
            e.style.background = '';
            e.style.color = ''
        });
        document.querySelectorAll('.now-playing-indicator .bar').forEach(bar => bar.style.background = '');
        fileNameDisplay.style.borderColor = '';
        currentDominantColor = null;
    }
});
