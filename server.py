#!/usr/bin/env python3
"""
PlaySV Ultimate - PWA Media Server with MPV IPC Integration
Python Backend Server
"""

import os
import json
import socket
import asyncio
import logging
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import subprocess

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'playsv-ultimate-secret-key-2026'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Configuration
CONFIG = {
    'VIDEO_DIR': os.getenv('VIDEO_DIR', os.path.expanduser('~/Videos')),
    'MPV_SOCKET': os.getenv('MPV_SOCKET', '/tmp/mpvsocket'),
    'PORT': int(os.getenv('PORT', 8080)),
    'HOST': os.getenv('HOST', '0.0.0.0'),
    'THUMBNAIL_DIR': 'public/thumbnails',
    'ALLOWED_EXTENSIONS': {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv'}
}

# Global state
video_library = []
current_playlist = []
mpv_process = None
mpv_socket = None


class MPVController:
    """MPV Player IPC Controller"""
    
    def __init__(self, socket_path: str):
        self.socket_path = socket_path
        self.socket = None
        self.connected = False
    
    def connect(self) -> bool:
        """Connect to MPV IPC socket"""
        try:
            if os.path.exists(self.socket_path):
                self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.socket.connect(self.socket_path)
                self.connected = True
                logger.info(f"Connected to MPV socket: {self.socket_path}")
                return True
            else:
                logger.warning(f"MPV socket not found: {self.socket_path}")
                return False
        except Exception as e:
            logger.error(f"Failed to connect to MPV: {e}")
            return False
    
    def send_command(self, command: str, *args) -> Optional[Dict]:
        """Send command to MPV via IPC"""
        if not self.connected:
            if not self.connect():
                return None
        
        try:
            cmd = {'command': [command] + list(args)}
            cmd_json = json.dumps(cmd) + '\n'
            self.socket.sendall(cmd_json.encode('utf-8'))
            
            # Read response
            response = self.socket.recv(4096).decode('utf-8')
            return json.loads(response) if response else None
        except Exception as e:
            logger.error(f"MPV command failed: {e}")
            self.connected = False
            return None
    
    def play(self, file_path: str):
        """Play video file"""
        return self.send_command('loadfile', file_path)
    
    def pause(self):
        """Pause playback"""
        return self.send_command('set_property', 'pause', True)
    
    def resume(self):
        """Resume playback"""
        return self.send_command('set_property', 'pause', False)
    
    def stop(self):
        """Stop playback"""
        return self.send_command('stop')
    
    def seek(self, seconds: int):
        """Seek forward/backward"""
        return self.send_command('seek', seconds)
    
    def set_volume(self, volume: int):
        """Set volume (0-100)"""
        return self.send_command('set_property', 'volume', volume)
    
    def get_property(self, property_name: str):
        """Get MPV property"""
        return self.send_command('get_property', property_name)
    
    def close(self):
        """Close socket connection"""
        if self.socket:
            self.socket.close()
            self.connected = False


# Initialize MPV controller
mpv = MPVController(CONFIG['MPV_SOCKET'])


def scan_video_directory(directory: str) -> List[Dict]:
    """Scan directory for video files"""
    videos = []
    video_dir = Path(directory)
    
    if not video_dir.exists():
        logger.warning(f"Video directory does not exist: {directory}")
        return videos
    
    logger.info(f"Scanning directory: {directory}")
    
    for file_path in video_dir.rglob('*'):
        if file_path.suffix.lower() in CONFIG['ALLOWED_EXTENSIONS']:
            try:
                stat = file_path.stat()
                videos.append({
                    'id': len(videos) + 1,
                    'title': file_path.stem,
                    'filename': file_path.name,
                    'path': str(file_path),
                    'size': stat.st_size,
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    'duration': get_video_duration(str(file_path)),
                    'thumbnail': generate_thumbnail(str(file_path))
                })
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}")
    
    logger.info(f"Found {len(videos)} videos")
    return videos


def get_video_duration(file_path: str) -> str:
    """Get video duration using ffprobe"""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', file_path],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            seconds = float(result.stdout.strip())
            mins, secs = divmod(int(seconds), 60)
            hours, mins = divmod(mins, 60)
            if hours > 0:
                return f"{hours}:{mins:02d}:{secs:02d}"
            return f"{mins}:{secs:02d}"
    except Exception as e:
        logger.error(f"Error getting duration: {e}")
    return "00:00"


