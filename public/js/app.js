// PlaySV Ultimate - Main Application JavaScript
// Modern ES6+ JavaScript with PWA features

class PlaySVApp {
    constructor() {
        this.apiBase = window.location.origin;
        this.ws = null;
        this.videos = [];
        this.playlist = [];
        this.currentVideoIndex = -1;
        this.playerStatus = 'disconnected';
        
        this.init();
    }

    async init() {
        console.log('🎬 Initializing PlaySV Ultimate...');
        
        // Initialize all components
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.connectWebSocket();
        await this.loadVideos();
        this.generateQRCode();
        
        console.log('✅ PlaySV Ultimate initialized successfully!');
    }

    // WebSocket Connection
    connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('🔌 WebSocket connected');
                this.updatePlayerStatus('connected');
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.updatePlayerStatus('error');
            };
            
            this.ws.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                this.updatePlayerStatus('disconnected');
                // Reconnect after 3 seconds
                setTimeout(() => this.connectWebSocket(), 3000);
            };
        } catch (error) {
            console.error('❌ Failed to connect WebSocket:', error);
            this.updatePlayerStatus('error');
        }
    }

    handleWebSocketMessage(data) {
        switch(data.type) {
            case 'status':
                this.updatePlayerInfo(data.payload);
                break;
            case 'playlist_update':
                this.updatePlaylist(data.payload);
                break;
            case 'video_info':
                this.displayCurrentVideo(data.payload);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Load videos from server
    async loadVideos() {
        try {
            const response = await fetch(`${this.apiBase}/api/videos`);
            if (!response.ok) throw new Error('Failed to load videos');
            
            this.videos = await response.json();
            this.renderVideoGrid();
        } catch (error) {
            console.error('❌ Error loading videos:', error);
            // Show demo data if API fails
            this.loadDemoVideos();
        }
    }

    loadDemoVideos() {
        this.videos = [
            { id: 1, title: 'Demo Video 1', duration: '10:30', thumbnail: 'https://via.placeholder.com/250x150?text=Video+1' },
            { id: 2, title: 'Demo Video 2', duration: '15:45', thumbnail: 'https://via.placeholder.com/250x150?text=Video+2' },
            { id: 3, title: 'Demo Video 3', duration: '08:20', thumbnail: 'https://via.placeholder.com/250x150?text=Video+3' },
            { id: 4, title: 'Demo Video 4', duration: '12:10', thumbnail: 'https://via.placeholder.com/250x150?text=Video+4' }
        ];
        this.renderVideoGrid();
    }

    renderVideoGrid() {
        const grid = document.getElementById('video-grid');
        grid.innerHTML = '';
        
        this.videos.forEach(video => {
            const card = this.createVideoCard(video);
            grid.appendChild(card);
        });
    }

    createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.draggable = true;
        card.dataset.videoId = video.id;
        
        card.innerHTML = `
            <img src="${video.thumbnail}" alt="${video.title}">
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-duration">${video.duration}</div>
            </div>
        `;
        
        // Drag start event
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('video', JSON.stringify(video));
            card.classList.add('dragging');
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });
        
        // Double click to play
        card.addEventListener('dblclick', () => {
            this.playVideo(video);
        });
        
        return card;
    }

    // Drag and Drop Setup
    setupDragAndDrop() {
        const playlist = document.getElementById('playlist');
        
        playlist.addEventListener('dragover', (e) => {
            e.preventDefault();
            playlist.classList.add('drag-over');
        });
        
        playlist.addEventListener('dragleave', () => {
            playlist.classList.remove('drag-over');
        });
        
        playlist.addEventListener('drop', (e) => {
            e.preventDefault();
            playlist.classList.remove('drag-over');
            
            const videoData = e.dataTransfer.getData('video');
            if (videoData) {
                const video = JSON.parse(videoData);
                this.addToPlaylist(video);
            }
        });
    }

    addToPlaylist(video) {
        // Check if video already in playlist
        if (this.playlist.some(v => v.id === video.id)) {
            console.log('Video already in playlist');
            return;
        }
        
        this.playlist.push(video);
        this.renderPlaylist();
    }

    renderPlaylist() {
        const playlistEl = document.getElementById('playlist');
        
        if (this.playlist.length === 0) {
            playlistEl.innerHTML = '<p class="empty-message">Kéo thả video vào đây để thêm vào playlist</p>';
            return;
        }
        
        playlistEl.innerHTML = this.playlist.map((video, index) => `
            <div class="playlist-item" data-index="${index}">
                <span class="playlist-number">${index + 1}</span>
                <span class="playlist-title">${video.title}</span>
                <span class="playlist-duration">${video.duration}</span>
                <button class="btn-remove" onclick="app.removeFromPlaylist(${index})">✕</button>
            </div>
        `).join('');
    }

    removeFromPlaylist(index) {
        this.playlist.splice(index, 1);
        this.renderPlaylist();
    }

    clearPlaylist() {
        this.playlist = [];
        this.renderPlaylist();
    }

    // Event Listeners Setup
    setupEventListeners() {
        // Refresh button
        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            this.loadVideos();
        });
        
        // Scan button
        document.getElementById('scan-btn')?.addEventListener('click', () => {
            this.scanDirectory();
        });
        
        // Search
        document.getElementById('search-input')?.addEventListener('input', (e) => {
            this.searchVideos(e.target.value);
        });
        
        // Player controls
        document.getElementById('play-btn')?.addEventListener('click', () => this.sendMPVCommand('play'));
        document.getElementById('pause-btn')?.addEventListener('click', () => this.sendMPVCommand('pause'));
        document.getElementById('stop-btn')?.addEventListener('click', () => this.sendMPVCommand('stop'));
        document.getElementById('next-btn')?.addEventListener('click', () => this.playNext());
        document.getElementById('prev-btn')?.addEventListener('click', () => this.playPrevious());
        
        // Volume control
        const volumeSlider = document.getElementById('volume-slider');
        const volumeValue = document.getElementById('volume-value');
        
        volumeSlider?.addEventListener('input', (e) => {
            const volume = e.target.value;
            volumeValue.textContent = `${volume}%`;
            this.setVolume(volume);
        });
        
        // Playlist controls
        document.getElementById('clear-playlist-btn')?.addEventListener('click', () => {
            if (confirm('Xóa toàn bộ playlist?')) {
                this.clearPlaylist();
            }
        });
        
        document.getElementById('save-playlist-btn')?.addEventListener('click', () => {
            this.savePlaylist();
        });
    }

    // MPV Control Functions
    async sendMPVCommand(command, args = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return;
        }
        
        const message = {
            type: 'mpv_command',
            command: command,
            args: args
        };
        
        this.ws.send(JSON.stringify(message));
    }

    playVideo(video) {
        this.sendMPVCommand('play', { video: video });
        document.getElementById('current-video').textContent = video.title;
    }

    playNext() {
        if (this.currentVideoIndex < this.playlist.length - 1) {
            this.currentVideoIndex++;
            this.playVideo(this.playlist[this.currentVideoIndex]);
        }
    }

    playPrevious() {
        if (this.currentVideoIndex > 0) {
            this.currentVideoIndex--;
            this.playVideo(this.playlist[this.currentVideoIndex]);
        }
    }

    setVolume(volume) {
        this.sendMPVCommand('volume', { value: parseInt(volume) });
    }

    // Search functionality
    searchVideos(query) {
        const filtered = this.videos.filter(video => 
            video.title.toLowerCase().includes(query.toLowerCase())
        );
        
        const grid = document.getElementById('video-grid');
        grid.innerHTML = '';
        
        filtered.forEach(video => {
            const card = this.createVideoCard(video);
            grid.appendChild(card);
        });
    }

    // Scan directory
    async scanDirectory() {
        try {
            const response = await fetch(`${this.apiBase}/api/scan`, {
                method: 'POST'
            });
            
            if (response.ok) {
                alert('Đang quét thư mục...');
                setTimeout(() => this.loadVideos(), 2000);
            }
        } catch (error) {
            console.error('Error scanning directory:', error);
        }
    }

    // Save playlist
    async savePlaylist() {
        try {
            const response = await fetch(`${this.apiBase}/api/playlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.playlist)
            });
            
            if (response.ok) {
                alert('Playlist đã được lưu!');
            }
        } catch (error) {
            console.error('Error saving playlist:', error);
        }
    }

    // Update player status
    updatePlayerStatus(status) {
        this.playerStatus = status;
        const statusEl = document.getElementById('player-status');
        
        if (statusEl) {
            statusEl.textContent = status === 'connected' ? 'Đã kết nối' : 'Chưa kết nối';
            statusEl.className = `status-${status}`;
        }
    }

    updatePlayerInfo(info) {
        if (info.currentVideo) {
            document.getElementById('current-video').textContent = info.currentVideo;
        }
    }

    displayCurrentVideo(video) {
        document.getElementById('current-video').textContent = video.title;
    }

    // Generate QR Code for remote control
    generateQRCode() {
        const canvas = document.getElementById('qr-canvas');
        if (!canvas) return;
        
        const url = `${window.location.origin}/remote`;
        
        // Simple QR code placeholder
        const ctx = canvas.getContext('2d');
        canvas.width = 250;
        canvas.height = 250;
        
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 250, 250);
        
        ctx.fillStyle = '#000';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Scan để điều khiển', 125, 120);
        ctx.fillText(url, 125, 140);
        
        console.log('📱 QR Code URL:', url);
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new PlaySVApp();
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlaySVApp;
}
