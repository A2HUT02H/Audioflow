// =====================================================================
// AudioFlow - Upload Module
// =====================================================================

const AudioFlowUpload = (function() {
    // Private state
    let dragCounter = 0;
    let uploadQueue = [];
    let isUploading = false;
    let isQueueDragging = false;

    // DOM elements
    let uploadBtn = null;
    let uploadStemsBtn = null;
    let audioInput = null;
    let vocalsInput = null;
    let instrumentalInput = null;
    let dragDropOverlay = null;
    let songTitleElement = null;
    let songArtistElement = null;
    let fileNameDisplay = null;
    let roomId = null;
    let pendingVocalsFile = null;

    // Configuration
    const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.aiff'];
    const ALLOWED_MIME_TYPES = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
        'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/x-m4a',
        'audio/aac', 'audio/x-aac', 'audio/x-ms-wma', 'audio/aiff', 'audio/x-aiff'
    ];
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB max

    function init(elements, room) {
        uploadBtn = elements.uploadBtn;
        uploadStemsBtn = elements.uploadStemsBtn;
        audioInput = elements.audioInput;
        vocalsInput = elements.vocalsInput;
        instrumentalInput = elements.instrumentalInput;
        dragDropOverlay = elements.dragDropOverlay;
        songTitleElement = elements.songTitleElement;
        songArtistElement = elements.songArtistElement;
        fileNameDisplay = elements.fileNameDisplay;
        roomId = room;

        setupUploadButton();
        setupStemUploadButton();
        setupDragDrop();
    }

    function setupUploadButton() {
        if (uploadBtn && audioInput) {
            console.log('[DEBUG] Upload button and audio input found, setting up event listeners');
            
            uploadBtn.addEventListener('click', () => {
                console.log('[DEBUG] Upload button clicked');
                audioInput.click();
            });

            audioInput.addEventListener('change', () => {
                console.log('[DEBUG] File input changed');
                const file = audioInput.files[0];
                if (!file) {
                    console.log('[DEBUG] No file selected');
                    return;
                }

                console.log('[DEBUG] File selected:', file.name, 'Size:', file.size, 'Type:', file.type);
                
                // Add uploading class to prevent animation and enable proper truncation
                if (fileNameDisplay) {
                    fileNameDisplay.classList.add('uploading');
                }
                
                // Truncate filename for display during upload
                const truncatedName = truncateFilename(file.name, 35);
                if (songTitleElement) {
                    songTitleElement.textContent = `Uploading: ${truncatedName}`;
                }
                if (songArtistElement) {
                    songArtistElement.textContent = "";
                }
                
                const formData = new FormData();
                formData.append('audio', file);
                formData.append('room', roomId);

                console.log('[DEBUG] Starting upload request to /upload');
                fetch('/upload', { method: 'POST', body: formData })
                    .then(response => {
                        console.log('[DEBUG] Upload response status:', response.status);
                        return response.json();
                    })
                    .then(data => {
                        console.log('[DEBUG] Upload response data:', data);
                        if (fileNameDisplay) {
                            fileNameDisplay.classList.remove('uploading');
                        }
                        
                        if (data.success) {
                            console.log('Upload successful. Waiting for new_file event.');
                        } else {
                            console.error('Upload failed:', data.error);
                            alert(data.error || 'Upload failed.');
                            if (songTitleElement) songTitleElement.textContent = 'Upload failed.';
                            if (songArtistElement) songArtistElement.textContent = "";
                        }
                    }).catch(error => {
                        console.error('Upload fetch error:', error);
                        if (fileNameDisplay) {
                            fileNameDisplay.classList.remove('uploading');
                        }
                        alert('An unexpected error occurred during upload.');
                        if (songTitleElement) songTitleElement.textContent = 'Upload error.';
                        if (songArtistElement) songArtistElement.textContent = "";
                    });
            });
        } else {
            console.error('[ERROR] Upload button or audio input not found!');
        }
    }

    function setupStemUploadButton() {
        if (!uploadStemsBtn || !vocalsInput || !instrumentalInput) {
            console.warn('[Upload] Stem upload controls not found, skipping stem setup');
            return;
        }

        uploadStemsBtn.addEventListener('click', () => {
            pendingVocalsFile = null;
            vocalsInput.value = '';
            instrumentalInput.value = '';
            if (songTitleElement) {
                songTitleElement.textContent = 'Step 1/2: Select VOCALS stem file';
            }
            if (songArtistElement) {
                songArtistElement.textContent = 'Step 2/2 will ask for the INSTRUMENTAL file';
            }
            vocalsInput.click();
        });

        vocalsInput.addEventListener('change', () => {
            const file = vocalsInput.files && vocalsInput.files[0];
            if (!file) {
                pendingVocalsFile = null;
                return;
            }

            const validationError = validateAudioFile(file, 'Vocals');
            if (validationError) {
                alert(validationError);
                pendingVocalsFile = null;
                vocalsInput.value = '';
                return;
            }

            pendingVocalsFile = file;
            if (songTitleElement) {
                songTitleElement.textContent = `Vocals selected: ${truncateFilename(file.name, 30)}`;
            }
            if (songArtistElement) {
                songArtistElement.textContent = 'Now select the instrumental file...';
            }

            instrumentalInput.click();
        });

        instrumentalInput.addEventListener('change', () => {
            const file = instrumentalInput.files && instrumentalInput.files[0];
            if (!file) {
                pendingVocalsFile = null;
                instrumentalInput.value = '';
                return;
            }

            if (!pendingVocalsFile) {
                alert('Please select a vocals file first.');
                instrumentalInput.value = '';
                return;
            }

            const validationError = validateAudioFile(file, 'Instrumental');
            if (validationError) {
                alert(validationError);
                instrumentalInput.value = '';
                pendingVocalsFile = null;
                return;
            }

            let vocals = pendingVocalsFile;
            let instrumental = file;

            // If filenames strongly indicate the user picked files in reverse order,
            // offer to auto-swap before upload.
            if (isLikelyStemSwap(vocals, instrumental)) {
                const swap = confirm(
                    'The first file looks instrumental and the second looks vocal.\n\n' +
                    'Click OK to auto-swap (recommended), or Cancel to keep current order.'
                );
                if (swap) {
                    [vocals, instrumental] = [instrumental, vocals];
                }
            }

            pendingVocalsFile = null;
            uploadStemPair(vocals, instrumental);
            vocalsInput.value = '';
            instrumentalInput.value = '';
        });
    }

    function isLikelyStemSwap(vocalsFile, instrumentalFile) {
        const vocalsName = String(vocalsFile && vocalsFile.name || '').toLowerCase();
        const instrumentalName = String(instrumentalFile && instrumentalFile.name || '').toLowerCase();

        const vocalHint = /(vocal|vocals|vox|acapella|a\s?cappella|lead\s?vocal)/;
        const instrumentalHint = /(inst|instrumental|karaoke|minus\s?vocal|no\s?vocal|backing)/;

        const firstLooksInstrumental = instrumentalHint.test(vocalsName) && !vocalHint.test(vocalsName);
        const secondLooksVocal = vocalHint.test(instrumentalName) && !instrumentalHint.test(instrumentalName);

        return firstLooksInstrumental && secondLooksVocal;
    }

    function validateAudioFile(file, label) {
        if (!isAudioFile(file)) {
            return `${label} file is not a supported audio format.`;
        }
        if (file.size > MAX_FILE_SIZE) {
            return `${label} file exceeds 100MB limit.`;
        }
        if (file.size === 0) {
            return `${label} file is empty.`;
        }
        return null;
    }

    async function uploadStemPair(vocalsFile, instrumentalFile) {
        console.log('[DEBUG] Uploading stem pair:', vocalsFile.name, instrumentalFile.name);

        if (fileNameDisplay) {
            fileNameDisplay.classList.add('uploading');
        }
        if (songTitleElement) {
            songTitleElement.textContent = `Uploading stems: ${truncateFilename(vocalsFile.name, 20)} + ${truncateFilename(instrumentalFile.name, 20)}`;
        }
        if (songArtistElement) {
            songArtistElement.textContent = 'Preparing synchronized stem track...';
        }

        try {
            const formData = new FormData();
            formData.append('room', roomId);
            formData.append('vocals', vocalsFile);
            formData.append('instrumental', instrumentalFile);

            const response = await fetch('/upload_stems', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Stem upload failed');
            }

            console.log('[DEBUG] Stem upload successful:', data);
            if (songTitleElement) {
                songTitleElement.textContent = `Stem track ready: ${data.title || 'Untitled'}`;
            }
            if (songArtistElement) {
                songArtistElement.textContent = 'Assign member roles to route vocals/instrumental.';
            }
        } catch (error) {
            console.error('[ERROR] Stem upload failed:', error);
            alert(error.message || 'Stem upload failed.');
            if (songTitleElement) {
                songTitleElement.textContent = 'Stem upload failed.';
            }
            if (songArtistElement) {
                songArtistElement.textContent = '';
            }
        } finally {
            if (fileNameDisplay) {
                fileNameDisplay.classList.remove('uploading');
            }
        }
    }

    function setupDragDrop() {
        console.log('[DEBUG] Drag drop overlay found:', !!dragDropOverlay);

        // Prevent default browser behavior for drag/drop on document
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDragEnter(e);
        }, false);
        
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDragLeave(e);
        }, false);
        
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDragOver(e);
        }, false);
        
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleFileDrop(e);
        }, false);

        // Also add listeners directly on overlay for reliability
        if (dragDropOverlay) {
            dragDropOverlay.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
            }, false);
            
            dragDropOverlay.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[DEBUG] Drop on overlay');
                handleFileDrop(e);
            }, false);

            // Click to dismiss (fallback)
            dragDropOverlay.addEventListener('click', () => {
                console.log('[DEBUG] Overlay clicked - dismissing');
                dragDropOverlay.classList.remove('active');
                dragCounter = 0;
            });
        }
    }

    function truncateFilename(filename, maxLength) {
        const Utils = window.AudioFlowUtils;
        if (Utils && Utils.truncateFilename) {
            return Utils.truncateFilename(filename, maxLength);
        }
        // Fallback implementation
        if (filename.length <= maxLength) return filename;
        const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
        const nameWithoutExt = filename.replace(ext, '');
        const truncatedLength = maxLength - ext.length - 3;
        return nameWithoutExt.substring(0, truncatedLength) + '...' + ext;
    }

    function isAudioFile(file) {
        // Check by MIME type first
        if (file.type && ALLOWED_MIME_TYPES.some(mime => file.type.toLowerCase().includes(mime.split('/')[1]))) {
            return true;
        }
        // Fallback to extension check
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return ALLOWED_EXTENSIONS.includes(ext);
    }

    function hasAudioFiles(dataTransfer) {
        const types = dataTransfer && dataTransfer.types ? Array.from(dataTransfer.types) : [];
        if (types.includes('Files')) {
            // Check items if available (more reliable)
            if (dataTransfer.items) {
                for (let i = 0; i < dataTransfer.items.length; i++) {
                    const item = dataTransfer.items[i];
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file && isAudioFile(file)) return true;
                    }
                }
            }
            return true; // Assume files might be audio if we can't check
        }
        return false;
    }

    function handleDragEnter(e) {
        // Only show overlay for file drops, not for internal queue reordering
        const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
        
        // Check if this is an internal queue drag
        const Queue = window.AudioFlowQueue;
        const queueDragging = Queue && Queue.isDragging();
        const isQueueDrag = queueDragging || isQueueDragging || (e.target && (e.target.closest('.queue-item') || e.target.closest('.queue-list')));
        
        if (types.includes('Files') && !isQueueDrag) {
            dragCounter++;
            console.log('[DEBUG] Drag enter, counter:', dragCounter);
            
            if (dragDropOverlay && !dragDropOverlay.classList.contains('active')) {
                dragDropOverlay.classList.add('active');
            }
        }
    }

    function handleDragLeave(e) {
        dragCounter--;
        console.log('[DEBUG] Drag leave, counter:', dragCounter);
        
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (dragDropOverlay) {
                dragDropOverlay.classList.remove('active');
            }
        }
    }

    function handleDragOver(e) {
        // Set drop effect to copy
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
    }

    function handleFileDrop(e) {
        console.log('[DEBUG] File Drop event triggered');
        e.preventDefault();
        e.stopPropagation();

        try {
            dragCounter = 0;
            
            // Force hide overlay
            if (dragDropOverlay) {
                dragDropOverlay.classList.remove('active');
                console.log('[DEBUG] Overlay hidden');
            }

            const dataTransfer = e.dataTransfer;
            console.log('[DEBUG] dataTransfer:', dataTransfer);
            console.log('[DEBUG] files:', dataTransfer ? dataTransfer.files : 'none');
            
            if (!dataTransfer || !dataTransfer.files || dataTransfer.files.length === 0) {
                console.log('[DEBUG] No files in drop event');
                return;
            }

            const files = Array.from(dataTransfer.files);
            console.log('[DEBUG] Dropped files:', files.map(f => `${f.name} (${f.type}, ${f.size} bytes)`));

            // Filter and validate audio files
            const validFiles = [];
            const errors = [];

            files.forEach(file => {
                if (!isAudioFile(file)) {
                    errors.push(`"${file.name}" is not a supported audio format`);
                } else if (file.size > MAX_FILE_SIZE) {
                    errors.push(`"${file.name}" exceeds 100MB limit`);
                } else if (file.size === 0) {
                    errors.push(`"${file.name}" is empty`);
                } else {
                    validFiles.push(file);
                }
            });

            // Show errors if any
            if (errors.length > 0 && validFiles.length === 0) {
                console.error(errors.join('\n'));
                return;
            } else if (errors.length > 0) {
                console.warn('[WARN] Some files skipped:', errors);
            }

            if (validFiles.length === 0) {
                console.error('No valid audio files found. Supported: MP3, WAV, FLAC, OGG, M4A');
                return;
            }

            // Add to upload queue
            uploadQueue.push(...validFiles);
            console.log(`Adding ${validFiles.length} file(s) to upload queue...`);
            processUploadQueue();
        } catch (err) {
            console.error('[ERROR] Error in handleFileDrop:', err);
            if (dragDropOverlay) dragDropOverlay.classList.remove('active');
        }
    }

    function processUploadQueue() {
        if (isUploading || uploadQueue.length === 0) return;
        
        isUploading = true;
        const file = uploadQueue.shift();
        
        uploadFileWithProgress(file).finally(() => {
            isUploading = false;
            // Process next file after a small delay
            if (uploadQueue.length > 0) {
                setTimeout(processUploadQueue, 300);
            }
        });
    }

    function uploadFileWithProgress(file) {
        return new Promise((resolve, reject) => {
            console.log('[DEBUG] Uploading file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB');
            
            if (fileNameDisplay) {
                fileNameDisplay.classList.add('uploading');
            }
            
            const truncatedName = truncateFilename(file.name, 30);
            const remaining = uploadQueue.length;
            const queueText = remaining > 0 ? ` (${remaining} more in queue)` : '';
            
            if (songTitleElement) {
                songTitleElement.textContent = `Uploading: ${truncatedName}${queueText}`;
            }
            if (songArtistElement) {
                songArtistElement.textContent = "";
            }
            
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('room', roomId);

            const xhr = new XMLHttpRequest();
            
            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    if (songArtistElement) {
                        songArtistElement.textContent = `${percent}% uploaded`;
                    }
                }
            });
            
            xhr.addEventListener('load', () => {
                if (fileNameDisplay) {
                    fileNameDisplay.classList.remove('uploading');
                }
                
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.success) {
                            console.log('[DEBUG] Upload successful:', file.name);
                            resolve(data);
                        } else {
                            console.error('[ERROR] Upload failed:', data.error);
                            reject(new Error(data.error));
                        }
                    } catch (e) {
                        console.error('[ERROR] Invalid response:', e);
                        reject(e);
                    }
                } else {
                    console.error('[ERROR] Upload HTTP error:', xhr.status);
                    reject(new Error('HTTP ' + xhr.status));
                }
            });
            
            xhr.addEventListener('error', () => {
                if (fileNameDisplay) {
                    fileNameDisplay.classList.remove('uploading');
                }
                console.error('[ERROR] Upload network error');
                reject(new Error('Network error'));
            });
            
            xhr.addEventListener('abort', () => {
                if (fileNameDisplay) {
                    fileNameDisplay.classList.remove('uploading');
                }
                console.log('[DEBUG] Upload aborted:', file.name);
                reject(new Error('Aborted'));
            });
            
            xhr.open('POST', '/upload');
            xhr.send(formData);
        });
    }

    function setQueueDragging(value) {
        isQueueDragging = value;
    }

    function getQueueLength() {
        return uploadQueue.length;
    }

    function clearQueue() {
        uploadQueue = [];
    }

    // Public API
    return {
        init,
        isAudioFile,
        hasAudioFiles,
        setQueueDragging,
        getQueueLength,
        clearQueue
    };
})();

// Make it available globally
window.AudioFlowUpload = AudioFlowUpload;
