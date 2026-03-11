// =====================================================================
// AudioFlow - Audio Visualizer Module
// =====================================================================

const AudioFlowVisualizer = (function() {
    // Private state
    let audioContext = null;
    let analyser = null;
    let leftAnalyser = null;
    let rightAnalyser = null;
    let dataArray = null;
    let leftDataArray = null;
    let rightDataArray = null;
    let source = null;
    let splitter = null;
    let animationId = null;
    let visualizerInterval = null;

    // DOM elements (will be set during init)
    let player = null;
    let coverDancingBarsLeft = null;
    let coverDancingBarsRight = null;

    function init(elements) {
        // Accept either { player } object (from main.js) or a raw element for backward compat
        if (elements && elements.player) {
            player = elements.player;
        } else {
            player = elements;
        }
        // Always resolve bar elements from the DOM
        coverDancingBarsLeft = document.querySelector('.cover-dancing-bars.left');
        coverDancingBarsRight = document.querySelector('.cover-dancing-bars.right');
    }

    function initAudioContext() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.3;
                analyser.minDecibels = -90;
                analyser.maxDecibels = -10;
                
                leftAnalyser = audioContext.createAnalyser();
                rightAnalyser = audioContext.createAnalyser();
                
                leftAnalyser.fftSize = 512;
                leftAnalyser.smoothingTimeConstant = 0.3;
                leftAnalyser.minDecibels = -90;
                leftAnalyser.maxDecibels = -10;
                
                rightAnalyser.fftSize = 512;
                rightAnalyser.smoothingTimeConstant = 0.3;
                rightAnalyser.minDecibels = -90;
                rightAnalyser.maxDecibels = -10;
                
                splitter = audioContext.createChannelSplitter(2);
                
                const bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
                leftDataArray = new Uint8Array(leftAnalyser.frequencyBinCount);
                rightDataArray = new Uint8Array(rightAnalyser.frequencyBinCount);
                
                console.log('Audio context initialized with stereo channel separation');
            } catch (e) {
                console.error('Could not initialize audio context:', e);
            }
        }
    }

    function connectAudioSource() {
        if (audioContext && analyser && leftAnalyser && rightAnalyser && splitter && !source) {
            try {
                source = audioContext.createMediaElementSource(player);
                
                source.connect(analyser);
                source.connect(splitter);
                
                splitter.connect(leftAnalyser, 0);
                splitter.connect(rightAnalyser, 1);
                
                source.connect(audioContext.destination);
                
                console.log('Audio source connected with stereo channel separation');
            } catch (e) {
                console.error('Could not connect audio source:', e);
                if (source) {
                    try {
                        source.connect(analyser);
                        source.connect(audioContext.destination);
                        console.log('Audio source connected in mono fallback mode');
                    } catch (reconnectError) {
                        console.error('Could not reconnect audio source:', reconnectError);
                    }
                }
            }
        } else if (audioContext && analyser && source) {
            try {
                source.connect(analyser);
                source.connect(audioContext.destination);
                console.log('Existing audio source reconnected');
            } catch (e) {
                console.log('Source already connected or connection failed:', e.message);
            }
        }
    }

    function ensureAudioConnection() {
        console.log('ensureAudioConnection called');
        if (audioContext && source && analyser && leftAnalyser && rightAnalyser) {
            try {
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                console.log('Stereo audio connection verified after seek');
            } catch (e) {
                console.error('Error ensuring stereo audio connection:', e);
            }
        } else {
            console.log('Reconnecting stereo audio source');
            connectAudioSource();
        }
    }

    function updateVisualizerBars() {
        if (!leftAnalyser || !rightAnalyser || !leftDataArray || !rightDataArray) {
            console.log('Stereo visualizer not running: analysers or data arrays missing');
            return;
        }

        leftAnalyser.getByteFrequencyData(leftDataArray);
        rightAnalyser.getByteFrequencyData(rightDataArray);

        const leftBars = coverDancingBarsLeft ? coverDancingBarsLeft.querySelectorAll('.bar') : [];
        const rightBars = coverDancingBarsRight ? coverDancingBarsRight.querySelectorAll('.bar') : [];

        const leftBass = leftDataArray[5];
        const leftMid = leftDataArray[15];
        const leftTreble = leftDataArray[25];

        const rightBass = rightDataArray[5];
        const rightMid = rightDataArray[15];
        const rightTreble = rightDataArray[25];

        const isFullscreen = document.body.classList.contains('fullscreen-mode');
        const isMobile = window.innerWidth <= 600;
        const isExtraSmall = window.innerWidth <= 400;
        
        let maxHeight;
        if (isFullscreen) {
            if (isExtraSmall) {
                maxHeight = 180;
            } else if (isMobile) {
                maxHeight = 220;
            } else {
                maxHeight = 280;
            }
        } else {
            maxHeight = 180;
        }

        const normalize = (value, max = 255, silenceThreshold = 10) => {
            if (value < silenceThreshold) return '0px';
            return `${(value / max) * maxHeight}px`;
        };

        if (leftBars.length >= 3) {
            leftBars[0].style.height = normalize(leftTreble);
            leftBars[1].style.height = normalize(leftMid);
            leftBars[2].style.height = normalize(leftBass);
        }

        if (rightBars.length >= 3) {
            rightBars[0].style.height = normalize(rightBass);
            rightBars[1].style.height = normalize(rightMid);
            rightBars[2].style.height = normalize(rightTreble);
        }

        if (!player.paused) {
            animationId = requestAnimationFrame(updateVisualizerBars);
        } else {
            animationId = null;
            if (visualizerInterval) {
                clearInterval(visualizerInterval);
                visualizerInterval = null;
            }
        }
    }

    function start() {
        console.log('startVisualizer called');
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
            console.log('Audio context resumed');
        }
        ensureAudioConnection();
        
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        if (!player.paused) {
            console.log('Starting visualizer animation loop');
            updateVisualizerBars();
            
            if (!visualizerInterval) {
                visualizerInterval = setInterval(() => {
                    if (!animationId && !player.paused) {
                        console.log('Backup interval restarting animation');
                        updateVisualizerBars();
                    }
                }, 100);
            }
        } else {
            console.log(`Visualizer not started: paused=${player.paused}`);
        }
    }

    function stop() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        if (visualizerInterval) {
            clearInterval(visualizerInterval);
            visualizerInterval = null;
        }
        
        const allBars = document.querySelectorAll('.cover-dancing-bars .bar');
        allBars.forEach((bar, index) => {
            if (bar.closest('.left')) {
                if (index === 0) bar.style.height = '10px';
                else if (index === 1) bar.style.height = '15px';
                else if (index === 2) bar.style.height = '20px';
            } else {
                if (index === 0) bar.style.height = '20px';
                else if (index === 1) bar.style.height = '15px';
                else if (index === 2) bar.style.height = '10px';
            }
        });
    }

    function enableOnInteraction() {
        function enable() {
            initAudioContext();
            document.removeEventListener('click', enable);
            document.removeEventListener('keydown', enable);
        }
        document.addEventListener('click', enable);
        document.addEventListener('keydown', enable);
    }

    // Public API
    return {
        init,
        initAudioContext,
        connectAudioSource,
        ensureAudioConnection,
        start,
        stop,
        enableOnInteraction
    };
})();

// Make it available globally
window.AudioFlowVisualizer = AudioFlowVisualizer;
