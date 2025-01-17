const { getByChatgpt4Vision } = require('./base');
const openai = require('./openai'); // Importar el cliente OpenAI configurado
const fs = require('fs');

const analizarCheque = async (filePath) => {
    try {
        // const r_fake = {
        //     tipo: 'TRANSFERENCIA',
        //     monto: '23000.00',
        //     banco_emisor: 'Mercado Pago',
        //     'numero_operación': '99146705059'
        //   }
        //   return { respuesta: r_fake, prompt: "prompt"};
        const comprobantes = [
            {
                name: "Cheque",
                accion: "CHEQUE",
                json_data: {
                    "tipo": "CHEQUE",
                    "monto": 'monto del cheque o null',
                    "banco_emisor": 'banco emisor del cheque o null',
                    "numero_comprobante": 'número de la operación/cheque/ o cualquier referencia al mismo/ o null',

                }
            },
            {
                name: "Transferencia",
                accion: "TRANSFERENCIA",
                json_data: {
                    "tipo": "TRANSFERENCIA",
                    "monto": 'monto de la transferencia o null',
                    "banco_emisor": 'banco emisor de la transferencia o null',
                    "numero_operación": 'número de la operación/transferencia',

                }
            }
        ]
        // Prompts para analizar el cheque
        const prompt = `
            Eres un asistente financiero. Voy a proporcionarte una imagen de un cheque o comprobante de transferencia.
            Tu objetivo es identificar que comprobante es y extraer la información relevante.
            Formatos de comprobantes: ${JSON.stringify(comprobantes)}

            Devuelve los datos como un JSON con su formato correspondiente.
        `;

        // Consultar a OpenAI
        const response = await getByChatgpt4Vision([filePath], prompt);

        const respuesta = JSON.parse(response);
        console.log('Respuesta de OpenAI:', respuesta);
        if (respuesta.hasOwnProperty('json_data'))
        return { respuesta: respuesta.json_data, prompt: prompt};
        else
        return { respuesta: respuesta, prompt: prompt};
    } catch (error) {
        console.error('Error analizando el cheque:', error.message);
        return null;
    }
};

module.exports = { analizarCheque };
