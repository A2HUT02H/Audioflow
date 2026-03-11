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
                }
            });
        }

        // Close modal handler
        const closeBtn = document.getElementById('close-members');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (membersModal) {
                    membersModal.style.display = 'none';
                }
            });
        }

        // Close on backdrop click
        if (membersModal) {
            membersModal.addEventListener('click', (e) => {
                if (e.target === membersModal) {
                    membersModal.style.display = 'none';
                }
            });
        }
    }

    function fetchAndDisplayMembers() {
        // Show loading state in sidebar
        if (membersSidebarList) {
            membersSidebarList.innerHTML = '<p class="loading-members">Loading members...</p>';
        }
        
        // Show loading state in modal too
        const modalList = document.getElementById('members-list');
        if (modalList) {
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
            
            return `
                <div class="member-item">
                    <div class="member-avatar">${avatarIcon}</div>
                    <div class="member-info">
                        <div class="member-name">${memberName}</div>
                        <div class="member-device">${deviceInfo}</div>
                        <div class="member-status online">${joinTimeText}</div>
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

        // Update badge count
        updateBadgeCount();
    }

    function updateBadgeCount() {
        if (membersBadge) {
            const countSpan = membersBadge.querySelector('.member-count');
            if (countSpan) {
                countSpan.textContent = currentMembers.length;
            }
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
