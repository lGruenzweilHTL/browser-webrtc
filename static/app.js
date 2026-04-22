// DOM Elements
const remoteVideo = document.getElementById('remoteVideo');
const callBtn = document.getElementById('callBtn');
const hangupBtn = document.getElementById('hangupBtn');

// WebRTC State variables
let localStream;
let peerConnection;

// The signaling server WebSocket connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws`;
const signalingSocket = new WebSocket(wsUrl);

// Free public STUN servers provided by Google, PLUS your new TURN server fetched from the backend
let configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Fetch dynamic TURN configuration securely from backend
async function fetchTurnConfig() {
    try {
        const response = await fetch('/api/turn-config');
        if (response.ok) {
            const turnData = await response.json();
            if (turnData.url && turnData.username) {
                configuration.iceServers.push({
                    urls: turnData.url,
                    username: turnData.username,
                    credential: turnData.credential
                });
                console.log('Successfully fetched secure TURN credentials');
            }
        }
    } catch (error) {
        console.error('Failed to fetch TURN config. Falling back to STUN only.', error);
    }
}

// Fetch config when the script loads
fetchTurnConfig();

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

// Caller logic
callBtn.onclick = async () => {
    callBtn.disabled = true;
    hangupBtn.disabled = false;
    
    if (!localStream) {
        try {
            // Request audio and video from the user's device
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (error) {
            console.error('Error accessing media devices.', error);
            alert('Could not access camera/mic. Please grant permissions.');
            callBtn.disabled = false;
            hangupBtn.disabled = true;
            return;
        }
    }

    createPeerConnection();

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

    // Track ICE connection state for debugging
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            hangupBtn.click();
        }
    };
}

// =======================
// Handling Signaling Messages
// =======================

async function handleOffer(offer) {
    if (!peerConnection) {
        createPeerConnection();
    }

    // Callee also needs to add their own media tracks to the connection
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (error) {
            console.error('Error accessing media devices on answer.', error);
        }
    }
    
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
