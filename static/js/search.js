// =====================================================================
// AudioFlow - Search Module
// =====================================================================

const AudioFlowSearch = (function() {
    // Private state
    let pageReady = false;
    let userHasInteracted = false;

    // DOM elements
    let searchBtn = null;
    let searchInput = null;
    let searchModal = null;
    let searchResults = null;
    let closeSearch = null;
    let roomId = null;

    function init(elements, room) {
        searchBtn = elements.searchBtn;
        searchInput = elements.searchInput;
        searchModal = elements.searchModal;
        searchResults = elements.searchResults;
        closeSearch = elements.closeSearch;
        roomId = room;

        if (!searchBtn || !searchInput || !searchModal || !searchResults) {
            console.warn('[Search] Some search elements not found');
            return;
        }

        setupSearchInput();
        setupEventListeners();

        // Set a delay after page load before allowing any search-related activity
        setTimeout(() => {
            pageReady = true;
            console.log('[DEBUG] Page is ready. Search can be enabled by user interaction.');
        }, 2000);
    }

    function setupSearchInput() {
        // Disable autocomplete and other auto-features
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('autocorrect', 'off');
        searchInput.setAttribute('autocapitalize', 'off');
        searchInput.setAttribute('spellcheck', 'false');
    }

    function setupEventListeners() {
        // Enable search ONLY when the user focuses or clicks the input
        searchInput.addEventListener('focus', () => {
            if (pageReady) {
                userHasInteracted = true;
                console.log('[DEBUG] User interaction confirmed. Search is now enabled.');
            }
        });

        // Handle search button click
        searchBtn.addEventListener('click', () => {
            openSearchModal();
            doSearch(searchInput.value);
            searchInput.value = ''; // Clear input after search
        });

        // Handle 'Enter' key in search input
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent any default form submission
                openSearchModal();
                doSearch(searchInput.value);
                searchInput.value = ''; // Clear input after search
            }
        });

        // Block any form submission events directly
        if (searchInput.form) {
            searchInput.form.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('[DEBUG] Form submission explicitly blocked.');
            });
        }
        
        if (closeSearch) {
            closeSearch.addEventListener('click', closeSearchModal);
        }
    }

    function openSearchModal() {
        if (searchModal) {
            searchModal.style.display = 'flex';
        }
    }

    function closeSearchModal() {
        if (searchModal) {
            searchModal.style.display = 'none';
        }
    }

    async function doSearch(q) {
        const query = q.trim();
        if (!query) return;

        if (searchResults) {
            searchResults.innerHTML = '<p class="loading-members">Searching...</p>';
        }

        try {
            // Search JioSaavn directly (no prefix needed)
            const res = await fetch(`/search_jiosaavn?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            if (!data.success || !data.results || data.results.length === 0) {
                if (searchResults) {
                    searchResults.innerHTML = `<p class="no-members">${data.error || 'No results found'}</p>`;
                }
                return;
            }
            
            let html = '';
            data.results.forEach((song, idx) => {
                html += `
                <div class="search-result-item">
                    <img src="${song.image || ''}" alt="" style="display:${song.image ? 'block' : 'none'}" />
                    <div class="result-info">
                        <div class="result-title">${song.title || 'Unknown'}</div>
                        <div class="result-artist">${song.artist || 'Unknown Artist'}</div>
                    </div>
                    <button class="add-jio-btn" data-index="${idx}">Add</button>
                </div>`;
            });
            
            if (searchResults) {
                searchResults.innerHTML = html;
            }
            
            document.querySelectorAll('.add-jio-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const button = e.currentTarget;
                    const index = parseInt(button.getAttribute('data-index'));
                    const song = data.results[index];
                    button.textContent = 'Processing...';
                    button.disabled = true;
                    await addJioSaavnSong(button, song);
                });
            });
        } catch (err) {
            console.error('Search fetch error:', err);
            if (searchResults) {
                searchResults.innerHTML = '<p class="no-members">An error occurred during search.</p>';
            }
        }
    }

    async function addJioSaavnSong(buttonEl, song) {
        if (!roomId) return;
        
        const original = buttonEl.textContent;
        try {
            buttonEl.textContent = 'Resolving...';
            
            const qualities = ['320kbps', '160kbps', '128kbps'];
            let resolved = null;
            
            for (const q of qualities) {
                const r = await fetch(`/resolve_jiosaavn?id=${encodeURIComponent(song.id)}&quality=${q}&register=1`);
                const data = await r.json();
                if (data.success && data.media_url) {
                    resolved = { q, data };
                    break;
                }
            }
            
            if (!resolved) throw new Error('Resolve failed');
            
            buttonEl.textContent = 'Queuing...';
            
            const meta = {
                title: song.title,
                artist: song.artist,
                album: song.album,
                image: song.image,
                image_url: song.image
            };
            
            const addResp = await fetch('/add_to_queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room: roomId,
                    proxy_id: resolved.data.proxy_id,
                    metadata: meta,
                    video_id: null
                })
            });
            
            const addData = await addResp.json();
            
            if (!addResp.ok || !addData.success) {
                throw new Error(addData.error || 'Queue failed');
            }
            
            buttonEl.textContent = 'Added';
            buttonEl.classList.add('added');
        } catch (e) {
            console.error(e);
            buttonEl.textContent = 'Error';
            buttonEl.classList.add('error');
        } finally {
            setTimeout(() => {
                if (!buttonEl.classList.contains('added')) {
                    buttonEl.textContent = original;
                }
                buttonEl.disabled = false;
            }, 2500);
        }
    }

    function formatDuration(seconds) {
        if (!seconds) return '';
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Public API
    return {
        init,
        openSearchModal,
        closeSearchModal,
        doSearch,
        formatDuration
    };
})();

// Make it available globally
window.AudioFlowSearch = AudioFlowSearch;
