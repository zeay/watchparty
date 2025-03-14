const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket']
});
const path = require('path');

// Enable gzip compression
const compression = require('compression');
app.use(compression());

// Serve static files with caching
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

// Room state management
const rooms = new Map();

class RoomState {
    constructor() {
        this.lastKnownTime = 0;
        this.isPlaying = false;
        this.participants = new Set();
        this.bufferedChunks = new Map();
    }
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('join-room', (roomId) => {
        currentRoom = roomId;
        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new RoomState());
        }
        
        const room = rooms.get(roomId);
        room.participants.add(socket.id);

        // Send current state to new participant
        socket.emit('sync-state', {
            time: room.lastKnownTime,
            isPlaying: room.isPlaying
        });
    });

    // Optimized video sync events
    socket.on('video-play', (data) => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            room.lastKnownTime = data.time;
            room.isPlaying = true;
            socket.to(currentRoom).emit('video-play', data);
        }
    });

    socket.on('video-pause', (data) => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            room.lastKnownTime = data.time;
            room.isPlaying = false;
            socket.to(currentRoom).emit('video-pause', data);
        }
    });

    socket.on('video-seek', (data) => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            room.lastKnownTime = data.time;
            socket.to(currentRoom).emit('video-seek', data);
        }
    });

    // Chunked file handling
    socket.on('upload-chunk', (data) => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            room.bufferedChunks.set(data.offset, data.chunk);
            
            // Check if we have all chunks
            let totalReceived = 0;
            room.bufferedChunks.forEach(chunk => {
                totalReceived += chunk.length;
            });

            if (totalReceived === data.total) {
                // Combine chunks and broadcast
                const chunks = Array.from(room.bufferedChunks.values());
                const completeFile = Buffer.concat(chunks);
                socket.to(currentRoom).emit('video-data', completeFile);
                
                // Clear buffer
                room.bufferedChunks.clear();
            }
        }
    });

    // Chat messages
    socket.on('chat-message', (data) => {
        io.to(data.room).emit('chat-message', data.message);
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.participants.delete(socket.id);
                if (room.participants.size === 0) {
                    rooms.delete(currentRoom);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});