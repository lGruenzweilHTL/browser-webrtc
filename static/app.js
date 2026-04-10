// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const callBtn = document.getElementById('callBtn');
const hangupBtn = document.getElementById('hangupBtn');
const dataStatus = document.getElementById('dataChannelStatus');
const dataInput = document.getElementById('dataInput');
const sendDataBtn = document.getElementById('sendDataBtn');
const messagesDiv = document.getElementById('messages');

// WebRTC State variables
let localStream;
let peerConnection;
let dataChannel;

// The signaling server WebSocket connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws`;
const signalingSocket = new WebSocket(wsUrl);

// Free public STUN servers provided by Google, PLUS your new TURN server
// Replace the TURN credentials below with your real ones from Metered.ca or Twilio
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:global.turn.twilio.com:3478?transport=udp', // Example TURN URL
            username: 'YOUR_TURN_USERNAME',
            credential: 'YOUR_TURN_PASSWORD'
        }
    ]
};

// =======================
// Signaling Logic
// =======================

signalingSocket.onopen = () => {
    console.log('Connected to the signaling server.');
};

signalingSocket.onmessage = async (event) => {
    // Parse incoming signaling messages from other peer
    const message = JSON.parse(event.data);

    if (message.type === 'offer') {
        await handleOffer(message.offer);
    } else if (message.type === 'answer') {
        await handleAnswer(message.answer);
    } else if (message.type === 'ice-candidate') {
        await handleIceCandidate(message.candidate);
    }
};

function sendSignalingMessage(message) {
    if (signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify(message));
    }
}

// =======================
// Media and UI Logic
// =======================

startBtn.onclick = async () => {
    try {
        // Request audio and video from the user's device
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Display the local video feed
        localVideo.srcObject = localStream;
        
        // Update UI
        startBtn.disabled = true;
        callBtn.disabled = false;
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access camera/mic. Please grant permissions.');
    }
};

// Caller logic
callBtn.onclick = async () => {
    callBtn.disabled = true;
    hangupBtn.disabled = false;
    
    createPeerConnection();
    
    // Create the data channel on the caller side
    createDataChannel();

    // Add local media tracks to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    try {
        // Create an offer and set it as local description
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Send the offer to the signaling server
        sendSignalingMessage({ type: 'offer', offer: offer });
    } catch (error) {
        console.error('Error creating offer.', error);
    }
};

hangupBtn.onclick = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    hangupBtn.disabled = true;
    callBtn.disabled = false;
    dataStatus.innerHTML = 'Status: <span class="offline">Offline</span>';
    dataInput.disabled = true;
    sendDataBtn.disabled = true;
};

// =======================
// WebRTC Peer Connection Core
// =======================

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    // ICE Candidate gathering -> Send to remote peer
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignalingMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    // When remote media track arrives, attach it to the remote video element
    peerConnection.ontrack = (event) => {
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Listen for incoming DataChannel (for the Callee)
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannelEventHandlers();
    };

    // Track ICE connection state for debugging
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            hangupBtn.click();
        }
    };
}

// =======================
// Data Channel Logic
// =======================

function createDataChannel() {
    // Label it 'gameData' to signify future use case
    dataChannel = peerConnection.createDataChannel('gameData');
    setupDataChannelEventHandlers();
}

function setupDataChannelEventHandlers() {
    dataChannel.onopen = () => {
        console.log('Data channel opened!');
        dataStatus.innerHTML = 'Status: <span class="online">Connected</span>';
        dataInput.disabled = false;
        sendDataBtn.disabled = false;
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed!');
        dataStatus.innerHTML = 'Status: <span class="offline">Offline</span>';
        dataInput.disabled = true;
        sendDataBtn.disabled = true;
    };

    dataChannel.onmessage = (event) => {
        console.log('Received message:', event.data);
        appendMessage('Remote', event.data);
    };
}

sendDataBtn.onclick = () => {
    const text = dataInput.value;
    if (text && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(text);
        appendMessage('You', text);
        dataInput.value = '';
    }
};

dataInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendDataBtn.click();
    }
});

function appendMessage(sender, text) {
    const p = document.createElement('p');
    p.className = 'message';
    p.innerHTML = `<strong>${sender}:</strong> ${text}`;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// =======================
// Handling Signaling Messages
// =======================

async function handleOffer(offer) {
    if (!peerConnection) {
        createPeerConnection();
    }

    // Callee also needs to add their own media tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Create an answer and set it as local description
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send the answer back to the Caller
    sendSignalingMessage({ type: 'answer', answer: answer });
    
    callBtn.disabled = true;
    hangupBtn.disabled = false;
}

async function handleAnswer(answer) {
    if (!peerConnection) {
        console.error('No peer connection when receiving answer.');
        return;
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleIceCandidate(candidate) {
    if (!peerConnection) {
        console.error('No peer connection when receiving ICE candidate.');
        return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error('Error adding received ICE candidate', e);
    }
}
