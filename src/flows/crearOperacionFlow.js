const FlowManager = require('../services/flowManager');
const { saveImageToStorage } = require('../services/firebase/storageHandler');
const { analizarComprobantes } = require('../services/chatgpt/analizarComprobantes');
const { formatCurrency } = require('../utils/formatCurrency');
const { getFechaFirestore } = require('../utils/fechas');
const ProveedoresService = require('../services/ProveedoresService');
const { analizarModificacionComprobante } = require('../services/chatgpt/analizarModificacionComprobante');
const { addComprobanteToSheet } = require('../services/GoogleSheetsService');

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
                await sock.sendMessage(userId, { text: '⚠️ No pude procesar la imagen. Por favor, intenta nuevamente.' });
                return;
            }

            // Analizar el cheque para obtener datos iniciales
            const { respuesta: comprobantes, prompt } = await analizarComprobantes(imageUrl);

            if (!comprobantes) {
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: '⚠️ No pude extraer información. Por favor, intenta nuevamente.' });
                return;
            }
            
            switch  (comprobantes.tipo) {
                case "CHEQUES": 
                    let montoTotal = 0;
                    for (let index = 0; index < comprobantes.cheques.length; index++) {
                        const cheque = comprobantes.cheques[index];
                        comprobantes.cheques[index].descuentoGeneral = 1.8 * cheque.monto / 100;
                        comprobantes.cheques[index].tipo = "CHEQUE";
                        comprobantes.cheques[index].fecha = getFechaFirestore(null);
                        montoTotal += cheque.monto;

                        await sock.sendMessage(userId, {
                            text: `✅ Cheque ${index+1}:\n\n` +
                                `- *Monto*: ${formatCurrency(cheque.monto) || 'No detectado'}\n` +
                                `- *Número de comprobante*: ${cheque.numero_comprobante || 'No detectado'}\n` +
                                `- *Banco emisor*: ${cheque.banco_emisor || 'No detectado'}\n` + 
                                `- *CUIT*: ${cheque.cuit || 'No detectado'}\n` + 
                                `- *Fecha de pago*: ${cheque.fecha_pago || 'No detectado'}` 
                        });
                    }

                    await sock.sendMessage(userId, {
                        text: `💰 *Total de la operación:* ${formatCurrency(montoTotal)}\n\n` +
                        `¿Deseas modificar algún cheque antes de continuar?\n\n` +
                        `1️⃣ No, continuar\n2️⃣ Sí, modificar un cheque`
                    });

                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 6, { comprobantes: comprobantes.cheques, tipoOperacion: "CHEQUE" });
                    break;
                case "TRANSFERENCIA": 
                    const transferencia = comprobantes;
                    transferencia.descuentoGeneral = 2 * transferencia.monto / 100;
                    transferencia.fecha = getFechaFirestore(null);
                    await sock.sendMessage(userId, {
                        text: `✅ He detectado los siguientes datos del cheque:\n\n` +
                            `- *Monto*: ${formatCurrency(transferencia.monto) || 'No detectado'}\n` +
                            `- *Número de comprobante*: ${transferencia.numero_comprobante || 'No detectado'}\n` +
                            `- *Banco emisor*: ${transferencia.banco_emisor || 'No detectado'}\n\n` +
                            `- *CUIT*: ${transferencia.cuit || 'No detectado'}\n` + 
                            `- *Fecha de pago*: ${transferencia.fecha_pago || 'No detectado'}` 
                    });
                    
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 0, { comprobantes: [transferencia], tipoOperacion: "TRANSFERENCIA" });
                    break; 
            }
            // await sock.sendMessage(userId, {
            //     text: '2️⃣ ¿Quién es el cliente que envía la transferencia? (Escribe el nombre).',
            // });
        } catch (error) {
            console.error('Error en crearOperacionFlow:', error.message);
            FlowManager.resetFlow(userId);
            await sock.sendMessage(userId, { text: '⚠️ Ocurrió un error procesando la operación. Intenta nuevamente.' });
        }
    },

    async handle(userId, message, step, sock, messageType) {
        //if (messageType !== 'text' || messageType !== 'text_extended') {
        const esTexto = messageType !== 'text' ? messageType !== 'text_extended' : false;
        if (esTexto) {
            await sock.sendMessage(userId, { text: '⚠️ Por favor, responde con texto para continuar.' });
            return;
        }

        const flowData = FlowManager.getFlow(userId)?.flowData || {};

        switch (step) {
            case 0: // Solicitar el cliente emisor
                flowData.clienteEmisor = message;
                FlowManager.setFlow(userId, 'CREAR_OPERACION', 1, flowData);
                const proveedores = await ProveedoresService.obtenerProveedores();
            
                if (proveedores.length > 0) {
                    let proveedoresTexto = "Selecciona un proveedor:\n\n";
                    proveedores.forEach((prov, index) => {
                        proveedoresTexto += `${index + 1}️⃣ ${prov.nombre}\n`;
                    });
                    proveedoresTexto += `\nO escribe el nombre manualmente si no está en la lista.`;

                    await sock.sendMessage(userId, { text: proveedoresTexto });
                } else {
                    await sock.sendMessage(userId, { text: 'No se encontraron proveedores. Escribe el nombre manualmente.' });
                }
                break;


                break;

            case 1: // Solicitar el cliente receptor
                const proveedoresList = await ProveedoresService.obtenerProveedores();
                const proveedorSeleccionado = proveedoresList[parseInt(message) - 1]; // Verificamos si el mensaje es un número válido

                if (proveedorSeleccionado) {
                    flowData.clienteReceptor = proveedorSeleccionado.nombre;
                } else {
                    ProveedoresService.agregarProveedor(message);
                    flowData.clienteReceptor = message;
                }

                if (isStepRequired(2, flowData.tipoOperacion)) {
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 2, flowData);
                    await sock.sendMessage(userId, {
                        text: '3️⃣ ¿Qué tipo de cheque es? Responde con el número correspondiente:\n\n' +
                            '1️⃣ Gestión 1.2\n' +
                            '2️⃣ Gestión 1.7\n' +
                            '3️⃣ Diferido\n' +
                            '4️⃣ Pecho',
                    });
                } else {
                    const transferencia = flowData.comprobantes[0]
                    transferencia.tipoCheque = 'Transferencia';
                    transferencia.descuento = 1 * transferencia.monto / 100;
                    transferencia.total = transferencia.monto - transferencia.descuentoGeneral - transferencia.descuento;
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 3, { comprobantes: [transferencia]});

                    await sock.sendMessage(userId, {
                        text: `✅ Perfecto, estos son los datos recopilados:\n\n` +
                            `- *Monto*: ${formatCurrency(transferencia?.monto) || 'No detectado'}\n` +
                            `- *Número de comprobante*: ${transferencia?.numero_comprobante || 'No detectado'}\n` +
                            `- *Banco emisor*: ${transferencia?.banco_emisor || 'No detectado'}\n` +
                            `- *Cliente Emisor*: ${flowData.clienteEmisor || 'No especificado'}\n` +
                            `- *Cliente Receptor*: ${flowData.clienteReceptor || 'No especificado'}\n` +
                            `- *Tipo de Cheque*: ${transferencia.tipoCheque}\n\n` +
                            `Resumen de descuentos:\n` +
                            `- Descuento transferencia (2%): ${formatCurrency(flowData.chequeData.descuentoGeneral)}\n` +
                            `- Descuento transferencia (1%): ${formatCurrency(flowData.descuento)}\n` +
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
                    '1': 'Gestión 1.2',
                    '2': 'Gestión 1.7',
                    '3': 'Diferido',
                    '4': 'Pecho',
                };

                const descuentos = {
                    '1': 1.2,
                    '2': 1.7,
                    '3': 1,
                    '4': 1.7,
                };

                const tipoCheque = opcionesCheque[message];
                const descuento = descuentos[message];


                await sock.sendMessage(userId, {
                    text: `✅ Perfecto, estos son los datos recopilados:`})

                if (tipoCheque) {
                    for (let i = 0; i < flowData.comprobantes.length; i++) {
                        const cheque = flowData.comprobantes[i];
                        cheque.tipoCheque = tipoCheque;
                        cheque.descuento = descuento * cheque.monto / 100;
                        cheque.total = cheque.monto - cheque.descuentoGeneral - cheque.descuento;
                        flowData.comprobantes[i] = cheque;

                        await sock.sendMessage(userId, {
                            text: `✅ Cheque ${i+1}:\n\n` +
                                `- *Monto*: ${formatCurrency(cheque?.monto) || 'No detectado'}\n` +
                                `- *Número de comprobante*: ${cheque?.numero_comprobante || 'No detectado'}\n` +
                                `- *Banco emisor*: ${cheque?.banco_emisor || 'No detectado'}\n` +
                                `- *Cliente Emisor*: ${flowData.clienteEmisor || 'No especificado'}\n` +
                                `- *Cliente Receptor*: ${flowData.clienteReceptor || 'No especificado'}\n` +
                                `- *Tipo de Cheque*: ${cheque.tipoCheque}\n\n` +
                                `Resumen de descuentos:\n` +
                                `- Descuento Cheque (1.8%): ${formatCurrency(cheque.descuentoGeneral)}\n` +
                                `- Descuento ${cheque.tipoCheque} (${descuento}%): ${formatCurrency(cheque.descuento)}\n` +
                                `- **Total a recibir**: ${formatCurrency(cheque.total)}\n\n`
                        });
                    }
                    
                } else {
                    await sock.sendMessage(userId, {
                        text: '⚠️ Respuesta no válida. Por favor, responde con el número correspondiente:\n1️⃣ Gestión\n2️⃣ Diferido\n3️⃣ Pecho',
                    });
                }

                await sock.sendMessage(userId, {
                    text: `¿Deseas confirmar esta operación?\n\n` +
                            `1️⃣ Confirmar\n` +
                            `2️⃣ Cancelar\n` +
                            `3️⃣ Modificar algún dato`})

                FlowManager.setFlow(userId, 'CREAR_OPERACION', 3, flowData);
                break;

                case 3: // Confirmación final
                if (message === '1') {
                    FlowManager.resetFlow(userId);
                    for (let i = 0; i < flowData.comprobantes.length; i++) {
                        const comprobante = flowData.comprobantes[i];
                        addComprobanteToSheet(comprobante, flowData.clienteEmisor, flowData.clienteReceptor)   
                    }
                    await sock.sendMessage(userId, { text: '🎉 ¡Operación registrada con éxito! Gracias por confiar en nuestro servicio.' });
                } else if (message === '2') {
                    FlowManager.resetFlow(userId);
                    await sock.sendMessage(userId, { text: '❌ Operación cancelada. Si necesitas algo más, ¡escríbeme!' });
                } else if (message === '3') {
                    if (flowData.comprobantes.length === 1) {
                        // Si solo hay un comprobante, pedir directamente qué modificar
                        flowData.comprobanteSeleccionado = 0;
                        FlowManager.setFlow(userId, 'CREAR_OPERACION', 4, flowData);
                        await sock.sendMessage(userId, {
                            text: '✏️ Escribe qué dato deseas modificar (Ejemplo: "El monto es incorrecto, debe ser 50,000").',
                        });
                    } else {
                        // Si hay varios comprobantes, pedir que elija cuál modificar
                        let comprobantesTexto = '📑 ¿Cuál comprobante deseas modificar? Envía el número correspondiente:\n\n';
                        flowData.comprobantes.forEach((comp, index) => {
                            comprobantesTexto += `${index + 1}️⃣ Monto: ${formatCurrency(comp.monto)} - Banco: ${comp.banco_emisor}\n`;
                        });
            
                        FlowManager.setFlow(userId, 'CREAR_OPERACION', 5, flowData);
                        await sock.sendMessage(userId, { text: comprobantesTexto });
                    }
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Respuesta no válida. Elige:\n1️⃣ Confirmar\n2️⃣ Cancelar\n3️⃣ Modificar' });
                }
                break;
            
            case 5: // Selección del comprobante a modificar
                const indexSeleccionado = parseInt(message) - 1;
            
                if (!isNaN(indexSeleccionado) && flowData.comprobantes[indexSeleccionado]) {
                    flowData.comprobanteSeleccionado = indexSeleccionado;
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 4, flowData);
                    await sock.sendMessage(userId, {
                        text: '✏️ Escribe qué dato deseas modificar (Ejemplo: "El monto es incorrecto, debe ser 50,000").',
                    });
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Selección no válida. Envía el número del comprobante que deseas modificar.' });
                }
                break;
            
            case 4: // Modificación del comprobante seleccionado
                const comprobanteModificar = flowData.comprobantes[flowData.comprobanteSeleccionado];
            
                if (comprobanteModificar) {
                    const respuesta = await analizarModificacionComprobante(comprobanteModificar, message);
                    flowData.comprobantes[flowData.comprobanteSeleccionado] = { ...comprobanteModificar, ...respuesta.respuesta}
                    const comprobanteModificado = flowData.comprobantes[flowData.comprobanteSeleccionado]
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 3, flowData);
                    
                    await sock.sendMessage(userId, {
                        text: `- *Monto*: ${formatCurrency(comprobanteModificado?.monto) || 'No detectado'}\n` +
                            `- *Número de comprobante*: ${comprobanteModificado?.numero_comprobante || 'No detectado'}\n` +
                            `- *Banco emisor*: ${comprobanteModificado?.banco_emisor || 'No detectado'}\n` +
                            `- *Cliente Emisor*: ${flowData.clienteEmisor || 'No especificado'}\n` +
                            `- *Cliente Receptor*: ${flowData.clienteReceptor || 'No especificado'}\n` +
                            `- *Tipo de Cheque*: ${comprobanteModificado.tipoCheque}\n\n` +
                            `Resumen de descuentos:\n` +
                            `- Descuento Cheque (1.8%): ${formatCurrency(comprobanteModificado.descuentoGeneral)}\n` +
                            `- Descuento ${comprobanteModificado.tipoCheque}: ${formatCurrency(comprobanteModificado.descuento)}\n` +
                            `- **Total a recibir**: ${formatCurrency(comprobanteModificado.total)}\n\n`
                    });

                    await sock.sendMessage(userId, {
                        text: `¿Deseas confirmar los cambios?\n\n1️⃣ Confirmar\n2️⃣ Cancelar\n3️⃣ Modificar otro dato`,
                    });
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Ocurrió un error. Intenta seleccionar el comprobante nuevamente.' });
                }
                break;
            case 6: // Preguntar si quiere modificar un cheque
                if (message === '1') {
                    // Si el usuario no quiere modificar, pasamos al siguiente paso
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 0, flowData);
                    await sock.sendMessage(userId, { text: '2️⃣ ¿Quién es el cliente que envía la transferencia? (Escribe el nombre).' });
                } else if (message === '2') {
                    // Si hay varios cheques, mostrar la lista para elegir cuál modificar
                    let mensaje = '✏️ ¿Qué cheque deseas modificar? Envía el número correspondiente:\n\n';
                    flowData.comprobantes.forEach((cheque, index) => {
                        mensaje += `${index + 1}️⃣ ${formatCurrency(cheque.monto)} - ${cheque.banco_emisor}\n`;
                    });
            
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 7, flowData);
                    await sock.sendMessage(userId, { text: mensaje });
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Respuesta no válida. Escribe 1️⃣ para continuar o 2️⃣ para modificar un cheque.' });
                }
                break;
            case 7: // Seleccionar el cheque a modificar
                const indexS = parseInt(message) - 1;
            
                if (!isNaN(indexS) && flowData.comprobantes[indexS]) {
                    flowData.comprobanteSeleccionado = indexS;
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 8, flowData);
                    await sock.sendMessage(userId, {
                        text: `✏️ Escribe qué dato deseas modificar (Ejemplo: "El monto es incorrecto, debe ser 50,000").`,
                    });
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Selección no válida. Envía el número del cheque que deseas modificar.' });
                }
                break;
            case 8: // Aplicar modificación al cheque seleccionado
                const chequeModificar = flowData.comprobantes[flowData.comprobanteSeleccionado];
            
                if (chequeModificar) {
                    const respuesta = await analizarModificacionComprobante(chequeModificar, message);
                    flowData.comprobantes[flowData.comprobanteSeleccionado] = { ...chequeModificar, ...respuesta.respuesta };
            
                    FlowManager.setFlow(userId, 'CREAR_OPERACION', 6, flowData);
            
                    await sock.sendMessage(userId, {
                        text: `✅ Modificación aplicada:\n\n` +
                            `- *Monto:* ${formatCurrency(flowData.comprobantes[flowData.comprobanteSeleccionado].monto)}\n` +
                            `- *Banco:* ${flowData.comprobantes[flowData.comprobanteSeleccionado].banco_emisor}\n` +
                            `- *Número:* ${flowData.comprobantes[flowData.comprobanteSeleccionado].numero_comprobante}\n` +
                            `- *Fecha de pago:* ${flowData.comprobantes[flowData.comprobanteSeleccionado].fecha_pago}\n\n` +
                            `¿Deseas modificar otro cheque o continuar?\n\n` +
                            `1️⃣ No, continuar\n2️⃣ Sí, modificar otro cheque`,
                    });
                } else {
                    await sock.sendMessage(userId, { text: '⚠️ Ocurrió un error. Intenta seleccionar el cheque nuevamente.' });
                }
                break;
            
            default:
                FlowManager.resetFlow(userId);
                await sock.sendMessage(userId, { text: '⚠️ Algo salió mal. Intenta nuevamente desde el inicio.' });
            
        }
    },
};

module.exports = crearOperacionFlow;
