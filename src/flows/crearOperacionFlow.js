const FlowManager = require('../services/flowManager');
const { saveImageToStorage } = require('../services/firebase/storageHandler');
const { analizarCheque } = require('../services/chatgpt/analizarCheque');
const { formatCurrency } = require('../utils/formatCurrency');

// Función para determinar si un paso es necesario
const isStepRequired = (step, chequeType) => {
    const stepsToSkip = {
        'CHEQUE': [], // No se omite ningún paso para CHEQUE
        'TRANSFERENCIA': [2], // Omitir paso 2 para transferencias
        'OTRO': [2], // Omitir paso 2 para otros tipos
    };

    return !stepsToSkip[chequeType]?.includes(step);
};

const crearOperacionFlow = {
    async start(userId, message, sock) {
        try {
            await sock.sendMessage(userId, { text: '📝 Creando operación...\nPor favor, espera mientras procesamos tu imagen.' });

            // Descargar y guardar la imagen en Firebase Storage
            const phoneNumber = userId.split('@')[0];
            const imageUrl = await saveImageToStorage(message, phoneNumber);

            if (!imageUrl) {
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: '⚠️ No pude procesar la imagen del cheque. Por favor, intenta nuevamente.' });
                return;
            }

            // Analizar el cheque para obtener datos iniciales
            const { respuesta: chequeData, prompt } = await analizarCheque(imageUrl);

            if (!chequeData) {
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: '⚠️ No pude extraer información del cheque. Por favor, intenta nuevamente.' });
                return;
            }

            chequeData.descuentoGeneral = chequeData.tipo == "CHEQUE" ? 1.8 * chequeData.monto / 100 : 2 * chequeData.monto / 100;

            // Guardar datos iniciales en el flujo y avanzar al siguiente paso
            FlowManager.setFlow(userId, 'CREAR_OPERACION', 0, { chequeData });
            await sock.sendMessage(userId, {
                text: `✅ He detectado los siguientes datos del cheque:\n\n` +
                    `- *Monto*: ${formatCurrency(chequeData.monto) || 'No detectado'}\n` +
                    `- *Número de comprobante*: ${chequeData.numero_comprobante || 'No detectado'}\n` +
                    `- *Banco emisor*: ${chequeData.banco_emisor || 'No detectado'}\n\n` +
                    `Ahora necesito más información:\n1️⃣ ¿Quién es el cliente que emite la transferencia? (Escribe el nombre).`,
            });
        } catch (error) {
            console.error('Error en crearOperacionFlow:', error.message);
            FlowManager.resetFlow(userId);
            await sock.sendMessage(userId, { text: '⚠️ Ocurrió un error procesando la operación. Intenta nuevamente.' });
        }
    },

    async handle(userId, message, step, sock, messageType) {
        if (messageType !== 'text') {
            await sock.sendMessage(userId, { text: '⚠️ Por favor, responde con texto para continuar.' });
            return;
        }

        const flowData = FlowManager.getFlow(userId)?.flowData || {};

        switch (step) {
            case 0: // Solicitar el cliente emisor
                flowData.clienteEmisor = message;
                FlowManager.setFlow(userId, 'CREAR_OPERACION', 1, flowData);
                await sock.sendMessage(userId, {
                    text: '2️⃣ ¿Quién es el cliente que recibe la transferencia? (Escribe el nombre).',
                });
                break;

            case 1: // Solicitar el cliente receptor
                flowData.clienteReceptor = message;

                if (isStepRequired(2, flowData.chequeData.tipo)) {
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 2, flowData);
                    await sock.sendMessage(userId, {
                        text: '3️⃣ ¿Qué tipo de cheque es? Responde con el número correspondiente:\n\n' +
                            '1️⃣ Gestión\n' +
                            '2️⃣ Diferido\n' +
                            '3️⃣ Pecho',
                    });
                } else {
                    // Omitir el paso 2 y calcular el total directamente
                    flowData.tipoCheque = 'No aplica';
                    flowData.descuento = 0;
                    flowData.total = flowData.chequeData.monto - flowData.chequeData.descuentoGeneral;
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 3, flowData);

                    await sock.sendMessage(userId, {
                        text: `✅ Perfecto, estos son los datos recopilados:\n\n` +
                            `- *Monto*: ${formatCurrency(flowData.chequeData?.monto) || 'No detectado'}\n` +
                            `- *Número de comprobante*: ${flowData.chequeData?.numero_comprobante || 'No detectado'}\n` +
                            `- *Banco emisor*: ${flowData.chequeData?.banco_emisor || 'No detectado'}\n` +
                            `- *Cliente Emisor*: ${flowData.clienteEmisor || 'No especificado'}\n` +
                            `- *Cliente Receptor*: ${flowData.clienteReceptor || 'No especificado'}\n` +
                            `- *Tipo de Cheque*: ${flowData.tipoCheque}\n\n` +
                            `Resumen de descuentos:\n` +
                            `- Descuento transferencia (2%): ${formatCurrency(flowData.chequeData.descuentoGeneral)}\n` +
                            `- **Total a recibir**: ${formatCurrency(flowData.total)}\n\n` +
                            `¿Deseas confirmar esta operación?\n\n` +
                            `1️⃣ Confirmar\n` +
                            `2️⃣ Cancelar\n` +
                            `3️⃣ Modificar algún dato`,
                    });
                }
                break;

            case 2: // Solicitar el tipo de cheque
                const opcionesCheque = {
                    '1': 'Gestión',
                    '2': 'Diferido',
                    '3': 'Pecho',
                };

                const descuentos = {
                    '1': 1.2,
                    '2': 1,
                    '3': 1.7,
                };

                const tipoCheque = opcionesCheque[message];
                const descuento = descuentos[message];
                if (tipoCheque) {
                    flowData.tipoCheque = tipoCheque;
                    flowData.descuento = descuento * flowData.chequeData.monto / 100;
                    flowData.total = flowData.chequeData.monto - flowData.chequeData.descuentoGeneral - flowData.descuento;

                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 3, flowData);

                    await sock.sendMessage(userId, {
                        text: `✅ Perfecto, estos son los datos recopilados:\n\n` +
                            `- *Monto*: ${formatCurrency(flowData.chequeData?.monto) || 'No detectado'}\n` +
                            `- *Número de comprobante*: ${flowData.chequeData?.numero_comprobante || 'No detectado'}\n` +
                            `- *Banco emisor*: ${flowData.chequeData?.banco_emisor || 'No detectado'}\n` +
                            `- *Cliente Emisor*: ${flowData.clienteEmisor || 'No especificado'}\n` +
                            `- *Cliente Receptor*: ${flowData.clienteReceptor || 'No especificado'}\n` +
                            `- *Tipo de Cheque*: ${flowData.tipoCheque}\n\n` +
                            `Resumen de descuentos:\n` +
                            `- Descuento Cheque (1.8%): ${formatCurrency(flowData.chequeData.descuentoGeneral)}\n` +
                            `- Descuento ${flowData.tipoCheque} (${descuento}%): ${formatCurrency(flowData.descuento)}\n` +
                            `- **Total a recibir**: ${formatCurrency(flowData.total)}\n\n` +
                            `¿Deseas confirmar esta operación?\n\n` +
                            `1️⃣ Confirmar\n` +
                            `2️⃣ Cancelar\n` +
                            `3️⃣ Modificar algún dato`,
                    });
                } else {
                    await sock.sendMessage(userId, {
                        text: '⚠️ Respuesta no válida. Por favor, responde con el número correspondiente:\n1️⃣ Gestión\n2️⃣ Diferido\n3️⃣ Pecho',
                    });
                }
                break;

            case 3: // Confirmación final
                if (message === '1') {
                    FlowManager.resetFlow(userId);
                    await sock.sendMessage(userId, { text: '🎉 ¡Operación registrada con éxito! Gracias por confiar en nuestro servicio.' });
                } else if (message === '2') {
                    FlowManager.resetFlow(userId);
                    await sock.sendMessage(userId, { text: '❌ Operación cancelada. Si necesitas algo más, ¡escríbeme!' });
                } else if (message === '3') {
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 4, flowData);
                    await sock.sendMessage(userId, {
                        text: '✏️ Por favor, escribe qué dato deseas modificar (por ejemplo: "El monto es incorrecto, debe ser 50,000").',
                    });
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Respuesta no válida. Por favor, elige:\n1️⃣ Confirmar\n2️⃣ Cancelar\n3️⃣ Modificar' });
                }
                break;

            default:
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: '⚠️ Algo salió mal. Intenta nuevamente desde el inicio.' });
        }
    },
};

module.exports = crearOperacionFlow;
