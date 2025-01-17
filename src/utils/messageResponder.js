const FlowMapper = require('../services/flowMapper'); // Asegúrate de importar correctamente FlowMapper
const { downloadMedia } = require('./mediaHandler'); // Asegúrate de importar correctamente downloadMedia

// Responder mensajes según el tipo de contenido
const messageResponder = async (messageType, msg, sock, sender) => {
    switch (messageType) {
        case 'text':
        case 'text_extended': {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            await FlowMapper.handleMessage(sender, text, sock, messageType);
            break;
        }
        case 'image': {
            
            await FlowMapper.handleMessage(
                sender,
                msg,
                sock,
                'image'
            );
            
            break;
        }
        case 'video': {
            const filePath = await downloadMedia(msg.message, 'video');
            if (filePath) {
                await sock.sendMessage(sender, { text: `He recibido tu video y lo he guardado en: ${filePath}` });
            } else {
                await sock.sendMessage(sender, { text: 'No pude guardar el video. Intenta nuevamente.' });
            }
            break;
        }
        case 'audio': {
            const filePath = await downloadMedia(msg.message, 'audio');
            if (filePath) {
                await sock.sendMessage(sender, { text: `He recibido tu audio y lo he guardado en: ${filePath}` });
            } else {
                await sock.sendMessage(sender, { text: 'No pude guardar el audio. Intenta nuevamente.' });
            }
            break;
        }
        case 'document': {
            const filePath = await downloadMedia(msg.message, 'document');
            if (filePath) {
                await sock.sendMessage(sender, { text: `He recibido tu documento y lo he guardado en: ${filePath}` });
            } else {
                await sock.sendMessage(sender, { text: 'No pude guardar el documento. Intenta nuevamente.' });
            }
            break;
        }
        case 'document-caption': {
            const caption = msg.message.documentWithCaptionMessage?.message?.documentMessage?.caption;
            const filePath = await downloadMedia(msg.message, 'document_with_caption');
            if (filePath) {
                await sock.sendMessage(sender, {
                    text: `He recibido tu documento con texto: "${caption}" y lo he guardado en: ${filePath}`,
                });
            } else {
                await sock.sendMessage(sender, { text: 'No pude guardar el documento. Intenta nuevamente.' });
            }
            break;
        }
        default: {
            await sock.sendMessage(sender, {
                text: `No entiendo este tipo de mensaje (${messageType}). Por favor, envíame texto o un comando válido.`,
            });
        }
    }
};

module.exports = messageResponder;
