const FlowManager = require('../services/flowManager');
const { downloadMedia } = require('../utils/mediaHandler');
const { analizarCheque } = require('../services/chatgpt/analizarCheque');
const { saveImageToStorage } = require('../services/firebase/storageHandler');

const crearOperacionFlow = {
    async start(userId, message, sock) {
        // Descargar la imagen del cheque
        
        const filePath = await saveImageToStorage(message, userId);

        if (!filePath) {
            FlowManager.resetFlow(userId);
            await sock.sendMessage(userId, { text: 'No pude guardar la imagen del cheque. Intenta nuevamente.' });
            return;
        }

        // Analizar la imagen para extraer los datos del cheque
        const chequeData = await analizarCheque(filePath);
        if (!chequeData) {
            FlowManager.resetFlow(userId);
            await sock.sendMessage(userId, { text: 'No pude analizar los datos del cheque. Intenta nuevamente.' });
            return;
        }

        // Solicitar confirmación de los datos extraídos
        FlowManager.setFlow(userId, 'CREAR_OPERACION', 0); // Flujo en paso 0
        await sock.sendMessage(userId, {
            text: `He detectado los siguientes datos del cheque:\n\n${JSON.stringify(chequeData, null, 2)}\n\n¿Son correctos? Responde "Sí" para confirmar o "No" para cancelar.`,
        });
    },

    async handle(userId, message, step, sock, messageType) {
        if (step === 0) {
            if (messageType === 'text' && (message.toLowerCase() === 'sí' || message.toLowerCase() === 'confirmar')) {
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: '¡Operación registrada con éxito! 🎉' });
                // Aquí puedes guardar los datos de la operación en la base de datos
            } else if (messageType === 'text' && (message.toLowerCase() === 'no' || message.toLowerCase() === 'cancelar')) {
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: 'Operación cancelada. Si necesitas algo más, ¡escríbeme!' });
            } else {
                await sock.sendMessage(userId, { text: 'Por favor, responde con "Sí" para confirmar o "No" para cancelar.' });
            }
        }
    },
};

module.exports = crearOperacionFlow;
