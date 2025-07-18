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

    // --- State Variables ---
    const roomId = document.body.dataset.roomId; // Get room ID from body data attribute
    let serverTimeOffset = 0;
    let isReceivingUpdate = false;
    let pingInterval;

    // --- Event Listeners ---
    if (uploadBtn && audioInput) {
        uploadBtn.addEventListener('click', () => {
            audioInput.click();
        });
        audioInput.addEventListener('change', () => {
            const file = audioInput.files[0];
            if (!file) return;
            fileNameText.textContent = `Uploading: ${file.name}`;
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('room', roomId); // Add room ID to the upload request
            fetch('/upload', { method: 'POST', body: formData })
                .then(response => response.json())
                .then(data => {
                    if (!data.success) {
                        fileNameText.textContent = data.error || 'Upload failed.';
                    }
                })
                .catch(error => {
                    console.error('Upload error:', error);
                    fileNameText.textContent = 'Upload error.';
                });
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            const delay = parseFloat(document.getElementById('delay-input').value) || 0.5;
            // Include room ID in the event payload
            socket.emit('sync', { time: player.currentTime, delay, room: roomId });
        });
    }
    
    player.addEventListener('play', () => {
        fileNameDisplay.classList.add('playing');
        if (isReceivingUpdate) return;
        const delay = parseFloat(document.getElementById('delay-input').value) || 0.5;
        // Include room ID in the event payload
        socket.emit('play', { time: player.currentTime, delay, room: roomId });
    });

    player.addEventListener('pause', () => {
        fileNameDisplay.classList.remove('playing');
        if (isReceivingUpdate) return;
        // Include room ID in the event payload
        socket.emit('pause', { time: player.currentTime, room: roomId });
    });
    
    player.addEventListener('seeked', () => {
        if (!isReceivingUpdate) {
            // Include room ID in the event payload
            socket.emit('seek', { time: player.currentTime, room: roomId });
        }
    });

    // --- SocketIO Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server.');
        // Join the specific room
        socket.emit('join', { room: roomId });

        syncWithServer(); 
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(syncWithServer, 10000);

        // Fetch the current song for this specific room
        fetch(`/current_song?room=${roomId}`)
            .then(response => response.json())
            .then(data => {
                if (data.current_file) {
                    loadAudio(data.current_file, data.current_cover);
                }
            });
    });

    socket.on('disconnect', () => {
        if (pingInterval) clearInterval(pingInterval);
        console.log('Disconnected from server.');
    });

    socket.on('new_file', (data) => {
        loadAudio(data.filename, data.cover);
    });

    socket.on('scheduled_play', (data) => {
        isReceivingUpdate = true;
        player.currentTime = data.audio_time;
        player.play().finally(() => setTimeout(() => { isReceivingUpdate = false; }, 100));
    });

    socket.on('sync_seek', (data) => {
        isReceivingUpdate = true;
        player.currentTime = data.audio_time;
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    });

    socket.on('pause', (data) => {
        isReceivingUpdate = true;
        player.currentTime = data.time;
        player.pause();
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    });

    socket.on('seek', (data) => {
        isReceivingUpdate = true;
        player.currentTime = data.time;
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    });
    
    socket.on('error', (data) => {
        alert(data.message);
        window.location.href = '/';
    });


    // --- Helper Functions ---
    function syncWithServer() {
        const sendTime = Date.now();
        socket.emit('get_server_time');
        socket.once('server_time', (data) => {
            const rtt = Date.now() - sendTime;
            serverTimeOffset = (data.timestamp * 1000 + rtt / 2) - Date.now();
        });
    }

    function getBrightness(r, g, b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    function applyTheme(dominantColor) {
        const [r, g, b] = dominantColor;
        const brightness = getBrightness(r, g, b);

        if (brightness < 50) {
            resetTheme();
            return;
        }

        const textColor = brightness > 140 ? '#000000' : '#FFFFFF';
        const r2 = Math.min(255, r + 40);
        const g2 = Math.min(255, g + 40);
        const b2 = Math.min(255, b + 40);
        const newGradient = `linear-gradient(90deg, rgb(${r}, ${g}, ${b}), rgb(${r2}, ${g2}, ${b2}))`;
        
        controlButtons.forEach(button => {
            button.style.background = newGradient;
            button.style.color = textColor;
        });
    }

    function resetTheme() {
        controlButtons.forEach(button => {
            button.style.background = '';
            button.style.color = '';
        });
    }
    
    function loadAudio(filename, cover) {
        fileNameText.title = filename;
        fileNameText.textContent = filename;
        player.src = `/uploads/${filename}`;
        player.load();
        fileNameDisplay.classList.remove('playing');
        coverArt.style.boxShadow = 'none';
        
        resetTheme();

        if (cover) {
            coverArt.onload = () => {
                try {
                    const colorThief = new ColorThief();
                    const dominantColor = colorThief.getColor(coverArt);
                    const [r, g, b] = dominantColor;
                    
                    const glowColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
                    const softGlow = `rgba(${r}, ${g}, ${b}, 0.4)`;
                    coverArt.style.boxShadow = `0 0 15px ${glowColor}, 0 0 35px ${softGlow}`;

                    applyTheme(dominantColor);
                } catch (e) {
                    console.error("Error processing cover art:", e);
                    resetTheme();
                }
            };
            coverArt.onerror = () => {
                console.log('Cover art failed to load.');
                coverArt.style.display = 'none';
                coverArt.style.boxShadow = 'none';
                resetTheme();
            };
            coverArt.src = `/uploads/${cover}`;
            coverArt.style.display = 'block';
        } else {
            console.log('No cover art available');
            coverArt.src = '';
            coverArt.style.display = 'none';
            resetTheme();
        }
    }
});