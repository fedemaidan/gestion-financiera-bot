const {connectToWhatsApp } = require('./src/whatsapp');
const getMessageType = require('./src/utils/getMessageType');
const messageResponder = require('./src/utils/messageResponder');

const startBot = async () => {
    const sock = await connectToWhatsApp();

    sock.ev.on('messages.upsert', async (message) => {
        const msg = message.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;

        // Identificar el tipo de mensaje
        const messageType = getMessageType(msg.message);
        console.log(`Tipo de mensaje recibido: ${messageType}`);

        // Delegar manejo al messageResponder
        await messageResponder(messageType, msg, sock, sender);
    });
};

startBot();
