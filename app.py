from flask import Flask, render_template, request, redirect, url_for, make_response, send_from_directory, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import time
import mimetypes
import uuid # Used for generating unique room IDs

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'm4a'}

app = Flask(__name__, static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
socketio = SocketIO(app)
# Ensure the upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

import base64
from mutagen import File as MutagenFile
from mutagen.id3 import ID3
from mutagen.id3._frames import APIC as ID3APIC
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4

# In-memory state to track audio files and cover art for each room
# rooms = { 'room_id_1': {'current_file': 'song.mp3', 'current_cover': 'cover.jpg'}, ... }
rooms = {}

def allowed_file(filename):
    """Check if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/uploads/<path:filename>')
def serve_file(filename):
    """Serve uploaded files with support for range requests (streaming)."""
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(file_path):
        from flask import abort
        abort(404)

    range_header = request.headers.get('Range', None)
    size = os.path.getsize(file_path)
    mimetype = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

    if not range_header:
        # Serve the whole file if no range is requested
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename, mimetype=mimetype)

    # Handle range request for streaming
    import re
    byte1, byte2 = 0, None
    match = re.search(r'bytes=(\d+)-(\d*)', range_header)
    if match:
        groups = match.groups()
        byte1 = int(groups[0])
        if groups[1]:
            byte2 = int(groups[1])
    
    length = size - byte1
    if byte2 is not None:
        length = byte2 - byte1 + 1
    
    data = None
    with open(file_path, 'rb') as f:
        f.seek(byte1)
        data = f.read(length)
    
    from flask import Response
    rv = Response(data, 206, mimetype=mimetype, direct_passthrough=True)
    rv.headers.add('Content-Range', f'bytes {byte1}-{byte1 + length - 1}/{size}')
    rv.headers.add('Accept-Ranges', 'bytes')
    return rv

@app.route('/upload', methods=['POST'])
def upload():
    """Handle audio file uploads for a specific room."""
    room = request.form.get('room')
    if not room or room not in rooms:
        return jsonify({'error': 'Invalid or expired room'}), 400
        
    if 'audio' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file and allowed_file(file.filename):
        from werkzeug.utils import secure_filename
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # Update state for the specific room
        rooms[room]['current_file'] = filename
        rooms[room]['current_cover'] = None
        current_cover = None

        # Try to extract cover art
        try:
            audio = MutagenFile(file_path)
            cover_data = None
            cover_ext = 'jpg'
            
            if isinstance(audio, MP3) and audio.tags:
                for tag in audio.tags.values():
                    if isinstance(tag, ID3APIC):
                        cover_data = tag.data
                        if 'image/png' in tag.mime.lower():
                           cover_ext = 'png'
                        break
            elif isinstance(audio, FLAC) and audio.pictures:
                pic = audio.pictures[0]
                cover_data = pic.data
                if hasattr(pic, 'mime') and 'png' in pic.mime:
                    cover_ext = 'png'
            elif isinstance(audio, MP4) and audio.tags and 'covr' in audio.tags:
                covr = audio.tags.get('covr')
                if covr:
                    if covr[0].imageformat == MP4.COVER_PNG:
                         cover_ext = 'png'
                    cover_data = covr[0]
            
            if cover_data:
                cover_filename = f"{os.path.splitext(filename)[0]}_cover.{cover_ext}"
                cover_path = os.path.join(app.config['UPLOAD_FOLDER'], cover_filename)
                with open(cover_path, 'wb') as imgf:
                    imgf.write(cover_data)
                rooms[room]['current_cover'] = cover_filename
                current_cover = cover_filename
                print(f"Cover art for room '{room}' saved as: {cover_filename}")
            else:
                print(f"No cover art found in the audio file for room '{room}'")

        except Exception as e:
            print(f"Cover art extraction failed for room '{room}': {e}")
            
        # Notify all clients in the specific room of the new file
        socketio.emit('new_file', {'filename': filename, 'cover': current_cover}, room=room)
        return jsonify({'success': True, 'filename': filename, 'cover': current_cover})
    elif file:
        return jsonify({'error': f"File type not allowed. Please use one of: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    return jsonify({'error': 'File upload failed'}), 500

@app.route('/current_song')
def get_current_song():
    """Endpoint for new clients to get the currently loaded song and cover for a room."""
    room = request.args.get('room')
    if room and room in rooms:
        return jsonify(rooms[room])
    return jsonify({'filename': None, 'cover': None})


@app.route('/')
def home():
    """Serve the page for creating or joining a room."""
    return render_template('room_select.html')

@app.route('/create_room', methods=['GET', 'POST'])
def create_room():
    """Create a new room and redirect to it."""
    room_id = str(uuid.uuid4())[:6] # Generate a short, unique room ID
    rooms[room_id] = {'current_file': None, 'current_cover': None}
    print(f"New room created: {room_id}")
    return redirect(url_for('player_room', room_id=room_id))

@app.route('/room/<string:room_id>')
def player_room(room_id):
    """Serve the main player interface for a specific room."""
    if room_id not in rooms:
        # Optionally, redirect to the home page with an error message
        return redirect(url_for('home')) 
    return render_template('index.html', room_id=room_id)

# --- SocketIO Events ---

@socketio.on('join')
def on_join(data):
    """Client joins a room."""
    room = data['room']
    if room in rooms:
        join_room(room)
        print(f"Client joined room: {room}")
        # Send the current state of the room to the client that just joined
        emit('room_state', rooms[room], room=request.sid)
    else:
        # Handle case where room does not exist
        emit('error', {'message': 'Room not found.'}, room=request.sid)

@socketio.on('get_server_time')
def handle_get_server_time():
    """Send server timestamp to client for synchronization."""
    emit('server_time', {'timestamp': time.time()})

@socketio.on('play')
def handle_play(data):
    """Broadcast play event to all other clients in the same room."""
    room = data.get('room')
    if room:
        delay = float(data.get('delay', 0.5))
        future_audio_time = data.get('time', 0) + delay
        emit('scheduled_play', {
            'audio_time': future_audio_time
        }, room=room, include_self=False)

@socketio.on('pause')
def handle_pause(data):
    """Broadcast immediate pause to all clients in the same room."""
    room = data.get('room')
    if room:
        emit('pause', data, room=room, include_self=False)

@socketio.on('seek')
def handle_seek(data):
    """Broadcast seek event to all clients in the same room."""
    room = data.get('room')
    if room:
        emit('seek', data, room=room, include_self=False)

@socketio.on('sync')
def handle_sync(data):
    """Broadcast sync_seek event to all other clients in the same room."""
    room = data.get('room')
    if room:
        delay = float(data.get('delay', 0.5))
        future_audio_time = data.get('time', 0) + delay
        emit('sync_seek', {
            'audio_time': future_audio_time
        }, room=room, include_self=False)
