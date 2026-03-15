// =====================================================================
// AudioFlow - Members Module
// =====================================================================

const AudioFlowMembers = (function() {
    // Private state
    let currentMembers = [];

    // DOM elements
    let membersSidebarList = null;
    let membersModal = null;
    let membersBadge = null;
    let socket = null;
    let roomId = null;
    let membersRefreshInterval = null;

    function init(elements, socketInstance, room) {
        membersSidebarList = elements.membersSidebarList;
        membersModal = elements.membersModal;
        membersBadge = elements.membersBadge;
        socket = socketInstance;
        roomId = room;

        setupSocketListeners();
        setupModalListeners();
    }

    function setupSocketListeners() {
        if (!socket) return;

        // Listen for member list updates from server
        socket.on('member_list_update', (data) => {
            console.log('Received member list update:', data);
            if (data.members) {
                updateMembersList(data.members);
            }
        });

        // Listen for individual member join/leave events
        socket.on('member_joined', (data) => {
            console.log('Member joined:', data);
            // Refresh member list if modal is open
            if (membersModal && membersModal.style.display === 'flex') {
                fetchAndDisplayMembers();
            }
        });

        socket.on('member_left', (data) => {
            console.log('Member left:', data);
            // Refresh member list if modal is open
            if (membersModal && membersModal.style.display === 'flex') {
                fetchAndDisplayMembers();
            }
        });

        // Listen for host change events
        socket.on('host_changed', (data) => {
            console.log('Host changed:', data);
            // Refresh member list to update host badges
            if (membersModal && membersModal.style.display === 'flex') {
                fetchAndDisplayMembers();
            }
        });
    }

    function setupModalListeners() {
        // Members badge click handler
        if (membersBadge) {
            membersBadge.addEventListener('click', () => {
                if (membersModal) {
                    membersModal.style.display = 'flex';
                    fetchAndDisplayMembers();
                    startMembersAutoRefresh();
                }
            });
        }

        // Close modal handler
        const closeBtn = document.getElementById('close-members');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (membersModal) {
                    membersModal.style.display = 'none';
                    stopMembersAutoRefresh();
                }
            });
        }

        // Close on backdrop click
        if (membersModal) {
            membersModal.addEventListener('click', (e) => {
                if (e.target === membersModal) {
                    membersModal.style.display = 'none';
                    stopMembersAutoRefresh();
                }
            });
        }
    }

    function startMembersAutoRefresh() {
        stopMembersAutoRefresh();
        membersRefreshInterval = setInterval(() => {
            if (!membersModal || membersModal.style.display !== 'flex') {
                stopMembersAutoRefresh();
                return;
            }
            fetchAndDisplayMembers({ showLoading: false });
        }, 2000);
    }

    function stopMembersAutoRefresh() {
        if (membersRefreshInterval) {
            clearInterval(membersRefreshInterval);
            membersRefreshInterval = null;
        }
    }

    function fetchAndDisplayMembers(options = {}) {
        const showLoading = options.showLoading !== false;
        // Show loading state in sidebar
        if (showLoading && membersSidebarList) {
            membersSidebarList.innerHTML = '<p class="loading-members">Loading members...</p>';
        }
        
        // Show loading state in modal too
        const modalList = document.getElementById('members-list');
        if (showLoading && modalList) {
            modalList.innerHTML = '<p class="loading-members">Loading members...</p>';
        }

        try {
            // Request member list from server
            console.log('Requesting member list for room:', roomId);
            
            if (!roomId) {
                console.error('roomId is undefined or empty');
                showMembersError('Room ID not found. Please refresh the page.');
                return;
            }
            
            socket.emit('request_member_list', { room: roomId });
        } catch (error) {
            console.error('Error requesting member list:', error);
            showMembersError('Failed to load members. Please try again.');
        }
    }

    function showMembersError(message) {
        if (membersSidebarList) {
            membersSidebarList.innerHTML = `<p class="no-members">${message}</p>`;
        }
        // Also update modal list
        const modalList = document.getElementById('members-list');
        if (modalList) {
            modalList.innerHTML = `<p class="no-members">${message}</p>`;
        }
    }

    function updateMembersList(members) {
        currentMembers = members || [];
        
        if (currentMembers.length === 0) {
            if (membersSidebarList) {
                membersSidebarList.innerHTML = '<p class="no-members">No members in this room</p>';
            }
            return;
        }

        const isCurrentUserHost = !!currentMembers.find(member => member.id === socket.id && member.is_host);

        function buildSyncDriftDisplay(member) {
            const driftRaw = Number(member && member.sync_drift_ms);
            if (!Number.isFinite(driftRaw)) {
                return {
                    text: 'Sync drift: --',
                    className: 'member-sync-drift-unknown',
                    title: 'Waiting for playback report'
                };
            }

            const driftMs = Math.round(driftRaw);
            const absMs = Math.abs(driftMs);
            let severityClass = 'member-sync-drift-good';
            if (absMs > 250) {
                severityClass = 'member-sync-drift-bad';
            } else if (absMs > 90) {
                severityClass = 'member-sync-drift-warn';
            }

            const sign = driftMs > 0 ? '+' : '';
            const direction = driftMs === 0 ? 'On time' : (driftMs > 0 ? 'Ahead' : 'Behind');
            return {
                text: `Sync drift: ${sign}${driftMs} ms`,
                className: severityClass,
                title: `${direction} by ${absMs} ms`
            };
        }

        const membersHTML = currentMembers.map((member, index) => {
            // Generate avatar icon based on operating system
            let avatarIcon = '<i class="fas fa-user"></i>'; // Default fallback
            if (member.os) {
                switch (member.os.toLowerCase()) {
                    case 'windows':
                        avatarIcon = '<i class="fab fa-windows"></i>';
                        break;
                    case 'android':
                        avatarIcon = '<i class="fab fa-android"></i>';
                        break;
                    case 'ios':
                        avatarIcon = '<i class="fab fa-apple"></i>';
                        break;
                    case 'macos':
                        avatarIcon = '<i class="fab fa-apple"></i>';
                        break;
                    case 'linux':
                        avatarIcon = '<i class="fab fa-linux"></i>';
                        break;
                    default:
                        avatarIcon = '<i class="fas fa-desktop"></i>';
                        break;
                }
            }
            
            const memberName = member.name || `User ${index + 1}`;
            const syncDrift = buildSyncDriftDisplay(member);
            
            // Calculate relative join time
            let joinTimeText = 'Unknown';
            if (member.joinTime) {
                const joinDate = new Date(member.joinTime);
                const now = new Date();
                const diffMs = now - joinDate;
                const diffSeconds = Math.floor(diffMs / 1000);
                const diffMinutes = Math.floor(diffSeconds / 60);
                const diffHours = Math.floor(diffMinutes / 60);
                const diffDays = Math.floor(diffHours / 24);
                
                if (diffSeconds < 60) {
                    joinTimeText = diffSeconds <= 5 ? 'Just joined' : `Joined ${diffSeconds} seconds ago`;
                } else if (diffMinutes < 60) {
                    joinTimeText = diffMinutes === 1 ? 'Joined 1 minute ago' : `Joined ${diffMinutes} minutes ago`;
                } else if (diffHours < 24) {
                    joinTimeText = diffHours === 1 ? 'Joined 1 hour ago' : `Joined ${diffHours} hours ago`;
                } else {
                    joinTimeText = diffDays === 1 ? 'Joined 1 day ago' : `Joined ${diffDays} days ago`;
                }
            }
            
            // Create device info string
            let deviceInfo = '';
            if (member.browser && member.os) {
                deviceInfo = `${member.browser} • ${member.os}`;
                if (member.deviceType && member.deviceType !== 'Desktop') {
                    deviceInfo += ` • ${member.deviceType}`;
                }
            }
            
            // Create host badge if this member is the host
            const hostBadge = member.is_host ? '<div class="member-host-badge"></div>' : '';

            const selectedRole = (member.audio_role || 'mix').toLowerCase();
            const selectedChannelMode = (member.channel_mode || 'stereo').toLowerCase();
            const roleControls = `
                <div class="member-role-row">
                    <span class="member-role-label">Audio:</span>
                    <select class="member-role-select" data-member-id="${member.id}" ${isCurrentUserHost ? '' : 'disabled'}>
                        <option value="mix" ${selectedRole === 'mix' ? 'selected' : ''}>Mix</option>
                        <option value="vocals" ${selectedRole === 'vocals' ? 'selected' : ''}>Vocals</option>
                        <option value="instrumental" ${selectedRole === 'instrumental' ? 'selected' : ''}>Instrumental</option>
                    </select>
                </div>
                <div class="member-role-row">
                    <span class="member-role-label">Channel:</span>
                    <select class="member-channel-select member-role-select" data-member-id="${member.id}" ${isCurrentUserHost ? '' : 'disabled'}>
                        <option value="stereo" ${selectedChannelMode === 'stereo' ? 'selected' : ''}>Stereo</option>
                        <option value="left" ${selectedChannelMode === 'left' ? 'selected' : ''}>Left Only</option>
                        <option value="right" ${selectedChannelMode === 'right' ? 'selected' : ''}>Right Only</option>
                    </select>
                </div>
            `;
            
            return `
                <div class="member-item">
                    <div class="member-avatar">${avatarIcon}</div>
                    <div class="member-info">
                        <div class="member-name">${memberName}</div>
                        <div class="member-device">${deviceInfo}</div>
                        <div class="member-status online">${joinTimeText}</div>
                        <div class="member-sync-drift ${syncDrift.className}" title="${syncDrift.title}">${syncDrift.text}</div>
                        ${roleControls}
                    </div>
                    ${hostBadge}
                </div>
            `;
        }).join('');

        // Inject generated HTML into the sidebar list element
        if (membersSidebarList) {
            membersSidebarList.innerHTML = membersHTML;
        }
        
        // Also update the modal list (for mobile)
        const modalList = document.getElementById('members-list');
        if (modalList) {
            modalList.innerHTML = membersHTML;
        }

        setupRoleAssignmentHandlers(isCurrentUserHost);
        setupChannelModeHandlers(isCurrentUserHost);

        // Update badge count
        updateBadgeCount();
    }

    function setupRoleAssignmentHandlers(isCurrentUserHost) {
        const roleSelects = document.querySelectorAll('.member-role-select');
        roleSelects.forEach(select => {
            if (select.classList.contains('member-channel-select')) {
                return;
            }
            select.disabled = !isCurrentUserHost;
            select.addEventListener('change', (e) => {
                const role = e.target.value;
                const targetSid = e.target.getAttribute('data-member-id');
                if (!targetSid || !socket || !roomId) return;
                socket.emit('set_member_role', {
                    room: roomId,
                    target_sid: targetSid,
                    role: role
                });
            });
        });
    }

    function setupChannelModeHandlers(isCurrentUserHost) {
        const channelSelects = document.querySelectorAll('.member-channel-select');
        channelSelects.forEach(select => {
            select.disabled = !isCurrentUserHost;
            select.addEventListener('change', (e) => {
                const channelMode = e.target.value;
                const targetSid = e.target.getAttribute('data-member-id');
                if (!targetSid || !socket || !roomId) return;
                const payload = {
                    room: roomId,
                    target_sid: targetSid,
                    channel_mode: channelMode
                };

                let ackReceived = false;
                const fallbackTimer = setTimeout(() => {
                    if (!ackReceived) {
                        fallbackSetChannelModeHttp(payload);
                    }
                }, 2500);

                socket.emit('set_member_channel_mode', payload, (response) => {
                    ackReceived = true;
                    clearTimeout(fallbackTimer);

                    if (!response || response.success !== true) {
                        fallbackSetChannelModeHttp(payload);
                    }
                });
            });
        });
    }

    function fallbackSetChannelModeHttp(payload) {
        if (!payload || !roomId || !socket) return;

        const body = {
            room: payload.room,
            target_sid: payload.target_sid,
            channel_mode: payload.channel_mode,
            actor_sid: socket.id
        };

        fetch('/set_member_channel_mode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    throw new Error(data.error || `HTTP ${res.status}`);
                }
            })
            .catch((error) => {
                console.error('Failed to set channel mode:', error);
            });
    }

    function updateBadgeCount() {
        const countSpan = document.getElementById('members-badge-count') || (membersBadge ? membersBadge.querySelector('.member-count') : null);
        if (countSpan) {
            countSpan.textContent = currentMembers.length;
        }
    }

    function getMembers() {
        return currentMembers;
    }

    function getMemberCount() {
        return currentMembers.length;
    }

    // Public API
    return {
        init,
        fetchAndDisplayMembers,
        updateMembersList,
        getMembers,
        getMemberCount
    };
})();

// Make it available globally
window.AudioFlowMembers = AudioFlowMembers;
