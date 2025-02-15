const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { admin } = require('./services/firebase/firebaseUtils');
const QRCode = require('qrcode');

const bucket = admin.storage().bucket();
const app = express();
let latestQR = null;

const sessionFolderPath = `whatsappSessions/${process.env.SESSION_WHATSAPP || 'general_session'}`;
const authDir = path.resolve('./auth');

app.get('/qr', (req, res) => {
    if (!latestQR) {
        return res.send('QR no generado aún. Espera...');
    }

    QRCode.toDataURL(latestQR, (err, url) => {
        if (err) return res.status(500).send('Error generando QR');
        res.send(`<img src="${url}" style="width:300px;">`);
    });
});

const saveSessionToStorage = async () => {
    try {
        if (!fs.existsSync(authDir)) {
            console.error('⚠️ No se encontró la carpeta de autenticación. No se guardará la sesión.');
            return;
        }

        const files = fs.readdirSync(authDir);
        for (const file of files) {
            const filePath = path.join(authDir, file);
            const destination = `${sessionFolderPath}/${file}`;

            const fileUpload = bucket.file(destination);
            await fileUpload.save(fs.readFileSync(filePath), {
                metadata: { contentType: 'application/json' },
            });
            console.log(`✅ Archivo guardado en Firebase Storage: ${destination}`);
        }

        console.log(`✅ Sesión completa guardada en Firebase Storage (${sessionFolderPath}).`);
    } catch (error) {
        console.error('❌ Error guardando sesión en Firebase Storage:', error.message);
    }
};

const loadSessionFromStorage = async () => {
    try {
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
        }

        fs.mkdirSync(authDir, { recursive: true });

        const [files] = await bucket.getFiles({ prefix: sessionFolderPath });
        if (files.length === 0) {
            console.log(`⚠️ No se encontró sesión en Storage (${sessionFolderPath}).`);
            return;
        }

        for (const file of files) {
            const localPath = path.join(authDir, path.basename(file.name));
            await file.download({ destination: localPath });
            console.log(`🔄 Sesión descargada: ${file.name}`);
        }
    } catch (error) {
        console.error('❌ Error cargando sesión desde Firebase Storage:', error.message);
    }
};

const connectToWhatsApp = async () => {
    
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    
    const sock = makeWASocket({ auth: state });
    
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            latestQR = qr;
            console.log('QR actualizado. Escanea en: http://localhost:3000/qr');
        }

        if (connection === 'close') {
            console.log('Conexión cerrada. Reintentando...');
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Conectado a WhatsApp');
            setTimeout(() => {
                // saveSessionToStorage();
            }, 2000);
        }
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
};

app.listen(3000, () => console.log('Servidor corriendo en http://localhost:3000/qr'));

module.exports = {connectToWhatsApp, loadSessionFromStorage};
