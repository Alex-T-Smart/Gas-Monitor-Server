const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// File to store ALL device data
const DATA_FILE = path.join(__dirname, 'devices.json');

// Load all devices from file
function loadDevices() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const devices = JSON.parse(data);
            console.log('Loaded devices:', Object.keys(devices).length);
            return devices;
        }
    } catch (error) {
        console.log('Error loading devices:', error.message);
    }
    return {};
}

// Save all devices to file
function saveDevices(devices) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(devices, null, 2));
        console.log('Saved devices to file');
    } catch (error) {
        console.log('Error saving devices:', error.message);
    }
}

// Initialize devices
let devices = loadDevices();

// Twilio setup
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Serve dashboard


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Get all devices (list of device IDs)
app.get('/api/devices', (req, res) => {
    const deviceList = Object.keys(devices);
    console.log('Device list requested:', deviceList);
    res.json(deviceList);
});

// Get device settings
app.get('/api/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices[deviceId] || { 
        location: 'Unknown', 
        peopleCount: '1', 
        emergencyNumber: '+27640789433',
        phoneNumbers: []
    };
    console.log('GET device:', deviceId);
    res.json(device);
});

// Save device settings
app.post('/api/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const { location, peopleCount, emergencyNumber } = req.body;
    
    console.log('POST device:', deviceId);
    
    if (!devices[deviceId]) {
        devices[deviceId] = {};
    }
    
    if (location) devices[deviceId].location = location;
    if (peopleCount) devices[deviceId].peopleCount = peopleCount;
    if (emergencyNumber) devices[deviceId].emergencyNumber = emergencyNumber;
    if (!devices[deviceId].phoneNumbers) devices[deviceId].phoneNumbers = [];
    
    saveDevices(devices);
    res.json({ success: true, device: devices[deviceId] });
});

// Add phone number to device
app.post('/api/device/:deviceId/phones', (req, res) => {
    const deviceId = req.params.deviceId;
    const { number, name } = req.body;
    
    console.log('POST phone to device:', deviceId, number);
    
    if (!devices[deviceId]) {
        devices[deviceId] = {
            location: 'Unknown',
            peopleCount: '1',
            emergencyNumber: '+27640789433',
            phoneNumbers: []
        };
    }
    
    if (!devices[deviceId].phoneNumbers) {
        devices[deviceId].phoneNumbers = [];
    }
    
    // Check if number already exists
    const exists = devices[deviceId].phoneNumbers.some(p => p.number === number);
    if (exists) {
        return res.status(400).json({ error: 'Number already exists' });
    }
    
    const newPhone = {
        id: Date.now(),
        number: number,
        name: name || 'My Phone'
    };
    
    devices[deviceId].phoneNumbers.push(newPhone);
    saveDevices(devices);
    res.json(newPhone);
});

// Delete phone number from device
app.delete('/api/device/:deviceId/phones/:phoneId', (req, res) => {
    const deviceId = req.params.deviceId;
    const phoneId = parseInt(req.params.phoneId);
    
    console.log('DELETE phone from device:', deviceId, phoneId);
    
    if (devices[deviceId] && devices[deviceId].phoneNumbers) {
        devices[deviceId].phoneNumbers = devices[deviceId].phoneNumbers.filter(p => p.id !== phoneId);
        saveDevices(devices);
    }
    
    res.json({ success: true });
});

// Test SMS for device
app.post('/api/device/:deviceId/test-sms', async (req, res) => {
    const deviceId = req.params.deviceId;
    console.log('Test SMS for device:', deviceId);
    
    const device = devices[deviceId] || {
        location: 'Unknown',
        peopleCount: '1',
        emergencyNumber: '+27640789433',
        phoneNumbers: []
    };
    
    const results = [];
    for (let phone of (device.phoneNumbers || [])) {
        try {
            const message = `TEST: Gas Monitor System Check\n\n` +
                           `Location: ${device.location}\n` +
                           `People: ${device.peopleCount}\n` +
                           `Device ID: ${deviceId}\n\n` +
                           `System is operational and monitoring.`;
            
            await twilioClient.messages.create({
                body: message,
                to: phone.number,
                from: process.env.TWILIO_PHONE_NUMBER
            });
            console.log('Test SMS sent to:', phone.number);
            results.push({ number: phone.number, success: true });
        } catch (error) {
            console.log('Failed to send to:', phone.number, error.message);
            results.push({ number: phone.number, success: false, error: error.message });
        }
    }
    res.json(results);
});

// Arduino alert endpoint
app.post('/api/device/alert', async (req, res) => {
    const { deviceId, gasLevel, flameDetected } = req.body;
    console.log('Alert received from:', deviceId);
    console.log('   Gas:', gasLevel, 'Flame:', flameDetected);
    
    // Get device settings
    const device = devices[deviceId] || {
        location: 'Unknown',
        peopleCount: '1',
        emergencyNumber: '+27640789433',
        phoneNumbers: []
    };
    
    let alertType = 'GAS LEAK';
    if (flameDetected && gasLevel > 250) alertType = 'GAS LEAK WITH FLAME';
    else if (flameDetected) alertType = 'FLAME DETECTED';
    
    // Send SMS to all phone numbers for this device
    for (let phone of (device.phoneNumbers || [])) {
        const message = `EMERGENCY ALERT: ${alertType}!\n\n` +
                        `Location: ${device.location || 'Unknown'}\n` +
                        `People at location: ${device.peopleCount || '1'}\n` +
                        `Device: ${deviceId}\n\n` +
                        `Gas Level: ${gasLevel}\n` +
                        `Flame: ${flameDetected ? 'YES' : 'NO'}\n\n` +
                        `Time: ${new Date().toLocaleString()}\n\n` +
                        `For emergency assistance, call: ${device.emergencyNumber || '+27640789433'}\n\n` +
                        `Please check immediately!`;
        
        try {
            await twilioClient.messages.create({
                body: message,
                to: phone.number,
                from: process.env.TWILIO_PHONE_NUMBER
            });
            console.log('SMS sent to:', phone.number);
        } catch (error) {
            console.log('SMS failed to:', phone.number, error.message);
        }
    }
    
    res.json({ received: true, alertType });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', devices: Object.keys(devices).length });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`Gas Monitor Server Running`);
    console.log(`========================================`);
    console.log(`Server URL: http://localhost:${PORT}`);
    console.log(`Dashboard: http://YOUR_IP:${PORT}`);
    console.log(`Devices registered: ${Object.keys(devices).length}`);
    console.log(`Twilio: Enabled`);
    console.log(`========================================\n`);
});
