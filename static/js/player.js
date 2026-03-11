// =====================================================================
// AudioFlow - Custom Player Controls Module
// =====================================================================

const AudioFlowPlayer = (function() {
    // Private state
    let player = null;
    let playPauseBtn = null;
    let playPauseIcon = null;
    let prevBtn = null;
    let nextBtn = null;
    let loopBtn = null;
    let loopIcon = null;
    let shuffleBtn = null;
    let shuffleIcon = null;
    let currentTimeDisplay = null;
    let totalTimeDisplay = null;
    let progressBar = null;
    let progressFill = null;
    let progressHandle = null;
    let volumeBtn = null;
    let volumeIcon = null;
    let volumeSliderHorizontal = null;
    let volumeFillHorizontal = null;
    let volumeHandleHorizontal = null;
    
    let socket = null;
    let roomId = null;
    
    let isDraggingProgress = false;
    let isDraggingVolume = false;
    let lastVolume = window.AudioFlowConfig ? window.AudioFlowConfig.DEFAULT_VOLUME : 0.7;
    let isLooping = false;
    let isShuffling = false;

    function init(elements, socketInstance, room) {
        player = elements.player;
        playPauseBtn = elements.playPauseBtn;
        playPauseIcon = elements.playPauseIcon;
        prevBtn = elements.prevBtn;
        nextBtn = elements.nextBtn;
        loopBtn = elements.loopBtn;
        loopIcon = elements.loopIcon;
        shuffleBtn = elements.shuffleBtn;
        shuffleIcon = elements.shuffleIcon;
        currentTimeDisplay = elements.currentTimeDisplay;
        totalTimeDisplay = elements.totalTimeDisplay;
        progressBar = elements.progressBar;
        progressFill = elements.progressFill;
        progressHandle = elements.progressHandle;
        volumeBtn = elements.volumeBtn;
        volumeIcon = elements.volumeIcon;
        volumeSliderHorizontal = elements.volumeSliderHorizontal;
        volumeFillHorizontal = elements.volumeFillHorizontal;
        volumeHandleHorizontal = elements.volumeHandleHorizontal;
        
        socket = socketInstance;
        roomId = room;
    }

    function formatTime(seconds) {
        return window.AudioFlowUtils ? window.AudioFlowUtils.formatTime(seconds) : '0:00';
    }

    function updateProgressBar() {
        if (isDraggingProgress) return;
        
        if (!progressFill || !progressHandle || !currentTimeDisplay || !totalTimeDisplay) {
            return;
        }
        
        if (!player.duration) {
            progressFill.style.width = '0%';
            progressHandle.style.left = '0%';
            currentTimeDisplay.textContent = "0:00";
            return;
        }
        
        const progress = (player.currentTime / player.duration) * 100;
        progressFill.style.width = `${progress}%`;
        progressHandle.style.left = `${progress}%`;
        
        currentTimeDisplay.textContent = formatTime(player.currentTime);
        totalTimeDisplay.textContent = formatTime(player.duration);
    }

    function updateVolumeDisplay() {
        if (isDraggingVolume) return;
        
        if (!volumeFillHorizontal || !volumeHandleHorizontal || !volumeIcon) {
            return;
        }
        
        const volumePercent = player.volume * 100;
        volumeFillHorizontal.style.width = `${volumePercent}%`;
        volumeHandleHorizontal.style.left = `${volumePercent}%`;
        
        if (player.volume === 0) {
            volumeIcon.className = 'fas fa-volume-mute';
        } else if (player.volume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down';
        } else {
            volumeIcon.className = 'fas fa-volume-up';
        }
    }

    function toggleMute() {
        if (player.volume === 0) {
            player.volume = lastVolume > 0 ? lastVolume : 0.7;
        } else {
            lastVolume = player.volume;
            player.volume = 0;
        }
        updateVolumeDisplay();
    }

    function updatePlayPauseButton() {
        if (!playPauseIcon) return;
        
        if (player.paused) {
            playPauseIcon.className = 'fas fa-play';
        } else {
            playPauseIcon.className = 'fas fa-pause';
        }
    }

    function toggleLoop() {
        isLooping = !isLooping;
        updateLoopButton();
        console.log('Loop mode:', isLooping ? 'enabled' : 'disabled');
        
        if (socket && roomId) {
            socket.emit('loop_toggle', { room: roomId, isLooping: isLooping });
        }
    }

    function updateLoopButton() {
        if (!loopBtn || !loopIcon) return;
        
        if (isLooping) {
            loopBtn.classList.add('loop-active');
            loopBtn.style.removeProperty('background');
            loopBtn.style.background = 'transparent';
        } else {
            loopBtn.classList.remove('loop-active');
            loopBtn.style.removeProperty('background');
        }
    }

    function toggleShuffle() {
        isShuffling = !isShuffling;
        updateShuffleButton();
        console.log('Shuffle mode:', isShuffling ? 'enabled' : 'disabled');
        
        if (socket && roomId) {
            socket.emit('shuffle_toggle', { room: roomId, isShuffling: isShuffling });
        }
    }

    function updateShuffleButton() {
        if (!shuffleBtn || !shuffleIcon) return;
        
        if (isShuffling) {
            shuffleBtn.classList.add('shuffle-active');
            shuffleBtn.style.removeProperty('background');
            shuffleBtn.style.background = 'transparent';
        } else {
            shuffleBtn.classList.remove('shuffle-active');
            shuffleBtn.style.removeProperty('background');
        }
    }

    function setupProgressDragging() {
        if (!progressBar) return;
        
        const progressBarContainer = progressBar.parentElement;

        function updateDragPosition(e) {
            const rect = progressBarContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const progress = Math.max(0, Math.min(1, clickX / rect.width));
            
            const progressPercent = progress * 100;
            progressFill.style.width = `${progressPercent}%`;
            progressHandle.style.left = `${progressPercent}%`;
            
            if (player.duration) {
                const newTime = progress * player.duration;
                currentTimeDisplay.textContent = formatTime(newTime);
            }
        }

        function onMouseDown(e) {
            if (!player.duration) return;
            isDraggingProgress = true;
            
            progressFill.classList.add('dragging');
            progressHandle.classList.add('dragging');
            
            updateDragPosition(e);
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        }

        function onMouseMove(e) {
            if (!isDraggingProgress) return;
            updateDragPosition(e);
        }

        function onMouseUp(e) {
            if (!isDraggingProgress) return;
            isDraggingProgress = false;
            
            progressFill.classList.remove('dragging');
            progressHandle.classList.remove('dragging');
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            const rect = progressBarContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const progress = Math.max(0, Math.min(1, clickX / rect.width));
            player.currentTime = progress * player.duration;
        }

        progressBarContainer.addEventListener('mousedown', onMouseDown);
    }

    function setupVolumeDragging() {
        if (!volumeSliderHorizontal) return;

        function updateVolumePosition(e) {
            const rect = volumeSliderHorizontal.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const newVolume = Math.max(0, Math.min(1, clickX / rect.width));
            
            player.volume = newVolume;
            if (newVolume > 0) {
                lastVolume = newVolume;
            }
            
            const volumePercent = newVolume * 100;
            volumeFillHorizontal.style.width = `${volumePercent}%`;
            volumeHandleHorizontal.style.left = `${volumePercent}%`;
            
            if (newVolume === 0) {
                volumeIcon.className = 'fas fa-volume-mute';
            } else if (newVolume < 0.5) {
                volumeIcon.className = 'fas fa-volume-down';
            } else {
                volumeIcon.className = 'fas fa-volume-up';
            }
        }

        function onMouseDown(e) {
            isDraggingVolume = true;
            
            volumeFillHorizontal.classList.add('dragging');
            volumeHandleHorizontal.classList.add('dragging');
            
            updateVolumePosition(e);
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        }

        function onMouseMove(e) {
            if (!isDraggingVolume) return;
            updateVolumePosition(e);
        }

        function onMouseUp() {
            isDraggingVolume = false;
            
            volumeFillHorizontal.classList.remove('dragging');
            volumeHandleHorizontal.classList.remove('dragging');
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        volumeSliderHorizontal.addEventListener('mousedown', onMouseDown);
    }

    function initializePlayer() {
        console.log('[DEBUG] Initializing custom player');
        
        const customPlayerElement = document.querySelector('.custom-player');
        if (customPlayerElement) {
            customPlayerElement.style.display = 'block';
            customPlayerElement.style.visibility = 'visible';
        }
        
        if (player) {
            player.style.display = 'none';
            player.controls = false;
        }
        
        player.volume = lastVolume;
        updateVolumeDisplay();
        updatePlayPauseButton();
        updateLoopButton();
        updateShuffleButton();
        updateProgressBar();

        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                playPauseBtn.classList.remove('playing-pulse');
                void playPauseBtn.offsetWidth;
                playPauseBtn.classList.add('playing-pulse');
                
                if (player.paused) {
                    player.play();
                } else {
                    player.pause();
                }
            });
        }

        if (volumeBtn) {
            volumeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isMobile = window.innerWidth <= 600;
                if (isMobile) {
                    const volumeControl = volumeBtn.closest('.volume-control');
                    if (volumeControl) {
                        volumeControl.classList.toggle('open');
                    }
                } else {
                    toggleMute();
                }
            });
        }

        document.addEventListener('click', (e) => {
            const volumeControl = document.querySelector('.volume-control.open');
            if (volumeControl && !volumeControl.contains(e.target)) {
                volumeControl.classList.remove('open');
            }
        });

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (socket && roomId) {
                    socket.emit('previous_song', { room: roomId });
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (socket && roomId) {
                    socket.emit('next_song', { room: roomId });
                }
            });
        }

        if (loopBtn) {
            loopBtn.addEventListener('click', toggleLoop);
        }

        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', toggleShuffle);
        }

        setupProgressDragging();
        setupVolumeDragging();

        player.addEventListener('loadedmetadata', updateProgressBar);
        player.addEventListener('timeupdate', updateProgressBar);
        player.addEventListener('play', updatePlayPauseButton);
        player.addEventListener('pause', updatePlayPauseButton);
        player.addEventListener('volumechange', updateVolumeDisplay);
        
        console.log('[SUCCESS] Custom player initialization completed!');
    }

    function setLooping(value) {
        isLooping = value;
        updateLoopButton();
    }

    function setShuffling(value) {
        isShuffling = value;
        updateShuffleButton();
    }

    function getLooping() {
        return isLooping;
    }

    function getShuffling() {
        return isShuffling;
    }

    function updateNextPrevButtons(queueLength) {
        if (prevBtn) {
            prevBtn.disabled = queueLength <= 1;
            prevBtn.style.opacity = queueLength <= 1 ? '0.5' : '1';
        }
        if (nextBtn) {
            nextBtn.disabled = queueLength <= 1;
            nextBtn.style.opacity = queueLength <= 1 ? '0.5' : '1';
        }
    }

    // Public API
    return {
        init,
        initializePlayer,
        updateProgressBar,
        updateVolumeDisplay,
        updatePlayPauseButton,
        toggleLoop,
        toggleShuffle,
        updateLoopButton,
        updateShuffleButton,
        setLooping,
        setShuffling,
        getLooping,
        getShuffling,
        updateNextPrevButtons,
        toggleMute
    };
})();

// Make it available globally
window.AudioFlowPlayer = AudioFlowPlayer;
