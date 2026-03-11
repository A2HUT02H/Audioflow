// =====================================================================
// AudioFlow - Configuration & Constants
// =====================================================================

const AudioFlowConfig = {
    // Sync settings
    MAX_ALLOWED_DRIFT_S: 0.5,
    PLAYBACK_RATE_ADJUST: 0.05,
    
    // File settings
    ALLOWED_EXTENSIONS: ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.aiff'],
    ALLOWED_MIME_TYPES: [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
        'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/x-m4a',
        'audio/aac', 'audio/x-aac', 'audio/x-ms-wma', 'audio/aiff', 'audio/x-aiff'
    ],
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB max
    
    // Fullscreen settings
    FULLSCREEN_IDLE_TIMEOUT: 2500, // ms
    
    // Default volume
    DEFAULT_VOLUME: 0.7
};

// Make it available globally
window.AudioFlowConfig = AudioFlowConfig;
