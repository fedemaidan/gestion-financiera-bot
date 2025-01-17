const fs = require('fs');
const { promisify } = require('util');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { admin } = require('./firebaseUtils'); // Configuración de Firebase Admin

// Función para guardar un archivo en Firebase Storage
async function saveFileToStorage(buffer, fileName, filePath, mimeType) {
    const bucket = admin.storage().bucket();
    
    try {
        // Referencia al archivo en Firebase Storage
        const file = bucket.file(filePath);
        console.log(1)
        // Subir el archivo
        await file.save(buffer, {
            metadata: { contentType: mimeType },
        });
        console.log(2)
        // Obtener una URL firmada del archivo
        const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: '03-09-2491', // Fecha arbitraria
        });
        console.log(3)
        console.log(`Archivo subido a Firebase Storage: ${signedUrl}`);
        return { success: true, signedUrl };
    } catch (error) {
        console.error('Error al guardar archivo en Firebase Storage:', error.message);
        return { success: false, error: error.message };
    }
}

// Función para descargar una imagen y subirla a Firebase Storage
async function saveImageToStorage(message, senderPhone) {
    try {
        // Descargar la imagen usando Baileys
        const buffer = await downloadMediaMessage(message, 'buffer');

        // Generar un nombre de archivo único
        const date = new Date().toISOString().split('T')[0]; // Fecha actual en formato YYYY-MM-DD
        const randomNumber = Math.floor(Math.random() * 1000000);
        const fileName = `${randomNumber}.jpeg`;

        // Ruta en Firebase Storage basada en el número de teléfono y la fecha
        const filePath = `cheques/${senderPhone}/${date}/${fileName}`;

        // Guardar la imagen en Firebase Storage
        const mimeType = 'image/jpeg';
        const storageResult = await saveFileToStorage(buffer, fileName, filePath, mimeType);

        if (storageResult.success) {
            console.log(`Imagen guardada en: ${storageResult.signedUrl}`);
            return storageResult.signedUrl;
        } else {
            console.error('Error guardando la imagen en Firebase Storage:', storageResult.error);
            return null;
        }
    } catch (error) {
        console.error('Error descargando o guardando la imagen:', error.message);
        return null;
    }
}

module.exports = { saveImageToStorage };