def generate_thumbnail(file_path: str) -> str:
    """Generate video thumbnail"""
    try:
        thumb_dir = Path(CONFIG['THUMBNAIL_DIR'])
        thumb_dir.mkdir(parents=True, exist_ok=True)
        
        filename = Path(file_path).stem
        thumb_path = thumb_dir / f"{filename}.jpg"
        
        # Generate thumbnail if not exists
        if not thumb_path.exists():
            subprocess.run(
                ['ffmpeg', '-i', file_path, '-ss', '00:00:10', '-vframes', '1',
                 '-vf', 'scale=250:-1', str(thumb_path)],
                capture_output=True,
                timeout=30
            )
        
        return f"/thumbnails/{thumb_path.name}" if thumb_path.exists() else "/placeholder.jpg"
    except Exception as e:
        logger.error(f"Error generating thumbnail: {e}")
        return "/placeholder.jpg"


# Flask Routes

@app.route('/')
def index():
    """Serve PWA main page"""
    return send_from_directory('public', 'index.html')


@app.route('/api/videos', methods=['GET'])
def get_videos():
    """Get video library"""
    global video_library
    
    if not video_library:
        video_library = scan_video_directory(CONFIG['VIDEO_DIR'])
    
    return jsonify(video_library)


@app.route('/api/scan', methods=['POST'])
def scan_videos():
    """Rescan video directory"""
    global video_library
    video_library = scan_video_directory(CONFIG['VIDEO_DIR'])
    
    # Notify clients via WebSocket
    socketio.emit('videos_updated', {'count': len(video_library)})
    
    return jsonify({
        'success': True,
        'count': len(video_library),
        'message': 'Video library updated'
    })


@app.route('/api/playlist', methods=['GET', 'POST'])
def handle_playlist():
    """Get or save playlist"""
    global current_playlist
    
    if request.method == 'POST':
        current_playlist = request.json
        return jsonify({'success': True, 'playlist': current_playlist})
    
    return jsonify(current_playlist)


# WebSocket Events

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    logger.info(f"Client connected: {request.sid}")
    emit('status', {'connected': True, 'mpv_connected': mpv.connected})


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {request.sid}")


@socketio.on('mpv_command')
def handle_mpv_command(data):
    """Handle MPV control commands"""
    command = data.get('command')
    args = data.get('args', {})
    
    logger.info(f"MPV command: {command} with args: {args}")
    
    result = None
    
    if command == 'play':
        video = args.get('video')
        if video:
            result = mpv.play(video.get('path'))
            emit('player_status', {'playing': True, 'video': video.get('title')}, broadcast=True)
    
    elif command == 'pause':
        result = mpv.pause()
        emit('player_status', {'paused': True}, broadcast=True)
    
    elif command == 'resume':
        result = mpv.resume()
        emit('player_status', {'paused': False}, broadcast=True)
    
    elif command == 'stop':
        result = mpv.stop()
        emit('player_status', {'stopped': True}, broadcast=True)
    
    elif command == 'volume':
        volume = args.get('value', 100)
        result = mpv.set_volume(volume)
        emit('player_status', {'volume': volume}, broadcast=True)
    
    elif command == 'seek':
        seconds = args.get('seconds', 10)
        result = mpv.seek(seconds)
    
    emit('command_result', {'success': result is not None, 'command': command})


if __name__ == '__main__':
    # Create necessary directories
    Path(CONFIG['THUMBNAIL_DIR']).mkdir(parents=True, exist_ok=True)
    
    # Initial video scan
    logger.info("Starting PlaySV Ultimate Server...")
    logger.info(f"Video directory: {CONFIG['VIDEO_DIR']}")
    logger.info(f"MPV socket: {CONFIG['MPV_SOCKET']}")
    
    video_library = scan_video_directory(CONFIG['VIDEO_DIR'])
    
    # Try to connect to MPV
    mpv.connect()
    
    # Start server
    logger.info(f"Server starting on {CONFIG['HOST']}:{CONFIG['PORT']}")
    socketio.run(
        app,
        host=CONFIG['HOST'],
        port=CONFIG['PORT'],
        debug=True,
        allow_unsafe_werkzeug=True
    )
