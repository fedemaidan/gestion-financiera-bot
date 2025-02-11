const admin = require('firebase-admin');
const { serviceAccount } = require('./firebaseServiceAccount')

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "factudata-3afdf.appspot.com"
  });
  
const db = admin.firestore();
module.exports = { admin, db };
