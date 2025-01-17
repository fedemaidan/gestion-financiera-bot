const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode-terminal');
const path = require('path');

const connectToWhatsApp = async () => {
    const authDir = path.resolve('./auth');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            // Mostrar el QR en la terminal
            QRCode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            console.log('Conexión cerrada. Reintentando...');
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Conectado a WhatsApp');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
};

module.exports = connectToWhatsApp;
