const { OpenAI } = require("openai");

require('dotenv').config(); // Cargar variables de entorno


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = openai;